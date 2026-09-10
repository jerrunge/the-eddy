// face-knock v1: the knocks for the new 29:11 face. Called by pg_cron every 15
// minutes, 7am to 10pm Pacific. No essays, no gates: a knock is one line with the
// numbers, at the edge of each block, for a routine whose time he set on the glass,
// and for a med by its timing. Sends Web Push to the Harbor's subscriptions (same
// phone, same VAPID keys); the click opens the face. Auth: face_knock_secret lives
// only in eddy_config, generated server-side. verify_jwt=false by design.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const USER = "5c048e07-15b3-4a44-98e7-33cde24017ac";
const FACE_URL = "https://jerrunge.github.io/the-eddy/2911-9c4e1a/";
const BLOCK_OF: Record<string, string> = { wake: "Wake", levo_gap_closed: "Wake", meal_start: "Midday", fork_down: "Midday", dip_clear: "Midday", gym_leave: "Midday", wind_down: "Evening", lights_down: "Evening", close: "Close" };
const BLOCK_START: Record<string, number> = { Wake: 7 * 60, Midday: 11 * 60 + 30, Evening: 18 * 60, Close: 20 * 60 + 30 };
const MED_MINUTE: Record<string, number> = { on_waking: 7 * 60 + 5, with_breakfast: 8 * 60 + 30, pre_gym: 14 * 60, bedtime: 21 * 60 + 30, weekly: 9 * 60 };

function pt() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hour12: false, weekday: "short" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24, m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const date = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  return { minute: h * 60 + m, date, thu: wd === "Thu" };
}
const inWindow = (target: number, minute: number, width = 15) => minute >= target && minute < target + width;

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  let body: any; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const cfgRows = await sb.from("eddy_config").select("key, value");
    const cfg: Record<string, string> = {}; for (const r of (cfgRows.data ?? []) as any[]) cfg[r.key] = r.value;
    if (!cfg.face_knock_secret || String(body.secret ?? "") !== cfg.face_knock_secret) return new Response(JSON.stringify({ error: "bad secret" }), { status: 403, headers });
    if (!cfg.vapid_public || !cfg.vapid_private) return new Response(JSON.stringify({ error: "vapid keys missing" }), { status: 500, headers });
    const { minute, date, thu } = pt();
    const force = body.force === true;
    const [routines, comps, meds, medlog, sent, subs, weights, items, boxes] = await Promise.all([
      sb.from("checklist_templates").select("id, title, anchor, window_start, paused, cadence, days").eq("user_id", USER).eq("paused", false),
      sb.from("checklist_completions").select("template_id").eq("date", date),
      sb.from("medications").select("name, timing").eq("active", true),
      sb.from("med_log").select("med_name").eq("date", date),
      sb.from("face_knocks").select("key").eq("date", date),
      sb.from("harbor_push_subs").select("endpoint, p256dh, auth"),
      sb.from("health_snapshots").select("date, weight_lb").not("weight_lb", "is", null).order("date"),
      sb.from("desk_items").select("text, due, done, kind").eq("done", false).not("due", "is", null),
      sb.from("desk_boxes").select("title, deadline").eq("archived", false).not("deadline", "is", null),
    ]);
    const done = new Set((comps.data ?? []).map((c: any) => c.template_id));
    const already = new Set((sent.data ?? []).map((s: any) => s.key));
    const taken = new Set((medlog.data ?? []).map((m: any) => m.med_name));
    const knocks: { key: string; title: string; body: string }[] = [];

    // the morning line: the numbers, once, at 7:15
    if (force || inWindow(7 * 60 + 15, minute)) {
      const W = (weights.data ?? []) as any[];
      let num = "";
      if (W.length) { const hi = W.reduce((a, b) => Number(b.weight_lb) > Number(a.weight_lb) ? b : a); const last = W[W.length - 1]; num = `${(Number(hi.weight_lb) - Number(last.weight_lb)).toFixed(1)} lb off the high. `; }
      const open = (routines.data ?? []).length; const lateItems = (items.data ?? []).filter((i: any) => i.due < date).length;
      const dueBoxes = (boxes.data ?? []).filter((b: any) => b.deadline >= date).sort((a: any, b: any) => a.deadline.localeCompare(b.deadline))[0];
      knocks.push({ key: "morning", title: "29:11", body: `${num}${open} routines today, ${(meds.data ?? []).length} meds${lateItems ? `, ${lateItems} late items` : ""}${dueBoxes ? `. ${dueBoxes.title} in ${Math.round((new Date(dueBoxes.deadline).getTime() - new Date(date).getTime()) / 86400000)} days.` : "."}` });
    }
    // block edges: one knock per block with the count still open
    for (const [block, start] of Object.entries(BLOCK_START)) {
      if (!(force || inWindow(start, minute))) continue;
      const rs = (routines.data ?? []).filter((r: any) => BLOCK_OF[r.anchor ?? "wake"] === block && !done.has(r.id) && !r.window_start);
      if (rs.length) knocks.push({ key: `block:${block}`, title: `${block}`, body: `${rs.length} on the list: ${rs.slice(0, 3).map((r: any) => r.title).join(", ")}${rs.length > 3 ? "…" : ""}` });
    }
    // routines with a time he set on the glass
    for (const r of (routines.data ?? []) as any[]) {
      if (!r.window_start || done.has(r.id)) continue;
      const [hh, mm] = String(r.window_start).split(":").map(Number); const t = hh * 60 + mm;
      if (force || inWindow(t, minute)) knocks.push({ key: `routine:${r.id}`, title: r.title, body: `It's ${String(r.window_start).slice(0, 5)}. You set this one.` });
    }
    // meds by timing, unmarked
    for (const m of (meds.data ?? []) as any[]) {
      if (taken.has(m.name)) continue;
      const t = MED_MINUTE[m.timing]; if (t == null) continue;
      if (m.timing === "weekly" && !thu) continue;
      if (force || inWindow(t, minute)) knocks.push({ key: `med:${m.timing}`, title: "Meds", body: `${(meds.data ?? []).filter((x: any) => x.timing === m.timing && !taken.has(x.name)).map((x: any) => x.name).join(", ")}${m.timing === "weekly" ? " (Thursday)" : ""}` });
    }
    // dedupe by key, skip already sent today
    const seen = new Set<string>(); const todo = knocks.filter((k) => !already.has(k.key) && !seen.has(k.key) && seen.add(k.key));
    webpush.setVapidDetails("mailto:jerrunge@gmail.com", cfg.vapid_public, cfg.vapid_private);
    let sentN = 0, failed = 0, pruned = 0;
    for (const k of todo) {
      const payload = JSON.stringify({ title: k.title, body: k.body, url: FACE_URL, tag: k.key });
      for (const s of (subs.data ?? []) as any[]) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } } as any, payload, { TTL: 1800 }); sentN++; }
        catch (e: any) { failed++; if (e?.statusCode === 404 || e?.statusCode === 410) { await sb.from("harbor_push_subs").delete().eq("endpoint", s.endpoint); pruned++; } }
      }
      await sb.from("face_knocks").upsert({ key: k.key, date, body: k.body }, { onConflict: "key,date" });
    }
    return new Response(JSON.stringify({ minute, date, candidates: knocks.length, sent_keys: todo.map((k) => k.key), subs: (subs.data ?? []).length, sent: sentN, failed, pruned }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
