// face-api v2: the data door for the new 29:11 face (RULINGS 2026-09-10: "built to
// perfection... fuck all the rules... no protection or safety nets. Go.").
// Same device token as the Eddy and the Harbor, plus the Mac that drives the build.
// RLS-sealed tables, service role inside. No gates, no caps, no hidden counts:
// everything his tables hold is his. v2 adds Linear, Hevy, people, the cut, the
// search, the ventures, labs, the movement protocol, and the read with receipts.
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
  return (d.viewer?.assignedIssues?.nodes ?? []).map((n: any) => ({ id: n.id, key: n.identifier, title: n.title, priority: n.priority, due: n.dueDate, url: n.url, updated: n.updatedAt, state: n.state?.name, state_type: n.state?.type, project: n.project?.name ?? null, labels: (n.labels?.nodes ?? []).map((l: any) => l.name), team_id: n.team?.id }));
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
  try {
    if (body.op === "board") {
      const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
      const [dw, hs, routines, comps, meds, medlog, goals, projects, moves, boxes, items, cal, allSnaps, cut, move, labs, sched, people, thread, opps, leads, book, content, domains, bp] = await Promise.all([
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
        sb.from("opportunities").select("id, pillar, stage, estimated_value_usd, probability, next_action, next_action_due, notes, source, person_id, updated_at").is("closed_at", null).order("updated_at", { ascending: false }),
        sb.from("role_leads").select("id, title, company, url, fit_score, fit_bucket, fit_rationale, status, posted_at, comp_raw").not("status", "in", "(dismissed,rejected,closed)").order("fit_score", { ascending: false }).limit(12),
        sb.from("reckoning_writing").select("kind, key, title, position, updated_at").order("position"),
        sb.from("content_calendar").select("title, platform, status, scheduled_for, campaign, pillar").gte("scheduled_for", today).lte("scheduled_for", soon).order("scheduled_for"),
        sb.from("domains").select("code, name, tagline, sort_order").order("sort_order"),
        sb.from("bp_reading").select("measured_at, systolic, diastolic, pulse").order("measured_at", { ascending: false }).limit(10),
      ]);
      const wmap = new Map<string, any>();
      for (const r of (dw.data ?? []) as any[]) if (r.weight_lb != null) wmap.set(r.date, { date: r.date, lb: Number(r.weight_lb), fat: r.body_fat_pct, src: r.source || "his hand" });
      for (const r of (allSnaps.data ?? []) as any[]) wmap.set(r.date, { date: r.date, lb: Number(r.weight_lb), fat: r.body_fat_pct, lean: r.extras?.lean_body_mass?.value ?? null, src: "scale" });
      const weights = [...wmap.values()].sort((a, b) => a.date.localeCompare(b.date));
      // the outside world, each tolerated on its own
      const [linear, hevy] = await Promise.all([
        cfg.linear_api_key ? linearOpen(cfg.linear_api_key).catch((e) => ({ error: String(e).slice(0, 120) })) : Promise.resolve({ error: "no key" }),
        cfg.hevy_api_key ? hevyRecent(cfg.hevy_api_key).catch((e) => ({ error: String(e).slice(0, 120) })) : Promise.resolve({ error: "no key" }),
      ]);
      return j({
        today, weights, health: hs.data ?? [], routines: routines.data ?? [], completions: comps.data ?? [],
        medications: meds.data ?? [], med_log: medlog.data ?? [], goals: goals.data ?? [],
        projects: projects.data ?? [], moves: moves.data ?? [], boxes: boxes.data ?? [], items: items.data ?? [],
        calendar: cal.data ?? [], cut: cut.data?.[0] ?? null, movement: move.data?.[0] ?? null, labs: labs.data ?? [], schedule: sched.data ?? [],
        people: people.data ?? [], thread: thread.data ?? [], opportunities: opps.data ?? [], leads: leads.data ?? [], book: book.data ?? [], content: content.data ?? [], domains: domains.data ?? [], bp: bp.data ?? [],
        linear, hevy, served_at: now,
      }, headers);
    }
    if (body.op === "mark") {
      await sb.from("checklist_completions").delete().eq("template_id", body.template_id).eq("date", today);
      await sb.from("checklist_completions").insert({ template_id: body.template_id, user_id: USER, date: today, completed_at: now, skipped: !!body.skipped });
      return j({ ok: true }, headers);
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
      return j({ ok: true }, headers);
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
      for (const k of ["status", "goal", "target_date", "progress_notes"]) if (k in body) patch[k] = body[k];
      await sb.from("goals").update(patch).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    if (body.op === "person_touch") {
      await sb.from("people").update({ last_contacted: today, updated_at: now }).eq("id", body.id);
      return j({ ok: true }, headers);
    }
    if (body.op === "person_set") {
      const patch: any = { updated_at: now };
      for (const k of ["cadence", "circle", "category", "motion", "context", "status", "snoozed_until"]) if (k in body) patch[k] = body[k];
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
    if (body.op === "linear_done") {
      if (!cfg.linear_api_key) return j({ error: "no linear key" }, headers, 500);
      const d = await linearQuery(cfg.linear_api_key, `query($id: String!) { issue(id: $id) { id team { states { nodes { id type name } } } } }`, { id: body.id });
      const done = (d.issue?.team?.states?.nodes ?? []).find((s: any) => s.type === "completed");
      if (!done) return j({ error: "no completed state on the team" }, headers, 500);
      await linearQuery(cfg.linear_api_key, `mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`, { id: body.id, state: done.id });
      await sb.from("tasks_log").insert({ user_id: USER, event_type: "issue_closed", occurred_at: now, linear_issue_id: body.id, source: "face", payload: { key: body.key ?? null, title: body.title ?? null } });
      return j({ ok: true }, headers);
    }
    if (body.op === "linear_add") {
      if (!cfg.linear_api_key) return j({ error: "no linear key" }, headers, 500);
      const teams = await linearQuery(cfg.linear_api_key, `query { viewer { id teams { nodes { id key name } } } }`);
      const team = (teams.viewer?.teams?.nodes ?? []).find((t: any) => /jer/i.test(t.key) || /jer/i.test(t.name)) ?? teams.viewer?.teams?.nodes?.[0];
      if (!team) return j({ error: "no team" }, headers, 500);
      const r = await linearQuery(cfg.linear_api_key, `mutation($teamId: String!, $title: String!, $desc: String, $assignee: String, $due: TimelessDate, $priority: Int) { issueCreate(input: { teamId: $teamId, title: $title, description: $desc, assigneeId: $assignee, dueDate: $due, priority: $priority }) { success issue { id identifier url } } }`, { teamId: team.id, title: String(body.title).slice(0, 200), desc: body.detail ?? null, assignee: teams.viewer.id, due: body.due ?? null, priority: body.priority ?? 3 });
      return j({ ok: true, issue: r.issueCreate?.issue }, headers);
    }
    if (body.op === "read") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!apiKey) return j({ error: "ANTHROPIC_API_KEY not set" }, headers, 500);
      const facts = String(body.facts ?? "").slice(0, 12000);
      const system = `You write one honest line for Jeremy Runge's own life dashboard. He is an adult expert in his own life; you never scold, cap, coddle, or assess him, and you never mention safety. Return ONLY JSON: {"line": string, "number": string, "evidence": [string, string, string]}. "line" is one sentence, plain words, under 26 words, that says what today is actually about given the facts, with a specific move in it. "number" is the single most important number today with its unit and a two-word label (for example "31.3 lb off the high"). "evidence" is three short receipts, each a fact from the data with its date. Never use an em dash. No adjectives about him.`;
      const raw = await ask(apiKey, system, `Today is ${today}. Facts from his tables and feeds:\n${facts}`, 500);
      let out: any; try { out = parseJson(raw); } catch { out = { line: raw.slice(0, 200), number: "", evidence: [] }; }
      return j({ ok: true, read: out }, headers);
    }
    if (body.op === "word" || body.op === "plan") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
      if (!apiKey) return j({ error: "ANTHROPIC_API_KEY not set" }, headers, 500);
      const text = String(body.text ?? "").slice(0, 4000);
      const boxes = await sb.from("desk_boxes").select("id, title, why, deadline").eq("archived", false).order("position");
      const boxList = (boxes.data ?? []).map((b: any) => `${b.id} | ${b.title}${b.deadline ? " (by " + b.deadline + ")" : ""}`).join("\n");
      const system = [
        `You organize work for Jeremy Runge inside his own app. He is an adult expert in his own life; you never scold, cap, or assess him. Plain words. Never use an em dash.`,
        `He types one sentence about something on his mind. Decide what it is and return ONLY JSON, no prose:`,
        `{"kind":"routine"|"work"|"linear"|"note"|"person", "title": string, "why": string,`,
        ` "routine": {"cadence":"daily"|"weekly"|"as_needed","anchor":"wake"|"levo_gap_closed"|"meal_start"|"fork_down"|"dip_clear"|"gym_leave"|"wind_down"|"lights_down"|"close","kind":"self"|"body"|"food"|"meds"|"mind"|"home"|"work"} (only when kind is routine),`,
        ` "box": {"use_existing_id": string|null, "title": string, "why": string, "deadline": "YYYY-MM-DD"|null} (only when kind is work),`,
        ` "items": [{"text": string, "detail": string|null, "due": "YYYY-MM-DD"|null, "minutes": number, "steps": [string]}] (only when kind is work: 3 to 10 items in doing order, each one focused sprint of 15 to 45 minutes; a big item gets 2 to 6 steps under it; every step is one physical action; nothing vague),`,
        ` "linear": {"title": string, "detail": string|null, "due": "YYYY-MM-DD"|null, "priority": 1|2|3|4} (only when kind is linear: a single professional to-do that belongs in his Linear, not a project),`,
        ` "person": {"name": string, "note": string} (only when kind is person: something about a person in his life to remember or a contact to log),`,
        ` "questions": [string] (0 to 3 things you need from him to organize it better)}`,
        `Anchors mean: wake (first thing), levo_gap_closed (about 45 minutes after waking, after the thyroid pill), meal_start (with lunch), fork_down (after lunch), dip_clear (mid afternoon), gym_leave (after training), wind_down (evening), lights_down (bed), close (end of day sweep).`,
        `If the sentence names a multi-week job (a move, a launch, a book, a sale), kind is work and the items are the days of it, in order, each a bounded sprint list. If it is one professional task, kind is linear. If it is a daily habit or a medical protocol, kind is routine. If it is about a person, kind is person. If it is only a thought to keep, kind is note.`,
        `Existing boxes (id | title), reuse one when the sentence clearly belongs to it:\n${boxList}`,
        `Today is ${today}.`,
      ].join("\n");
      const raw = await ask(apiKey, system, text);
      const plan = parseJson(raw);
      const did: any = { kind: plan.kind, title: plan.title, why: plan.why, questions: plan.questions ?? [] };
      if (plan.kind === "routine") {
        const r = plan.routine ?? {}; const anchor = r.anchor ?? "wake";
        const ins = await sb.from("checklist_templates").insert({ user_id: USER, type: TYPE_FOR_ANCHOR[anchor] ?? "morning", title: String(plan.title).slice(0, 160), kind: r.kind ?? "self", cadence: r.cadence ?? "daily", anchor, sort_order: 999, why: plan.why ?? null, senior: false, may_knock: false, rungs_authored: false, paused: false }).select("id").single();
        if (ins.error) return j({ error: ins.error.message }, headers, 500);
        did.routine_id = ins.data?.id;
      } else if (plan.kind === "linear" && cfg.linear_api_key) {
        const l = plan.linear ?? {};
        const teams = await linearQuery(cfg.linear_api_key, `query { viewer { id teams { nodes { id key name } } } }`);
        const team = (teams.viewer?.teams?.nodes ?? []).find((t: any) => /jer/i.test(t.key) || /jer/i.test(t.name)) ?? teams.viewer?.teams?.nodes?.[0];
        const r = await linearQuery(cfg.linear_api_key, `mutation($teamId: String!, $title: String!, $desc: String, $assignee: String, $due: TimelessDate, $priority: Int) { issueCreate(input: { teamId: $teamId, title: $title, description: $desc, assigneeId: $assignee, dueDate: $due, priority: $priority }) { success issue { id identifier url } } }`, { teamId: team.id, title: String(l.title ?? plan.title).slice(0, 200), desc: l.detail ?? plan.why ?? null, assignee: teams.viewer.id, due: l.due ?? null, priority: l.priority ?? 3 });
        did.issue = r.issueCreate?.issue;
      } else if (plan.kind === "person") {
        const p = plan.person ?? {}; const name = String(p.name ?? plan.title).slice(0, 120);
        const found = await sb.from("people").select("id, notes").ilike("name", `%${name.split(" ")[0]}%`).limit(1);
        if (found.data?.[0]) { await sb.from("people").update({ notes: [found.data[0].notes, `${today}: ${p.note ?? text}`].filter(Boolean).join("\n"), last_contacted: body.touched ? today : undefined, updated_at: now }).eq("id", found.data[0].id); did.person_id = found.data[0].id; }
        else { const ins = await sb.from("people").insert({ user_id: USER, name, category: "friend", cadence: "monthly", notes: `${today}: ${p.note ?? text}`, status: "active", source: "face" }).select("id").single(); did.person_id = ins.data?.id; }
      } else if (plan.kind === "work") {
        const b = plan.box ?? {};
        let boxId = b.use_existing_id && (boxes.data ?? []).some((x: any) => x.id === b.use_existing_id) ? b.use_existing_id : null;
        if (!boxId) {
          boxId = crypto.randomUUID();
          await sb.from("desk_boxes").insert({ id: boxId, title: String(b.title ?? plan.title).slice(0, 120), why: b.why ?? plan.why ?? null, deadline: b.deadline ?? null, hue: "harbor", position: 0 });
        }
        const existing = await sb.from("desk_items").select("position").eq("box_id", boxId).is("parent_item_id", null).order("position", { ascending: false }).limit(1);
        let pos = (existing.data?.[0]?.position ?? 0) + 1;
        const made: any[] = [];
        for (const it of (plan.items ?? []).slice(0, 12)) {
          const id = crypto.randomUUID();
          const detail = [it.detail, it.minutes ? `${it.minutes} min sprint` : null].filter(Boolean).join(" · ");
          await sb.from("desk_items").insert({ id, box_id: boxId, kind: "task", text: String(it.text).slice(0, 500), detail: detail || null, due: it.due ?? null, position: pos++, source: "face" });
          let sp = 1;
          for (const s of (it.steps ?? []).slice(0, 8)) await sb.from("desk_items").insert({ id: crypto.randomUUID(), box_id: boxId, parent_item_id: id, kind: "task", text: String(s).slice(0, 500), position: sp++, source: "face" });
          made.push({ id, text: it.text, steps: (it.steps ?? []).length });
        }
        if ((plan.questions ?? []).length) await sb.from("desk_items").insert({ id: crypto.randomUUID(), box_id: boxId, kind: "note", text: "Questions from the plan", body: (plan.questions as string[]).map((q) => "- " + q).join("\n"), position: pos++, source: "face" });
        await sb.from("desk_log").insert({ actor: "face", summary: `Planned from his word: ${String(plan.title).slice(0, 120)} (${made.length} items)` });
        did.box_id = boxId; did.items = made;
      } else {
        const inbox = (boxes.data ?? []).find((x: any) => /work/i.test(x.title)) ?? (boxes.data ?? [])[0];
        if (inbox) await sb.from("desk_items").insert({ id: crypto.randomUUID(), box_id: inbox.id, kind: "note", text: String(plan.title).slice(0, 500), body: text, position: 999, source: "face" });
        did.box_id = inbox?.id ?? null;
      }
      return j({ ok: true, did }, headers);
    }
    return j({ error: "unknown op" }, headers, 400);
  } catch (e) {
    return j({ error: String(e).slice(0, 300) }, headers, 500);
  }
});
