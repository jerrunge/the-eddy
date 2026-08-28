// eddy-api v1: the Eddy's single data door.
// Auth: device token checked against an embedded SHA-256 hash (the room-cabinet
// pattern). Tables are RLS-enabled with zero policies, so only this function's
// service role reaches them. verify_jwt=false is deliberate and load-bearing.
// Every write is an idempotent upsert on a client-generated UUID, which is what
// lets the offline queue replay safely; capture is never blocked by this door.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_HASH = "65c1760f8404c8eec8bbc938ac3c9a0ab60623eea93a643f25214cd628fc9e4f";
const ALLOWED_ORIGINS = ["https://jerrunge.github.io", "http://localhost:4181"];
const USER_ID = "5c048e07-15b3-4a44-98e7-33cde24017ac";

function cors(origin: string | null) {
  const o = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function db() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function ptToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
  if (!body.token || (await sha256hex(String(body.token))) !== TOKEN_HASH) {
    return new Response(JSON.stringify({ error: "bad token" }), { status: 403, headers });
  }

  const sb = db();
  try {
    if (body.op === "context") {
      const today = ptToday();
      const [health, cap, meds, parksDue, parksAll, rituals] = await Promise.all([
        sb.from("health_snapshots").select("date, sleep_total_min, hrv_sdnn_ms").order("date", { ascending: false }).limit(1),
        sb.from("capacity_state").select("state, declared_at").eq("date", today).order("declared_at", { ascending: false }).limit(1),
        sb.from("med_log").select("med_name, taken_at").eq("date", today),
        sb.from("eddy_parks").select("id, until, note, episode_id").is("arrived", null).lte("until", new Date().toISOString()).order("until"),
        sb.from("eddy_parks").select("id, arrived"),
        sb.from("eddy_rituals").select("id, name").order("created_at"),
      ]);
      const kept = (parksAll.data ?? []).length;
      const quiet = (parksAll.data ?? []).filter((p: any) => p.arrived === "quiet").length;
      return new Response(JSON.stringify({
        sleep_min: health.data?.[0]?.sleep_total_min ?? null,
        hrv: health.data?.[0]?.hrv_sdnn_ms ?? null,
        capacity: cap.data?.[0]?.state ?? null,
        meds_today: (meds.data ?? []).map((m: any) => m.med_name),
        parks_due: parksDue.data ?? [],
        parks_kept: kept,
        parks_quiet: quiet,
        rituals: rituals.data ?? [],
      }), { headers });
    }

    if (body.op === "sync") {
      const results: any[] = [];
      for (const o of (body.ops ?? []).slice(0, 200)) {
        try {
          if (o.kind === "episode_open") {
            await sb.from("eddy_episodes").upsert({ id: o.id, user_id: USER_ID, opened_at: o.opened_at, capacity: o.capacity ?? null, sleep_h: o.sleep_h ?? null, entry_mode: o.entry_mode ?? "typed" });
          } else if (o.kind === "episode_close") {
            await sb.from("eddy_episodes").update({ closed_at: o.closed_at, ended_by: o.ended_by, minutes: o.minutes ?? null, entry_mode: o.entry_mode ?? undefined }).eq("id", o.id);
          } else if (o.kind === "entry_add") {
            await sb.from("eddy_entries").upsert({ id: o.id, episode_id: o.episode_id, at: o.at, text: String(o.text ?? "").slice(0, 20000), source: o.source ?? "typed" });
          } else if (o.kind === "park_add") {
            await sb.from("eddy_parks").upsert({ id: o.id, episode_id: o.episode_id ?? null, parked_at: o.parked_at, until: o.until, note: o.note ?? null });
          } else if (o.kind === "park_arrive") {
            await sb.from("eddy_parks").update({ arrived: o.arrived }).eq("id", o.id);
          } else if (o.kind === "ritual_add") {
            await sb.from("eddy_rituals").upsert({ id: o.id, name: String(o.name ?? "").slice(0, 80) });
          } else if (o.kind === "ritual_mark") {
            await sb.from("eddy_ritual_marks").upsert({ id: o.id, ritual_id: o.ritual_id, episode_id: o.episode_id ?? null, at: o.at, rode: o.rode ?? null, seconds: o.seconds ?? null });
          } else if (o.kind === "belief_rate") {
            await sb.from("eddy_beliefs").upsert({ id: o.id, at: o.at, belief: String(o.belief ?? "").slice(0, 300), polarity: o.polarity ?? "negative", rating: o.rating });
          }
          results.push({ id: o.id, ok: true });
        } catch (e) {
          results.push({ id: o.id, ok: false, error: String(e).slice(0, 200) });
        }
      }
      return new Response(JSON.stringify({ results }), { headers });
    }

    if (body.op === "record") {
      const [eps, marks, beliefs, parks] = await Promise.all([
        sb.from("eddy_episodes").select("id, opened_at, closed_at, ended_by, capacity, minutes, entry_mode").order("opened_at", { ascending: false }).limit(60),
        sb.from("eddy_ritual_marks").select("ritual_id, at, rode, seconds").order("at", { ascending: false }).limit(200),
        sb.from("eddy_beliefs").select("at, belief, polarity, rating").order("at", { ascending: false }).limit(100),
        sb.from("eddy_parks").select("parked_at, until, arrived, note").order("parked_at", { ascending: false }).limit(100),
      ]);
      const ids = (eps.data ?? []).map((e: any) => e.id);
      const entries = ids.length
        ? await sb.from("eddy_entries").select("episode_id, at, text").in("episode_id", ids.slice(0, 60)).order("at")
        : { data: [] };
      return new Response(JSON.stringify({ episodes: eps.data ?? [], entries: entries.data ?? [], marks: marks.data ?? [], beliefs: beliefs.data ?? [], parks: parks.data ?? [] }), { headers });
    }

    if (body.op === "push_subscribe") {
      const { endpoint, p256dh, auth, ua } = body;
      if (!endpoint || !p256dh || !auth) return new Response(JSON.stringify({ error: "missing sub fields" }), { status: 400, headers });
      await sb.from("eddy_push_subs").upsert({ id: crypto.randomUUID(), endpoint, p256dh, auth, ua: ua ?? null }, { onConflict: "endpoint" });
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "unknown op" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
