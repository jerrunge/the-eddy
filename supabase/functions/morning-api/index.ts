// morning-api v12: THE ONE TODAY ENGINE (RULINGS 2026-09-13, "29:11 blasting": one place that
// shows what he is supposed to do just today, and no two tabs disagreeing). One composition
// of the day for every surface: the Chart House's Morning room, the 29:11 face on the phone,
// the iPad, the Mac, the Watch, the menu bar, Siri. Every renderer reads this; every tap
// writes back through it. Nothing else composes a "next".
//
// The day is everything the face knows, dated: content dated today, desk items due today,
// project moves targeted today, Linear issues due today or urgent, the routines of today
// (checklist_templates by block; the Morning's five moved in, one table), the rulings owed,
// the meds by window, and the calendar. Three buckets, never mixed:
//   sitting  today, in the order of the day (time, then door), each card carrying its block
//   later    dated ahead, the next seven days, grouped by day
//   behind   dated in the past, grouped by campaign, box, project, or Linear; one line each
// Undated things are neither today nor behind: they live in Work under their box, and the
// composer writes `undated` counts (in all, per door, per box) so a door can say
// "34 items with no day". Floors, not ceilings: no caps, no hidden rows.
//
// Actions only (RULINGS 2026-09-14, "what may reach the Morning", "goals in Linear", "a job written
// twice"): a card is one step with a date he can do in one sitting. Priority never places a card.
//   Linear   an assigned open issue (Duplicate is out of every count) is a card only when it carries no
//            Goal or Parked label, has no open sub-issues, and has a due date. Otherwise it is listed:
//            undated in undated.linear_list (undated.linear_urgent for Urgent with no day), dated in
//            held.linear. A sub-issue's why is its parent's title.
//   Desk     an item with open child items never renders; its children place by their own days with
//            the parent's text as the why. Dated, it lists in held.items (reason parent); every parent
//            lists in undated.parents. Undated children now count under their box.
//   Doubles  a project move may name the desk item it repeats (project_moves.desk_item_id, migration
//            actions_only_01). While the move is open the move is the card and the desk item lists in
//            held.items (reason twin) when dated. Done on the move closes the desk item too, and undo or
//            reopen of that Done reopens it; an undo of Tomorrow or Skip never touches the desk item, and
//            a Done on the desk item never closes the move. Until the column exists the old select runs
//            and links_ready is false.
// Nothing vanishes: whatever stops being a card is listed in held or undated, counted on its door
// (door.held, door.undated) and in counts.held, and stays in 29:11 Work.
//
// Door: the same device token as the Harbor, the hub, and the face (SHA-256 against the accepted
// hashes; MORNING_TOKEN_HASHES in the env overrides the face's list), or the service role key as a
// bearer for the Chart House's own Pages function. No anon path.
//
// Ops (POST, json):
//   morning  { date?, now_min? }                -> { date, now, now_min, clock, next_rule, place_rule, next_id, sitting:[card], later:[day], behind:[group], undated, held, doors:[door], week:[day], counts, links_ready, served_at }
//            now_min (0 to 1439) is a test clock, honored only for the service role; a device token's is ignored.
//            undated: { total, items, moves, linear, content, doors, boxes, linear_urgent:[lrow], linear_list:[lrow], parents:[{id, title, box, door, due, open_children, undated_children}] }
//            held:    { total, doors, items:[{id, card_id, title, box, door, due, reason: parent|twin, open_children, move_id, move_day}], linear:[lrow] }
//            lrow:    { id, key, title, url, due, priority, state, reason: goal|parked|parent|undated_urgent|undated, open_children }
//            door:    { ..., today, later, behind, undated, held }; counts: { sitting, open, later, behind, undated, held }
//   tap      { card_id, action, post_id?, post_ids?, url?, value?, choice?, text?, source? } -> { ok, card }
//            on a move with a desk twin: -> { ok, card, twin_card, touched, twin_skipped? } (Done also closes the twin; undo or reopen of a
//            done move reopens it; twin_skipped: open children | already done | already open, and nothing is written to the desk item)
//            card ids: content:<id> routine:<id> ruling:<id> item:<id> move:<id> linear:<id> med:<timing> calendar:<id>
//            actions: posted sent done hold skip ruled undo reopen (done on a med card takes post_id = the medication)
//   text     { card_id, post_id? }              -> { ok, copy:[...] }   copy for a card the composition left thin
//   GET ?op=photo&path=<vault path>  (token as Authorization: Bearer or x-device-token; never in the URL) -> the image bytes
//
// door.pill.state is ok | wait | quiet (the contract the two renderers share); card.photo carries
// path, alt, and url (null when the photo lives outside the vault, e.g. the iCloud frames).
//
// A card: { id, source: content|routine|ruling|work|move|linear|meds|calendar, time, block, door, what, why,
//           copy:[{label, platforms, text}], photo:{path, alt}|null, kit:{to, from, when, how}|null,
//           taps:[{action, label, post_id?}], status, posts:[{id, platform, status, url}] (content; the meds
//           of a window on a meds card), options:[{key,label}] (ruling), links:[{label, href}], day,
//           overdue_since?, campaign? (content), box? (work), project? (move), anchor? cadence? rungs? (routine),
//           parent? (work {id, title}, linear {id, key, title}; null when none), twin? (move {item_id, text, open}; null when unlinked),
//           due_min, until_min }
//
// The next card, by the clock (RULINGS 2026-09-14, "the next thing on every screen"): walk the sitting in
// its order and skip calendar events and anything not open. The first card with no clock, or whose clock
// has not passed, is next. due_min is the card's own clock in minutes since Pacific midnight, null when the
// time shown is a placeholder (rulings, work, moves, Linear, a door's default hour, a routine written
// "later"). until_min is due_min + 15, or the end of the routine's window when that is later; a card has
// passed only when now_min > until_min. When every open card has passed, next is the one that passed most
// recently. The Chart House and 29:11 run the same few lines on until_min against the Pacific clock.
//
// Floors, not ceilings. Nothing here counts him, caps him, or hides a row from him: overdue rows
// older than a week travel in `behind`, grouped by campaign, every card intact.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const FACE_HASHES = ["65c1760f8404c8eec8bbc938ac3c9a0ab60623eea93a643f25214cd628fc9e4f", "157e17d0ec1f683b732cf08fbef857b5dde40cd8a34259f995335f4d9afa095f"];
const USER = "5c048e07-15b3-4a44-98e7-33cde24017ac";
const TZ = "America/Los_Angeles";
const REPO = "jerrunge/jr-os-docs";
const DOORS: Record<string, string> = { maddy: "Maddy", fortify: "Fortify", wayofdad: "The Way of Dad", walks: "Walks and Talks", house: "The house" };
const DOOR_ORDER = ["wayofdad", "fortify", "maddy", "walks", "house"];
const DOOR_TIME: Record<string, string> = { wayofdad: "7:30am", fortify: "8:00am", maddy: "9:00am", walks: "9:00am", house: "later" };
const SOCIAL = new Set(["x", "bluesky", "instagram", "threads", "linkedin", "youtube", "tiktok", "reddit", "facebook", "substack"]);
const PLATFORM_LABEL: Record<string, string> = { x: "X", bluesky: "Bluesky", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok", reddit: "Reddit", facebook: "Facebook", substack: "Substack", email: "Email", jeremyrunge_com: "jeremyrunge.com", other: "Note" };
const BEHIND_DAYS = 7;
const CACHE_MIN = 10;

const headersFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "content-type, authorization, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
});
const j = (x: unknown, h: Record<string, string>, status = 200) => new Response(JSON.stringify(x), { status, headers: h });
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function serviceProbe(bearer: string): Promise<boolean> {
  try {
    const r = await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/hub_content?select=key&limit=1", { headers: { apikey: bearer, authorization: "Bearer " + bearer }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}
const ptToday = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
function ptNow() {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
  return f.format(new Date()).replace(" ", "").toLowerCase().replace(/^0/, "");
}
function addDays(ymd: string, n: number) { const t = new Date(ymd + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function dow(ymd: string) { return new Date(ymd + "T12:00:00Z").getUTCDay(); }
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function niceDate(ymd: string) { const d = new Date(ymd + "T12:00:00Z"); return DOW[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + d.getUTCDate(); }
function timeKey(t: string | null | undefined) {
  if (!t) return 9999;
  const m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
  if (!m) return 9998;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2] || 0);
}
// the clock on the row itself (slot before when), or null; the door's default hour is not a clock on the row
function slotClock(meta: any): string | null {
  const s = meta?.slot || meta?.when || "";
  const m = String(s).match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
  return m ? m[1].replace(/\s+/g, "").toLowerCase() : null;
}
function slotTime(meta: any, door: string) { return slotClock(meta) ?? DOOR_TIME[door]; }

// ----- the next card, by the clock -----
const NEXT_GRACE_MIN = 15;
// "7:45am" -> 465; anything that is not a clock -> null
function minOf(t: string | null | undefined): number | null { const k = timeKey(t); return k < 9998 ? k : null; }
// "12:00:00" or "12:00" -> 720
function hmsMin(t: string | null | undefined): number | null {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function untilOf(due: number | null, windowEnd?: string | null): number | null {
  if (due == null) return null;
  const end = windowEnd ? hmsMin(windowEnd) : null;
  return Math.max(due + NEXT_GRACE_MIN, end != null && end > due ? end : 0);
}
// whole minutes since Pacific midnight, seconds dropped
function ptMinute(): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + m;
}
// The sitting is already in the order of the day. The first open, non-calendar card with no clock or a
// clock not yet passed; else the open card that passed most recently (earliest in order on a tie); else null.
function pickNext(sitting: any[], nowMin: number): any | null {
  const open = sitting.filter((c) => c.status === "open" && c.source !== "calendar");
  if (!open.length) return null;
  const hit = open.find((c) => c.until_min == null || nowMin <= c.until_min);
  if (hit) return hit;
  let best = open[0];
  for (const c of open) if (c.until_min > best.until_min) best = c;
  return best;
}
function doorOf(row: any): string {
  const c = String(row.campaign || "");
  if (c.startsWith("wayofdad")) return "wayofdad";
  if (c.startsWith("walks")) return "walks";
  if (c.startsWith("fortify")) return "fortify";
  if (c.startsWith("maddy") || c.startsWith("your-people")) return "maddy";
  if (row.pillar === "maddy") return "maddy";
  if (row.pillar === "fortify") return "fortify";
  return "house";
}
function pieceTitle(row: any): string {
  const t = row?.metadata?.piece_title;
  if (t) return String(t);
  return String(row.title || "").replace(/\s*\((x|bluesky|instagram|threads|linkedin|youtube|tiktok|reddit|facebook|substack|email|other)\)\s*$/i, "");
}
function groupKey(row: any) { return (row.scheduled_for || "").slice(0, 10) + "|" + pieceTitle(row).toLowerCase(); }
function tapLabel(platform: string, format: string) {
  if (SOCIAL.has(platform)) return "Posted";
  if (platform === "email" || format === "note" || platform === "other") return "Sent";
  return "Done";
}
function esc(s: any) { return String(s == null ? "" : s); }
// A photo the phone can load: only a file in the vault has one (the Way of Dad frames live in
// iCloud and carry a name only). The face loads it with the device token as a header
// (Authorization: Bearer, or x-device-token) through URLSession; the token never rides in a URL.
const API_URL = () => (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/morning-api";
function isVaultImage(path: string) { return /^docs\/[^\s]+\.(png|jpe?g|gif|webp)$/i.test(path); }
function photoUrl(path: string) { return isVaultImage(path) ? API_URL() + "?op=photo&path=" + encodeURIComponent(path) : null; }
const IMAGE_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

// ----- the vault (copy for the cards) -----
// The GitHub token: the MORNING_GH_TOKEN secret when set, else the eddy_config row
// morning_gh_token (RLS-sealed, service role only; the same table the face reads its
// Linear and Hevy keys from). His word, 2026-09-12: use the token already on his machine.
let ghCache: { at: number; token: string } | null = null;
async function ghToken(): Promise<string> {
  const env = Deno.env.get("MORNING_GH_TOKEN") || "";
  if (env) return env;
  if (ghCache && Date.now() - ghCache.at < 5 * 60000) return ghCache.token;
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const r = await sb.from("eddy_config").select("value").eq("key", "morning_gh_token").maybeSingle();
    const token = String(r.data?.value || "");
    ghCache = { at: Date.now(), token };
    return token;
  } catch { return ""; }
}
const textCache = new Map<string, { at: number; text: string | null }>();
async function vaultText(path: string): Promise<string | null> {
  const token = await ghToken();
  if (!token || !path) return null;
  const hit = textCache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MIN * 60000) return hit.text;
  let text: string | null = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: { authorization: "Bearer " + token, "user-agent": "morning-api", accept: "application/vnd.github.raw+json" } });
    if (r.ok) text = await r.text();
  } catch { text = null; }
  textCache.set(path, { at: Date.now(), text });
  return text;
}
function copyPaths(post: any): string[] {
  const m = post.metadata || {};
  const vp = String(m.vault_path || "");
  const base = vp.replace(/\.(md|txt|html)$/i, "").replace(/\.(x|ig|linkedin|bluesky|instagram)\.txt$/i, "");
  const p = post.platform;
  const out: string[] = [];
  if (m.script_txt) out.push(String(m.script_txt));
  if (p === "x" || p === "bluesky") out.push(base + ".x.txt");
  if (p === "instagram") out.push(base + ".ig.txt");
  if (p === "linkedin") out.push(base + ".linkedin.txt");
  if (vp.endsWith(".txt")) out.push(vp);
  out.push(base + ".txt");
  if (vp.endsWith(".md")) out.push(vp);
  return [...new Set(out.filter(Boolean))];
}

// ----- composition -----
type Card = any;
async function contentCards(sb: any, today: string, hubCards: Map<number, any>, withText: boolean, onlyIds?: string[], ahead?: { from: string; to: string }) {
  let q = sb.from("content_calendar").select("id, title, platform, format, status, scheduled_for, published_at, url, campaign, pillar, parent_post_id, is_canonical, metadata, excerpt, updated_at").eq("user_id", USER).not("status", "in", "(published,archived)").not("scheduled_for", "is", null).lte("scheduled_for", today).order("scheduled_for");
  if (ahead) q = sb.from("content_calendar").select("id, title, platform, format, status, scheduled_for, published_at, url, campaign, pillar, parent_post_id, is_canonical, metadata, excerpt, updated_at").eq("user_id", USER).not("status", "in", "(published,archived)").gt("scheduled_for", ahead.from).lte("scheduled_for", ahead.to + "T23:59:59").order("scheduled_for");
  if (onlyIds && onlyIds.length) q = sb.from("content_calendar").select("id, title, platform, format, status, scheduled_for, published_at, url, campaign, pillar, parent_post_id, is_canonical, metadata, excerpt, updated_at").in("id", onlyIds);
  const rows = (await q).data ?? [];
  const groups = new Map<string, any[]>();
  for (const r of rows) { const k = groupKey(r); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const cards: Card[] = [];
  let fetches = 0;
  for (const [, posts] of groups) {
    const lead = posts[0];
    const m = lead.metadata || {};
    const door = doorOf(lead);
    const day = (lead.scheduled_for || "").slice(0, 10);
    const morning = m.morning || {};
    const heldUntil = morning.held_until && morning.held_until > today ? morning.held_until : null;
    const skippedToday = morning.skipped === today;
    const hub = m.day != null && door === "wayofdad" ? hubCards.get(Number(m.day)) : null;
    // copy, per platform, deduplicated by text
    const copy: any[] = [];
    const seen = new Map<string, any>();
    const recent = day >= addDays(today, -BEHIND_DAYS);
    for (const p of posts) {
      let text: string | null = null;
      if (hub) text = (p.platform === "instagram" ? hub.ig : hub.x) || null;
      if (!text && withText && recent && fetches < 14) {
        for (const path of copyPaths(p)) { fetches++; text = await vaultText(path); if (text) break; if (fetches >= 14) break; }
      }
      if (!text && p.excerpt) text = p.excerpt;
      const label = PLATFORM_LABEL[p.platform] || p.platform;
      if (text) {
        const key = text.trim();
        if (seen.has(key)) { seen.get(key).platforms.push(p.platform); seen.get(key).label += " and " + label; }
        else { const c = { label, platforms: [p.platform], text: text.trim() }; seen.set(key, c); copy.push(c); }
      }
    }
    const photoPath = m.image || m.frame || (hub ? hub.photo : null) || null;
    const photo = photoPath ? { path: String(photoPath), alt: (hub ? hub.alt : null) || m.alt || null, url: photoUrl(String(photoPath)) } : null;
    const kit = (m.send_to || m.account || m.slot || m.send_note) ? { to: m.send_to || null, from: m.account || null, when: m.slot || null, how: m.send_note || null } : null;
    const taps: any[] = [];
    const allLabel = tapLabel(lead.platform, lead.format);
    if (posts.length > 1) taps.push({ action: allLabel.toLowerCase(), label: allLabel + " on all " + posts.length });
    for (const p of posts) taps.push({ action: tapLabel(p.platform, p.format).toLowerCase(), label: tapLabel(p.platform, p.format) + (posts.length > 1 ? " on " + (PLATFORM_LABEL[p.platform] || p.platform) : ""), post_id: p.id });
    taps.push({ action: "hold", label: "Hold" }, { action: "skip", label: "Skip" });
    const links: any[] = [];
    if (m.plan_page) links.push({ label: "The plan page", href: "https://github.com/" + REPO + "/blob/main/" + m.plan_page });
    if (m.plan_artifact || m.show_artifact) links.push({ label: "The plan", href: m.plan_artifact || m.show_artifact });
    if (m.vault_path) links.push({ label: "The file", href: "https://github.com/" + REPO + "/blob/main/" + m.vault_path });
    const clock = slotClock(m);
    const due = clock ? minOf(clock) : null;
    cards.push({
      id: "content:" + lead.id,
      source: "content",
      time: slotTime(m, door),
      block: blockOf(slotTime(m, door)),
      due_min: due,
      until_min: untilOf(due),
      door,
      what: pieceTitle(lead),
      why: m.why || null,
      copy,
      photo,
      kit,
      taps,
      status: heldUntil ? "held" : skippedToday ? "skipped" : "open",
      held_until: heldUntil,
      posts: posts.map((p: any) => ({ id: p.id, platform: p.platform, status: p.status, url: p.url || null, stage: p.metadata?.stage || null })),
      links,
      campaign: lead.campaign || null,
      overdue_since: day < today ? day : null,
      day,
      stage: m.stage || null,
    });
  }
  return cards;
}

function routineCard(r: any, mark: any, today: string): Card {
  const taps = (r.taps || ["done", "skip"]).map((a: string) => ({ action: a, label: a === "done" ? "Done" : a === "skip" ? "Skip" : a === "hold" ? "Hold" : a }));
  return {
    id: "routine:" + r.id,
    source: "routine",
    time: r.time || DOOR_TIME[r.door],
    block: blockOf(r.time || DOOR_TIME[r.door]),
    due_min: r.time ? minOf(r.time) : null,
    until_min: untilOf(r.time ? minOf(r.time) : null),
    door: r.door,
    what: r.what,
    why: r.why || null,
    copy: Array.isArray(r.copy) ? r.copy : (r.copy ? [r.copy] : []),
    photo: null,
    kit: null,
    taps,
    ask: r.ask || null,
    links: Array.isArray(r.links) ? r.links : [],
    status: mark ? mark.action : "open",
    value: mark ? mark.value : null,
    marked_at: mark ? mark.at : null,
    source_path: r.source_path || null,
    day: today,
  };
}

function rulingCard(r: any): Card {
  const opts = Array.isArray(r.options) ? r.options : [];
  const taps = opts.map((o: any) => ({ action: "ruled", label: o.label, choice: o.key }));
  taps.push({ action: "ruled", label: "Your words", choice: "typed", typed: true });
  taps.push({ action: "hold", label: "Hold" });
  return {
    id: "ruling:" + r.id,
    source: "ruling",
    time: "8:20am",
    block: "Wake",
    due_min: null,     // 8:20am is a placeholder, not a clock
    until_min: null,
    door: r.door || "house",
    what: r.question,
    why: r.context || null,
    lane: r.lane,
    copy: [],
    photo: null,
    kit: null,
    taps,
    options: opts,
    links: r.link ? [{ label: "Where it was asked", href: r.link }] : [],
    status: r.answered_at ? "ruled" : "open",
    answer: r.answer || null,
    answer_text: r.answer_text || null,
    asked_at: r.asked_at,
  };
}

// ----- the one Today engine: the other things the face knows, as cards -----
// Anchors are the app's (Face/FaceDerive.swift): the block a routine belongs to and the hour it reads as.
const ANCHOR_TIME: Record<string, string> = { wake: "7:00am", levo_gap_closed: "7:30am", meal_start: "12:00pm", fork_down: "12:45pm", dip_clear: "3:00pm", gym_leave: "5:00pm", wind_down: "7:30pm", close: "9:00pm", lights_down: "9:30pm" };
const ANCHOR_BLOCK: Record<string, string> = { wake: "Wake", levo_gap_closed: "Wake", meal_start: "Midday", fork_down: "Midday", dip_clear: "Midday", gym_leave: "Midday", wind_down: "Evening", lights_down: "Evening", close: "Close" };
const ANCHOR_NAME: Record<string, string> = { wake: "first thing", levo_gap_closed: "after the levo gap", meal_start: "with lunch", fork_down: "after lunch", dip_clear: "mid afternoon", gym_leave: "after the gym", wind_down: "evening", lights_down: "lights down", close: "the close" };
const MED_TIME: Record<string, string> = { on_waking: "7:00am", with_breakfast: "8:30am", pre_gym: "2:00pm", bedtime: "9:30pm", weekly: "9:00am" };
const MED_LABEL: Record<string, string> = { on_waking: "On waking", with_breakfast: "With breakfast", pre_gym: "Before the gym", bedtime: "Bedtime", weekly: "Thursday, weekly" };
const MED_ORDER = ["on_waking", "with_breakfast", "weekly", "pre_gym", "bedtime"];
const WORK_TIME = "9:00am";     // a dated thing with no clock time sits at the top of the work morning (a placeholder: due_min null)
const LATER_DAYS = 7;
// The block a clock time falls in, the app's own edges (Wake before 11, Midday before 5, Evening before 9, then Close).
const BLOCKS = ["Wake", "Midday", "Evening", "Close", "Any time"];
function blockOf(time: string | null | undefined, anchor?: string | null): string {
  if (anchor && ANCHOR_BLOCK[anchor]) return ANCHOR_BLOCK[anchor];
  const k = timeKey(time);
  if (k >= 9998) return "Any time";
  return k < 11 * 60 ? "Wake" : k < 17 * 60 ? "Midday" : k < 21 * 60 ? "Evening" : "Close";
}
function clockOf(t: string | null | undefined): string | null {
  // "07:45:00" (a time column) -> "7:45am"; "7:45am" stays
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return String(t);
  const h = Number(m[1]); const ap = h >= 12 ? "pm" : "am"; const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ":" + m[2] + ap;
}
function ptClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s/g, "");
}
function ptDate(iso: string): string { return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }); }
function doorOfBox(title: string): string { return /walks/i.test(title) ? "walks" : "house"; }
function daysBetween(a: string, b: string) { return Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86400000); }
function ago(day: string, today: string): string { const d = daysBetween(day, today); return d <= 0 ? "today" : d === 1 ? "1 day past" : d + " days past"; }

// A routine of the day, from checklist_templates (the one table). The Morning's five carry door,
// copy, ask, links; the body's thirty carry the rungs. Both are the same card.
function checklistCard(t: any, comp: any, today: string): Card {
  const time = t.time && t.time !== "later" ? t.time : (clockOf(t.window_start) || ANCHOR_TIME[t.anchor] || "later");
  // the row's own clock: its time, else its window, else its anchor's hour; a routine written "later" has none
  const due = t.time && t.time !== "later" ? minOf(t.time) : t.window_start ? hmsMin(t.window_start) : t.time === "later" ? null : minOf(ANCHOR_TIME[t.anchor]);
  const status = !comp ? "open" : comp.skipped ? "skipped" : "done";
  const copy = Array.isArray(t.copy) ? t.copy : (t.copy ? [t.copy] : []);
  return {
    id: "routine:" + t.id, source: "routine", time, block: blockOf(time, t.anchor), due_min: due, until_min: untilOf(due, t.window_end), door: t.door || null,
    what: t.title, why: t.why || null, copy, photo: null, kit: null,
    taps: [{ action: "done", label: "Done" }, { action: "skip", label: "Skip" }],
    ask: t.ask || null, links: Array.isArray(t.links) ? t.links : [],
    status, value: comp ? comp.value ?? null : null, marked_at: comp ? comp.completed_at : null,
    anchor: t.anchor || null, anchor_name: ANCHOR_NAME[t.anchor] || null, cadence: t.cadence || "daily",
    rungs: (t.rung_full || t.rung_reduced || t.rung_floor) ? { full: t.rung_full || null, reduced: t.rung_reduced || null, floor: t.rung_floor || null } : null,
    first_motion: t.first_physical_motion || null, source_path: t.source_path || null, day: today,
  };
}
// A desk item as a card. A child item carries its (nearest, open) parent's text as its why, plus the days
// past when it is overdue (RULINGS 2026-09-14: goals and projects reach the day only through their steps).
function itemCard(it: any, box: any, today: string, parent?: any): Card {
  const day = it.due;
  const links: any[] = [];
  const url = String(it.detail || "").match(/https?:\/\/\S+/);
  if (url) links.push({ label: "Open", href: url[0] });
  if (it.linear_ref && /^https?:/.test(it.linear_ref)) links.push({ label: "In Linear", href: it.linear_ref });
  const why = parent
    ? [parent.text, day && day < today ? ago(day, today) : null].filter(Boolean).join(" · ")
    : it.detail && !url ? it.detail : (day && day < today ? ago(day, today) + " · " + (box?.title || "") : (box?.title || null));
  return {
    id: "item:" + it.id, source: "work", time: WORK_TIME, block: "Wake", due_min: null, until_min: null, door: doorOfBox(box?.title || ""),
    what: it.text, why: why || null,
    copy: [], photo: null, kit: null,
    taps: [{ action: "done", label: "Done" }, { action: "hold", label: "Tomorrow" }, { action: "hold", label: "Next week", value: "7" }],
    links, status: it.done ? "done" : "open", box: box?.title || null, box_id: it.box_id, kind: it.kind || "task",
    options: it.kind === "decision" && Array.isArray(it.options) ? it.options.map((o: any) => (typeof o === "string" ? { key: o, label: o } : { key: o.key || o.id || o.label, label: o.label || o.text || String(o.key || "") })) : [],
    parent: parent ? { id: parent.id, title: parent.text } : null,
    day, overdue_since: day && day < today ? day : null,
  };
}
// A project move as a card. twin: the desk item this move repeats (project_moves.desk_item_id), null when unlinked;
// text and open come from the open desk items the composer holds (null text and open false when that item is closed).
function moveCard(m: any, project: any, today: string, itemById?: Map<string, any>): Card {
  const day = m.target_ymd;
  const twinItem = m.desk_item_id ? itemById?.get(m.desk_item_id) : null;
  return {
    id: "move:" + m.id, source: "move", time: WORK_TIME, block: "Wake", due_min: null, until_min: null, door: "house",
    what: m.title, why: m.why || (project ? "Step " + (m.stage ?? "") + " of " + project.title : null),
    copy: [], photo: null, kit: null,
    taps: [{ action: "done", label: "Done" }, { action: "hold", label: "Tomorrow" }],
    links: [], status: m.status === "done" ? "done" : "open", project: project?.title || null, project_id: m.project_id, stage: m.stage ?? null,
    twin: m.desk_item_id ? { item_id: m.desk_item_id, text: twinItem ? twinItem.text : null, open: !!twinItem && !twinItem.done } : null,
    day, overdue_since: day && day < today ? day : null,
  };
}
// A Linear issue as a card. A sub-issue (open parent) carries the parent's title as its why.
function linearCard(i: any, today: string): Card {
  const day = i.due || null;
  const p = i.priority;
  const overdue = day && day < today ? ago(day, today) : null;
  const why = i.parent
    ? [i.parent.title, overdue].filter(Boolean).join(" · ")
    : [i.project ? String(i.project).replace(/^[^\w]+/, "").trim() : null, i.state || null, p === 1 ? "urgent" : p === 2 ? "high" : null, overdue].filter(Boolean).join(" · ");
  return {
    id: "linear:" + i.id, source: "linear", time: WORK_TIME, block: "Wake", due_min: null, until_min: null, door: "house",
    what: (i.key ? i.key + " " : "") + i.title, why: why || null, copy: [], photo: null, kit: null,
    taps: [{ action: "done", label: "Done in Linear" }, { action: "hold", label: "Tomorrow" }],
    links: i.url ? [{ label: "Open in Linear", href: i.url }] : [], status: "open", priority: p ?? null, linear_key: i.key || null, team_id: i.team_id || null,
    parent: i.parent ? { id: i.parent.id, key: i.parent.key || null, title: i.parent.title } : null,
    day, overdue_since: day && day < today ? day : null,
  };
}
// ----- actions only (RULINGS 2026-09-14) -----
// Linear state types that are closed: out of every card, count and list.
const LINEAR_CLOSED = ["completed", "canceled", "duplicate"];
// project_moves as the Morning reads them; desk_item_id arrives with migration actions_only_01
const MOVE_COLS = "id, project_id, title, why, stage, target_ymd, status";
// Why a Linear row is not a card, checked in order; null means it is a card. "skip" is out of every count and list.
function linearReason(i: any): "skip" | "goal" | "parked" | "parent" | "undated_urgent" | "undated" | null {
  if (LINEAR_CLOSED.includes(String(i.state_type || "")) || String(i.state || "").toLowerCase() === "duplicate") return "skip";
  const labels = (i.labels || []).map((l: any) => String(typeof l === "string" ? l : l?.name || "").toLowerCase());
  if (labels.includes("goal")) return "goal";
  if (labels.includes("parked")) return "parked";
  if ((i.open_children || []).length > 0) return "parent";   // any assignee: a child someone else holds keeps the parent off the day
  if (!i.due) return i.priority === 1 ? "undated_urgent" : "undated";
  return null;
}
// The desk's holds. itemById: the open items the composer reads (not notes, box not archived). openKids: a parent's
// open child items, only where the parent is itself open. twinOf: a desk item's linking open move, the first in
// the given (stage) order.
function deskHolds(items: any[], moves: any[]) {
  const itemById = new Map<string, any>();
  for (const it of items) itemById.set(it.id, it);
  const openKids = new Map<string, any[]>();
  for (const it of items) {
    if (!it.parent_item_id || !itemById.has(it.parent_item_id)) continue;
    if (!openKids.has(it.parent_item_id)) openKids.set(it.parent_item_id, []);
    openKids.get(it.parent_item_id)!.push(it);
  }
  const twinOf = new Map<string, any>();
  for (const m of moves) if (m.status !== "done" && m.desk_item_id && itemById.has(m.desk_item_id) && !twinOf.has(m.desk_item_id)) twinOf.set(m.desk_item_id, m);
  return { itemById, openKids, twinOf };
}
// One card per meds window: every med of the window as a "post" (taken or due), one tap per med and one for all.
function medsCard(timing: string, meds: any[], log: any[], today: string): Card {
  const taken = new Map<string, any>();
  for (const l of log) { if (l.medication_id) taken.set(l.medication_id, l); taken.set("name:" + l.med_name, l); }
  const posts = meds.map((m) => { const l = taken.get(m.id) || taken.get("name:" + m.name); return { id: m.id, platform: m.name + (m.dose ? " " + m.dose : ""), status: l ? "taken" : "due", url: null, at: l ? l.taken_at : null }; });
  const left = posts.filter((p) => p.status === "due");
  const taps: any[] = [];
  if (left.length > 1) taps.push({ action: "done", label: "Taken, all " + left.length });
  for (const p of left) taps.push({ action: "done", label: "Taken: " + p.platform, post_id: p.id });
  return {
    id: "med:" + timing, source: "meds", time: MED_TIME[timing] || "later", block: blockOf(MED_TIME[timing]), due_min: minOf(MED_TIME[timing]), until_min: untilOf(minOf(MED_TIME[timing])), door: null,
    what: "Meds, " + (MED_LABEL[timing] || timing).toLowerCase() + ": " + meds.map((m) => m.name).join(", "),
    why: left.length === 0 ? "All taken." : left.length === meds.length ? null : left.length + " of " + meds.length + " still due.",
    copy: [], photo: null, kit: null, taps, links: [], status: left.length === 0 ? "done" : "open", posts, timing, day: today,
  };
}
// the last day an all-day event covers, when that is after today; end_at is the exclusive date at UTC midnight
function allDayThrough(endIso: string | null, today: string): string | null {
  if (!endIso) return null;
  const last = new Date(endIso.slice(0, 10) + "T12:00:00Z"); last.setUTCDate(last.getUTCDate() - 1);
  if (last.toISOString().slice(0, 10) <= today) return null;
  return "through " + last.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}
function calendarCard(ev: any, today: string, nowIso: string): Card {
  const start = ev.start_at ? ptClock(ev.start_at) : null;
  // an all-day event is never over before its day is: its end_at read as an instant is the afternoon before
  const over = ev.all_day ? false : ev.end_at ? ev.end_at < nowIso : false;
  return {
    id: "calendar:" + (ev.id || ev.event_id || ev.summary), source: "calendar", time: ev.all_day ? "all day" : (start || "later"), block: ev.all_day ? "Wake" : blockOf(start),
    due_min: ev.all_day ? null : minOf(start), until_min: null, door: null,
    what: ev.summary, why: [ev.location || null, ev.end_at && !ev.all_day ? "until " + ptClock(ev.end_at) : null, ev.all_day ? allDayThrough(ev.end_at, today) : null].filter(Boolean).join(" · ") || null,
    copy: [], photo: null, kit: null, taps: [], links: ev.html_link ? [{ label: "Open", href: ev.html_link }] : [], status: over ? "done" : "open", day: today,
  };
}

// ----- Linear (the key the face keeps in eddy_config; read with a short cache, written on a tap) -----
let linearCache: { at: number; rows: any[] } | null = null;
async function linearQuery(key: string, query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { "content-type": "application/json", authorization: key }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(12000) });
  const d = await r.json();
  if (!r.ok || d.errors) throw new Error("linear " + r.status + " " + JSON.stringify(d.errors ?? d).slice(0, 160));
  return d.data;
}
async function linearKey(sb: any): Promise<string> {
  try { const r = await sb.from("eddy_config").select("value").eq("key", "linear_api_key").maybeSingle(); return String(r.data?.value || ""); } catch { return ""; }
}
// Every open issue assigned to him (Duplicate is closed too), every page: nothing past page 1 may vanish.
const LINEAR_OPEN_QUERY = `query($after: String) { viewer { assignedIssues(first: 100, after: $after, filter: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } }, orderBy: updatedAt) {
  pageInfo { hasNextPage endCursor }
  nodes { id identifier title priority dueDate url updatedAt state { name type } project { name } team { id } labels { nodes { name } }
    parent { id identifier title state { type } }
    children(first: 50) { nodes { id identifier title dueDate state { type } assignee { isMe } } } } } } }`;
// A Linear node as the engine's row. parent: only an open parent. open_children: the children not closed, any assignee.
function linearRow(i: any) {
  const closed = (s: any) => LINEAR_CLOSED.includes(String(s?.type || ""));
  return {
    id: i.id, key: i.identifier, title: i.title, priority: i.priority, due: i.dueDate, url: i.url, updated: i.updatedAt, state: i.state?.name, state_type: i.state?.type, project: i.project?.name, labels: (i.labels?.nodes ?? []).map((l: any) => l.name), team_id: i.team?.id,
    parent: i.parent && !closed(i.parent.state) ? { id: i.parent.id, key: i.parent.identifier, title: i.parent.title } : null,
    open_children: (i.children?.nodes ?? []).filter((c: any) => !closed(c.state)).map((c: any) => ({ id: c.id, key: c.identifier, title: c.title, due: c.dueDate || null, mine: !!c.assignee?.isMe })),
  };
}
async function linearOpen(key: string): Promise<any[]> {
  if (linearCache && Date.now() - linearCache.at < 5 * 60000) return linearCache.rows;
  const nodes: any[] = [];
  let after: string | null = null;
  for (;;) {
    const d = await linearQuery(key, LINEAR_OPEN_QUERY, { after });
    const conn = d.viewer?.assignedIssues;
    nodes.push(...(conn?.nodes ?? []));
    const cursor = conn?.pageInfo?.endCursor || null;
    if (!conn?.pageInfo?.hasNextPage || !cursor || cursor === after) break;
    after = cursor;
  }
  const rows = nodes.map(linearRow);
  linearCache = { at: Date.now(), rows };
  return rows;
}
async function linearSetState(key: string, issueId: string, type: "completed" | "unstarted") {
  const d = await linearQuery(key, `query($id: String!) { issue(id: $id) { id team { states { nodes { id name type position } } } } }`, { id: issueId });
  const states = (d.issue?.team?.states?.nodes ?? []).filter((s: any) => s.type === type).sort((a: any, b: any) => a.position - b.position);
  if (!states.length) throw new Error("no " + type + " state on the team");
  await linearQuery(key, `mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`, { id: issueId, state: states[0].id });
  linearCache = null;
}
async function linearSetDue(key: string, issueId: string, due: string | null) {
  await linearQuery(key, `mutation($id: String!, $due: TimelessDate) { issueUpdate(id: $id, input: { dueDate: $due }) { success } }`, { id: issueId, due });
  linearCache = null;
}

// Every completion of a template on a day is deleted before one is written: one mark per routine per day.
async function writeCompletion(sb: any, templateId: string, today: string, now: string, skipped: boolean, value: string | null, source: string) {
  await sb.from("checklist_completions").delete().eq("template_id", templateId).eq("date", today);
  const row: any = { template_id: templateId, user_id: USER, date: today, completed_at: now, skipped, value, source };
  let u = await sb.from("checklist_completions").insert(row);
  if (u.error && /column/i.test(u.error.message)) { delete row.value; delete row.source; u = await sb.from("checklist_completions").insert(row); }
  if (u.error) throw new Error(u.error.message);
  return row;
}

async function liveChecks(sb: any) {
  const cached = (await sb.from("hub_content").select("content, updated_at").eq("key", "morning-doors").maybeSingle()).data;
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < CACHE_MIN * 60000) return cached.content;
  const sites: Record<string, string> = { maddy: "https://mymaddy.app/", fortify: "https://jeremyrunge.com/fortify", wayofdad: "https://wayofdad.co/", walks: "https://walks.jeremyrunge.com/", house: "https://chart-house.pages.dev/" };
  const out: any = { checked_at: new Date().toISOString(), sites: {}, bluesky: null };
  await Promise.all(Object.entries(sites).map(async ([k, u]) => {
    try { const r = await fetch(u, { method: "GET", redirect: "follow", headers: { "user-agent": "morning-api" }, signal: AbortSignal.timeout(6000) }); out.sites[k] = { status: r.status, ok: r.ok, url: u }; }
    catch { out.sites[k] = { status: 0, ok: false, url: u }; }
  }));
  try {
    const r = await fetch("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=wayofdad.co&limit=1&filter=posts_no_replies", { signal: AbortSignal.timeout(6000) });
    if (r.ok) { const d = await r.json(); const p = d.feed?.[0]?.post; if (p) out.bluesky = { at: p.record?.createdAt, text: String(p.record?.text || "").slice(0, 140), likes: p.likeCount, replies: p.replyCount, uri: p.uri }; }
  } catch { out.bluesky = null; }
  await sb.from("hub_content").upsert({ key: "morning-doors", content: out, updated_at: out.checked_at }, { onConflict: "key" });
  return out;
}

Deno.serve(async (req: Request) => {
  const headers = headersFor(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("op") !== "photo") return j({ error: "POST, or GET ?op=photo" }, headers, 405);
    // The token travels only in a header, never in the URL: URLs land in logs.
    const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || req.headers.get("x-device-token") || "";
    const hashesG = (Deno.env.get("MORNING_TOKEN_HASHES") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const acceptedG = hashesG.length ? hashesG : FACE_HASHES;
    const serviceG = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const okTok = !!given && (acceptedG.includes(await sha256hex(given)) || (given === serviceG) || (given.length > 20 && await serviceProbe(given)));
    if (!okTok) return j({ error: "bad token" }, headers, 403);
    const path = u.searchParams.get("path") || "";
    if (!isVaultImage(path)) return j({ error: "not a vault image" }, headers, 400);
    const gh = await ghToken();
    if (!gh) return j({ error: "MORNING_GH_TOKEN not set" }, headers, 503);
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: { authorization: "Bearer " + gh, "user-agent": "morning-api", accept: "application/vnd.github.raw+json" } });
    if (!r.ok) return j({ error: "vault " + r.status }, headers, r.status === 404 ? 404 : 502);
    const ext = path.split(".").pop()!.toLowerCase();
    return new Response(r.body, { status: 200, headers: { "Access-Control-Allow-Origin": headers["Access-Control-Allow-Origin"], "Content-Type": IMAGE_TYPE[ext] || "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
  }
  if (req.method !== "POST") return j({ error: "POST only" }, headers, 405);
  let body: any;
  try { body = await req.json(); } catch { return j({ error: "bad json" }, headers, 400); }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const hashes = (Deno.env.get("MORNING_TOKEN_HASHES") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const accepted = hashes.length ? hashes : FACE_HASHES;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const viaToken = !!body.token && accepted.includes(await sha256hex(String(body.token)));
  // The Chart House Pages function speaks with the service role as a bearer. The key it holds may
  // be the legacy JWT or the newer secret; either way, a bearer that can read an RLS-sealed table
  // through PostgREST is the service role, and nothing else is.
  let viaService = !!serviceKey && bearer.length > 20 && bearer === serviceKey;
  if (!viaService && !viaToken && bearer.length > 20) viaService = await serviceProbe(bearer);
  if (!viaService && !viaToken) return j({ error: "bad token" }, headers, 403);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const today = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : ptToday();
  const now = new Date().toISOString();
  const source = String(body.source || (viaService ? "chart-house" : "face")).slice(0, 40);

  try {
    if (body.op === "morning") {
      const wd = dow(today);
      const later_to = addDays(today, LATER_DAYS);
      const [hub, tplQ, compQ, legacyRoutinesQ, legacyMarksQ, rulingsQ, live, oppsQ, walksQ, aheadQ, undatedQ, boxesQ, itemsQ, projectsQ, movesQ, medsQ, medLogQ, calQ, lkey] = await Promise.all([
        sb.from("hub_content").select("content").eq("key", "wayofdad").maybeSingle(),
        sb.from("checklist_templates").select("*").eq("user_id", USER).order("sort_order"),
        sb.from("checklist_completions").select("*").eq("date", today),
        sb.from("morning_routines").select("*").eq("user_id", USER).eq("active", true).order("sort"),   // gone after one_today_01; the error is ignored
        sb.from("morning_marks").select("*").eq("date", today),
        sb.from("rulings_owed").select("*").is("answered_at", null).order("asked_at"),
        liveChecks(sb),
        sb.from("opportunities").select("pillar, stage").is("closed_at", null),
        sb.from("desk_items").select("id, kind, text, source, done, created_at").in("box_id", ["c9ec85f4-c2e2-4294-bfe5-7b500e905eae", "daf7faf0-936f-4e21-aeca-7196b9c31a84"]).eq("done", false),
        sb.from("content_calendar").select("id, title, platform, status, scheduled_for, campaign, pillar, metadata").eq("user_id", USER).neq("status", "archived").gt("scheduled_for", today).lte("scheduled_for", addDays(today, 14)).order("scheduled_for"),
        sb.from("content_calendar").select("id, campaign, pillar, status, metadata").eq("user_id", USER).eq("status", "draft").is("scheduled_for", null),
        sb.from("desk_boxes").select("id, title, why, deadline, position").eq("archived", false).order("position"),
        sb.from("desk_items").select("id, box_id, text, detail, done, due, kind, options, choice, linear_ref, parent_item_id, position").eq("done", false).order("position"),
        sb.from("projects").select("id, title, due_ymd, status"),
        sb.from("project_moves").select(MOVE_COLS + ", desk_item_id").neq("status", "done").order("stage"),
        sb.from("medications").select("id, name, dose, timing, active").eq("active", true).order("name"),
        sb.from("med_log").select("medication_id, med_name, taken_at").eq("date", today),
        sb.from("calendar_today_cache").select("id, event_id, summary, start_at, end_at, all_day, location, html_link").eq("event_date", today).order("start_at"),
        linearKey(sb).then(async (k) => { if (!k) return { rows: [], error: "no key" }; try { return { rows: await linearOpen(k), error: null }; } catch (e) { return { rows: [], error: String(e).slice(0, 120) }; } }),
      ]);
      const hubCards = new Map<number, any>();
      const hubContent = hub.data?.content || null;
      for (const c of (hubContent?.cards || [])) hubCards.set(Number(c.day), c);
      const comps = new Map<string, any>();
      for (const c of (compQ.data ?? [])) comps.set(c.template_id, c);
      const boxes = boxesQ.data ?? []; const boxById = new Map<string, any>(); for (const b of boxes) boxById.set(b.id, b);
      const projects = projectsQ.data ?? []; const projById = new Map<string, any>(); for (const p of projects) projById.set(p.id, p);
      const items = (itemsQ.data ?? []).filter((it: any) => it.kind !== "note" && boxById.has(it.box_id));
      // the links (project_moves.desk_item_id, migration actions_only_01): until the column exists the old select
      // runs, so no move is lost to a missing column and no move has a twin
      const linksReady = !movesQ.error;
      let moves: any[] = movesQ.data ?? [];
      if (movesQ.error) moves = (await sb.from("project_moves").select(MOVE_COLS).neq("status", "done").order("stage")).data ?? [];
      const meds = medsQ.data ?? [];
      const medLog = medLogQ.data ?? [];
      const linear: any[] = lkey.rows; const linearError: string | null = lkey.error;

      // ---- the routines of today: the one table (plus the legacy Morning rows until the migration lands)
      const templates = (tplQ.data ?? []).filter((t: any) => !t.paused);
      const runsOn = (t: any, day: string, wdi: number) => {
        if (t.starts_on && t.starts_on > day) return false;
        if (t.ends_on && t.ends_on < day) return false;
        if (Array.isArray(t.days) && t.days.length) return t.days.map(Number).includes(wdi);
        if (t.cadence === "as_needed") return false;
        if (t.cadence === "weekly") return wdi === 4;   // no days named: Thursday, the week's anchor day
        return true;
      };
      const todaysTemplates = templates.filter((t: any) => runsOn(t, today, wd));
      const legacyRoutines = legacyRoutinesQ.error ? [] : (legacyRoutinesQ.data ?? []);
      const legacyMarks = new Map<string, any>(); for (const m of (legacyMarksQ.error ? [] : (legacyMarksQ.data ?? []))) legacyMarks.set(m.routine_id, m);
      const legacyToday = legacyRoutines.filter((r: any) => (r.days || []).includes(wd) && (!r.starts_on || r.starts_on <= today) && (!r.ends_on || r.ends_on >= today));

      // ---- content: today and the past (behind), then ahead (later)
      const content = await contentCards(sb, today, hubCards, true);
      const contentAhead = await contentCards(sb, today, hubCards, false, undefined, { from: today, to: later_to });

      // ---- the three buckets
      const sitting: Card[] = [];
      const behindMap = new Map<string, any>();
      const laterMap = new Map<string, Card[]>();
      const behindPut = (key: string, kind: string, label: string, door: string | null, c: Card) => {
        if (!behindMap.has(key)) behindMap.set(key, { key, kind, campaign: label, label, door, count: 0, from: c.day, to: c.day, cards: [] });
        const g = behindMap.get(key); g.count++; if (c.day < g.from) g.from = c.day; if (c.day > g.to) g.to = c.day; g.cards.push(c);
      };
      const laterPut = (c: Card) => { if (!laterMap.has(c.day)) laterMap.set(c.day, []); laterMap.get(c.day)!.push(c); };

      for (const c of content) { if (c.day === today) sitting.push(c); else if (c.day < today) behindPut("campaign:" + (c.campaign || "none"), "campaign", c.campaign || "no campaign", c.door, c); }
      for (const c of contentAhead) laterPut(c);
      for (const t of todaysTemplates) sitting.push(checklistCard(t, comps.get(t.id), today));
      for (const r of legacyToday) sitting.push(routineCard(r, legacyMarks.get(r.id), today));
      for (const r of (rulingsQ.data ?? [])) sitting.push(rulingCard(r));
      // actions only (RULINGS 2026-09-14). A desk item with open children never renders: its children place by
      // their own days, each carrying the parent's text. A desk item an open move repeats never renders: the move
      // is the card. Both stay in Work and in the counts; dated, they list in held.items.
      const { itemById, openKids, twinOf } = deskHolds(items, moves);
      const heldItems: any[] = [];
      for (const it of items) {
        const kids = openKids.get(it.id) || [];
        const twin = twinOf.get(it.id) || null;
        if (kids.length || twin) {
          if (it.due) { const box = boxById.get(it.box_id); heldItems.push({ id: it.id, card_id: "item:" + it.id, title: it.text, box: box?.title || null, door: doorOfBox(box?.title || ""), due: it.due, reason: kids.length ? "parent" : "twin", open_children: kids.length, move_id: twin ? twin.id : null, move_day: twin ? twin.target_ymd || null : null }); }
          continue;
        }
        if (!it.due) continue;
        const c = itemCard(it, boxById.get(it.box_id), today, it.parent_item_id ? itemById.get(it.parent_item_id) : undefined);
        if (it.due === today) sitting.push(c); else if (it.due < today) behindPut("box:" + it.box_id, "box", boxById.get(it.box_id)?.title || "a box", c.door, c); else if (it.due <= later_to) laterPut(c);
      }
      for (const m of moves) {
        if (!m.target_ymd) continue;
        const c = moveCard(m, projById.get(m.project_id), today, itemById);
        if (m.target_ymd === today) sitting.push(c); else if (m.target_ymd < today) behindPut("project:" + m.project_id, "project", projById.get(m.project_id)?.title || "a project", "house", c); else if (m.target_ymd <= later_to) laterPut(c);
      }
      // A Linear issue is a card only when linearReason is null; priority never places a card. The rest list in
      // undated (no due date) or held (dated), with their reason, and count on the house door.
      const linearOff: any[] = [];
      for (const i of linear) {
        const reason = linearReason(i);
        if (reason === "skip") continue;
        if (reason) { linearOff.push({ i, reason }); continue; }
        const c = linearCard(i, today);
        if (i.due === today) sitting.push(c);
        else if (i.due < today) behindPut("linear", "linear", "Linear", "house", c);
        else if (i.due <= later_to) laterPut(c);
      }
      const medsByTiming = new Map<string, any[]>();
      for (const m of meds) { if (m.timing === "weekly" && wd !== 4) continue; const k = m.timing || "on_waking"; if (!medsByTiming.has(k)) medsByTiming.set(k, []); medsByTiming.get(k)!.push(m); }
      for (const k of MED_ORDER) if (medsByTiming.has(k)) sitting.push(medsCard(k, medsByTiming.get(k)!, medLog, today));
      // the cache files an all-day event under every Pacific day it covers (event_date is the truth); its start_at is UTC midnight,
      // so reading that in Pacific lands on the evening before and hid every all-day event from today
      for (const ev of (calQ.data ?? [])) sitting.push(calendarCard(ev, today, now));

      // the order of the day: block, then the clock, then the door; the blocks stay whole
      sitting.sort((a, b) => BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block) || timeKey(a.time) - timeKey(b.time) || DOOR_ORDER.indexOf(a.door) - DOOR_ORDER.indexOf(b.door));
      // the clock: a test clock for the service role only, else Pacific now on today, else the edge of the day
      let nowMin: number; let clock: "pacific" | "test" = "pacific";
      if (viaService && Number.isInteger(body.now_min) && body.now_min >= 0 && body.now_min <= 1439) { nowMin = body.now_min; clock = "test"; }
      else if (today === ptToday()) nowMin = ptMinute();
      else nowMin = today > ptToday() ? 0 : 1439;
      const nextCard = pickNext(sitting, nowMin);
      const behind = [...behindMap.values()].sort((a, b) => b.to.localeCompare(a.to));
      const later = [] as any[];
      for (let i = 1; i <= LATER_DAYS; i++) {
        const day = addDays(today, i);
        const cards = (laterMap.get(day) || []).sort((a, b) => timeKey(a.time) - timeKey(b.time));
        later.push({ date: day, dow: DOW[dow(day)], nice: niceDate(day), count: cards.length, label: cards[0] ? cards[0].what.slice(0, 48) : null, cards });
      }

      // ---- what has no day: neither today nor behind; counted so a door can say so
      // every undated desk item counts, children included (they were neither shown nor counted before v12)
      const undatedItems = items.filter((it: any) => !it.due);
      const undatedByBox = boxes.map((b: any) => ({ id: b.id, title: b.title, door: doorOfBox(b.title), count: undatedItems.filter((it: any) => it.box_id === b.id).length })).filter((b: any) => b.count > 0);
      const undatedMoves = moves.filter((m: any) => !m.target_ymd).length;
      const linearUndated = linearOff.filter((x: any) => !x.i.due);
      const undatedLinear = linearUndated.length;
      const undatedContent = undatedQ.data ?? [];
      const lrow = (x: any) => ({ id: x.i.id, key: x.i.key || null, title: x.i.title, url: x.i.url || null, due: x.i.due || null, priority: x.i.priority ?? null, state: x.i.state || null, reason: x.reason, open_children: (x.i.open_children || []).length });
      const undated: any = { total: undatedItems.length + undatedMoves + undatedLinear + undatedContent.length, items: undatedItems.length, moves: undatedMoves, linear: undatedLinear, content: undatedContent.length, doors: {}, boxes: undatedByBox,
        linear_urgent: linearUndated.filter((x: any) => x.reason === "undated_urgent").map(lrow),
        linear_list: linearUndated.map(lrow),
        parents: items.filter((it: any) => openKids.has(it.id)).map((it: any) => { const box = boxById.get(it.box_id); const kids = openKids.get(it.id)!; return { id: it.id, title: it.text, box: box?.title || null, door: doorOfBox(box?.title || ""), due: it.due || null, open_children: kids.length, undated_children: kids.filter((k: any) => !k.due).length }; }) };
      for (const id of DOOR_ORDER) undated.doors[id] = undatedByBox.filter((b: any) => b.door === id).reduce((n: number, b: any) => n + b.count, 0) + undatedContent.filter((r: any) => doorOf(r) === id).length + (id === "house" ? undatedMoves + undatedLinear : 0);
      // what is dated but not a card: a desk parent or twin, a dated Goal, Parked or parent issue. Every date counts
      // (past, today, far ahead), so a count never drops when a card becomes a hold.
      const held: any = { total: 0, doors: {}, items: heldItems, linear: linearOff.filter((x: any) => x.i.due).map(lrow) };
      held.total = held.items.length + held.linear.length;
      for (const id of DOOR_ORDER) held.doors[id] = held.items.filter((x: any) => x.door === id).length + (id === "house" ? held.linear.length : 0);

      // the doors
      const ahead = aheadQ.data ?? [];
      const opps = oppsQ.data ?? [];
      const doors = DOOR_ORDER.map((id) => {
        const site = live?.sites?.[id] || null;
        const nextRow = ahead.find((r: any) => doorOf(r) === id);
        const undatedCount = undatedContent.filter((r: any) => doorOf(r) === id).length;
        const openHere = sitting.filter((c) => c.door === id && c.status === "open").length;
        const laterHere = later.reduce((n, d) => n + d.cards.filter((c: Card) => c.door === id).length, 0);
        const behindHere = behind.filter((g) => g.door === id).reduce((n, g) => n + g.count, 0);
        const d: any = { id, name: DOORS[id], pill: { state: site && site.ok ? "ok" : "wait", label: site ? (site.ok ? "site live" : "site " + site.status) : "unchecked", url: site?.url || null }, next: null, numbers: [], quiet: null, links: [], today: openHere, later: laterHere, behind: behindHere, undated: undated.doors[id] || 0, held: held.doors[id] || 0 };
        if (id === "wayofdad") {
          const day0 = hubContent?.day0 || null;
          const dayN = day0 ? Math.round((new Date(today + "T12:00:00Z").getTime() - new Date(day0 + "T12:00:00Z").getTime()) / 86400000) : null;
          const total = hubCards.has(0) ? hubCards.size - 1 : (hubCards.size || 13);
          if (live?.bluesky?.at) {
            const postedDay = new Date(live.bluesky.at).toLocaleDateString("en-CA", { timeZone: TZ });
            const postedTime = new Date(live.bluesky.at).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
            d.pill = { state: postedDay === today ? "ok" : "wait", label: postedDay === today ? "posted " + postedTime : "last post " + niceDate(postedDay), url: "https://bsky.app/profile/wayofdad.co" };
          }
          if (dayN != null) d.numbers.push({ label: "day", value: dayN + " of " + total });
          const dmCard = sitting.find((c) => c.source === "routine" && c.door === "wayofdad" && /dm/i.test(c.what));
          const rpCard = sitting.find((c) => c.source === "routine" && c.door === "wayofdad" && /repl/i.test(c.what));
          d.numbers.push({ label: "DMs today", value: dmCard?.value ?? "not yet" }, { label: "replies today", value: rpCard?.value ?? "not yet" });
          if (nextRow) d.next = "Tomorrow: " + pieceTitle(nextRow).replace(/^Day \d+: /, "") + ".";
          d.links.push({ label: "Everything Dad", href: "https://jerrunge.github.io/the-eddy/dad-b3ab3e/" }, { label: "Bluesky", href: "https://bsky.app/profile/wayofdad.co" }, { label: "X", href: "https://x.com/wayofdad" }, { label: "Instagram", href: "https://www.instagram.com/way.of.dad/" });
        }
        if (id === "fortify") {
          const disc = opps.filter((o: any) => o.pillar === "fortify" && /discover/i.test(o.stage || "")).length;
          const dayc = opps.filter((o: any) => o.pillar === "fortify" && /^day/i.test(o.stage || "")).length;
          d.numbers.push({ label: "Discovery", value: disc }, { label: "Day", value: dayc });
          const shoot = templates.find((t: any) => t.door === "fortify" && /^shoot/i.test(t.title) && t.starts_on && t.starts_on === t.ends_on) || legacyRoutines.find((r: any) => r.door === "fortify" && /^shoot/i.test(r.what) && r.starts_on && r.starts_on === r.ends_on);
          if (shoot && shoot.starts_on >= today) d.next = "Shoot " + niceDate(shoot.starts_on) + ". " + (nextRow ? "Then " + pieceTitle(nextRow) + " " + niceDate(nextRow.scheduled_for.slice(0, 10)) + "." : "");
          else if (nextRow) d.next = "Next: " + pieceTitle(nextRow) + ", " + niceDate(nextRow.scheduled_for.slice(0, 10)) + ".";
          if (undatedCount) d.numbers.push({ label: "staged, no day", value: undatedCount });
          d.links.push({ label: "/fortify", href: "https://jeremyrunge.com/fortify" }, { label: "The video kit", href: "https://github.com/" + REPO + "/blob/main/docs/marketing/staged/fortify-video-2026-09/the-kit.html" });
        }
        if (id === "maddy") {
          const datedAhead = ahead.filter((r: any) => doorOf(r) === "maddy").length;
          if (!openHere && !datedAhead) d.quiet = "Quiet until D. Name ship day and the morning fills in.";
          d.numbers.push({ label: "staged", value: undatedCount });
          if (nextRow) d.next = "Next: " + pieceTitle(nextRow) + ", " + niceDate(nextRow.scheduled_for.slice(0, 10)) + ".";
          d.links.push({ label: "mymaddy.app", href: "https://mymaddy.app/" }, { label: "The September plan", href: "https://github.com/" + REPO + "/blob/main/docs/strategy/maddy-marketing-plan-2026-09.md" });
        }
        if (id === "walks") {
          const reqs = (walksQ.data ?? []).filter((x: any) => !["homebase", "lane", "face", "chart-house"].includes(String(x.source || "")));
          d.numbers.push({ label: "requests", value: reqs.length });
          if (site?.ok) d.next = "Live. The form knocks your phone.";
          d.links.push({ label: "walks.jeremyrunge.com", href: "https://walks.jeremyrunge.com/" }, { label: "The Harbor list", href: "https://jeremyrunge.com/h-7q9m2kx4wd" });
        }
        if (id === "house") {
          const owed = sitting.filter((c) => c.source === "ruling" && c.status === "open").length;
          d.numbers.push({ label: "rulings owed", value: owed }, { label: "with no day", value: undated.doors.house || 0 });
          if (undated.linear_urgent.length) d.numbers.push({ label: "Urgent, no day", value: undated.linear_urgent.length });
          if (held.doors.house) d.numbers.push({ label: "off the day", value: held.doors.house });
          if (!openHere && !nextRow) d.quiet = "Nothing dated for the house today.";
          d.links.push({ label: "RULINGS.md", href: "https://github.com/" + REPO + "/blob/main/RULINGS.md" }, { label: "NOW.md", href: "https://github.com/" + REPO + "/blob/main/NOW.md" });
        }
        if (d.quiet) d.pill.state = "quiet";
        return d;
      });

      // the week: today's open sitting, then each later day's dated things plus its routines
      const week = [] as any[];
      for (let i = 0; i < 7; i++) {
        const day = addDays(today, i);
        const wdi = dow(day);
        const rts = templates.filter((t: any) => runsOn(t, day, wdi)).length + legacyRoutines.filter((r: any) => (r.days || []).includes(wdi) && (!r.starts_on || r.starts_on <= day) && (!r.ends_on || r.ends_on >= day)).length;
        const special = templates.find((t: any) => t.starts_on && t.ends_on && t.starts_on === t.ends_on && t.starts_on === day) || legacyRoutines.find((r: any) => r.starts_on && r.ends_on && r.starts_on === r.ends_on && r.starts_on === day);
        const DATED = new Set(["content", "work", "move", "linear", "ruling"]);
        const dayCards = (i === 0 ? sitting.filter((c) => c.status === "open") : (later[i - 1]?.cards ?? [])).filter((c: Card) => DATED.has(c.source));
        const lead = special ? (special.title || special.what) : (dayCards.find((c: Card) => c.source === "content" || c.source === "move" || c.source === "work")?.what || dayCards[0]?.what || null);
        let label = lead ? String(lead) : null;
        if (label) label = label.replace(/^(Day \d+|Video \d+ of \d+)[:.]?\s*/i, (m) => m.trim().replace(/[:.]$/, "") + ": ").replace(/: $/, "");
        week.push({ date: day, dow: DOW[wdi], count: dayCards.length, posts: dayCards.filter((c: Card) => c.source === "content").length, routines: i === 0 ? sitting.filter((c) => c.source === "routine").length : rts, label: label ? label.slice(0, 48) : null });
      }

      const counts = { sitting: sitting.length, open: sitting.filter((c) => c.status === "open").length, later: later.reduce((n, d) => n + d.count, 0), behind: behind.reduce((n, g) => n + g.count, 0), undated: undated.total, held: held.total };
      return j({ date: today, nice_date: niceDate(today), now: ptNow(), now_min: nowMin, clock, next_rule: "clock-15", place_rule: "actions-only", engine: "one-today v12", next_id: nextCard ? nextCard.id : null, sitting, later, behind, undated, held, doors, week, counts, linear_error: linearError, links_ready: linksReady, routines_seeded: todaysTemplates.length + legacyToday.length, text_ready: !!(await ghToken()), served_at: now }, headers);
    }

    if (body.op === "text") {
      const id = String(body.card_id || "");
      if (!id.startsWith("content:")) return j({ ok: true, copy: [] }, headers);
      const rows = (await sb.from("content_calendar").select("id, title, platform, format, status, scheduled_for, url, campaign, pillar, metadata, excerpt").eq("id", id.slice(8))).data ?? [];
      if (!rows.length) return j({ error: "no such card" }, headers, 404);
      const lead = rows[0];
      const sibs = (await sb.from("content_calendar").select("id, title, platform, format, status, scheduled_for, url, campaign, pillar, metadata, excerpt").eq("user_id", USER).eq("scheduled_for", lead.scheduled_for).not("status", "in", "(archived)")).data ?? [];
      const posts = sibs.filter((r: any) => groupKey(r) === groupKey(lead));
      const copy: any[] = []; const seen = new Map<string, any>();
      for (const p of posts) {
        let text: string | null = null;
        for (const path of copyPaths(p)) { text = await vaultText(path); if (text) break; }
        if (!text && p.excerpt) text = p.excerpt;
        if (!text) continue;
        const label = PLATFORM_LABEL[p.platform] || p.platform; const key = text.trim();
        if (seen.has(key)) { seen.get(key).platforms.push(p.platform); seen.get(key).label += " and " + label; }
        else { const c = { label, platforms: [p.platform], text: key }; seen.set(key, c); copy.push(c); }
      }
      return j({ ok: true, copy, text_ready: !!(await ghToken()) }, headers);
    }

    if (body.op === "tap") {
      const id = String(body.card_id || "");
      const action = String(body.action || "").toLowerCase();
      if (!id || !action) return j({ error: "card_id and action" }, headers, 400);
      const stamp = { at: now, action: "morning: " + action, source };

      if (id.startsWith("content:")) {
        const leadId = id.slice(8);
        const lead = (await sb.from("content_calendar").select("*").eq("id", leadId).maybeSingle()).data;
        if (!lead) return j({ error: "no such card" }, headers, 404);
        const sibs = (await sb.from("content_calendar").select("*").eq("user_id", USER).eq("scheduled_for", lead.scheduled_for).not("status", "in", "(archived)")).data ?? [];
        const group = sibs.filter((r: any) => groupKey(r) === groupKey(lead));
        const wanted = body.post_id ? [String(body.post_id)] : (Array.isArray(body.post_ids) ? body.post_ids.map(String) : group.map((r: any) => r.id));
        const targets = group.filter((r: any) => wanted.includes(r.id));
        for (const r of targets) {
          const meta = Object.assign({}, r.metadata || {});
          meta.chart_house = { at: now, action: "morning: " + action + " (" + source + ")" };
          const patch: any = { metadata: meta, updated_at: now };
          if (action === "posted" || action === "sent" || action === "done") {
            patch.status = "published"; patch.published_at = now;
            if (body.url) patch.url = String(body.url).slice(0, 500);
            meta.stage = "ratified";
          } else if (action === "hold") {
            meta.morning = Object.assign({}, meta.morning || {}, { held_at: now, held_until: addDays(today, 1) });
          } else if (action === "skip") {
            meta.morning = Object.assign({}, meta.morning || {}, { skipped: today, skipped_at: now });
          } else if (action === "unhold" || action === "reopen") {
            meta.morning = Object.assign({}, meta.morning || {}, { held_until: null, skipped: null });
            if (r.status === "published" && action === "reopen") { patch.status = "draft"; patch.published_at = null; }
          } else return j({ error: "unknown action for content" }, headers, 400);
          const u = await sb.from("content_calendar").update(patch).eq("id", r.id);
          if (u.error) return j({ error: u.error.message }, headers, 500);
        }
        // a follow-up becomes its own dated task, once, where the row asked for one (his ruling, 2026-08-08)
        for (const r of targets) {
          const fm = r.metadata || {};
          if ((action === "posted" || action === "sent") && fm.followup_days && !fm.followup_created) {
            await sb.from("content_calendar").insert({ user_id: USER, status: "draft", platform: r.platform, format: "note", title: "Follow up: " + String(r.title).replace(/^Press: send the /, ""), pillar: r.pillar, campaign: r.campaign, parent_post_id: r.parent_post_id || r.id, scheduled_for: addDays(today, Number(fm.followup_days)), excerpt: fm.followup_copy || null, metadata: { send_to: fm.send_to || null, account: fm.account || null, send_note: "Only if they have been quiet. Reply in the same thread, paste the text above, send. One bump total.", followup_of: r.id, stage: "staged" } });
            await sb.from("content_calendar").update({ metadata: Object.assign({}, fm, { followup_created: true, chart_house: stamp }) }).eq("id", r.id);
          }
        }
        const hub = (await sb.from("hub_content").select("content").eq("key", "wayofdad").maybeSingle()).data;
        const hubCards = new Map<number, any>(); for (const c of (hub?.content?.cards || [])) hubCards.set(Number(c.day), c);
        // the hub's day ledger rides along so Everything Dad and the Morning agree
        if ((action === "posted" || action === "done") && lead.metadata?.day != null && doorOf(lead) === "wayofdad") {
          const allOut = ((await sb.from("content_calendar").select("status, metadata").eq("user_id", USER).eq("scheduled_for", lead.scheduled_for).eq("campaign", lead.campaign)).data ?? []).filter((x: any) => String(x.metadata?.day) === String(lead.metadata.day));
          if (allOut.length && allOut.every((x: any) => x.status === "published")) await sb.from("hub_days").upsert({ hub: "wayofdad", day: Number(lead.metadata.day), done: true, done_at: now, source: "the Morning (" + source + ")", updated_at: now }, { onConflict: "hub,day" });
        }
        const fresh = await contentCards(sb, today, hubCards, true, group.map((r: any) => r.id));
        return j({ ok: true, card: fresh[0] || null, touched: targets.map((r: any) => r.id) }, headers);
      }

      if (id.startsWith("routine:")) {
        const rid = id.slice(8);
        // the one table first; the Morning's own table only until one_today_01 lands
        const t = (await sb.from("checklist_templates").select("*").eq("id", rid).maybeSingle()).data;
        if (t) {
          if (action === "undo" || action === "reopen") { await sb.from("checklist_completions").delete().eq("template_id", rid).eq("date", today); return j({ ok: true, card: checklistCard(t, null, today) }, headers); }
          if (!["done", "skip", "hold"].includes(action)) return j({ error: "unknown action for routine" }, headers, 400);
          const value = body.value != null ? String(body.value).slice(0, 80) : null;
          const row = await writeCompletion(sb, rid, today, now, action !== "done", value, source);
          return j({ ok: true, card: checklistCard(t, row, today) }, headers);
        }
        const legacy = await sb.from("morning_routines").select("*").eq("id", rid).maybeSingle();
        const r = legacy.error ? null : legacy.data;
        if (!r) return j({ error: "no such routine" }, headers, 404);
        if (action === "undo" || action === "reopen") { await sb.from("morning_marks").delete().eq("routine_id", rid).eq("date", today); return j({ ok: true, card: routineCard(r, null, today) }, headers); }
        if (!["done", "skip", "hold"].includes(action)) return j({ error: "unknown action for routine" }, headers, 400);
        const mark = { routine_id: rid, date: today, action, value: body.value != null ? String(body.value).slice(0, 80) : null, at: now, source };
        const u = await sb.from("morning_marks").upsert(mark, { onConflict: "routine_id,date" });
        if (u.error) return j({ error: u.error.message }, headers, 500);
        return j({ ok: true, card: routineCard(r, mark, today) }, headers);
      }

      if (id.startsWith("item:")) {
        const iid = id.slice(5);
        const it = (await sb.from("desk_items").select("*").eq("id", iid).maybeSingle()).data;
        if (!it) return j({ error: "no such item" }, headers, 404);
        const box = (await sb.from("desk_boxes").select("id, title").eq("id", it.box_id).maybeSingle()).data;
        let patch: any = { updated_at: now };
        if (action === "done") patch = { done: true, done_at: now, updated_at: now };
        else if (action === "hold" || action === "skip") patch = { due: addDays(today, Math.max(1, Number(body.value) || 1)), updated_at: now };
        else if (action === "undo" || action === "reopen") patch = { done: false, done_at: null, due: it.done ? it.due : today, updated_at: now };
        else if (action === "ruled" && it.kind === "decision") patch = { choice: String(body.choice ?? body.text ?? "").slice(0, 200), done: true, done_at: now, updated_at: now };
        else return j({ error: "unknown action for item" }, headers, 400);
        const u = await sb.from("desk_items").update(patch).eq("id", iid).select("*").single();
        if (u.error) return j({ error: u.error.message }, headers, 500);
        // a child keeps its open parent's text as its why after a tap; a Done here never closes a move that repeats it
        const parent = u.data.parent_item_id ? (await sb.from("desk_items").select("id, text, done").eq("id", u.data.parent_item_id).maybeSingle()).data : null;
        const card = itemCard(u.data, box, today, parent && !parent.done ? parent : undefined);
        if ((action === "hold" || action === "skip") && card.day > today) { card.status = "held"; card.held_until = card.day; }
        return j({ ok: true, card }, headers);
      }

      if (id.startsWith("move:")) {
        const mid = id.slice(5);
        const m = (await sb.from("project_moves").select("*").eq("id", mid).maybeSingle()).data;
        if (!m) return j({ error: "no such move" }, headers, 404);
        const project = (await sb.from("projects").select("id, title").eq("id", m.project_id).maybeSingle()).data;
        let patch: any;
        if (action === "done") patch = { status: "done" };
        else if (action === "hold" || action === "skip") patch = { target_ymd: addDays(today, Math.max(1, Number(body.value) || 1)) };
        else if (action === "undo" || action === "reopen") patch = { status: "open", target_ymd: m.status === "done" ? m.target_ymd : today };
        else return j({ error: "unknown action for move" }, headers, 400);
        const u = await sb.from("project_moves").update(patch).eq("id", mid).select("*").single();
        if (u.error) return j({ error: u.error.message }, headers, 500);
        // one job, one card (RULINGS 2026-09-14): Done closes the desk item this move repeats. Undo or reopen
        // takes back a Done and nothing else: it reopens the desk item only when the move was done before this
        // tap (read above, before the update), even one he closed himself in Work, since reopening is the visible
        // direction. An Undo after Tomorrow or Skip moves only the move and never touches the desk item. A Done
        // leaves a desk item he already closed as it is (his done_at stays), and an undo leaves an open one as it
        // is. Hold and skip move only the move. A twin with open children is left alone: its steps close it.
        // Before actions_only_01 the row carries no desk_item_id and nothing cascades.
        const twinId: string | null = m.desk_item_id || null;
        const wasDone = m.status === "done";
        let twin: any = twinId ? (await sb.from("desk_items").select("*").eq("id", twinId).maybeSingle()).data : null;
        let twinCard: any = null; let twinSkipped: string | null = null;
        if (twin && (action === "done" || ((action === "undo" || action === "reopen") && wasDone))) {
          const closing = action === "done";
          if (!!twin.done === closing) twinSkipped = closing ? "already done" : "already open";
          else if (((await sb.from("desk_items").select("id").eq("parent_item_id", twin.id).eq("done", false)).data ?? []).length) twinSkipped = "open children";
          else {
            const tp = action === "done" ? { done: true, done_at: now, updated_at: now } : { done: false, done_at: null, updated_at: now };
            const tu = await sb.from("desk_items").update(tp).eq("id", twin.id).select("*").single();
            if (tu.error) return j({ error: "the move is " + (action === "done" ? "done" : "open") + "; its desk twin did not follow: " + tu.error.message, card: moveCard(u.data, project, today, new Map([[twin.id, twin]])) }, headers, 500);
            twin = tu.data;
            const tbox = (await sb.from("desk_boxes").select("id, title").eq("id", twin.box_id).maybeSingle()).data;
            twinCard = itemCard(twin, tbox, today);
          }
        }
        const card = moveCard(u.data, project, today, twin ? new Map([[twin.id, twin]]) : undefined);
        if ((action === "hold" || action === "skip") && card.day > today) { card.status = "held"; card.held_until = card.day; }
        const out: any = { ok: true, card, twin_card: twinCard, touched: ["move:" + mid].concat(twinCard ? [twinCard.id] : []) };
        if (twinSkipped) out.twin_skipped = twinSkipped;
        return j(out, headers);
      }

      if (id.startsWith("linear:")) {
        const lid = id.slice(7);
        const key = await linearKey(sb);
        if (!key) return j({ error: "no Linear key on the platform" }, headers, 503);
        let rows: any[] = []; try { rows = await linearOpen(key); } catch (e) { return j({ error: String(e).slice(0, 160) }, headers, 502); }
        const i = rows.find((x) => x.id === lid);
        if (action === "done") { await linearSetState(key, lid, "completed"); return j({ ok: true, card: Object.assign(linearCard(i || { id: lid, title: "" }, today), { status: "done" }) }, headers); }
        if (action === "hold" || action === "skip") { const due = addDays(today, Math.max(1, Number(body.value) || 1)); await linearSetDue(key, lid, due); return j({ ok: true, card: Object.assign(linearCard(Object.assign({}, i || { id: lid, title: "" }, { due }), today), { status: "held", held_until: due }) }, headers); }
        if (action === "undo" || action === "reopen") { await linearSetState(key, lid, "unstarted"); if (i && i.due !== today) await linearSetDue(key, lid, today); return j({ ok: true, card: linearCard(Object.assign({}, i || { id: lid, title: "" }, { due: today }), today) }, headers); }
        return j({ error: "unknown action for a Linear issue" }, headers, 400);
      }

      if (id.startsWith("med:")) {
        const timing = id.slice(4);
        const meds = ((await sb.from("medications").select("id, name, dose, timing, active").eq("active", true).eq("timing", timing)).data ?? []) as any[];
        if (!meds.length) return j({ error: "no meds in that window" }, headers, 404);
        const wanted = body.post_id ? meds.filter((m) => m.id === String(body.post_id)) : meds;
        if (action === "done") {
          for (const m of wanted) {
            await sb.from("med_log").delete().eq("date", today).eq("med_name", m.name);
            const u = await sb.from("med_log").insert({ user_id: USER, date: today, med_name: m.name, taken_at: now, medication_id: m.id });
            if (u.error) return j({ error: u.error.message }, headers, 500);
          }
        } else if (action === "undo" || action === "reopen") {
          for (const m of wanted) await sb.from("med_log").delete().eq("date", today).eq("med_name", m.name);
        } else return j({ error: "unknown action for meds" }, headers, 400);
        const log = (await sb.from("med_log").select("medication_id, med_name, taken_at").eq("date", today)).data ?? [];
        return j({ ok: true, card: medsCard(timing, meds, log, today) }, headers);
      }

      if (id.startsWith("calendar:")) return j({ error: "a calendar event is not tapped here" }, headers, 400);

      if (id.startsWith("ruling:")) {
        const rid = id.slice(7);
        const r = (await sb.from("rulings_owed").select("*").eq("id", rid).maybeSingle()).data;
        if (!r) return j({ error: "no such ruling" }, headers, 404);
        if (action === "hold") return j({ ok: true, card: rulingCard(r) }, headers);
        if (action !== "ruled") return j({ error: "unknown action for ruling" }, headers, 400);
        const choice = body.choice != null ? String(body.choice).slice(0, 80) : null;
        const typed = body.text != null ? String(body.text).trim().slice(0, 2000) : "";
        const opt = (Array.isArray(r.options) ? r.options : []).find((o: any) => o.key === choice);
        if (!opt && !typed) return j({ error: "a choice or his words" }, headers, 400);
        let commit: string | null = null; let writeError: string | null = null;
        try { commit = await writeRuling(r, opt, typed, today); } catch (e) { writeError = String(e).slice(0, 200); }
        const patch = { answered_at: now, answer: opt ? opt.key : (typed ? "typed" : null), answer_text: typed || null, rulings_commit: commit };
        const u = await sb.from("rulings_owed").update(patch).eq("id", rid);
        if (u.error) return j({ error: u.error.message }, headers, 500);
        return j({ ok: true, card: rulingCard(Object.assign({}, r, patch)), rulings_commit: commit, rulings_write_error: writeError }, headers);
      }
      return j({ error: "unknown card" }, headers, 400);
    }
    return j({ error: "unknown op" }, headers, 400);
  } catch (e) {
    return j({ error: String(e).slice(0, 300) }, headers, 500);
  }
});

// His tap lands in RULINGS.md in the exact shape the file uses for tap rulings: the decision is
// recorded, the option label is the lane's proposal and is never quoted as his words, and anything
// he typed is quoted verbatim. Same-day tap rulings share one heading.
async function writeRuling(r: any, opt: any, typed: string, today: string): Promise<string | null> {
  const token = await ghToken();
  if (!token) throw new Error("MORNING_GH_TOKEN not set; the row is answered, RULINGS.md waits");
  const api = `https://api.github.com/repos/${REPO}/contents/RULINGS.md`;
  const gh = { authorization: "Bearer " + token, "user-agent": "morning-api", accept: "application/vnd.github+json" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await fetch(api, { headers: gh });
    if (!cur.ok) throw new Error("RULINGS read " + cur.status);
    const data = await cur.json();
    const text = new TextDecoder().decode(Uint8Array.from(atob(String(data.content).replace(/\n/g, "")), (c) => c.charCodeAt(0)));
    const heading = `## ${today} (by tap, the Morning)`;
    const time = ptNow();
    const lane = String(r.lane || "a lane");
    let line = `- **${esc(r.question).replace(/\s+/g, " ").trim().replace(/[.:]$/, "").toUpperCase()}** (${lane}${r.link ? "; " + r.link : ""}), ${time} PT.`;
    if (opt) line += ` Decision by tap: ${esc(opt.label).trim().replace(/\.$/, "")}.`;
    if (typed) line += ` His typed words: "${typed.replace(/"/g, "'")}"`;
    if (!opt && typed) line += " [as typed]";
    let next: string;
    if (text.includes(heading + "\n")) {
      const at = text.indexOf(heading + "\n");
      const after = text.indexOf("\n\n## ", at + heading.length);
      const block = after === -1 ? text.slice(at) : text.slice(at, after);
      const newBlock = block.replace(/\s*$/, "") + "\n" + line;
      next = text.slice(0, at) + newBlock + (after === -1 ? "\n" : text.slice(after));
    } else {
      const intro = `${heading}\n\nRuled by tap on a Morning card (RULINGS 09-12, the Morning is go). The option labels were the lane's proposals, so the DECISIONS are recorded and the labels are NOT quoted as his words; where he typed, it is quoted verbatim.\n\n${line}\n\n`;
      const sep = text.indexOf("\n---\n");
      next = sep === -1 ? intro + text : text.slice(0, sep + 5) + "\n" + intro + text.slice(sep + 5).replace(/^\n+/, "");
    }
    const bytes = new TextEncoder().encode(next); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
    const put = await fetch(api, { method: "PUT", headers: Object.assign({ "content-type": "application/json" }, gh), body: JSON.stringify({ message: `rulings: by tap on the Morning, ${lane}: ${esc(r.question).slice(0, 60)}`, content: btoa(bin), sha: data.sha }) });
    if (put.ok) { const d = await put.json(); return d.commit?.sha || null; }
    if (put.status !== 409) throw new Error("RULINGS write " + put.status);
  }
  throw new Error("RULINGS write conflicted twice");
}
