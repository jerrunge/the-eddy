// eddy-dispatch v3: the park appointment rail, and the backstop that closes a
// loop he walked away from. Called by pg_cron every 5 minutes (net.http_post,
// the estate's proven pattern). Finds parks that have come due, sends Web Push
// to every subscribed device, and stamps notified_at. The in-app arrival banner
// is the belt-and-braces surface; this is the knock.
// Auth: the dispatch secret lives ONLY in eddy_config (generated server-side by
// gen_random_bytes; it never left the database). The cron reads it at runtime and
// this function compares against the same row. verify_jwt=false.
//
// v2 (2026-09-17, his word "make sure there is a close it mechanism in place, or
// a button for me to press when complete, so the function actually works"): the
// idle close. Seven of the eight episodes since 08-28 were never closed, so
// everything keyed to a close never fired. The button is his; this is the
// backstop for the nights he puts the phone down instead. Any episode with no
// entry for eight hours is closed as "idle", dated to his last word rather than
// to now, and handed to the guide's summarize op so the loop still becomes
// memory. Nothing here scores him and nothing deletes anything.
// v3 (2026-09-17, homebase): closed loops with words and no summary yet get one, three a tick,
// so the 09-14 loop he closed before the memory existed becomes memory too.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const IDLE_HOURS = 8;

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const [cfg, due, subs] = await Promise.all([
      sb.from("eddy_config").select("key, value").in("key", ["vapid_public", "vapid_private", "dispatch_secret"]),
      sb.from("eddy_parks").select("id, until, note").is("notified_at", null).lte("until", new Date().toISOString()).limit(20),
      sb.from("eddy_push_subs").select("id, endpoint, p256dh, auth"),
    ]);
    const config: Record<string, string> = {};
    for (const r of (cfg.data ?? []) as any[]) config[r.key] = r.value;
    if (!config.dispatch_secret || String(body.secret ?? "") !== config.dispatch_secret) {
      return new Response(JSON.stringify({ error: "bad secret" }), { status: 403, headers });
    }
    if (!config.vapid_public || !config.vapid_private) {
      return new Response(JSON.stringify({ error: "vapid keys missing" }), { status: 500, headers });
    }
    webpush.setVapidDetails("mailto:jerrunge@gmail.com", config.vapid_public, config.vapid_private);

    const dueParks = due.data ?? [];
    const subscriptions = subs.data ?? [];
    let sent = 0, failed = 0, pruned = 0;

    for (const park of dueParks) {
      const preview = (park.note ?? "").slice(0, 60);
      const payload = JSON.stringify({
        title: "The Eddy",
        body: preview ? `The parked loop is ready for you: ${preview}` : "A parked loop is ready for you.",
        park_id: park.id,
      });
      for (const s of subscriptions) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any, payload, { TTL: 3600 });
          sent++;
        } catch (e: any) {
          failed++;
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await sb.from("eddy_push_subs").delete().eq("id", s.id);
            pruned++;
          }
        }
      }
      await sb.from("eddy_parks").update({ notified_at: new Date().toISOString() }).eq("id", park.id);
    }

    /* ---- the idle close: a loop he walked away from still gets remembered -- */
    const idle: any[] = [];
    const cutoff = Date.now() - IDLE_HOURS * 3600000;
    const open = await sb.from("eddy_episodes").select("id, opened_at").is("closed_at", null).order("opened_at").limit(20);
    for (const ep of ((open.data ?? []) as any[])) {
      const last = await sb.from("eddy_entries").select("at").eq("episode_id", ep.id).order("at", { ascending: false }).limit(1).maybeSingle();
      const lastAt = last.data?.at ?? ep.opened_at;
      if (new Date(lastAt).getTime() > cutoff) continue;
      const minutes = Math.max(1, Math.round((new Date(lastAt).getTime() - new Date(ep.opened_at).getTime()) / 60000));
      await sb.from("eddy_episodes").update({ closed_at: lastAt, ended_by: "idle", minutes }).eq("id", ep.id);
      let summarized = false;
      if (last.data?.at && !body.no_summary) {
        try {
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eddy-guide`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ op: "summarize", episode_id: ep.id, service_key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") }),
          });
          summarized = r.ok;
        } catch { summarized = false; }
      }
      idle.push({ id: ep.id, minutes, summarized });
    }

    /* ---- the missing summaries: a loop closed before the memory existed, or a
       close whose summarize call failed, still becomes memory. Three a tick. ---- */
    const backfilled: any[] = [];
    if (!body.no_summary) {
      const closed = await sb.from("eddy_episodes").select("id, closed_at").not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(30);
      for (const ep of ((closed.data ?? []) as any[])) {
        if (backfilled.length >= 3) break;
        const has = await sb.from("eddy_episode_summaries").select("episode_id").eq("episode_id", ep.id).maybeSingle();
        if (has.data) continue;
        const said = await sb.from("eddy_entries").select("id").eq("episode_id", ep.id).limit(1);
        if (!(said.data ?? []).length) continue;
        let ok = false;
        try {
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eddy-guide`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ op: "summarize", episode_id: ep.id, service_key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") }),
          });
          ok = r.ok;
        } catch { ok = false; }
        backfilled.push({ id: ep.id, summarized: ok });
      }
    }

    return new Response(JSON.stringify({ due: dueParks.length, subs: subscriptions.length, sent, failed, pruned, idle_closed: idle.length, idle, backfilled }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
