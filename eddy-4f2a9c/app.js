/* The Eddy v1. Capture is the sacred path: every word lands in IndexedDB the
   moment it exists, then syncs whenever the network and the door allow. A login
   wall is structurally impossible here; the device token is a static pairing,
   never a session that can expire at 1:42am. */
"use strict";

const FN = "https://dsjnvwhyevjzsmuawkcs.supabase.co/functions/v1";
const VAPID_PUBLIC = "BAeWETFXv1Y5lpd25yux-QfGnzeV7qNkwfSQSh3s-wQg-B9VO_HafzvyGu5SfRuqBgPJoS4U2GqBcuaXV46xizc";
const RESUME_WINDOW_MIN = 240;

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
/* One chain, never two flushes at once: awaiting flush() therefore waits for
   everything already queued, which is what lets Close it ask for a summary only
   after his last words are actually in. */
let flushChain = Promise.resolve();
async function enqueue(kind, payload) {
  const op = { qid: crypto.randomUUID(), kind, ...payload };
  await qPut(op);
  flush();
  return op;
}
function flush() { flushChain = flushChain.then(doFlush, doFlush); return flushChain; }
async function doFlush() {
  if (!navigator.onLine || !token()) return;
  const ops = await qAll();
  if (!ops.length) { setSyncState("Everything is in."); return; }
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
const views = ["land", "ep", "park", "held", "arrive", "watch", "ride", "record", "closed", "hold", "settings"];
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
  if (v === "hold") loadHold();
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
  renderContinue();
  renderCloseLand();
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
async function restoreStream() {
  // a reopened episode redraws what was said, his words and the guide's, in order
  const s = document.getElementById("ep-stream"); s.innerHTML = "";
  const started = new Date(ep.opened_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  try {
    const d = await api("episode", { episode_id: ep.id });
    const rows = [
      ...(d.entries || []).map((e) => ({ at: e.at, kind: "him", text: e.text })),
      ...(d.replies || []).map((r) => ({ at: r.at, kind: "guide", text: r.reply })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    if (!rows.length) { bubble("sys", "Picked up where you left off. Started " + started + "."); return; }
    bubble("sys", "Picked up where you left off. Started " + started + ".");
    for (const r of rows) bubble(r.kind, r.text);
    bubble("sys", "Still the same loop. Keep going, or let it go below.");
  } catch {
    bubble("sys", "Picked up where you left off (started " + started + "). The earlier words are in your record; the wire is quiet right now.");
  }
}
async function reopenEpisode(e) {
  if (!e || !e.id) return;
  ep = { id: e.id, opened_at: e.opened_at };
  await kvSet("open_episode", ep);
  if (e.closed_at) enqueue("episode_reopen", { id: e.id });
  document.getElementById("ep-clock").textContent = "resumed";
  show("ep");
  await restoreStream();
  document.getElementById("dump").focus();
}
function renderContinue() {
  const b = document.getElementById("btn-continue"); if (!b) return;
  const le = ctx && ctx.last_episode;
  const fresh = le && (Date.now() - new Date(le.opened_at).getTime()) < 14 * 86400000;
  if (!fresh) { b.classList.add("hidden"); return; }
  const when = new Date(le.opened_at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  const first = (le.first || "").slice(0, 70);
  b.textContent = "Continue the last loop (" + when + ")" + (first ? ": " + first + (le.first.length > 70 ? "..." : "") : "");
  b.classList.remove("hidden");
  b.onclick = () => reopenEpisode(le);
}
async function startEpisode() {
  const resumed = await resumeOrNull();
  if (resumed) { ep = resumed; await restoreStream(); } else {
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
document.getElementById("btn-close-ep").addEventListener("click", () => closeIt());
document.getElementById("btn-close-land").addEventListener("click", () => closeIt());

/* ---------- close it ----------
   His word, 09-17: "Make sure there is a close it mechanism in place, or a
   button for me to press when complete, so the function actually works."
   Closing is what turns a loop into memory: the episode gets an end, and the
   guide writes the summary that later conversations read. eddy-dispatch closes
   an eight-hour-quiet loop the same way, for the nights he just puts it down. */
async function openEpisodeRef() {
  if (ep) return ep;
  const saved = await kvGet("open_episode");
  if (saved && saved.id) return saved;
  const le = ctx && ctx.last_episode;
  return le && !le.closed_at ? { id: le.id, opened_at: le.opened_at } : null;
}
async function renderCloseLand() {
  const b = document.getElementById("btn-close-land"); if (!b) return;
  const e = await openEpisodeRef();
  if (!e) { b.classList.add("hidden"); return; }
  const when = new Date(e.opened_at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  b.innerHTML = "";
  b.appendChild(document.createTextNode("Close it"));
  const sub = document.createElement("span"); sub.className = "sub";
  sub.textContent = "the loop you opened " + when;
  b.appendChild(sub);
  b.classList.remove("hidden");
}
async function closeIt() {
  const e = await openEpisodeRef();
  if (!e) return show("land");
  if (ep) { clearTimeout(draftTimer); commitDraft("typed"); }
  const minutes = Math.max(1, Math.round((Date.now() - new Date(e.opened_at).getTime()) / 60000));
  const mode = usedVoice && usedType ? "mixed" : usedVoice ? "voice" : "typed";
  enqueue("episode_close", { id: e.id, closed_at: new Date().toISOString(), ended_by: "closed", minutes, entry_mode: mode });
  await kvSet("open_episode", null);
  ep = null; usedVoice = usedType = false;
  showClosing(e);
  await flush();
  summarizeInto(e.id);
  loadContext();
}
function showClosing(e) {
  const body = document.getElementById("closed-body");
  body.innerHTML = "";
  const h = document.createElement("h1"); h.className = "closed-title";
  h.innerHTML = "Closed.<br>It is held.";
  const lead = document.createElement("p"); lead.className = "lead";
  lead.textContent = "The loop you opened " + new Date(e.opened_at).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }) + " is written down. You will not have to explain it again.";
  const slot = document.createElement("div"); slot.id = "sum-slot";
  slot.innerHTML = '<p class="lead">Reading the loop back...</p>';
  const done = document.createElement("button"); done.className = "big-btn small";
  done.textContent = "Back to the water";
  done.addEventListener("click", () => { show("land"); loadContext(); });
  body.append(h, lead, slot, done);
  show("closed");
}
async function summarizeInto(episodeId) {
  const slot = document.getElementById("sum-slot");
  try {
    const r = await fetch(FN + "/eddy-guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token(), op: "summarize", episode_id: episodeId }) });
    const j = await r.json();
    if (!j.summary) throw new Error(j.error || "no summary");
    renderSummary(slot, j, episodeId);
  } catch {
    slot.innerHTML = "";
    const p = document.createElement("p"); p.className = "lead";
    p.textContent = "Closed and held here. The written version needs the wire; it will be waiting under The record.";
    const again = document.createElement("button"); again.className = "move-btn"; again.textContent = "Try again";
    again.addEventListener("click", () => { slot.innerHTML = '<p class="lead">Reading the loop back...</p>'; summarizeInto(episodeId); });
    slot.append(p, again);
  }
}
function listBlock(slot, label, items) {
  if (!Array.isArray(items) || !items.length) return;
  const h = document.createElement("p"); h.className = "sum-head"; h.textContent = label;
  const ul = document.createElement("ul"); ul.className = "sum-list";
  for (const it of items) { const li = document.createElement("li"); li.textContent = String(it); ul.appendChild(li); }
  slot.append(h, ul);
}
function renderSummary(slot, j, episodeId) {
  slot.innerHTML = "";
  const card = document.createElement("div"); card.className = "sum-card"; card.textContent = j.summary || "";
  slot.appendChild(card);
  listBlock(slot, "What you decided", j.decisions);
  listBlock(slot, "Still open", j.open_threads);
  const cands = Array.isArray(j.rule_candidates) ? j.rule_candidates : [];
  if (!cands.length) return;
  const h = document.createElement("p"); h.className = "sum-head"; h.textContent = "Sounded like a rule you set";
  const note = document.createElement("p"); note.className = "lead";
  note.textContent = "Only if you say so. Nothing here is held until you keep it, and you can change the words first.";
  slot.append(h, note);
  for (const c of cands) slot.appendChild(candidateCard(c, episodeId));
}
function candidateCard(c, episodeId) {
  const card = document.createElement("div"); card.className = "cand";
  const txt = document.createElement("div"); txt.className = "txt"; txt.textContent = c.text || "";
  const row = document.createElement("div"); row.className = "row";
  const keep = document.createElement("button"); keep.className = "chip"; keep.textContent = "Keep as a rule";
  const no = document.createElement("button"); no.className = "quiet-btn"; no.textContent = "Not this";
  row.append(keep, no);
  card.append(txt, row);
  no.addEventListener("click", () => card.remove());
  keep.addEventListener("click", () => {
    card.innerHTML = "";
    const ta = document.createElement("textarea"); ta.value = c.text || ""; ta.setAttribute("aria-label", "The rule, in your words");
    const scope = document.createElement("input"); scope.className = "dt";
    scope.value = (Array.isArray(c.scope) ? c.scope : ["always"]).join(", ");
    scope.setAttribute("aria-label", "Who or what it is about");
    const hint = document.createElement("p"); hint.className = "dim";
    hint.textContent = "Who or what it is about. The guide reads a rule when the moment names it. Use always for one that rides everywhere.";
    const row2 = document.createElement("div"); row2.className = "row";
    const save = document.createElement("button"); save.className = "chip sel"; save.textContent = "Hold it";
    const cancel = document.createElement("button"); cancel.className = "quiet-btn"; cancel.textContent = "Never mind";
    row2.append(save, cancel);
    card.append(ta, scope, hint, row2);
    cancel.addEventListener("click", () => card.remove());
    save.addEventListener("click", async () => {
      const text = ta.value.trim(); if (!text) return;
      save.textContent = "Holding...";
      const edited = text !== (c.text || "");
      try {
        await api("rule_add", {
          text,
          scope: scope.value.split(",").map((x) => x.trim()).filter(Boolean),
          his_words: !!c.his_words && !edited,
          source: "kept from the loop of " + new Date().toLocaleDateString("en-CA") + (episodeId ? " (" + episodeId.slice(0, 8) + ")" : ""),
        });
        card.innerHTML = "";
        const ok = document.createElement("div"); ok.className = "txt"; ok.textContent = "Held. It is in What I hold.";
        card.appendChild(ok);
      } catch { save.textContent = "The wire is quiet. Try again"; }
    });
  });
  return card;
}

/* ---------- what I hold ---------- */
async function loadHold() {
  const body = document.getElementById("hold-body");
  body.innerHTML = '<p class="lead">Reading...</p>';
  let d = null;
  try { d = await api("rules_list"); await kvSet("rules", d); } catch { d = await kvGet("rules"); }
  body.innerHTML = "";
  const lead = document.createElement("p"); lead.className = "lead";
  lead.textContent = d
    ? "Yours. The guide reads these before it answers and holds you to them. Nothing was written here for you."
    : "Offline. What you hold lives on the server; it will be here when the water clears.";
  body.appendChild(lead);
  for (const r of (d?.rules || [])) body.appendChild(ruleCard(r));
  if (d && !(d.rules || []).length) {
    const p = document.createElement("p"); p.className = "dim";
    p.textContent = "Nothing held yet. Close a loop and keep what you said, or write one below.";
    body.appendChild(p);
  }
  if (d) body.appendChild(addRuleBlock());
}
function ruleCard(r) {
  const card = document.createElement("div"); card.className = "rule-card";
  const meta = document.createElement("div"); meta.className = "meta";
  meta.textContent = (Array.isArray(r.scope) ? r.scope.join(" / ") : "always") + " · " +
    String(r.at || "").slice(0, 10) + " · " + (r.his_words ? "your words" : "the shape you ratified");
  const text = document.createElement("div"); text.className = "text"; text.textContent = r.text || "";
  const retire = document.createElement("button"); retire.className = "retire"; retire.textContent = "Retire";
  let armed = false;
  retire.addEventListener("click", async () => {
    if (!armed) { armed = true; retire.classList.add("armed"); retire.textContent = "Retire it?"; return; }
    retire.textContent = "Retiring...";
    try { await api("rule_retire", { id: r.id }); card.remove(); } catch { retire.textContent = "The wire is quiet. Try again"; }
  });
  card.append(meta, text, retire);
  return card;
}
function addRuleBlock() {
  const wrap = document.createElement("div"); wrap.className = "set-block";
  const b = document.createElement("b"); b.textContent = "Hold something new";
  const ta = document.createElement("textarea"); ta.className = "dt"; ta.rows = 3;
  ta.placeholder = "In your words."; ta.setAttribute("aria-label", "The rule, in your words");
  const scope = document.createElement("input"); scope.className = "dt";
  scope.placeholder = "About who or what (David, always)"; scope.setAttribute("aria-label", "Who or what it is about");
  const save = document.createElement("button"); save.className = "move-btn"; save.textContent = "Hold this";
  save.addEventListener("click", async () => {
    const text = ta.value.trim(); if (!text) return;
    save.textContent = "Holding...";
    try {
      await api("rule_add", { text, scope: scope.value.split(",").map((x) => x.trim()).filter(Boolean), his_words: true, source: "typed in the app" });
      loadHold();
    } catch { save.textContent = "The wire is quiet. Try again"; }
  });
  wrap.append(b, ta, scope, save);
  return wrap;
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
  renderCloseLand();
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
    row.style.cursor = "pointer";
    const hint = document.createElement("div"); hint.className = "dim"; hint.style.fontSize = ".72rem"; hint.textContent = "tap to continue this loop"; row.appendChild(hint);
    row.addEventListener("click", () => reopenEpisode(e));
    body.appendChild(row);
  }
}

/* ---------- settings ---------- */
/* iOS lesson, learned the hard way: an installed home-screen app has its OWN
   storage, separate from Safari. So pairing must be possible INSIDE the
   installed app: paste the link or the bare token here, once. */
function updatePairLine(msg) {
  const el = document.getElementById("set-pair");
  if (el) el.textContent = msg || (token() ? "Paired to your backend." : "Not paired. Paste your pairing link below, once.");
}
updatePairLine();
document.getElementById("btn-pair").addEventListener("click", async () => {
  const raw = document.getElementById("pair-input").value.trim();
  if (!raw) return;
  const t = raw.includes("#setup=") ? raw.split("#setup=")[1].split(/[\s&?]/)[0] : raw;
  localStorage.setItem("eddy_token", t);
  updatePairLine("Checking the pairing...");
  try {
    await api("context");
    document.getElementById("pair-input").value = "";
    updatePairLine("Paired and connected.");
    loadContext(); flush();
  } catch {
    updatePairLine("That token was refused. Check the link and paste it whole.");
  }
});
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
  if (open) { ep = open; document.getElementById("ep-clock").textContent = "resumed"; show("ep"); restoreStream(); }
})();
