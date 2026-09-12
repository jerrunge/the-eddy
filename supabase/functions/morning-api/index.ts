// morning-api: the one composition behind the Morning (RULINGS 2026-09-12, "the Morning is go").
// Two renderers read it, the Chart House and the 29:11 face, and both write taps back through it.
//
// Door: the same device token as the Harbor, the hub, and the face (SHA-256 against the accepted
// hashes; MORNING_TOKEN_HASHES in the env overrides the face's list), or the service role key as a
// bearer for the Chart House's own Pages function. No anon path.
//
// Ops (POST, json):
//   morning  { date? }                          -> { date, sitting:[card], behind:[group], doors:[door], week:[day], routines_seeded, served_at }
//   tap      { card_id, action, post_id?, post_ids?, url?, value?, choice?, text?, source? } -> { ok, card }
//   text     { card_id, post_id? }              -> { ok, copy:[...] }   copy for a card the composition left thin
//   GET ?op=photo&path=<vault path>  (token as Authorization: Bearer or x-device-token; never in the URL) -> the image bytes
//
// door.pill.state is ok | wait | quiet (the contract the two renderers share); card.photo carries
// path, alt, and url (null when the photo lives outside the vault, e.g. the iCloud frames).
//
// A card: { id, source: content|routine|ruling, time, door, what, why, copy:[{label, platforms, text}],
//           photo:{path, alt}|null, kit:{to, from, when, how}|null, taps:[{action, label, post_id?}],
//           status, posts:[{id, platform, status, url}] (content), options:[{key,label}] (ruling),
//           links:[{label, href}], overdue_since?, campaign?, ask? }
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
function slotTime(meta: any, door: string) {
  const s = meta?.slot || meta?.when || "";
  const m = String(s).match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
  return m ? m[1].replace(/\s+/g, "").toLowerCase() : DOOR_TIME[door];
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
async function contentCards(sb: any, today: string, hubCards: Map<number, any>, withText: boolean, onlyIds?: string[]) {
  let q = sb.from("content_calendar").select("id, title, platform, format, status, scheduled_for, published_at, url, campaign, pillar, parent_post_id, is_canonical, metadata, excerpt, updated_at").eq("user_id", USER).not("status", "in", "(published,archived)").not("scheduled_for", "is", null).lte("scheduled_for", today).order("scheduled_for");
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
    cards.push({
      id: "content:" + lead.id,
      source: "content",
      time: slotTime(m, door),
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
      const [hub, routinesQ, marksQ, rulingsQ, live, oppsQ, walksQ, aheadQ, undatedQ] = await Promise.all([
        sb.from("hub_content").select("content").eq("key", "wayofdad").maybeSingle(),
        sb.from("morning_routines").select("*").eq("user_id", USER).eq("active", true).order("sort"),
        sb.from("morning_marks").select("*").eq("date", today),
        sb.from("rulings_owed").select("*").is("answered_at", null).order("asked_at"),
        liveChecks(sb),
        sb.from("opportunities").select("pillar, stage").is("closed_at", null),
        sb.from("desk_items").select("id, kind, text, source, done, created_at").in("box_id", ["c9ec85f4-c2e2-4294-bfe5-7b500e905eae", "daf7faf0-936f-4e21-aeca-7196b9c31a84"]).eq("done", false),
        sb.from("content_calendar").select("id, title, platform, status, scheduled_for, campaign, pillar, metadata").eq("user_id", USER).neq("status", "archived").gt("scheduled_for", today).lte("scheduled_for", addDays(today, 14)).order("scheduled_for"),
        sb.from("content_calendar").select("id, campaign, pillar, status, metadata").eq("user_id", USER).eq("status", "draft").is("scheduled_for", null),
      ]);
      const hubCards = new Map<number, any>();
      const hubContent = hub.data?.content || null;
      for (const c of (hubContent?.cards || [])) hubCards.set(Number(c.day), c);
      const routines = routinesQ.data ?? [];
      const marks = new Map<string, any>();
      for (const m of (marksQ.data ?? [])) marks.set(m.routine_id, m);
      const wd = dow(today);
      const todaysRoutines = routines.filter((r: any) => (r.days || []).includes(wd) && (!r.starts_on || r.starts_on <= today) && (!r.ends_on || r.ends_on >= today));
      const content = await contentCards(sb, today, hubCards, true);
      const cutoff = addDays(today, -BEHIND_DAYS);
      const sitting: Card[] = [];
      const behindMap = new Map<string, any>();
      for (const c of content) {
        if (c.day >= cutoff) sitting.push(c);
        else {
          const k = c.campaign || "no campaign";
          if (!behindMap.has(k)) behindMap.set(k, { campaign: k, door: c.door, count: 0, from: c.day, to: c.day, cards: [] });
          const g = behindMap.get(k); g.count++; g.to = c.day; g.cards.push(c);
        }
      }
      for (const r of todaysRoutines) sitting.push(routineCard(r, marks.get(r.id), today));
      for (const r of (rulingsQ.data ?? [])) sitting.push(rulingCard(r));
      sitting.sort((a, b) => timeKey(a.time) - timeKey(b.time) || DOOR_ORDER.indexOf(a.door) - DOOR_ORDER.indexOf(b.door));
      const behind = [...behindMap.values()].sort((a, b) => b.to.localeCompare(a.to));

      // the doors
      const ahead = aheadQ.data ?? [];
      const undated = undatedQ.data ?? [];
      const opps = oppsQ.data ?? [];
      const doors = DOOR_ORDER.map((id) => {
        const site = live?.sites?.[id] || null;
        const nextRow = ahead.find((r: any) => doorOf(r) === id);
        const undatedCount = undated.filter((r: any) => doorOf(r) === id).length;
        const openHere = sitting.filter((c) => c.door === id && c.status === "open").length;
        const d: any = { id, name: DOORS[id], pill: { state: site && site.ok ? "ok" : "wait", label: site ? (site.ok ? "site live" : "site " + site.status) : "unchecked", url: site?.url || null }, next: null, numbers: [], quiet: null, links: [], today: openHere };
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
          const dmMark = todaysRoutines.find((r: any) => /dm/i.test(r.what)); const dm = dmMark ? marks.get(dmMark.id) : null;
          const rpMark = todaysRoutines.find((r: any) => /repl/i.test(r.what)); const rp = rpMark ? marks.get(rpMark.id) : null;
          d.numbers.push({ label: "DMs today", value: dm?.value ?? "not yet" }, { label: "replies today", value: rp?.value ?? "not yet" });
          if (nextRow) d.next = "Tomorrow: " + pieceTitle(nextRow).replace(/^Day \d+: /, "") + ".";
          d.links.push({ label: "Everything Dad", href: "https://jerrunge.github.io/the-eddy/dad-b3ab3e/" }, { label: "Bluesky", href: "https://bsky.app/profile/wayofdad.co" }, { label: "X", href: "https://x.com/wayofdad" }, { label: "Instagram", href: "https://www.instagram.com/way.of.dad/" });
        }
        if (id === "fortify") {
          const disc = opps.filter((o: any) => o.pillar === "fortify" && /discover/i.test(o.stage || "")).length;
          const dayc = opps.filter((o: any) => o.pillar === "fortify" && /^day/i.test(o.stage || "")).length;
          d.numbers.push({ label: "Discovery", value: disc }, { label: "Day", value: dayc });
          const shoot = routines.find((r: any) => r.door === "fortify" && /^shoot/i.test(r.what) && r.starts_on && r.starts_on === r.ends_on);
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
          d.numbers.push({ label: "rulings owed", value: owed });
          if (!openHere && !nextRow) d.quiet = "Nothing dated for the house today.";
          d.links.push({ label: "RULINGS.md", href: "https://github.com/" + REPO + "/blob/main/RULINGS.md" }, { label: "NOW.md", href: "https://github.com/" + REPO + "/blob/main/NOW.md" });
        }
        if (d.quiet) d.pill.state = "quiet";
        return d;
      });

      // the week
      const week = [] as any[];
      for (let i = 0; i < 7; i++) {
        const day = addDays(today, i);
        const rows = i === 0 ? sitting.filter((c) => c.source === "content" && c.day === today) : ahead.filter((r: any) => r.scheduled_for.slice(0, 10) === day);
        const wdi = dow(day);
        const rts = routines.filter((r: any) => (r.days || []).includes(wdi) && (!r.starts_on || r.starts_on <= day) && (!r.ends_on || r.ends_on >= day));
        const special = rts.find((r: any) => r.starts_on && r.ends_on && r.starts_on === r.ends_on);
        const titles = i === 0 ? rows.map((c) => c.what) : [...new Set(rows.map((r: any) => pieceTitle(r)))];
        let label = special ? special.what : (titles[0] || (i === 0 ? (sitting.find((c) => c.status === "open") || {}).what || null : null));
        if (label) label = label.replace(/^(Day \d+|Video \d+ of \d+)[:.]?\s*/i, (m) => m.trim().replace(/[:.]$/, "") + ": ").replace(/: $/, "");
        week.push({ date: day, dow: DOW[wdi], count: (i === 0 ? sitting.filter((c) => c.status === "open").length : titles.length + rts.length), posts: titles.length, routines: rts.length, label: label ? label.slice(0, 48) : null });
      }

      return j({ date: today, nice_date: niceDate(today), now: ptNow(), sitting, behind, doors, week, routines_seeded: routines.length, text_ready: !!(await ghToken()), served_at: now }, headers);
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
        const r = (await sb.from("morning_routines").select("*").eq("id", rid).maybeSingle()).data;
        if (!r) return j({ error: "no such routine" }, headers, 404);
        if (action === "undo" || action === "reopen") { await sb.from("morning_marks").delete().eq("routine_id", rid).eq("date", today); return j({ ok: true, card: routineCard(r, null, today) }, headers); }
        if (!["done", "skip", "hold"].includes(action)) return j({ error: "unknown action for routine" }, headers, 400);
        const mark = { routine_id: rid, date: today, action, value: body.value != null ? String(body.value).slice(0, 80) : null, at: now, source };
        const u = await sb.from("morning_marks").upsert(mark, { onConflict: "routine_id,date" });
        if (u.error) return j({ error: u.error.message }, headers, 500);
        return j({ ok: true, card: routineCard(r, mark, today) }, headers);
      }

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
