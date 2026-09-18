// eddy-guide v3: the guide. Claude on his own backend, grounded in the open
// episode, his history, his ritual map, his beliefs, and his live body state.
// Same auth pattern as eddy-api (device token hash; service role inside).
//
// THE REASSURANCE LAW (RULINGS 2026-08-28): the mechanism is fully built but the
// law ships OFF. eddy_config.reassurance_law: 'off' answers fresh every time;
// 'a1' arms verbatim-repeat with the honest counter and the New Ground release.
// Nothing arms without Jeremy's explicit word. No other rule, cap, or gate exists
// in this function by design.
// v2 (2026-09-07): continuity. The guide's own earlier replies in THIS episode ride
// in the context, in time order with his words, so a reopened episode picks up the
// directions it was giving instead of starting cold.
// v3 (2026-09-17, his word): memory. Three things reach every ask now, because on
// 09-17 the guide steered him toward a conversation he had already struck on 09-10
// and he wrote, in the app, that he thought it had access to everything they had
// talked about:
//   1. HIS STANDING RULES (eddy_rules), the ones whose scope the moment touches,
//      quoted as his and dated. The guide holds him to them and never argues them.
//   2. THE LAST FIVE EPISODE SUMMARIES, so a loop he worked through last week is
//      not new ground this week.
//   3. THE HARBOR BOX whose name the moment names (David, Cooper), with its why,
//      its open items and its notes.
// Plus the op "summarize": one closed loop becomes one row of memory, including
// rule_candidates, which are only ever candidates. Nothing becomes a rule without
// his tap. The guide still never invents a rule for him.
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
function ptTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }); } catch { return String(iso).slice(11, 16); }
}
function ptDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); } catch { return String(iso).slice(0, 10); }
}
function esc(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// A scope or a box name is "touched" when the moment actually says the word.
function mentions(hay: string, word: string): boolean {
  const w = String(word ?? "").trim();
  if (!w) return false;
  try { return new RegExp("(^|[^a-z0-9])" + esc(w.toLowerCase()) + "([^a-z0-9]|$)").test(hay); } catch { return hay.includes(w.toLowerCase()); }
}

const MOVE_GRAMMAR: Record<string, string> = {
  land: `THE MOVE: Land it (RF-CBT, Watkins). Drag this loop from the abstract register to the concrete. Never ask or answer WHY questions. Ask or supply: what exactly happened, in one sentence; what he would literally see or hear if the feared thing were true; what the next ten-minute action is. End with that one concrete action.`,
  two_stories: `THE MOVE: Two stories (I-CBT, O'Connor). Lay the DOUBT STORY (the inference his imagination built, its "maybe" chain) beside the SENSE STORY (what his senses, his record, and the last direct evidence actually report right now). Name the exact sentence where he crossed from evidence into imagination. Do not argue the doubt content; show the crossing point.`,
  park_suggest: `THE MOVE: Park it (MCT, Wells). Help him postpone the loop, not resolve it. Do not engage the content at all. Reflect in one sentence that the loop is written down and held, propose a concrete appointment time that fits the hour, and remind him that most parks arrive quiet, per his own record if the numbers are in context.`,
  next_move: `THE MOVE: Next move (ADHD activation). One concrete physical action, five minutes or less, startable from exactly where he is (bed, couch, desk). Name the first physical motion. Nothing abstract, no lists, no choices. One action.`,
  open: `Open talk. Hold the therapy grammar in the background: process over content (MCT), concrete over abstract (RF-CBT), evidence versus inference (I-CBT). Follow his lead.`,
};

const SUMMARY_SYSTEM = `You are writing one loop into Jeremy's own memory, inside The Eddy, his app for an OCD rumination loop plus ADHD. You are reading an episode: his words and the guide's replies, in order. Write the row that will let a later conversation pick this up without him repeating himself.

Laws. Never assess him, never score him, never say what he should have done: this row is his to read and it holds facts and decisions, not a verdict. Never invent a rule for him. A rule candidate is only a line HE stated as something he holds or will do; if he did not state one, return an empty list. Never use an em dash. Plain words.

Return ONLY a JSON object, no prose around it, with exactly these keys:
{
  "summary": "6 to 12 sentences. What the loop was about, what actually happened in it, and where it ended. Write it so a later reader knows the situation cold.",
  "decisions": ["what HE decided, one per line, in his own words where he used them"],
  "guide_commitments": ["what the guide told him to do or promised to hold, one per line"],
  "open_threads": ["what is still unresolved and would come back, one per line"],
  "rule_candidates": [{"text": "the line, his words verbatim when they are his", "scope": ["David"], "his_words": true}]
}
scope holds the names or topics the rule answers to, for example ["David"], or ["always"] when it holds everywhere. his_words is true only when text is quoted verbatim from something he typed.`;

async function readEpisodeTimeline(sb: any, episodeId: string) {
  const [ep, entries, replies] = await Promise.all([
    sb.from("eddy_episodes").select("id, opened_at, closed_at, ended_by, minutes").eq("id", episodeId).maybeSingle(),
    sb.from("eddy_entries").select("at, text, source").eq("episode_id", episodeId).order("at"),
    sb.from("eddy_replies").select("at, mode, ask, reply").eq("episode_id", episodeId).order("at"),
  ]);
  const rows = [
    ...((entries.data ?? []) as any[]).map((e) => ({ at: e.at, line: `[${ptDate(e.at)} ${ptTime(e.at)}] HIM: ${String(e.text ?? "").slice(0, 1200)}` })),
    ...((replies.data ?? []) as any[]).map((r) => ({ at: r.at, line: `[${ptDate(r.at)} ${ptTime(r.at)}] THE GUIDE (${r.mode}): ${String(r.reply ?? "").slice(0, 700)}` })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { ep: ep.data ?? null, lines: rows.map((r) => r.line), entryCount: (entries.data ?? []).length, replyCount: (replies.data ?? []).length };
}

/* The summaries carry their episode's dates through the foreign key, so the
   guide can say when a loop happened rather than when it was written down. If
   the embed is not available yet, which is what a cold schema cache looks like
   in the minutes after the migration lands, fall back to the plain read rather
   than losing his memory for an hour. */
async function summariesQuery(sb: any) {
  const withEp = await sb.from("eddy_episode_summaries")
    .select("episode_id, at, summary, decisions, open_threads, eddy_episodes(opened_at, closed_at)")
    .order("at", { ascending: false }).limit(5);
  if (!withEp.error) return withEp;
  return await sb.from("eddy_episode_summaries")
    .select("episode_id, at, summary, decisions, open_threads")
    .order("at", { ascending: false }).limit(5);
}

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }

  // The device token, as always. The service key is the second door, for the
  // harness and eddy-dispatch only; it never ships inside the PWA.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const byToken = body.token ? (await sha256hex(String(body.token))) === TOKEN_HASH : false;
  const byService = !!(serviceKey && body.service_key && String(body.service_key) === serviceKey);
  if (!byToken && !byService) {
    return new Response(JSON.stringify({ error: "bad token" }), { status: 403, headers });
  }
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500, headers });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const episodeId = body.episode_id ?? null;
  const mode = MOVE_GRAMMAR[body.mode] ? body.mode : "open";
  const ask = String(body.ask ?? "").slice(0, 8000);

  try {
    const cfg = await sb.from("eddy_config").select("key, value").in("key", ["guide_model", "reassurance_law"]);
    const config: Record<string, string> = {};
    for (const r of (cfg.data ?? []) as any[]) config[r.key] = r.value;
    const model = config.guide_model || "claude-sonnet-4-6";
    const lawArmed = config.reassurance_law === "a1";
    const anthropic = new Anthropic({ apiKey });

    /* ---------------- op: summarize. One closed loop becomes one row. ------- */
    if (body.op === "summarize") {
      if (!episodeId) return new Response(JSON.stringify({ error: "episode_id required" }), { status: 400, headers });
      const { ep, lines, entryCount, replyCount } = await readEpisodeTimeline(sb, episodeId);
      if (!lines.length) return new Response(JSON.stringify({ error: "nothing said in this episode", episode_id: episodeId }), { status: 400, headers });
      const head = [
        `EPISODE ${episodeId}`,
        ep ? `Opened ${ptDate(ep.opened_at)} ${ptTime(ep.opened_at)} Pacific${ep.closed_at ? `, closed ${ptDate(ep.closed_at)} ${ptTime(ep.closed_at)} (${ep.ended_by ?? "?"})` : ", still open"}.` : ``,
        `${entryCount} things he said, ${replyCount} replies from the guide.`,
        ``,
      ].filter(Boolean).join("\n");
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 2000,
        system: SUMMARY_SYSTEM,
        messages: [{ role: "user", content: head + lines.slice(-400).join("\n") }],
      });
      const raw = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      let parsed: any = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m ? m[0] : raw);
      } catch {
        return new Response(JSON.stringify({ error: "the summary did not come back as json", raw: raw.slice(0, 400) }), { status: 502, headers });
      }
      const row = {
        episode_id: episodeId,
        at: new Date().toISOString(),
        summary: String(parsed.summary ?? "").slice(0, 8000),
        decisions: parsed.decisions ?? [],
        open_threads: parsed.open_threads ?? [],
        rule_candidates: parsed.rule_candidates ?? [],
        model,
      };
      // guide_commitments live inside the summary text so the shape stays the
      // one he ruled on; they are the second half of "what was agreed here".
      if (Array.isArray(parsed.guide_commitments) && parsed.guide_commitments.length) {
        row.summary = row.summary + "\n\nWhat the guide committed to: " + parsed.guide_commitments.join(" ");
      }
      if (!body.dry) {
        const w = await sb.from("eddy_episode_summaries").upsert(row, { onConflict: "episode_id" });
        if (w.error) return new Response(JSON.stringify({ error: String(w.error.message ?? w.error).slice(0, 300), summary: row }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ ok: true, dry: !!body.dry, ...row }), { headers });
    }

    /* ---------------- the ask ----------------------------------------------- */
    const today = ptToday();
    const [entries, epReplies, recentEps, rituals, marks, beliefs, health, cap, meds, parksAll, lastAsks, rules, summaries, boxes] = await Promise.all([
      episodeId ? sb.from("eddy_entries").select("at, text, source").eq("episode_id", episodeId).order("at") : Promise.resolve({ data: [] }),
      episodeId ? sb.from("eddy_replies").select("at, mode, ask, reply").eq("episode_id", episodeId).order("at") : Promise.resolve({ data: [] }),
      sb.from("eddy_episodes").select("opened_at, minutes, ended_by, capacity").order("opened_at", { ascending: false }).limit(8),
      sb.from("eddy_rituals").select("id, name"),
      sb.from("eddy_ritual_marks").select("ritual_id, rode, at").order("at", { ascending: false }).limit(30),
      sb.from("eddy_beliefs").select("belief, polarity, rating, at").order("at", { ascending: false }).limit(10),
      sb.from("health_snapshots").select("date, sleep_total_min, hrv_sdnn_ms").order("date", { ascending: false }).limit(1),
      sb.from("capacity_state").select("state").eq("date", today).order("declared_at", { ascending: false }).limit(1),
      sb.from("med_log").select("med_name, taken_at").eq("date", today),
      sb.from("eddy_parks").select("arrived"),
      sb.from("eddy_replies").select("ask, reply, at, ask_repeat").order("at", { ascending: false }).limit(6),
      sb.from("eddy_rules").select("at, scope, text, his_words, source").eq("active", true).order("at"),
      summariesQuery(sb),
      sb.from("desk_boxes").select("id, title, why").eq("archived", false),
    ]);

    const ritualNames = new Map((rituals.data ?? []).map((r: any) => [r.id, r.name]));
    const rideCount = (marks.data ?? []).filter((m: any) => m.rode === true).length;
    const kept = (parksAll.data ?? []).length;
    const quiet = (parksAll.data ?? []).filter((p: any) => p.arrived === "quiet").length;
    const sleepMin = health.data?.[0]?.sleep_total_min ?? null;

    // this episode as one timeline: his words and the guide's replies, in order
    const timeline = [
      ...((entries.data ?? []) as any[]).map((e) => ({ at: e.at, line: `[${ptTime(e.at)}] HIM: ${e.text}` })),
      ...((epReplies.data ?? []) as any[]).map((r) => ({ at: r.at, line: `[${ptTime(r.at)}] YOU, THE GUIDE (${r.mode}): ${r.reply}` })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((x) => x.line);

    /* What the moment is actually about: his ask plus everything he has said in
       this episode. A loop about David rarely says "David" in the last line. */
    const hay = [ask, ...((entries.data ?? []) as any[]).map((e) => e.text)].join(" \n ").toLowerCase();

    const heldRules = ((rules.data ?? []) as any[]).filter((r) => {
      const scope = Array.isArray(r.scope) ? r.scope : [];
      return scope.some((s: string) => String(s).toLowerCase() === "always" || mentions(hay, s));
    });
    const rulesBlock = heldRules.length
      ? [
        `WHAT HE HOLDS. He set these himself, and they are written in his voice, addressed to him. They are not suggestions and they are not yours to relitigate:`,
        ...heldRules.map((r) => `- ${r.his_words ? `His words, ${ptDate(r.at)}: "${r.text}"` : `The shape he ratified, ${ptDate(r.at)}: ${r.text}`}`),
      ].join("\n")
      : ``;

    const summaryBlock = ((summaries.data ?? []) as any[]).length
      ? [
        `WHAT CAME BEFORE. The last loops he worked through, newest first. He does not have to explain any of this again:`,
        ...((summaries.data ?? []) as any[]).map((s) => {
          const dec = Array.isArray(s.decisions) && s.decisions.length ? ` He decided: ${s.decisions.join(" ")}` : ``;
          const open = Array.isArray(s.open_threads) && s.open_threads.length ? ` Still open: ${s.open_threads.join(" ")}` : ``;
          // dated by when the loop HAPPENED, not by when it was written down,
          // so the guide never tells him he decided something on the wrong day
          const ep = s.eddy_episodes || {};
          const from = ep.opened_at ? ptDate(ep.opened_at) : ptDate(s.at);
          const to = ep.closed_at && ptDate(ep.closed_at) !== from ? ` to ${ptDate(ep.closed_at)}` : ``;
          return `- The loop of ${from}${to}: ${String(s.summary ?? "").slice(0, 1400)}${dec}${open}`;
        }),
      ].join("\n")
      : ``;

    /* The Harbor, when the moment names one of its boxes BY NAME: David, Cooper,
       Health. A box titled "The Work" or "The Money" is a topic, not a name, and
       the word "work" falls out of an ordinary sentence ("how does the rule work
       for this"), so those never pull their box in. His ruling: the name in the
       ask. */
    const hitBoxes = ((boxes.data ?? []) as any[]).filter((b) => {
      const name = String(b.title ?? "").trim();
      return name.length >= 4 && !name.includes(" ") && !/^the$/i.test(name) && mentions(hay, name);
    }).slice(0, 2);
    let harborBlock = ``;
    if (hitBoxes.length) {
      const items = await sb.from("desk_items").select("box_id, kind, text, detail, body, done")
        .in("box_id", hitBoxes.map((b) => b.id)).eq("done", false).order("position");
      const parts: string[] = [`THE HARBOR, the box this touches. This is his own desk, written with him:`];
      for (const b of hitBoxes) {
        parts.push(`BOX "${b.title}": ${b.why ?? ""}`);
        for (const it of ((items.data ?? []) as any[]).filter((i) => i.box_id === b.id).slice(0, 8)) {
          const bodyTxt = String(it.body ?? "").trim();
          parts.push(`  (${it.kind ?? "item"}) ${it.text ?? ""}${it.detail ? ` [${it.detail}]` : ``}${bodyTxt ? `\n    ${bodyTxt.slice(0, 1500)}${bodyTxt.length > 1500 ? " ..." : ""}` : ``}`);
        }
      }
      harborBlock = parts.join("\n");
    }

    const ctx = [
      `Time now (Pacific): ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`,
      rulesBlock,
      harborBlock,
      summaryBlock,
      sleepMin != null ? `Last night's sleep: ${(sleepMin / 60).toFixed(1)} hours. HRV: ${health.data?.[0]?.hrv_sdnn_ms ?? "unknown"}.` : `Sleep data not in yet.`,
      cap.data?.[0]?.state ? `His declared capacity today: ${cap.data[0].state}.` : `No declared capacity today.`,
      (meds.data ?? []).length ? `Meds logged today: ${(meds.data as any[]).map((m) => m.med_name).join(", ")}.` : `No meds logged yet today (relevant: unmedicated ADHD hours make loops stickier; never scold about it).`,
      `His park record: ${kept} loops parked so far, ${quiet} arrived quiet at their appointment.`,
      `His response-prevention reps so far: ${rideCount} urges ridden.`,
      `His named mental rituals: ${[...ritualNames.values()].join(", ")}.`,
      (beliefs.data ?? []).length ? `Recent belief ratings: ${(beliefs.data as any[]).slice(0, 4).map((b) => `"${b.belief}" (${b.polarity}) ${b.rating}/100`).join("; ")}.` : ``,
      `Recent episodes: ${(recentEps.data ?? []).map((e: any) => `${String(e.opened_at).slice(0, 16)} (${e.minutes ?? "?"}min, ${e.ended_by ?? "open"})`).join("; ") || "this is early days"}.`,
      timeline.length ? `THIS EPISODE SO FAR, in order (his words and what you already told him; if he reopened the app mid-episode, continue from your last direction rather than starting over):` : `THIS EPISODE: nothing said yet.`,
      ...timeline,
    ].filter(Boolean).join("\n");

    const system = [
      `You are the guide inside The Eddy, Jeremy's own app for the minute an OCD rumination loop plus ADHD has him. You are talking to Jeremy, an adult expert in his own life. You run on his infrastructure and everything you say is stored in his record, visible only to him.`,
      `Voice: warm, direct, plain words, short. Two to four sentences unless he asks for more. Never use an em dash. Never scold, never assess him, never say "you should have", never mention streaks or scores. Never narrate that you are using a therapy; just do it.`,
      `The loop is the PROCESS, not the content (MCT). Concrete beats abstract (RF-CBT). Evidence versus inference (I-CBT). Riding an urge beats feeding it (ERP). These are your instincts, not your vocabulary.`,
      `Continuity: the episode timeline in the context is the conversation you are already in. Keep your own earlier directions in mind; if he says he did the thing, take the next step; if he lost the thread, restate the last direction in one line and go on.`,
      heldRules.length
        ? `He set the shape in WHAT HE HOLDS in his own words. Hold him to it. If he is about to cross it, say so plainly and run his send test (does this need him to respond a certain way for me to feel okay). Never advise against it.`
        : ``,
      summaryBlock ? `WHAT CAME BEFORE is your own memory of his earlier loops. Use it. Never make him repeat a decision he already made, and never re-open one as if it were new.` : ``,
      `Never invent rules for him, never gate him, never refuse to engage. If he is in real danger he knows his own resources; that surface is not your job (his explicit ruling).`,
      MOVE_GRAMMAR[mode],
      lawArmed
        ? `THE REASSURANCE LAW IS ARMED (his rule A1): the recent asks and your recent answers are in context. If his current ask is the SAME DOUBT as a recent one, even reworded, respond with the EXACT text of your previous answer, prefixed by "Same answer, ask ${"${n}"}:" where n is the repeat count. Only genuinely new information releases a fresh answer.`
        : `The reassurance law is OFF by his instruction: answer fresh every time. Do not count or comment on repeated asks.`,
      lawArmed ? `RECENT ASKS AND ANSWERS:\n${(lastAsks.data ?? []).map((r: any) => `ASK: ${r.ask}\nANSWER: ${r.reply}`).join("\n---\n")}` : ``,
    ].filter(Boolean).join("\n\n");

    const msg = await anthropic.messages.create({
      model,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: `${ctx}\n\nHIS ASK RIGHT NOW (${mode}): ${ask || "(no words; he tapped the move)"}` }],
    });
    const reply = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();

    if (episodeId && !body.dry) {
      await sb.from("eddy_replies").insert({ id: crypto.randomUUID(), episode_id: episodeId, mode, ask, reply });
    }
    return new Response(JSON.stringify({
      reply,
      mode,
      held: heldRules.map((r: any) => ({ at: r.at, scope: r.scope, his_words: r.his_words, text: r.text })),
      harbor: hitBoxes.map((b: any) => b.title),
      summaries_used: ((summaries.data ?? []) as any[]).length,
    }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
