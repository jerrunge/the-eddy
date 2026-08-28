// eddy-guide v1: the guide. Claude on his own backend, grounded in the open
// episode, his history, his ritual map, his beliefs, and his live body state.
// Same auth pattern as eddy-api (device token hash; service role inside).
//
// THE REASSURANCE LAW (RULINGS 2026-08-28): the mechanism is fully built but the
// law ships OFF. eddy_config.reassurance_law: 'off' answers fresh every time;
// 'a1' arms verbatim-repeat with the honest counter and the New Ground release.
// Nothing arms without Jeremy's explicit word. No other rule, cap, or gate exists
// in this function by design.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.40.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_HASH = "65c1760f8404c8eec8bbc938ac3c9a0ab60623eea93a643f25214cd628fc9e4f";
const ALLOWED_ORIGINS = ["https://jerrunge.github.io", "http://localhost:4181"];

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
function ptToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

const MOVE_GRAMMAR: Record<string, string> = {
  land: `THE MOVE: Land it (RF-CBT, Watkins). Drag this loop from the abstract register to the concrete. Never ask or answer WHY questions. Ask or supply: what exactly happened, in one sentence; what he would literally see or hear if the feared thing were true; what the next ten-minute action is. End with that one concrete action.`,
  two_stories: `THE MOVE: Two stories (I-CBT, O'Connor). Lay the DOUBT STORY (the inference his imagination built, its "maybe" chain) beside the SENSE STORY (what his senses, his record, and the last direct evidence actually report right now). Name the exact sentence where he crossed from evidence into imagination. Do not argue the doubt content; show the crossing point.`,
  park_suggest: `THE MOVE: Park it (MCT, Wells). Help him postpone the loop, not resolve it. Do not engage the content at all. Reflect in one sentence that the loop is written down and held, propose a concrete appointment time that fits the hour, and remind him that most parks arrive quiet, per his own record if the numbers are in context.`,
  next_move: `THE MOVE: Next move (ADHD activation). One concrete physical action, five minutes or less, startable from exactly where he is (bed, couch, desk). Name the first physical motion. Nothing abstract, no lists, no choices. One action.`,
  open: `Open talk. Hold the therapy grammar in the background: process over content (MCT), concrete over abstract (RF-CBT), evidence versus inference (I-CBT). Follow his lead.`,
};

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
  if (!body.token || (await sha256hex(String(body.token))) !== TOKEN_HASH) {
    return new Response(JSON.stringify({ error: "bad token" }), { status: 403, headers });
  }
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500, headers });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const episodeId = body.episode_id ?? null;
  const mode = MOVE_GRAMMAR[body.mode] ? body.mode : "open";
  const ask = String(body.ask ?? "").slice(0, 8000);

  try {
    const today = ptToday();
    const [cfg, entries, recentEps, rituals, marks, beliefs, health, cap, meds, parksAll, lastAsks] = await Promise.all([
      sb.from("eddy_config").select("key, value"),
      episodeId ? sb.from("eddy_entries").select("at, text, source").eq("episode_id", episodeId).order("at") : Promise.resolve({ data: [] }),
      sb.from("eddy_episodes").select("opened_at, minutes, ended_by, capacity").order("opened_at", { ascending: false }).limit(8),
      sb.from("eddy_rituals").select("id, name"),
      sb.from("eddy_ritual_marks").select("ritual_id, rode, at").order("at", { ascending: false }).limit(30),
      sb.from("eddy_beliefs").select("belief, polarity, rating, at").order("at", { ascending: false }).limit(10),
      sb.from("health_snapshots").select("date, sleep_total_min, hrv_sdnn_ms").order("date", { ascending: false }).limit(1),
      sb.from("capacity_state").select("state").eq("date", today).order("declared_at", { ascending: false }).limit(1),
      sb.from("med_log").select("med_name, taken_at").eq("date", today),
      sb.from("eddy_parks").select("arrived"),
      sb.from("eddy_replies").select("ask, reply, at, ask_repeat").order("at", { ascending: false }).limit(6),
    ]);

    const config: Record<string, string> = {};
    for (const r of (cfg.data ?? []) as any[]) config[r.key] = r.value;
    const model = config.guide_model || "claude-sonnet-4-6";
    const lawArmed = config.reassurance_law === "a1";

    const ritualNames = new Map((rituals.data ?? []).map((r: any) => [r.id, r.name]));
    const rideCount = (marks.data ?? []).filter((m: any) => m.rode === true).length;
    const kept = (parksAll.data ?? []).length;
    const quiet = (parksAll.data ?? []).filter((p: any) => p.arrived === "quiet").length;
    const sleepMin = health.data?.[0]?.sleep_total_min ?? null;

    const ctx = [
      `Time now (Pacific): ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`,
      sleepMin != null ? `Last night's sleep: ${(sleepMin / 60).toFixed(1)} hours. HRV: ${health.data?.[0]?.hrv_sdnn_ms ?? "unknown"}.` : `Sleep data not in yet.`,
      cap.data?.[0]?.state ? `His declared capacity today: ${cap.data[0].state}.` : `No declared capacity today.`,
      (meds.data ?? []).length ? `Meds logged today: ${(meds.data as any[]).map((m) => m.med_name).join(", ")}.` : `No meds logged yet today (relevant: unmedicated ADHD hours make loops stickier; never scold about it).`,
      `His park record: ${kept} loops parked so far, ${quiet} arrived quiet at their appointment.`,
      `His response-prevention reps so far: ${rideCount} urges ridden.`,
      `His named mental rituals: ${[...ritualNames.values()].join(", ")}.`,
      (beliefs.data ?? []).length ? `Recent belief ratings: ${(beliefs.data as any[]).slice(0, 4).map((b) => `"${b.belief}" (${b.polarity}) ${b.rating}/100`).join("; ")}.` : ``,
      `Recent episodes: ${(recentEps.data ?? []).map((e: any) => `${String(e.opened_at).slice(0, 16)} (${e.minutes ?? "?"}min, ${e.ended_by ?? "open"})`).join("; ") || "this is early days"}.`,
      `THIS EPISODE, his words in order:`,
      ...(entries.data ?? []).map((e: any) => `[${String(e.at).slice(11, 16)}] ${e.text}`),
    ].filter(Boolean).join("\n");

    const system = [
      `You are the guide inside The Eddy, Jeremy's own app for the minute an OCD rumination loop plus ADHD has him. You are talking to Jeremy, an adult expert in his own life. You run on his infrastructure and everything you say is stored in his record, visible only to him.`,
      `Voice: warm, direct, plain words, short. Two to four sentences unless he asks for more. Never use an em dash. Never scold, never assess him, never say "you should have", never mention streaks or scores. Never narrate that you are using a therapy; just do it.`,
      `The loop is the PROCESS, not the content (MCT). Concrete beats abstract (RF-CBT). Evidence versus inference (I-CBT). Riding an urge beats feeding it (ERP). These are your instincts, not your vocabulary.`,
      `Never invent rules for him, never gate him, never refuse to engage. If he is in real danger he knows his own resources; that surface is not your job (his explicit ruling).`,
      MOVE_GRAMMAR[mode],
      lawArmed
        ? `THE REASSURANCE LAW IS ARMED (his rule A1): the recent asks and your recent answers are in context. If his current ask is the SAME DOUBT as a recent one, even reworded, respond with the EXACT text of your previous answer, prefixed by "Same answer, ask ${"${n}"}:" where n is the repeat count. Only genuinely new information releases a fresh answer.`
        : `The reassurance law is OFF by his instruction: answer fresh every time. Do not count or comment on repeated asks.`,
      lawArmed ? `RECENT ASKS AND ANSWERS:\n${(lastAsks.data ?? []).map((r: any) => `ASK: ${r.ask}\nANSWER: ${r.reply}`).join("\n---\n")}` : ``,
    ].filter(Boolean).join("\n\n");

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: `${ctx}\n\nHIS ASK RIGHT NOW (${mode}): ${ask || "(no words; he tapped the move)"}` }],
    });
    const reply = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();

    if (episodeId) {
      await sb.from("eddy_replies").insert({ id: crypto.randomUUID(), episode_id: episodeId, mode, ask, reply });
    }
    return new Response(JSON.stringify({ reply, mode }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
