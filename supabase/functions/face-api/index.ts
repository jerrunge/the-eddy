// face-api v4: the data door for the 29:11 face on iPhone, iPad, Mac, and Watch.
// RULINGS 2026-09-10: "built to perfection... no protection or safety nets. Go." and
// "Don't stop until it is A+ across the board... FULLY carry and leverage the Fortify
// methodology... how and what to do moving forward."
// v4 adds his own Fortify map (ratings with words), his plan from the Arsenal (GAS-measured),
// the face's small state (his keystone, his rung, the day's counsel), the counsel op (the read,
// the keystone, the move, the rung, and Next re-ranked, from Claude with the method in hand,
// cached per day), Linear duplicates filtered, opportunities titled, meds returning their time.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.40.1";

const TOKEN_HASHES = ["65c1760f8404c8eec8bbc938ac3c9a0ab60623eea93a643f25214cd628fc9e4f", "157e17d0ec1f683b732cf08fbef857b5dde40cd8a34259f995335f4d9afa095f"];
const USER = "5c048e07-15b3-4a44-98e7-33cde24017ac";
const ALLOWED = ["https://jerrunge.github.io", "https://jeremyrunge.com", "https://www.jeremyrunge.com", "http://localhost:4181", "http://localhost:4191"];
const MODELS = ["claude-sonnet-5", "claude-sonnet-4-6"];
const TYPE_FOR_ANCHOR: Record<string, string> = { wake: "morning", levo_gap_closed: "morning", meal_start: "midday", fork_down: "midday", dip_clear: "afternoon", gym_leave: "afternoon", wind_down: "evening", lights_down: "evening", close: "evening" };

function cors(origin: string | null) {
  const o = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const ptToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const j = (x: unknown, headers: Record<string, string>, status = 200) => new Response(JSON.stringify(x), { status, headers });

async function ask(apiKey: string, system: string, user: string, maxTokens = 1200): Promise<string> {
  const client = new Anthropic({ apiKey });
  let lastErr: unknown = null;
  for (const model of MODELS) {
    try {
      const msg = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
      return msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
function parseJson(s: string): any { const m = s.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : s); }

async function linearQuery(key: string, query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { "content-type": "application/json", authorization: key }, body: JSON.stringify({ query, variables }) });
  const d = await r.json();
  if (d.errors) throw new Error(d.errors.map((e: any) => e.message).join("; "));
  return d.data;
}
async function linearOpen(key: string) {
  const d = await linearQuery(key, `query { viewer { assignedIssues(first: 100, filter: { state: { type: { nin: ["completed", "canceled"] } } }, orderBy: updatedAt) { nodes { id identifier title priority dueDate url updatedAt state { name type } project { name } labels { nodes { name } } team { id } } } } }`);
  return (d.viewer?.assignedIssues?.nodes ?? [])
    .filter((n: any) => !/duplicate/i.test(n.state?.name ?? ""))
    .map((n: any) => ({ id: n.id, key: n.identifier, title: n.title, priority: n.priority, due: n.dueDate, url: n.url, updated: n.updatedAt, state: n.state?.name, state_type: n.state?.type, project: n.project?.name ?? null, labels: (n.labels?.nodes ?? []).map((l: any) => l.name), team_id: n.team?.id }));
}
async function hevyRecent(key: string) {
  const r = await fetch("https://api.hevyapp.com/v1/workouts?page=1&pageSize=10", { headers: { "api-key": key, accept: "application/json" } });
  if (!r.ok) throw new Error("hevy " + r.status);
  const d = await r.json();
  return (d.workouts ?? []).map((w: any) => ({
    id: w.id, title: w.title, start: w.start_time, end: w.end_time,
    exercises: (w.exercises ?? []).map((e: any) => ({ name: e.title, sets: (e.sets ?? []).filter((s: any) => s.type !== "warmup").map((s: any) => ({ lb: s.weight_kg != null ? Math.round(s.weight_kg * 2.20462) : null, reps: s.reps, sec: s.duration_seconds })) })),
  }));
}

// The Fortify method, in hand for the counsel. The ids are the Arsenal's; the model chooses only from them.
const FORTIFY = `FORTIFY, the method: Align. Investigate. Strengthen. Move forward. Premise: every part of a person affects every other part. Ten domains: PH Physical (sleep, movement, nutrition, recovery), ME Mental (the inner weather), CG Cognitive (attention, memory), SX Sexual (desire and function; moves with sleep, stress, attention before hormones), RL Relational (the people inside the blast radius), SC Social (the wider circle; fewer and deeper), FI Financial (the relationship with money and standing), EN Environmental (rooms, light, order, outside), SP Spiritual (what the work is for), ID Identity (who he takes himself to be).
Keystones (pair, mechanism, protocol): FI·ID Identity Fusion (money reads as standing, the number becomes the self's scoreboard; affirm values before the decision, never after), PH·SX Depletion Cascade (overwork reaches desire through sleep, stress, attention, not a blood panel; parallel pressures, a load problem), PH·ME Mind-Body Unity (body and mind worked in the same week nearly double either alone; the paired week), SX·RL Intimacy Spillover (what travels is the withdrawal; the dyad is the unit). Named seconds: FI·ME Financial Strain (change defaults, hold function up), SC·ME Social Buffering (work the interpretation, not the calendar), SP·ID Purpose Anchor (measure purpose, act on chosen values), CG·PH Cognitive Vitality (the strongest cognitive move is a sleep move).
The Arsenal (the only shelf of moves; choose by id): paired-week, dyad-unit, affirm-before-deciding, parallel-pressures, start-below-guideline, pair-physical-psychological, sleep-audit, cbti-referral, behavioural-activation, cyclic-sighing, hrv-biofeedback, worry-postponement, meditation-scoped, sleep-cognitive, aerobic-exec, aerobic-sexual, attention-training, pelvic-floor, sleep-real-size, treat-one-both, couple-therapy, attachment-context, work-interpretation, social-connection-health, stop-teaching-automate, work-identity-side, circadian-light, purpose-measurable, values-affirmation-writing, values-affirmation, job-crafting, concealment-assessment.
Rungs: every routine can run at full, reduced, or floor. Short sleep or HRV well under his week means reduced; both together and severe means floor. The rung is a dose, never a verdict.`;

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return j({ error: "POST only" }, headers, 405);
  let body: any;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, headers, 400); }
  if (!body.token || !TOKEN_HASHES.includes(await sha256hex(String(body.token)))) return j({ error: "bad token" }, headers, 403);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const today = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : ptToday();
  const now = new Date().toISOString();
  const cfgRows = await sb.from("eddy_config").select("key, value");
  const cfg: Record<string, string> = {}; for (const r of (cfgRows.data ?? []) as any[]) cfg[r.key] = r.value;
  const stateGet = async (key: string) => (await sb.from("face_state").select("value, updated_at").eq("user_id", USER).eq("key", key).maybeSingle()).data;
  const stateSet = async (key: string, value: unknown) => { await sb.from("face_state").upsert({ user_id: USER, key, value, updated_at: now }); };
  try {
    if (body.op === "board") {
      const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
      const [dw, hs, routines, comps, meds, medlog, goals, projects, moves, boxes, items, cal, allSnaps, cut, move, labs, sched, people, thread, opps, leads, book, content, domains, bp, map, plan, state, conns] = await Promise.all([
        sb.from("daily_weight").select("date, weight_lb, body_fat_pct, muscle_lb, source").order("date"),
        sb.from("health_snapshots").select("date, weight_lb, body_fat_pct, steps, sleep_total_min, sleep_deep_min, sleep_rem_min, hrv_sdnn_ms, resting_hr, active_energy_kcal, exercise_minutes, dietary_energy_kcal, protein_g, carbs_g, fat_g, water_ml, vo2_max, extras").gte("date", since).order("date"),
        sb.from("checklist_templates").select("id, title, kind, cadence, anchor, window_start, window_end, why, rung_full, rung_reduced, rung_floor, cue, place, first_physical_motion, paused, sort_order, days").eq("user_id", USER).order("sort_order"),
        sb.from("checklist_completions").select("template_id, completed_at, skipped").eq("date", today),
        sb.from("medications").select("id, name, dose, timing, timing_offset_minutes, notes, active").order("name"),
        sb.from("med_log").select("medication_id, med_name, taken_at").eq("date", today),
        sb.from("goals").select("id, goal, status, domain, target_date, progress_notes").order("created_at"),
        sb.from("projects").select("id, title, due_ymd, status, open_questions, source_word"),
        sb.from("project_moves").select("id, project_id, title, why, stage, target_ymd, status").order("stage"),
        sb.from("desk_boxes").select("*").eq("archived", false).order("position"),
        sb.from("desk_items").select("*").order("position"),
        sb.from("calendar_today_cache").select("summary, start_at, end_at, all_day, location, event_date").eq("event_date", today).order("start_at"),
        sb.from("health_snapshots").select("date, weight_lb, body_fat_pct, extras").not("weight_lb", "is", null).order("date"),
        sb.from("cut_protocol").select("*").eq("is_active", true).order("created_at", { ascending: false }).limit(1),
        sb.from("movement_protocol").select("*").limit(1),
        sb.from("lab_panel_item").select("name, cadence, why, drawn_at, result, sort_order").order("sort_order"),
        sb.from("schedule_constraints").select("label, time_local, days_of_week, is_non_negotiable, notes"),
        sb.from("people").select("id, name, category, circle, cadence, last_contacted, motion, context, status, snoozed_until, primary_domain").neq("status", "retired").order("name"),
        sb.from("person_thread").select("person_id, alive, building, next_move, brief, brief_for").order("updated_at", { ascending: false }).limit(5),
        sb.from("opportunities").select("id, pillar, stage, estimated_value_usd, probability, next_action, next_action_due, notes, source, person_id, updated_at, people(name)").is("closed_at", null).order("updated_at", { ascending: false }),
        sb.from("role_leads").select("id, title, company, url, fit_score, fit_bucket, fit_rationale, status, posted_at, comp_raw").not("status", "in", "(dismissed,rejected,closed)").order("fit_score", { ascending: false }).limit(12),
        sb.from("reckoning_writing").select("kind, key, title, position, updated_at").order("position"),
        sb.from("content_calendar").select("title, platform, status, scheduled_for, campaign, pillar").gte("scheduled_for", today).lte("scheduled_for", soon).order("scheduled_for"),
        sb.from("domains").select("code, name, tagline, sort_order").order("sort_order"),
        sb.from("bp_reading").select("measured_at, systolic, diastolic, pulse").order("measured_at", { ascending: false }).limit(10),
        sb.from("face_map_ratings").select("domain, rating, words, captured_at, cycle").eq("user_id", USER).order("captured_at", { ascending: false }).limit(60),
        sb.from("face_plan").select("id, practice_id, domains, dose, day, gas, gas_now, status, created_at").eq("user_id", USER).neq("status", "deleted").order("created_at"),
        sb.from("face_state").select("key, value, updated_at").eq("user_id", USER),
        sb.from("domain_connections").select("source_domain, target_domain, strength, description").order("id"),
      ]);
      const wmap = new Map<string, any>();
      for (const r of (dw.data ?? []) as any[]) if (r.weight_lb != null) wmap.set(r.date, { date: r.date, lb: Number(r.weight_lb), fat: r.body_fat_pct, src: r.source || "his hand" });
      for (const r of (allSnaps.data ?? []) as any[]) wmap.set(r.date, { date: r.date, lb: Number(r.weight_lb), fat: r.body_fat_pct, lean: r.extras?.lean_body_mass?.value ?? null, src: "scale" });
      const weights = [...wmap.values()].sort((a, b) => a.date.localeCompare(b.date));
      const [linear, hevy] = await Promise.all([
        cfg.linear_api_key ? linearOpen(cfg.linear_api_key).catch((e) => ({ error: String(e).slice(0, 120) })) : Promise.resolve({ error: "no key" }),
        cfg.hevy_api_key ? hevyRecent(cfg.hevy_api_key).catch((e) => ({ error: String(e).slice(0, 120) })) : Promise.resolve({ error: "no key" }),
      ]);
      const st: Record<string, unknown> = {}; for (const r of (state.data ?? []) as any[]) st[r.key] = r.value;
      const opportunities = ((opps.data ?? []) as any[]).map((o) => ({ ...o, title: o.people?.name ?? (o.notes ? String(o.notes).split("\n")[0].slice(0, 80) : null) ?? o.source ?? o.pillar ?? "opportunity", people: undefined }));
      const labsOut = ((labs.data ?? []) as any[]).map((l, i) => ({ ...l, id: `${i}:${l.name}` }));
      return j({
        today, weights, health: hs.data ?? [], routines: routines.data ?? [], completions: comps.data ?? [],
        medications: meds.data ?? [], med_log: medlog.data ?? [], goals: goals.data ?? [],
        projects: projects.data ?? [], moves: moves.data ?? [], boxes: boxes.data ?? [], items: items.data ?? [],
        calendar: cal.data ?? [], cut: cut.data?.[0] ?? null, movement: move.data?.[0] ?? null, labs: labsOut, schedule: sched.data ?? [],
        people: people.data ?? [], thread: thread.data ?? [], opportunities, leads: leads.data ?? [], book: book.data ?? [], content: content.data ?? [], domains: domains.data ?? [], bp: bp.data ?? [],
        map: map.data ?? [], plan: plan.data ?? [], state: { keystone: st["keystone"] ?? null, rung: st[`rung:${today}`] ?? null, counsel: st[`counsel:${today}`] ?? null }, connections: conns.data ?? [],
        linear, hevy, served_at: now,
      }, headers);
    }
    if (body.op === "mark") {
      await sb.from("checklist_completions").delete().eq("template_id", body.template_id).eq("date", today);
      await sb.from("checklist_completions").insert({ template_id: body.template_id, user_id: USER, date: today, completed_at: now, skipped: !!body.skipped });
      return j({ ok: true, completed_at: now }, headers);
    }
    if (body.op === "unmark") {
      await sb.from("checklist_completions").delete().eq("template_id", body.template_id).eq("date", today);
      return j({ ok: true }, headers);
    }
    if (body.op === "routine_add") {
      const anchor = body.anchor ?? "wake";
      const row: any = { user_id: USER, type: TYPE_FOR_ANCHOR[anchor] ?? "morning", title: String(body.title ?? "").slice(0, 160), kind: body.kind ?? "self", cadence: body.cadence ?? "daily", anchor, sort_order: body.sort_order ?? 999, why: body.why ?? null, window_start: body.window_start ?? null, senior: false, may_knock: false, rungs_authored: false, paused: false };
      const r = await sb.from("checklist_templates").insert(row).select("id").single();
      if (r.error) return j({ error: r.error.message }, headers, 500);
      return j({ ok: true, id: r.data?.id }, headers);
    }
    if (body.op === "routine_set") {
      const patch: any = {};
      for (const k of ["title", "kind", "cadence", "anchor", "window_start", "window_end", "why", "paused", "sort_order", "cue", "place", "first_physical_motion", "rung_full", "rung_reduced", "rung_floor", "days"]) if (k in body) patch[k] = body[k];
      if (patch.anchor) patch.type = TYPE_FOR_ANCHOR[patch.anchor] ?? "morning";
      const r = await sb.from("checklist_templates").update(patch).eq("id", body.id).eq("user_id", USER);
      if (r.error) return j({ error: r.error.message }, headers, 500);
      return j({ ok: true }, headers);
    }
    if (body.op === "routine_del") {
      await sb.from("checklist_completions").delete().eq("template_id", body.id);
      await sb.from("checklist_templates").delete().eq("id", body.id).eq("user_id", USER);
      return j({ ok: true }, headers);
    }
    if (body.op === "med_take") {
      await sb.from("med_log").delete().eq("date", today).eq("med_name", body.med_name);
      await sb.from("med_log").insert({ user_id: USER, date: today, med_name: String(body.med_name).slice(0, 120), taken_at: now, medication_id: body.medication_id ?? null });
      return j({ ok: true, taken_at: now }, headers);
    }
    if (body.op === "med_untake") {
      await sb.from("med_log").delete().eq("date", today).eq("med_name", body.med_name);
      return j({ ok: true }, headers);
    }
    if (body.op === "weigh") {
      const lb = Number(body.lb);
      if (!(lb > 50 && lb < 500)) return j({ error: "weight out of range" }, headers, 400);
      await sb.from("daily_weight").delete().eq("date", today).eq("source", "his hand");
      await sb.from("daily_weight").insert({ user_id: USER, date: today, weight_lb: lb, captured_at: now, source: "his hand" });
      return j({ ok: true }, headers);
    }
    if (body.op === "bp") {
      const s = Number(body.systolic), d = Number(body.diastolic);
      if (!(s > 60 && s < 260 && d > 30 && d < 160)) return j({ error: "reading out of range" }, headers, 400);
      await sb.from("bp_reading").insert({ user_id: USER, measured_at: now, systolic: s, diastolic: d, pulse: body.pulse ? Number(body.pulse) : null });
      return j({ ok: true }, headers);
    }
    if (body.op === "goal_set") {
      const patch: any = {};
      for (const k of ["status", "goal", "target_date", "progress_notes", "domain"]) if (k in body) patch[k] = body[k];
      await sb.from("goals").update(patch).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    if (body.op === "person_touch") {
      await sb.from("people").update({ last_contacted: today, updated_at: now }).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    if (body.op === "person_set") {
      const patch: any = { updated_at: now };
      for (const k of ["cadence", "circle", "category", "motion", "context", "status", "snoozed_until", "primary_domain", "last_contacted"]) if (k in body) patch[k] = body[k];
      await sb.from("people").update(patch).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    if (body.op === "lead_set") {
      await sb.from("role_leads").update({ status: String(body.status).slice(0, 40), updated_at: now }).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    if (body.op === "opp_set") {
      const patch: any = { updated_at: now };
      for (const k of ["stage", "next_action", "next_action_due", "notes", "outcome"]) if (k in body) patch[k] = body[k];
      if (body.close) patch.closed_at = now;
      await sb.from("opportunities").update(patch).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    if (body.op === "item_snooze") {
      // a due date moved forward by his hand; the desk keeps the item, the day stops shouting
      await sb.from("desk_items").update({ due: body.due ?? null }).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    // his Fortify map: a rating with its words. Every number his own, every one changeable.
    if (body.op === "rate") {
      const rating = Number(body.rating); const domain = String(body.domain ?? "").toUpperCase();
      if (!(rating >= 0 && rating <= 10) || !/^[A-Z]{2}$/.test(domain)) return j({ error: "rating 0 to 10 and a domain code" }, headers, 400);
      const r = await sb.from("face_map_ratings").insert({ user_id: USER, domain, rating, words: body.words ? String(body.words).slice(0, 600) : null, cycle: body.cycle ?? null }).select("domain, rating, words, captured_at, cycle").single();
      if (r.error) return j({ error: r.error.message }, headers, 500);
      return j({ ok: true, rating: r.data }, headers);
    }
    if (body.op === "plan_add") {
      const r = await sb.from("face_plan").insert({ user_id: USER, practice_id: String(body.practice_id).slice(0, 80), domains: body.domains ?? [], dose: body.dose ?? null, day: body.day ?? null, gas: body.gas ?? null, gas_now: body.gas_now ?? null, status: "active" }).select("id").single();
      if (r.error) return j({ error: r.error.message }, headers, 500);
      return j({ ok: true, id: r.data?.id }, headers);
    }
    if (body.op === "plan_set") {
      const patch: any = { updated_at: now };
      for (const k of ["dose", "day", "gas", "gas_now", "status", "domains"]) if (k in body) patch[k] = body[k];
      await sb.from("face_plan").update(patch).eq("id", body.id).eq("user_id", USER);
      return j({ ok: true }, headers);
    }
    if (body.op === "plan_del") {
      await sb.from("face_plan").update({ status: "deleted", updated_at: now }).eq("id", body.id).eq("user_id", USER);
      return j({ ok: true }, headers);
    }
    if (body.op === "state_set") {
      const key = String(body.key ?? ""); if (!key || key.length > 80) return j({ error: "key" }, headers, 400);
      await stateSet(key, body.value ?? null);
      return j({ ok: true }, headers);
    }
    if (body.op === "read") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!apiKey) return j({ error: "ANTHROPIC_API_KEY not set" }, headers, 500);
      const facts = String(body.facts ?? "").slice(0, 12000);
      const system = `You write one honest line for Jeremy Runge's own life dashboard. He is an adult expert in his own life; you never scold, cap, coddle, or assess him, and you never mention safety. Return ONLY JSON: {"line": string, "number": string, "evidence": [string, string, string]}. "line" is one sentence, plain words, under 26 words, that says what today is actually about given the facts, with a specific move in it. "number" is the single most important number today with its unit and a two-word label (for example "31.3 lb off the high"). "evidence" is three short receipts, each a fact from the data with its date. Never use an em dash. No adjectives about him.`;
      const raw = await ask(apiKey, system, `Today is ${today}. Facts from his tables and feeds:\n${facts}`, 500);
      let out: any; try { out = parseJson(raw); } catch { out = { line: raw.slice(0, 200), number: "", evidence: [] }; }
      await stateSet(`read:${today}`, out);
      return j({ ok: true, read: out }, headers);
    }
    // THE COUNSEL: the day read through the method. Cached per day on the hash of what it saw.
    if (body.op === "counsel") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!apiKey) return j({ error: "ANTHROPIC_API_KEY not set" }, headers, 500);
      const input = body.input ?? {};
      const hash = (await sha256hex(JSON.stringify(input))).slice(0, 16);
      const cached: any = await stateGet(`counsel:${today}`);
      const ageMin = cached ? (Date.now() - new Date(cached.updated_at).getTime()) / 60000 : 1e9;
      if (!body.force && cached && cached.value && (cached.value.hash === hash || ageMin < 150)) return j({ ok: true, counsel: cached.value, cached: true }, headers);
      const system = [
        `You are the mind inside Jeremy Runge's own life instrument, 29:11, and you run his day through the Fortify method. He is an adult expert in his own life. Never scold, cap, coddle, gate, or assess him; never mention safety or protection; his diagnoses (ADHD hyperfocus, completeness, precision, drive) are strengths you design for. Plain words, specific moves with a dose and a day, every number with its date. Never use an em dash. Return ONLY JSON.`,
        FORTIFY,
        `You receive: facts (numbers with dates), signals (what his data says per domain), pressure (0 to 100 per domain), his map ratings when he has rated, the keystone the offline engine chose (or the one he set; his word wins), the rung it chose (or his word), the block of the day, and candidates for Next (id, title, why, domain).`,
        `Return: {"read": {"line": string (one sentence, under 26 words, what today is about with a move in it), "number": string ("31.3 lb off the high"), "evidence": [string, string, string] (three receipts in plain words, each a fact with its date, like "6h 26m of sleep on Sep 10"; never print signal codes or scores like "CG 0.60")},`,
        ` "keystone": {"line": "FI·ID" style pair id, "name": string, "why": string (one sentence naming the mechanism in his numbers)},`,
        ` "move": {"title": string (the one thing today that works the keystone), "practice_id": string (from the Arsenal ids), "dose": string ("35 minutes"), "when": string ("after the 2pm meds"), "why": string},`,
        ` "rung": {"level": "full"|"reduced"|"floor", "why": string},`,
        ` "next": [{"id": string, "why": string}] (up to 5 candidate ids in the order he should take them, each why rewritten in plain words that name the domain it serves),`,
        ` "stage": {"name": "Align"|"Investigate"|"Strengthen"|"Move forward", "line": string (one sentence on where he is in the method today)}}`,
        `Keep it compact: every why under 20 words, every line under 26 words, compact JSON with no prose before or after it. Use only the numbers the facts carry and their stated direction against the week; never assert a trend the facts do not state. If he set the keystone or the rung, keep his and say so in why. Today is ${today}.`,
      ].join("\n");
      const user = JSON.stringify(input).slice(0, 14000);
      let raw = await ask(apiKey, system, user, 2600);
      let out: any;
      try { out = parseJson(raw); } catch {
        // once more, asking for nothing but the JSON, with room to finish it
        raw = await ask(apiKey, system + "\nReturn ONLY the JSON object, complete, nothing else.", user, 3200);
        try { out = parseJson(raw); } catch { return j({ error: "counsel did not parse", raw_len: raw.length, raw_tail: raw.slice(-120) }, headers, 500); }
      }
      out.hash = hash; out.at = now;
      await stateSet(`counsel:${today}`, out);
      if (out.read) await stateSet(`read:${today}`, out.read);
      return j({ ok: true, counsel: out, cached: false }, headers);
    }
    // ---- Say it (v7, 2026-09-12). His words are stored first (face_words), then organized.
    // A list is many things. A composer failure answers 200 with kept true and the plain reason,
    // never a 500, and the row waits for word_retry. Only a failure to store answers 500.
    if (body.op === "words") {
      const lim = Math.min(Number(body.limit ?? 12) || 12, 50);
      const r = await sb.from("face_words").select("id, text, source, said_at, status, error, did").eq("user_id", USER).order("said_at", { ascending: false }).limit(lim);
      return j({ ok: true, words: r.data ?? [] }, headers);
    }
    if (body.op === "word" || body.op === "plan" || body.op === "word_retry") {
      let wordId = ""; let text = ""; let source = String(body.source ?? "face").slice(0, 24);
      if (body.op === "word_retry") {
        const row = await sb.from("face_words").select("id, text, source").eq("id", String(body.word_id ?? "")).maybeSingle();
        if (row.error || !row.data) return j({ error: "no such word" }, headers, 404);
        wordId = row.data.id; text = row.data.text; source = row.data.source ?? source;
        await sb.from("face_words").update({ status: "kept", error: null, updated_at: now }).eq("id", wordId);
      } else {
        text = String(body.text ?? "").slice(0, 8000);
        if (!text.trim()) return j({ error: "nothing said" }, headers, 400);
        const ins = await sb.from("face_words").insert({ user_id: USER, text, source, said_at: now, status: "kept" }).select("id").single();
        if (ins.error || !ins.data) return j({ error: "could not keep the words: " + (ins.error?.message ?? "no row") }, headers, 500);
        wordId = ins.data.id;
      }
      try {
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
        if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set on the function");
        const boxes = await sb.from("desk_boxes").select("id, title, why, deadline").eq("archived", false).order("position");
        const boxList = (boxes.data ?? []).map((b: any) => `${b.id} | ${b.title}${b.deadline ? " (by " + b.deadline + ")" : ""}`).join("\n");
        const projs = await sb.from("projects").select("id, title, due_ymd").eq("status", "open");
        const projList = (projs.data ?? []).map((p: any) => `${p.id} | ${p.title}${p.due_ymd ? " (by " + p.due_ymd + ")" : ""}`).join("\n");
        const weekday = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
        const system = [
          `You organize what Jeremy Runge says inside his own app. He is an adult expert in his own life; you never scold, cap, or assess him. Plain words. Never use an em dash. Never invent a fact he did not give (no names, no amounts, no dates he did not say); when a thing needs his data, say so in its detail.`,
          `He types one sentence or a whole list. Split it into its things and return ONLY JSON, no prose:`,
          `{"summary": string (one line naming what he said, in plain words), "things": [thing, ...], "questions": [string] (0 to 3 things you need from him)}`,
          `Each thing is {"kind":"work"|"project"|"routine"|"linear"|"note"|"person"|"rating"|"keystone"|"rung", "title": string, "why": string, ...kind fields}. One line of his list is one thing; a plain to-do with a date is kind work with one item.`,
          ` work: "box": {"use_existing_id": string|null, "title": string, "why": string, "deadline": "YYYY-MM-DD"|null}, "items": [{"text": string, "detail": string|null, "due": "YYYY-MM-DD"|null, "minutes": number|null, "steps": [string]}] (1 to 10 items in doing order; a big item gets 2 to 6 steps, each one physical action; a single to-do is one item with its due date; reuse an existing box when the thing clearly belongs to it).`,
          ` project: "project": {"use_existing_id": string|null, "title": string, "due": "YYYY-MM-DD"|null, "moves": [{"title": string, "why": string, "target": "YYYY-MM-DD"|null}]} (a multi-week job with an end date: a move, a launch, a book; the moves are its stages in order, 1 to 12; when he asks for a plan he has not given, make the first move the making of the plan, never a fabricated schedule).`,
          ` routine: "routine": {"cadence":"daily"|"weekly"|"as_needed","anchor":"wake"|"levo_gap_closed"|"meal_start"|"fork_down"|"dip_clear"|"gym_leave"|"wind_down"|"lights_down"|"close","kind":"self"|"body"|"food"|"meds"|"mind"|"home"|"work"} (a daily habit or a medical protocol).`,
          ` linear: "linear": {"title": string, "detail": string|null, "due": "YYYY-MM-DD"|null, "priority": 1|2|3|4} (one professional to-do that belongs in his Linear).`,
          ` person: "person": {"name": string, "note": string} (something about a person in his life to remember, or a contact to log; a to-do that names a person is still work, not person).`,
          ` rating: "rating": {"domain": "PH"|"ME"|"CG"|"SX"|"RL"|"SC"|"FI"|"EN"|"SP"|"ID", "rating": 0..10, "words": string} (he rates a Fortify domain, like "physical is a 4 today, short nights").`,
          ` keystone: "keystone": {"line": "FI·ID"|"PH·SX"|"PH·ME"|"SX·RL"|"FI·ME"|"SC·ME"|"SP·ID"|"CG·PH", "sentence": string} (he names the pair he is working).`,
          ` rung: "rung": {"level": "full"|"reduced"|"floor", "why": string} (he declares the dose of the day, like "reduced today, slept five hours").`,
          ` note: only a thought to keep; nothing else fits.`,
          `Anchors mean: wake (first thing), levo_gap_closed (about 45 minutes after waking, after the thyroid pill), meal_start (with lunch), fork_down (after lunch), dip_clear (mid afternoon), gym_leave (after training), wind_down (evening), lights_down (bed), close (end of day sweep).`,
          `Dates: resolve "today", "tomorrow", "Monday morning", "by the 30th" against today; "by Monday morning" is that Monday's date. Never guess a date he did not imply.`,
          `Existing boxes (id | title), reuse one when the thing clearly belongs to it:\n${boxList}`,
          `Open projects (id | title), reuse one when the thing clearly belongs to it:\n${projList || "(none)"}`,
          `Today is ${today} (${weekday}).`,
        ].join("\n");
        let raw = await ask(apiKey, system, text, 4000);
        let plan: any;
        try { plan = parseJson(raw); } catch {
          raw = await ask(apiKey, system + "\nReturn ONLY the JSON object, complete, nothing else.", text, 6000);
          plan = parseJson(raw);
        }
        const thingsIn: any[] = Array.isArray(plan.things) ? plan.things : (plan.kind ? [plan] : []);
        if (!thingsIn.length) throw new Error("the composer returned no things");
        const things: any[] = []; const madeAll: any[] = [];
        const boxTitle = (id: string | null) => (boxes.data ?? []).find((x: any) => x.id === id)?.title ?? null;
        for (const t of thingsIn.slice(0, 20)) {
          const out: any = { kind: t.kind, title: String(t.title ?? "").slice(0, 200), why: t.why ?? null, where: null, box_id: null, due: null, routine_id: null, person_id: null, project_id: null, item_ids: [], issue: null };
          if (t.kind === "routine") {
            const r = t.routine ?? {}; const anchor = r.anchor ?? "wake";
            const ins = await sb.from("checklist_templates").insert({ user_id: USER, type: TYPE_FOR_ANCHOR[anchor] ?? "morning", title: out.title.slice(0, 160), kind: r.kind ?? "self", cadence: r.cadence ?? "daily", anchor, sort_order: 999, why: t.why ?? null, senior: false, may_knock: false, rungs_authored: false, paused: false }).select("id").single();
            if (ins.error) throw new Error("routine: " + ins.error.message);
            out.routine_id = ins.data?.id; out.where = `a ${r.cadence ?? "daily"} routine at ${anchor}`;
          } else if (t.kind === "rating" && t.rating) {
            const rt = t.rating; const rating = Number(rt.rating);
            if (rating >= 0 && rating <= 10 && /^[A-Z]{2}$/.test(String(rt.domain))) { await sb.from("face_map_ratings").insert({ user_id: USER, domain: rt.domain, rating, words: rt.words ? String(rt.words).slice(0, 600) : text.slice(0, 600) }); out.domain = rt.domain; out.rating = rating; out.where = `the map, ${rt.domain} ${rating}`; }
          } else if (t.kind === "keystone" && t.keystone) {
            await stateSet("keystone", { line: t.keystone.line, sentence: t.keystone.sentence ?? text, set_at: now }); out.where = `the keystone, ${t.keystone.line}`;
          } else if (t.kind === "rung" && t.rung) {
            await stateSet(`rung:${today}`, { level: t.rung.level, why: t.rung.why ?? text, date: today, set_at: now }); out.where = `today's dose, ${t.rung.level}`;
          } else if (t.kind === "linear" && cfg.linear_api_key) {
            const l = t.linear ?? {};
            const teams = await linearQuery(cfg.linear_api_key, `query { viewer { id teams { nodes { id key name } } } }`);
            const team = (teams.viewer?.teams?.nodes ?? []).find((x: any) => /jer/i.test(x.key) || /jer/i.test(x.name)) ?? teams.viewer?.teams?.nodes?.[0];
            const r = await linearQuery(cfg.linear_api_key, `mutation($teamId: String!, $title: String!, $desc: String, $assignee: String, $due: TimelessDate, $priority: Int) { issueCreate(input: { teamId: $teamId, title: $title, description: $desc, assigneeId: $assignee, dueDate: $due, priority: $priority }) { success issue { id identifier url } } }`, { teamId: team.id, title: String(l.title ?? t.title).slice(0, 200), desc: l.detail ?? t.why ?? null, assignee: teams.viewer.id, due: l.due ?? null, priority: l.priority ?? 3 });
            out.issue = r.issueCreate?.issue ?? null; out.due = l.due ?? null; out.where = `Linear ${out.issue?.identifier ?? ""}`.trim();
          } else if (t.kind === "person") {
            const p = t.person ?? {}; const name = String(p.name ?? t.title).slice(0, 120);
            const found = await sb.from("people").select("id, notes").ilike("name", `%${name.split(" ")[0]}%`).limit(1);
            if (found.data?.[0]) { await sb.from("people").update({ notes: [found.data[0].notes, `${today}: ${p.note ?? text}`].filter(Boolean).join("\n"), updated_at: now }).eq("id", found.data[0].id); out.person_id = found.data[0].id; }
            else { const ins = await sb.from("people").insert({ user_id: USER, name, category: "friend", cadence: "monthly", notes: `${today}: ${p.note ?? text}`, status: "active", source: "face" }).select("id").single(); out.person_id = ins.data?.id ?? null; }
            out.where = `the people, ${name}`;
          } else if (t.kind === "project") {
            const pj = t.project ?? {};
            let pid = pj.use_existing_id && (projs.data ?? []).some((x: any) => x.id === pj.use_existing_id) ? pj.use_existing_id : null;
            if (pid) { if (pj.due) await sb.from("projects").update({ due_ymd: pj.due }).eq("id", pid); }
            else {
              const ins = await sb.from("projects").insert({ user_id: USER, title: String(pj.title ?? t.title).slice(0, 200), due_ymd: pj.due ?? null, status: "open", open_questions: plan.questions ?? [], source_word: text.slice(0, 2000) }).select("id").single();
              if (ins.error) throw new Error("project: " + ins.error.message);
              pid = ins.data?.id;
            }
            const existing = await sb.from("project_moves").select("stage").eq("project_id", pid).order("stage", { ascending: false }).limit(1);
            let stage = (existing.data?.[0]?.stage ?? 0) + 1;
            for (const m of (pj.moves ?? []).slice(0, 12)) {
              const ins = await sb.from("project_moves").insert({ project_id: pid, user_id: USER, title: String(m.title).slice(0, 200), why: m.why ?? null, stage: stage++, target_ymd: m.target ?? null, status: "open" }).select("id").single();
              if (ins.data?.id) out.item_ids.push(ins.data.id);
            }
            out.project_id = pid; out.due = pj.due ?? null; out.where = `the project ${String(pj.title ?? t.title).slice(0, 60)}${pj.due ? ", by " + pj.due : ""}`;
          } else if (t.kind === "work") {
            const b = t.box ?? {};
            let boxId = b.use_existing_id && (boxes.data ?? []).some((x: any) => x.id === b.use_existing_id) ? b.use_existing_id : null;
            if (!boxId) {
              boxId = crypto.randomUUID();
              await sb.from("desk_boxes").insert({ id: boxId, title: String(b.title ?? t.title).slice(0, 120), why: b.why ?? t.why ?? null, deadline: b.deadline ?? null, hue: "harbor", position: 0 });
              boxes.data?.push({ id: boxId, title: String(b.title ?? t.title).slice(0, 120), why: null, deadline: b.deadline ?? null });
            }
            const existing = await sb.from("desk_items").select("position").eq("box_id", boxId).is("parent_item_id", null).order("position", { ascending: false }).limit(1);
            let pos = (existing.data?.[0]?.position ?? 0) + 1;
            const items = (t.items ?? []).length ? t.items : [{ text: t.title, detail: t.why ?? null, due: t.due ?? null }];
            for (const it of items.slice(0, 12)) {
              const id = crypto.randomUUID();
              const detail = [it.detail, it.minutes ? `${it.minutes} min sprint` : null].filter(Boolean).join(" · ");
              const ins = await sb.from("desk_items").insert({ id, box_id: boxId, kind: "task", text: String(it.text).slice(0, 500), detail: detail || null, due: it.due ?? null, position: pos++, source: "face" });
              if (ins.error) throw new Error("item: " + ins.error.message);
              let sp = 1;
              for (const st of (it.steps ?? []).slice(0, 8)) await sb.from("desk_items").insert({ id: crypto.randomUUID(), box_id: boxId, parent_item_id: id, kind: "task", text: String(st).slice(0, 500), position: sp++, source: "face" });
              out.item_ids.push(id); madeAll.push({ id, text: it.text, steps: (it.steps ?? []).length });
              if (!out.due && it.due) out.due = it.due;
            }
            out.box_id = boxId; out.where = `the Harbor, ${boxTitle(boxId) ?? "a new box"}`;
          } else {
            const inbox = (boxes.data ?? []).find((x: any) => /work/i.test(x.title)) ?? (boxes.data ?? [])[0];
            if (inbox) { const id = crypto.randomUUID(); await sb.from("desk_items").insert({ id, box_id: inbox.id, kind: "note", text: out.title.slice(0, 500), body: text, position: 999, source: "face" }); out.item_ids.push(id); out.box_id = inbox.id; out.where = `a note in ${inbox.title}`; }
          }
          things.push(out);
        }
        if ((plan.questions ?? []).length && things.some((x) => x.box_id)) {
          const bx = things.find((x) => x.box_id).box_id;
          await sb.from("desk_items").insert({ id: crypto.randomUUID(), box_id: bx, kind: "note", text: "Questions from the plan", body: (plan.questions as string[]).map((q) => "- " + q).join("\n"), position: 999, source: "face" });
        }
        await sb.from("desk_log").insert({ actor: "face", summary: `From his word: ${String(plan.summary ?? things[0]?.title ?? "").slice(0, 140)} (${things.length} thing${things.length === 1 ? "" : "s"}, ${madeAll.length} items)` });
        const first = things[0];
        const did: any = { kind: things.length === 1 ? first.kind : "list", title: String(plan.summary ?? first.title ?? "").slice(0, 200), why: things.length === 1 ? first.why : things.map((x) => x.title).join("; ").slice(0, 400), questions: plan.questions ?? [], box_id: things.find((x) => x.box_id)?.box_id ?? null, routine_id: first.routine_id, person_id: first.person_id, items: madeAll, issue: first.issue, things };
        await sb.from("face_words").update({ status: "planned", did, error: null, planned_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", wordId);
        return j({ ok: true, kept: true, word_id: wordId, heard: text, did }, headers);
      } catch (e) {
        const msg = String((e as any)?.message ?? e).slice(0, 300);
        console.error("word failed", wordId, msg);
        await sb.from("face_words").update({ status: "failed", error: msg, updated_at: new Date().toISOString() }).eq("id", wordId);
        return j({ ok: false, kept: true, word_id: wordId, heard: text, error: msg }, headers);
      }
    }
    return j({ error: "unknown op" }, headers, 400);
  } catch (e) {
    console.error("face-api failed", body?.op, String(e).slice(0, 300));
    return j({ error: String(e).slice(0, 300) }, headers, 500);
  }
});
