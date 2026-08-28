// eddy-dispatch v1: the park appointment rail. Called by pg_cron every 5 minutes
// (net.http_post, the estate's proven pattern). Finds parks that have come due,
// sends Web Push to every subscribed device, and stamps notified_at. The in-app
// arrival banner is the belt-and-braces surface; this is the knock.
// Auth: the dispatch secret lives ONLY in eddy_config (generated server-side by
// gen_random_bytes; it never left the database). The cron reads it at runtime and
// this function compares against the same row. verify_jwt=false.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
    return new Response(JSON.stringify({ due: dueParks.length, subs: subscriptions.length, sent, failed, pruned }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
