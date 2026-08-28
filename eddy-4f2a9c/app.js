/* The Eddy v1. Capture is the sacred path: every word lands in IndexedDB the
   moment it exists, then syncs whenever the network and the door allow. A login
   wall is structurally impossible here; the device token is a static pairing,
   never a session that can expire at 1:42am. */
"use strict";

const FN = "https://dsjnvwhyevjzsmuawkcs.supabase.co/functions/v1";
const VAPID_PUBLIC = "BAeWETFXv1Y5lpd25yux-QfGnzeV7qNkwfSQSh3s-wQg-B9VO_HafzvyGu5SfRuqBgPJoS4U2GqBcuaXV46xizc";
const RESUME_WINDOW_MIN = 60;

/* ---------- pairing ---------- */
if (location.hash.startsWith("#setup=")) {
  localStorage.setItem("eddy_token", location.hash.slice(7));
  history.replaceState(null, "", location.pathname);
}
const token = () => localStorage.getItem("eddy_token") || "";

/* ---------- tiny IndexedDB ---------- */
let _db = null;
function idb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const r = indexedDB.open("eddy", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("queue", { keyPath: "qid" });
      r.result.createObjectStore("kv");
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
async function kvSet(k, v) { const d = await idb(); return new Promise((res) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; }); }
async function kvGet(k) { const d = await idb(); return new Promise((res) => { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); }
async function qPut(op) { const d = await idb(); return new Promise((res) => { const t = d.transaction("queue", "readwrite"); t.objectStore("queue").put(op); t.oncomplete = res; }); }
async function qAll() { const d = await idb(); return new Promise((res) => { const q = d.transaction("queue").objectStore("queue").getAll(); q.onsuccess = () => res(q.result || []); }); }
async function qDel(qids) { const d = await idb(); return new Promise((res) => { const t = d.transaction("queue", "readwrite"); for (const id of qids) t.objectStore("queue").delete(id); t.oncomplete = res; }); }

/* ---------- sync engine ---------- */
let syncing = false;
async function enqueue(kind, payload) {
  const op = { qid: crypto.randomUUID(), kind, ...payload };
  await qPut(op);
  flush();
  return op;
}
async function flush() {
  if (syncing || !navigator.onLine || !token()) return;
  const ops = await qAll();
  if (!ops.length) { setSyncState("Everything is in."); return; }
  syncing = true;
  setSyncState(ops.length + " waiting to sync...");
  try {
    const r = await fetch(FN + "/eddy-api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token(), op: "sync", ops }) });
    const j = await r.json();
    if (j.results) {
      await qDel(j.results.filter((x) => x.ok).map((x, i) => ops.find((o) => o.id === x.id)?.qid).filter(Boolean));
      const left = (await qAll()).length;
      setSyncState(left ? left + " still waiting." : "Everything is in.");
    }
  } catch { setSyncState("Offline. Held safely here."); }
  syncing = false;
}
setInterval(flush, 20000);
addEventListener("online", flush);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { flush(); loadContext(); } });
function setSyncState(s) { const el = document.getElementById("sync-state"); if (el) el.textContent = s; }

async function api(op, extra = {}) {
  const r = await fetch(FN + "/eddy-api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token(), op, ...extra }) });
  if (!r.ok) throw new Error("api " + r.status);
  return r.json();
}

/* ---------- views ---------- */
const views = ["land", "ep", "park", "held", "arrive", "watch", "ride", "record", "settings"];
let stack = ["land"];
function show(v) {
  for (const x of views) document.getElementById("v-" + x).classList.toggle("hidden", x !== v);
  if (stack[stack.length - 1] !== v) stack.push(v);
  if (v === "land") { stack = ["land"]; startEddy(); } else stopEddy();
}
function back() { stack.pop(); show(stack.pop() || "land"); }
document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", back));
document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => {
  const v = b.dataset.nav;
  if (v === "record") loadRecord();
  if (v === "ride") prepRide();
  if (v === "watch") startWatch("");
  show(v);
}));

/* ---------- context (landing strip) ---------- */
let ctx = null;
async function loadContext() {
  try {
    ctx = await api("context");
    await kvSet("ctx", ctx);
  } catch { ctx = (await kvGet("ctx")) || null; }
  renderContext();
}
function renderContext() {
  const el = document.getElementById("ctx-strip");
  const now = new Date();
  const bits = [now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })];
  if (ctx?.sleep_min != null) bits.push("slept " + (ctx.sleep_min / 60).toFixed(1) + "h");
  if (ctx?.capacity) bits.push(ctx.capacity);
  el.textContent = bits.join(" · ");
  const banner = document.getElementById("parks-banner");
  const due = ctx?.parks_due || [];
  if (due.length) {
    banner.classList.remove("hidden");
    banner.innerHTML = "";
    const b = document.createElement("button");
    b.className = "quiet-btn"; b.style.color = "var(--ember)"; b.style.padding = "0";
    b.textContent = due.length === 1 ? "A parked loop is ready for you. Open it." : due.length + " parked loops are ready. Open them.";
    b.addEventListener("click", () => openArrival(due[0]));
    banner.appendChild(b);
  } else banner.classList.add("hidden");
}

/* ---------- episode ---------- */
let ep = null;        // {id, opened_at}
let draft = "";
let draftTimer = null;
let usedVoice = false, usedType = false;

async function resumeOrNull() {
  const saved = await kvGet("open_episode");
  if (saved && (Date.now() - new Date(saved.opened_at).getTime()) / 60000 < RESUME_WINDOW_MIN) return saved;
  return null;
}
async function startEpisode() {
  const resumed = await resumeOrNull();
  if (resumed) { ep = resumed; } else {
    ep = { id: crypto.randomUUID(), opened_at: new Date().toISOString() };
    await kvSet("open_episode", ep);
    enqueue("episode_open", { id: ep.id, opened_at: ep.opened_at, capacity: ctx?.capacity ?? null, sleep_h: ctx?.sleep_min != null ? +(ctx.sleep_min / 60).toFixed(1) : null, entry_mode: "typed" });
    document.getElementById("ep-stream").innerHTML = "";
    bubble("sys", "It's held here the moment you say it.");
  }
  document.getElementById("ep-clock").textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  show("ep");
  document.getElementById("dump").focus();
}
function bubble(kind, text, who) {
  const s = document.getElementById("ep-stream");
  const d = document.createElement("div");
  d.className = "bubble " + kind;
  if (kind === "guide") { const w = document.createElement("span"); w.className = "who"; w.textContent = who || "THE GUIDE"; d.appendChild(w); }
  d.appendChild(document.createTextNode(text));
  s.appendChild(d);
  s.scrollTop = s.scrollHeight;
  return d;
}
function commitDraft(source) {
  const text = document.getElementById("dump").value.trim();
  if (!text) return null;
  document.getElementById("dump").value = "";
  if (source === "voice") usedVoice = true; else usedType = true;
  bubble("him", text);
  enqueue("entry_add", { id: crypto.randomUUID(), episode_id: ep.id, at: new Date().toISOString(), text, source });
  return text;
}
const dumpEl = document.getElementById("dump");
dumpEl.addEventListener("input", () => {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => commitDraft("typed"), 4000);
  dumpEl.style.height = "auto"; dumpEl.style.height = Math.min(dumpEl.scrollHeight, innerHeight * 0.38) + "px";
});
document.getElementById("btn-send").addEventListener("click", () => { clearTimeout(draftTimer); const t = commitDraft("typed"); askGuide("open", t || ""); });
document.getElementById("btn-in").addEventListener("click", startEpisode);
document.getElementById("btn-done").addEventListener("click", () => closeEpisode("let_go"));

async function closeEpisode(endedBy) {
  if (!ep) return show("land");
  clearTimeout(draftTimer); commitDraft("typed");
  const minutes = Math.max(1, Math.round((Date.now() - new Date(ep.opened_at).getTime()) / 60000));
  const mode = usedVoice && usedType ? "mixed" : usedVoice ? "voice" : "typed";
  enqueue("episode_close", { id: ep.id, closed_at: new Date().toISOString(), ended_by: endedBy, minutes, entry_mode: mode });
  await kvSet("open_episode", null);
  ep = null; usedVoice = usedType = false;
  show("land"); loadContext();
}

/* ---------- the guide ---------- */
let guideBusy = false;
async function askGuide(mode, askText) {
  if (guideBusy || !ep) return;
  guideBusy = true;
  const thinking = bubble("sys", "the guide is reading...");
  try {
    const r = await fetch(FN + "/eddy-guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token(), episode_id: ep.id, mode, ask: askText }) });
    const j = await r.json();
    thinking.remove();
    if (j.reply) bubble("guide", j.reply);
    else bubble("sys", "The guide is unreachable. The moves still work: Park and Ride need no wire.");
  } catch {
    thinking.remove();
    bubble("sys", "The guide is unreachable. The moves still work: Park and Ride need no wire.");
  }
  guideBusy = false;
}
document.querySelectorAll(".move-btn[data-move]").forEach((b) => b.addEventListener("click", () => {
  clearTimeout(draftTimer);
  const t = commitDraft("typed");
  if (b.dataset.move === "park") return openPark();
  askGuide(b.dataset.move, t || "");
}));

/* ---------- hold to talk (Web Speech, with honest fallback) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const talkBtn = document.getElementById("btn-talk");
let rec = null, recFinal = "";
function startTalk() {
  if (!SR) { dumpEl.focus(); bubble("sys", "Hold-to-talk needs Safari speech. Use the mic key on your keyboard; it lands the same."); return; }
  recFinal = "";
  rec = new SR();
  rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) recFinal += e.results[i][0].transcript + " ";
      else interim += e.results[i][0].transcript;
    }
    dumpEl.value = (recFinal + interim).trim();
  };
  rec.onerror = () => { talkBtn.classList.remove("listening"); };
  try { rec.start(); talkBtn.classList.add("listening"); } catch { }
}
function stopTalk() {
  talkBtn.classList.remove("listening");
  if (rec) { try { rec.stop(); } catch { } rec = null; }
  if (dumpEl.value.trim()) { commitDraft("voice"); }
}
talkBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); startTalk(); });
talkBtn.addEventListener("pointerup", stopTalk);
talkBtn.addEventListener("pointercancel", stopTalk);

/* ---------- park ---------- */
let parkChoice = null;
function parkOptions() {
  const now = new Date();
  const opts = [];
  const plus1 = new Date(now.getTime() + 3600000);
  opts.push({ label: "In an hour", at: plus1 });
  const evening = new Date(now); evening.setHours(18, 0, 0, 0);
  if (evening > now) opts.push({ label: "This evening 6:00", at: evening });
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  opts.push({ label: "Tomorrow 9:00", at: tomorrow });
  return opts;
}
function openPark() {
  const chips = document.getElementById("park-chips");
  chips.innerHTML = "";
  parkChoice = null;
  for (const o of parkOptions()) {
    const c = document.createElement("button");
    c.className = "chip"; c.textContent = o.label;
    c.addEventListener("click", () => { parkChoice = o.at; document.querySelectorAll("#park-chips .chip").forEach((x) => x.classList.remove("sel")); c.classList.add("sel"); });
    chips.appendChild(c);
  }
  show("park");
}
document.getElementById("park-custom").addEventListener("change", (e) => { if (e.target.value) { parkChoice = new Date(e.target.value); document.querySelectorAll("#park-chips .chip").forEach((x) => x.classList.remove("sel")); } });
document.getElementById("btn-park-go").addEventListener("click", async () => {
  if (!parkChoice || !ep) return;
  const firstEntry = document.querySelector("#ep-stream .bubble.him");
  const note = firstEntry ? firstEntry.textContent.slice(0, 200) : "";
  enqueue("park_add", { id: crypto.randomUUID(), episode_id: ep.id, parked_at: new Date().toISOString(), until: parkChoice.toISOString(), note });
  const when = parkChoice.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  document.getElementById("held-line").textContent = "The loop is written down and parked until " + when + ". If it still needs you then, it gets your full attention on purpose.";
  const kept = (ctx?.parks_kept ?? 0) + 1, quiet = ctx?.parks_quiet ?? 0;
  document.getElementById("held-stats").textContent = "Parks kept: " + kept + (kept > 1 ? " · Arrived quiet: " + quiet : "");
  await closeEpisodeForPark();
  show("held");
});
async function closeEpisodeForPark() {
  if (!ep) return;
  const minutes = Math.max(1, Math.round((Date.now() - new Date(ep.opened_at).getTime()) / 60000));
  enqueue("episode_close", { id: ep.id, closed_at: new Date().toISOString(), ended_by: "parked", minutes, entry_mode: usedVoice && usedType ? "mixed" : usedVoice ? "voice" : "typed" });
  await kvSet("open_episode", null); ep = null; usedVoice = usedType = false;
}
document.getElementById("btn-held-done").addEventListener("click", () => { show("land"); loadContext(); });

/* ---------- park arrival ---------- */
let arriving = null;
function openArrival(park) {
  arriving = park;
  document.getElementById("arrive-note").textContent = park.note || "(no words were kept with it)";
  show("arrive");
}
document.getElementById("btn-arrive-quiet").addEventListener("click", () => {
  enqueue("park_arrive", { id: arriving.id, arrived: "quiet" });
  if (ctx) { ctx.parks_due = ctx.parks_due.filter((p) => p.id !== arriving.id); ctx.parks_quiet++; }
  show("land"); renderContext();
});
document.getElementById("btn-arrive-loud").addEventListener("click", async () => {
  enqueue("park_arrive", { id: arriving.id, arrived: "loud" });
  if (ctx) ctx.parks_due = ctx.parks_due.filter((p) => p.id !== arriving.id);
  await startEpisode();
  if (arriving.note) { dumpEl.value = arriving.note; commitDraft("typed"); }
});

/* ---------- watch ---------- */
let watchTimer = null;
function startWatch(thought) {
  document.getElementById("watch-thought").textContent = thought || "";
  let left = 90;
  const t = document.getElementById("watch-timer");
  t.textContent = "1:30";
  clearInterval(watchTimer);
  watchTimer = setInterval(() => {
    left--;
    t.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    if (left <= 0) { clearInterval(watchTimer); t.textContent = "The water is still moving. You are still on the bank."; }
  }, 1000);
  startWatchCanvas();
}
document.getElementById("btn-watch-done").addEventListener("click", () => { clearInterval(watchTimer); stopWatchCanvas(); back(); });

/* ---------- ride ---------- */
let rideRitual = null, rideTimer = null, rideStart = null;
function prepRide() {
  const chips = document.getElementById("ritual-chips");
  chips.innerHTML = ""; rideRitual = null;
  for (const r of (ctx?.rituals || [])) {
    const c = document.createElement("button");
    c.className = "chip"; c.textContent = r.name;
    c.addEventListener("click", () => { rideRitual = r; document.querySelectorAll("#ritual-chips .chip").forEach((x) => x.classList.remove("sel")); c.classList.add("sel"); });
    chips.appendChild(c);
  }
  document.getElementById("ride-ring").classList.add("hidden");
  document.getElementById("ride-outcome").classList.add("hidden");
  document.getElementById("btn-ride-start").classList.remove("hidden");
}
document.getElementById("ritual-new").addEventListener("change", (e) => {
  const name = e.target.value.trim();
  if (!name) return;
  const r = { id: crypto.randomUUID(), name };
  enqueue("ritual_add", { id: r.id, name });
  if (ctx) ctx.rituals.push(r);
  e.target.value = "";
  prepRide();
});
document.getElementById("btn-ride-start").addEventListener("click", () => {
  if (!rideRitual) return;
  rideStart = Date.now();
  document.getElementById("btn-ride-start").classList.add("hidden");
  const ring = document.getElementById("ride-ring");
  ring.classList.remove("hidden");
  let left = 90;
  document.getElementById("ride-count").textContent = left;
  clearInterval(rideTimer);
  rideTimer = setInterval(() => {
    left--; document.getElementById("ride-count").textContent = Math.max(0, left);
    if (left <= 0) { clearInterval(rideTimer); document.getElementById("ride-outcome").classList.remove("hidden"); }
  }, 1000);
  setTimeout(() => document.getElementById("ride-outcome").classList.remove("hidden"), 8000);
});
function recordRide(rode) {
  clearInterval(rideTimer);
  enqueue("ritual_mark", { id: crypto.randomUUID(), ritual_id: rideRitual.id, episode_id: ep?.id ?? null, at: new Date().toISOString(), rode, seconds: Math.round((Date.now() - rideStart) / 1000) });
  back();
}
document.getElementById("btn-rode").addEventListener("click", () => recordRide(true));
document.getElementById("btn-took").addEventListener("click", () => recordRide(false));

/* ---------- record ---------- */
async function loadRecord() {
  const body = document.getElementById("record-body");
  body.innerHTML = '<p class="lead">Reading the water...</p>';
  let d;
  try { d = await api("record"); } catch { body.innerHTML = '<p class="lead">Offline. The record lives on the server; it will be here when the water clears.</p>'; return; }
  const eps = d.episodes || [];
  const quiet = (d.parks || []).filter((p) => p.arrived === "quiet").length;
  const kept = (d.parks || []).length;
  const rides = (d.marks || []).filter((m) => m.rode === true).length;
  const firstByEp = {};
  for (const e of (d.entries || [])) if (!firstByEp[e.episode_id]) firstByEp[e.episode_id] = e.text;
  body.innerHTML = "";
  const stats = document.createElement("div"); stats.className = "stat-row";
  for (const [n, label] of [[eps.length, "loops held"], [kept ? quiet + " of " + kept : "0", "parks arrived quiet"], [rides, "urges ridden"]]) {
    const s = document.createElement("div"); s.className = "stat";
    s.innerHTML = "<b>" + n + "</b><span>" + label + "</span>";
    stats.appendChild(s);
  }
  body.appendChild(stats);
  const note = document.createElement("p"); note.className = "dim";
  note.textContent = "Facts, arranged. Never a verdict.";
  body.appendChild(note);
  for (const e of eps.slice(0, 30)) {
    const row = document.createElement("div"); row.className = "ep-row";
    const when = new Date(e.opened_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    row.innerHTML = '<div class="when">' + when + " · " + (e.minutes ?? "?") + " min · " + (e.ended_by ?? "open") + '</div><div class="first"></div>';
    row.querySelector(".first").textContent = firstByEp[e.id] || "";
    body.appendChild(row);
  }
}

/* ---------- settings ---------- */
document.getElementById("set-pair") && (document.getElementById("set-pair").textContent = token() ? "Paired to your backend." : "Not paired. Open your pairing link once on this phone.");
document.getElementById("btn-push").addEventListener("click", async () => {
  const state = document.getElementById("push-state");
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { state.textContent = "Knocks are off. iOS grants them only to the installed app (Share, then Add to Home Screen)."; return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
    const raw = sub.toJSON();
    await api("push_subscribe", { endpoint: raw.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth, ua: navigator.userAgent.slice(0, 120) });
    state.textContent = "Knocks are on for this phone.";
  } catch (e) { state.textContent = "Could not turn on knocks here: " + String(e).slice(0, 80); }
});
document.getElementById("btn-export").addEventListener("click", async () => {
  try {
    const d = await api("record");
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "the-eddy-export.json"; a.click();
  } catch { }
});
function urlB64ToUint8(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/* ---------- the eddy water (landing + watch) ---------- */
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function makeWater(canvasId, opts) {
  const cv = document.getElementById(canvasId);
  let raf = null, t = 0;
  function size() { cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio; }
  function frame() {
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height * opts.cy;
    for (let ring = 0; ring < opts.rings; ring++) {
      const baseR = (Math.min(cv.width, cv.height) * (0.12 + ring * 0.09));
      g.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.08) {
        const wob = Math.sin(a * 3 + t * (0.4 + ring * 0.13)) * baseR * 0.05;
        const r = baseR + wob;
        const x = cx + Math.cos(a + t * opts.spin * (1 - ring * 0.12)) * r;
        const y = cy + Math.sin(a + t * opts.spin * (1 - ring * 0.12)) * r * 0.62;
        a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = "rgba(87, 200, 191, " + (0.16 - ring * 0.02) + ")";
      g.lineWidth = 1.4 * devicePixelRatio;
      g.stroke();
    }
    t += reduceMotion ? 0 : 0.008;
    raf = requestAnimationFrame(frame);
  }
  return {
    start() { size(); if (!raf) frame(); },
    stop() { cancelAnimationFrame(raf); raf = null; },
  };
}
const landWater = makeWater("eddy-canvas", { rings: 5, cy: 0.5, spin: 0.06 });
const watchWater = makeWater("watch-canvas", { rings: 7, cy: 0.45, spin: 0.1 });
function startEddy() { landWater.start(); }
function stopEddy() { landWater.stop(); }
function startWatchCanvas() { watchWater.start(); }
function stopWatchCanvas() { watchWater.stop(); }
addEventListener("resize", () => { landWater.start(); });

/* ---------- boot ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
(async function boot() {
  show("land");
  await loadContext();
  flush();
  const open = await resumeOrNull();
  if (open) { ep = open; document.getElementById("ep-clock").textContent = "resumed"; show("ep"); }
})();
