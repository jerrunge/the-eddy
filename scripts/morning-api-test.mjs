// Unit tests for morning-api's actions-only rules (RULINGS 2026-09-14: what may reach the Morning, goals in Linear,
// a job written twice). No network, no tables: the function is bundled with its helpers exported and supabase-js
// replaced by an in-memory mock; fetch is stubbed (Linear answers from a fixture, anything else throws).
// Usage: node scripts/morning-api-test.mjs   (needs npx esbuild; prints no key, reads no env)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../supabase/functions/morning-api/index.ts", import.meta.url));
const OUT = mkdtempSync(join(tmpdir(), "morning-api-test-"));

// ---------------- the mock client: a small PostgREST-shaped store ----------------
writeFileSync(join(OUT, "sb-mock.mjs"), `export function createClient() { return globalThis.__sb; }\n`);
function mockDb(tables, opts = {}) {
  const schema = opts.schema || {};      // table -> column list; a select naming another column fails 42703
  const fail = opts.fail || {};          // "table:op" -> message
  const writes = [];
  class Q {
    constructor(t) { this.t = t; this.filters = []; this.op = "select"; this.cols = "*"; this.payload = null; this.mode = null; this.orders = []; }
    select(cols = "*") { if (this.op === "select") this.cols = cols; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c, op, v) {
      if (op === "in") { const vs = String(v).replace(/^\(|\)$/g, "").split(","); this.filters.push((r) => !vs.includes(String(r[c]))); }
      else if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v);
      return this;
    }
    lte(c, v) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
    lt(c, v) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
    gte(c, v) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
    order(c) { this.orders.push(c); return this; }
    limit() { return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    single() { this.mode = "single"; return this; }
    update(p) { this.op = "update"; this.payload = p; return this; }
    insert(p) { this.op = "insert"; this.payload = p; return this; }
    upsert(p) { this.op = "upsert"; this.payload = p; return this; }
    delete() { this.op = "delete"; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
    exec() {
      const rows = tables[this.t] || (tables[this.t] = []);
      if (fail[this.t + ":" + this.op]) return { data: null, error: { message: fail[this.t + ":" + this.op] } };
      const hit = rows.filter((r) => this.filters.every((f) => f(r)));
      const shape = (list) => this.mode === "maybe" ? { data: list[0] ?? null, error: null } : this.mode === "single" ? (list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: "not one row" } }) : { data: list, error: null };
      if (this.op === "select") {
        const cols = this.cols === "*" ? null : this.cols.split(",").map((s) => s.trim());
        if (cols && schema[this.t]) { const bad = cols.find((c) => !schema[this.t].includes(c)); if (bad) return { data: null, error: { code: "42703", message: "column " + this.t + "." + bad + " does not exist" } }; }
        let list = hit.slice();
        for (const o of this.orders.slice().reverse()) list.sort((a, b) => (a[o] == null) - (b[o] == null) || (a[o] < b[o] ? -1 : a[o] > b[o] ? 1 : 0));
        list = list.map((r) => { if (!cols) return JSON.parse(JSON.stringify(r)); const o = {}; for (const c of cols) if (c in r) o[c] = r[c]; return o; });
        return shape(list);
      }
      if (this.op === "update") { for (const r of hit) Object.assign(r, this.payload); writes.push({ table: this.t, op: "update", ids: hit.map((r) => r.id), payload: this.payload }); return shape(hit.map((r) => JSON.parse(JSON.stringify(r)))); }
      writes.push({ table: this.t, op: this.op, payload: this.payload });
      return { data: null, error: null };
    }
  }
  return { from: (t) => new Q(t), writes };
}

// ---------------- bundle the function ----------------
const EXPORTS = ["linearReason", "linearRow", "LINEAR_CLOSED", "linearCard", "itemCard", "moveCard", "deskHolds", "ago", "pickNext"];
const src = readFileSync(SRC, "utf8")
  .replace(/^import "jsr:[^"]+";\s*$/m, "")
  .replace(/"npm:@supabase\/supabase-js@2"/g, JSON.stringify(join(OUT, "sb-mock.mjs")))
  + `\nexport { ${EXPORTS.join(", ")} };\n`;
writeFileSync(join(OUT, "idx.ts"), src);
execSync(`npx --yes esbuild ${join(OUT, "idx.ts")} --bundle --platform=node --format=esm --outfile=${join(OUT, "idx.mjs")} --log-level=error`, { stdio: "inherit" });
const SERVICE = "service-role-key-for-unit-tests-only-0000";
const ENV = { SUPABASE_URL: "http://mock.local", SUPABASE_SERVICE_ROLE_KEY: SERVICE };
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { globalThis.__handler = h; } };
let instance = 0;
async function fresh() { instance++; const E = await import(pathToFileURL(join(OUT, "idx.mjs")).href + "?i=" + instance); return { E, handler: globalThis.__handler }; }

// ---------------- Linear, stubbed: two pages ----------------
const L = (o) => Object.assign({ priority: 0, dueDate: null, url: null, updatedAt: "2026-09-14T00:00:00Z", state: { name: "Todo", type: "unstarted" }, project: null, team: { id: "team" }, labels: { nodes: [] }, parent: null, children: { nodes: [] } }, o, { labels: { nodes: (o.labels || []).map((name) => ({ name })) } });
const kid = (n, type = "unstarted", mine = false, due = null) => ({ id: "kid-" + n, identifier: "JER-K" + n, title: "Step " + n, dueDate: due, state: { type }, assignee: mine ? { isMe: true } : null });
const PAGE1 = [
  L({ id: "lin-17", identifier: "JER-17", title: "Urgent with no day", priority: 1 }),
  L({ id: "lin-5", identifier: "JER-5", title: "Another urgent, no day", priority: 1, state: { name: "Backlog", type: "backlog" } }),
  L({ id: "lin-23", identifier: "JER-23", title: "Land first coaching client", priority: 0, labels: ["Goal", "Parked", "pillar:fortify"], state: { name: "Backlog", type: "backlog" } }),
  L({ id: "lin-36", identifier: "JER-36", title: "A parked one", labels: ["Parked"] }),
  L({ id: "lin-361", identifier: "JER-361", title: "The launch list", children: { nodes: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => kid(n)).concat([kid(9, "completed"), kid(10, "canceled")]) } }),
  L({ id: "lin-9", identifier: "JER-9", title: "Plain, no day", priority: 2 }),
  L({ id: "lin-716", identifier: "JER-716", title: "TikTok ads: kill waitlist rail", priority: 2, dueDate: "2026-08-02" }),
  L({ id: "lin-8", identifier: "JER-8", title: "A duplicate", priority: 1, state: { name: "Duplicate", type: "duplicate" } }),
  L({ id: "lin-900", identifier: "JER-900", title: "A dated goal", dueDate: "2026-09-20", labels: ["goal"] }),
  L({ id: "lin-901", identifier: "JER-901", title: "A step of the launch list", dueDate: "2026-09-10", parent: { id: "lin-361", identifier: "JER-361", title: "The launch list", state: { type: "started" } } }),
];
const PAGE2 = [
  L({ id: "lin-902", identifier: "JER-902", title: "On page two, due today", dueDate: "2026-09-14" }),
  L({ id: "lin-903", identifier: "JER-903", title: "Child due today", dueDate: "2026-09-14", parent: { id: "lin-p", identifier: "JER-P", title: "P", state: { type: "backlog" } } }),
  L({ id: "lin-904", identifier: "JER-904", title: "Child of a done parent", dueDate: "2026-09-16", priority: 2, project: { name: "Wealth Stack" }, parent: { id: "lin-old", identifier: "JER-OLD", title: "Old parent", state: { type: "completed" } } }),
  L({ id: "lin-905", identifier: "JER-905", title: "Dated parent with my open step", dueDate: "2026-09-12", children: { nodes: [kid(20, "started", true, "2026-09-30")] } }),
];
let linearCalls = [];
let linearEmpty = false;
globalThis.fetch = async (url, init) => {
  if (String(url) === "https://api.linear.app/graphql") {
    const body = JSON.parse(init.body);
    linearCalls.push(body.variables || {});
    if (/issueUpdate/.test(body.query)) throw new Error("a Linear write in a unit test");
    const page2 = body.variables?.after === "cursor-1";
    const conn = linearEmpty ? { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } : { pageInfo: { hasNextPage: !page2, endCursor: page2 ? "cursor-2" : "cursor-1" }, nodes: page2 ? PAGE2 : PAGE1 };
    return new Response(JSON.stringify({ data: { viewer: { assignedIssues: conn } } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("network call in a unit test: " + url);
};

// ---------------- the desk, the moves ----------------
const D = "2026-09-14";
const HOUSE = "box-house", PEOPLE = "box-people";
const I = (id, text, due, parent = null, extra = {}) => Object.assign({ id, box_id: HOUSE, text, detail: null, done: false, due, kind: "task", options: null, choice: null, linear_ref: null, parent_item_id: parent, position: 0 }, extra);
const P389 = "389abbe8-dd78-49f3-be1c-1ff9c8d9e134", P067 = "067434dd-0000-4000-8000-000000000000", TWIN = "0424483c-342b-4231-b2ef-099f3a15563b";
function deskRows() {
  return [
    I(P389, "The keep-with-me list", "2026-09-07"),
    ...["Cooper's kit", "Chargers", "Papers", "Meds", "Clothes for a week", "Laptop"].map((t, n) => I("k389-" + n, t, null, P389)),
    I(P067, "Paperwork", null), I("k067-0", "Lease copy", null, P067), I("k067-1", "Insurance card", null, P067),
    I("car-kit", "Car kit", "2026-09-18"), I("car-child", "Jumper cables in the trunk", D, "car-kit"),
    I("done-parent", "Old list", null, null, { done: true }), I("orphan", "Return the drill", "2026-09-13", "done-parent"),
    I("gp", "Garage", null), I("mid", "Shelves", "2026-09-15", "gp"), I("gc", "Buy brackets", D, "mid"),
    I(TWIN, "Set up the staging area", "2026-09-12"),
    I("tw-undated", "Utilities list", null),
    I("ptwin", "Pack the kitchen", "2026-09-11"), I("ptwin-kid", "Buy boxes", null, "ptwin"),
    I("tw-movedone", "Donate run", "2026-09-13"),
    I("solo", "Solo task", D), I("note-kid", "a note under solo", null, "solo", { kind: "note" }),
    I("people-1", "Send the six-word text", "2026-09-13", null, { box_id: PEOPLE }),
  ];
}
const FAB = "fab45510-ce5f-4c89-994c-379b4014d24b";
const M = (id, title, target, stage, link, extra = {}) => Object.assign({ id, project_id: "proj-move", user_id: "u", title, why: null, stage, target_ymd: target, status: "open", desk_item_id: link, created_at: "2026-09-12T00:00:00Z" }, extra);
function moveRows() {
  return [
    M(FAB, "Create the staging area; clothes", "2026-09-12", 1, TWIN),
    M("mv-kitchen", "Pack the kitchen", "2026-09-16", 2, "ptwin"),
    M("mv-utilities", "Utilities list", "2026-10-12", 5, "tw-undated"),
    M("mv-donate", "Donate run", "2026-09-13", 3, "tw-movedone", { status: "done" }),
    M("mv-plain", "Measure the truck", D, 4, null),
  ];
}
function tablesFor() {
  return {
    hub_content: [{ key: "morning-doors", content: { checked_at: new Date().toISOString(), sites: {}, bluesky: null }, updated_at: new Date().toISOString() }],
    eddy_config: [{ key: "linear_api_key", value: "linear-key-for-unit-tests" }],
    desk_boxes: [{ id: HOUSE, title: "The house: move out", why: null, deadline: null, position: 0, archived: false }, { id: PEOPLE, title: "The People", why: null, deadline: null, position: 1, archived: false }],
    desk_items: deskRows(),
    projects: [{ id: "proj-move", title: "Move out by October 30", due_ymd: "2026-10-30", status: "open" }],
    project_moves: moveRows(),
  };
}
async function call(handler, body) {
  const res = await handler(new Request("http://local/functions/v1/morning-api", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + SERVICE }, body: JSON.stringify(body) }));
  return { status: res.status, json: JSON.parse(await res.text()) };
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "\n     got  " + JSON.stringify(got) + "\n     want " + JSON.stringify(want))); };

// ================= A. Linear: the rule, the row, the card =================
const { E } = await fresh();
const row = (node) => E.linearRow(node);
eq("LINEAR_CLOSED", E.LINEAR_CLOSED, ["completed", "canceled", "duplicate"]);
eq("A4 JER-17 (p1, no due, Todo): undated_urgent", E.linearReason(row(PAGE1[0])), "undated_urgent");
eq("A4 JER-5 (p1, no due, Backlog): undated_urgent", E.linearReason(row(PAGE1[1])), "undated_urgent");
eq("A4 JER-23 (p0, Goal and Parked): goal", E.linearReason(row(PAGE1[2])), "goal");
eq("A4 JER-36 (Parked): parked", E.linearReason(row(PAGE1[3])), "parked");
eq("A4 JER-361 (8 open unassigned children): parent", E.linearReason(row(PAGE1[4])), "parent");
eq("A4 JER-9 (p2, no due, no labels): undated", E.linearReason(row(PAGE1[5])), "undated");
eq("A4 JER-716 (p2, due 2026-08-02): a card", E.linearReason(row(PAGE1[6])), null);
eq("A4 state_type duplicate (JER-8 shape): skip", E.linearReason(row(PAGE1[7])), "skip");
eq("A4 state name Duplicate with another type: skip", E.linearReason({ state: "Duplicate", state_type: "canceled_like", due: D }), "skip");
eq("A4 completed and canceled: skip", [E.linearReason({ state_type: "completed", due: D }), E.linearReason({ state_type: "canceled", due: D })], ["skip", "skip"]);
eq("A4 Goal label with a due date: goal", E.linearReason(row(PAGE1[8])), "goal");
eq("A4 lower-case goal and upper-case PARKED count", [E.linearReason({ labels: ["goal"], due: D }), E.linearReason({ labels: ["PARKED"], due: D })], ["goal", "parked"]);
eq("A4 Goal beats Parked beats parent beats undated", [E.linearReason({ labels: ["Parked", "Goal"], open_children: [{}] }), E.linearReason({ labels: ["Parked"], open_children: [{}] }), E.linearReason({ open_children: [{}], priority: 1 })], ["goal", "parked", "parent"]);
eq("A4 Urgent with a date is a card (priority never places, never blocks)", E.linearReason({ priority: 1, due: "2026-09-20" }), null);
eq("A1 row: open children only, any assignee", row(PAGE1[4]).open_children.map((c) => c.key), ["JER-K1", "JER-K2", "JER-K3", "JER-K4", "JER-K5", "JER-K6", "JER-K7", "JER-K8"]);
eq("A1 row: child shape", row(PAGE1[4]).open_children[0], { id: "kid-1", key: "JER-K1", title: "Step 1", due: null, mine: false });
eq("A1 row: open parent kept", row(PAGE1[9]).parent, { id: "lin-361", key: "JER-361", title: "The launch list" });
eq("A1 row: completed parent dropped", row(PAGE2[2]).parent, null);
eq("A1 row: today's fields kept", (({ id, key, title, priority, due, state, state_type, labels, team_id }) => ({ id, key, title, priority, due, state, state_type, labels, team_id }))(row(PAGE1[2])), { id: "lin-23", key: "JER-23", title: "Land first coaching client", priority: 0, due: null, state: "Backlog", state_type: "backlog", labels: ["Goal", "Parked", "pillar:fortify"], team_id: "team" });
eq("A4 linearCard of a child {parent P, due 09-10} on 09-14: why", E.linearCard({ id: "c", title: "t", due: "2026-09-10", parent: { id: "p", key: "JER-P", title: "P" } }, D).why, "P · 4 days past");
eq("A4 linearCard of a child dated today: why", E.linearCard({ id: "c", title: "t", due: D, parent: { id: "p", key: "JER-P", title: "P" } }, D).why, "P");
eq("A4 linearCard child: parent on the card", E.linearCard({ id: "c", title: "t", due: D, parent: { id: "p", key: "JER-P", title: "P" } }, D).parent, { id: "p", key: "JER-P", title: "P" });
eq("A4 linearCard without a parent: why as before, parent null", [E.linearCard({ id: "c", title: "t", due: "2026-09-10", project: "💰 Wealth Stack", state: "Todo", priority: 2 }, D).why, E.linearCard({ id: "c", title: "t", due: D }, D).parent], ["Wealth Stack · Todo · high · 4 days past", null]);
eq("ago", [E.ago("2026-09-13", D), E.ago("2026-09-10", D), E.ago(D, D)], ["1 day past", "4 days past", "today"]);

// ================= B. desk items: holds and whys =================
{
  const items = deskRows().filter((it) => !it.done && it.kind !== "note");
  const { itemById, openKids, twinOf } = E.deskHolds(items, moveRows());
  eq("B5 389abbe8: 6 open children", (openKids.get(P389) || []).length, 6);
  eq("B5 067434dd: 2 open children", (openKids.get(P067) || []).length, 2);
  eq("B5 a child whose parent is done has no parent in itemById", itemById.has("done-parent"), false);
  eq("B5 a note under an item makes no parent", openKids.has("solo"), false);
  eq("B5 grandparent and middle are both parents", [openKids.has("gp"), openKids.has("mid")], [true, true]);
  eq("C2 twinOf: the move names the item", twinOf.get(TWIN)?.id, FAB);
  eq("C2 twinOf: a done move links nothing", twinOf.has("tw-movedone"), false);
  const two = E.deskHolds([I("x", "X", D)], [M("m-a", "A", D, 3, "x"), M("m-b", "B", D, 4, "x")]);
  eq("C2 twinOf: the first move in stage order wins", two.twinOf.get("x").id, "m-a");
  const noCol = E.deskHolds(items, moveRows().map(({ desk_item_id, ...m }) => m));
  eq("C2 twinOf: no column, no twins", noCol.twinOf.size, 0);
  eq("B2 itemCard of a child due today: why is the parent", E.itemCard(I("c", "Jumper cables", D, "car-kit"), { title: "The house" }, D, { id: "car-kit", text: "Car kit" }).why, "Car kit");
  eq("B2 itemCard of a child: parent set", E.itemCard(I("c", "Jumper cables", D, "car-kit"), { title: "The house" }, D, { id: "car-kit", text: "Car kit" }).parent, { id: "car-kit", title: "Car kit" });
  eq("B2 itemCard of an overdue child: parent then days past", E.itemCard(I("c", "Jumper cables", "2026-09-12", "car-kit"), { title: "The house" }, D, { id: "car-kit", text: "Car kit" }).why, "Car kit · 2 days past");
  eq("B2 itemCard with no parent: today's why, parent null", [E.itemCard(I("o", "Return the drill", "2026-09-13", "done-parent"), { title: "The house" }, D).why, E.itemCard(I("o", "Return the drill", "2026-09-13"), { title: "The house" }, D).parent], ["1 day past · The house", null]);
  eq("C2 moveCard twin", E.moveCard(moveRows()[0], { title: "Move out" }, D, itemById).twin, { item_id: TWIN, text: "Set up the staging area", open: true });
  eq("C2 moveCard unlinked: twin null", E.moveCard(moveRows()[4], null, D, itemById).twin, null);
  eq("C2 moveCard twin not among open items (a done desk item): text null, open false", E.moveCard(M("mv-x", "X", D, 9, "done-parent"), null, D, itemById).twin, { item_id: "done-parent", text: null, open: false });
}

// ================= op morning on the mock: every rule together =================
async function morning(opts = {}) {
  const { handler } = await fresh();
  const db = mockDb(opts.tables || tablesFor(), opts.db || {});
  globalThis.__sb = db; linearCalls = [];
  const r = await call(handler, { op: "morning", date: D, now_min: 600 });
  return { r, db, d: r.json, calls: linearCalls.slice() };
}
const idsIn = (d) => ({ sitting: d.sitting.map((c) => c.id).sort(), behind: d.behind.flatMap((g) => g.cards.map((c) => c.id)).sort(), later: d.later.flatMap((x) => x.cards.map((c) => c.id)).sort() });
const find = (d, id) => d.sitting.concat(d.behind.flatMap((g) => g.cards), d.later.flatMap((x) => x.cards)).find((c) => c.id === id);
{
  const { r, db, d, calls } = await morning();
  eq("morning: 200", r.status, 200);
  eq("A3 engine and place_rule", [d.engine, d.place_rule], ["one-today v15", "actions-only"]);
  eq("A1 pagination: two Linear pages, the second after cursor-1", calls.map((v) => v.after ?? null), [null, "cursor-1"]);
  eq("C2 links_ready true with the column", d.links_ready, true);
  eq("morning writes nothing", db.writes, []);
  const got = idsIn(d);
  eq("A2/B/C sitting: actions only", got.sitting, ["item:car-child", "item:gc", "item:solo", "linear:lin-902", "linear:lin-903", "move:mv-plain"]);
  eq("A2/B/C behind", got.behind, ["item:orphan", "item:people-1", "item:tw-movedone", "linear:lin-716", "linear:lin-901", "move:" + FAB]);
  eq("A2/C later", got.later, ["linear:lin-904", "move:mv-kitchen"]);
  eq("F1 Urgent alone places nothing: JER-17 and JER-5 are not cards", [find(d, "linear:lin-17"), find(d, "linear:lin-5")], [undefined, undefined]);
  eq("A2 a child of an open parent: why", find(d, "linear:lin-901").why, "The launch list · 4 days past");
  eq("A2 a child dated today: why", find(d, "linear:lin-903").why, "P");
  eq("A2 a child of a done parent: plain why", find(d, "linear:lin-904").why, "Wealth Stack · Todo · high");
  eq("B2 Car kit child: why and parent", [find(d, "item:car-child").why, find(d, "item:car-child").parent], ["Car kit", { id: "car-kit", title: "Car kit" }]);
  eq("B2 grandchild: why is its direct parent", find(d, "item:gc").why, "Shelves");
  eq("B2 child of a done parent: plain card", [find(d, "item:orphan").why, find(d, "item:orphan").parent], ["1 day past · The house: move out", null]);
  eq("C2 the move carries its twin", find(d, "move:" + FAB).twin, { item_id: TWIN, text: "Set up the staging area", open: true });
  eq("C2 a move with no link: twin null", find(d, "move:mv-plain").twin, null);
  eq("A3 undated.linear_urgent", d.undated.linear_urgent, [
    { id: "lin-17", key: "JER-17", title: "Urgent with no day", url: null, due: null, priority: 1, state: "Todo", reason: "undated_urgent", open_children: 0, pillar: "life", track: "building", placed_by: "none" },
    { id: "lin-5", key: "JER-5", title: "Another urgent, no day", url: null, due: null, priority: 1, state: "Backlog", reason: "undated_urgent", open_children: 0, pillar: "life", track: "building", placed_by: "none" }]);
  eq("A3 undated.linear_list reasons (Duplicate out)", d.undated.linear_list.map((x) => x.key + ":" + x.reason), ["JER-17:undated_urgent", "JER-5:undated_urgent", "JER-23:goal", "JER-36:parked", "JER-361:parent", "JER-9:undated"]);
  eq("A3 JER-361 lists its 8 open children", d.undated.linear_list.find((x) => x.key === "JER-361").open_children, 8);
  eq("A3 undated.linear counts every undated off row, Urgent in, Duplicate out", d.undated.linear, 6);
  eq("A3 held.linear: the dated goal and the dated parent", d.held.linear.map((x) => x.key + ":" + x.reason + ":" + x.due), ["JER-900:goal:2026-09-20", "JER-905:parent:2026-09-12"]);
  eq("B1/C2 held.items", d.held.items.map((x) => [x.id, x.reason, x.due, x.open_children, x.move_id, x.move_day]), [
    [P389, "parent", "2026-09-07", 6, null, null],
    ["car-kit", "parent", "2026-09-18", 1, null, null],
    ["mid", "parent", "2026-09-15", 1, null, null],
    [TWIN, "twin", "2026-09-12", 0, FAB, "2026-09-12"],
    ["ptwin", "parent", "2026-09-11", 1, "mv-kitchen", "2026-09-16"]]);
  eq("B1 held item row shape (v13 adds pillar, track, placed_by)", d.held.items[0], { id: P389, card_id: "item:" + P389, title: "The keep-with-me list", box: "The house: move out", door: "house", due: "2026-09-07", reason: "parent", open_children: 6, move_id: null, move_day: null, pillar: "life", track: "house", placed_by: "rule" });
  eq("B4 389abbe8 and its children are not cards", [find(d, "item:" + P389), find(d, "item:k389-0")], [undefined, undefined]);
  eq("B5 067434dd (undated, 2 children): not held", d.held.items.some((x) => x.id === P067), false);
  eq("B3 undated.items counts children: 6 + 3 + gp + utilities + ptwin-kid", d.undated.items, 12);
  eq("B3 undated.boxes", d.undated.boxes.map((b) => b.title + ":" + b.count), ["The house: move out:12"]);
  eq("B3 undated.parents", d.undated.parents.map((p) => [p.id, p.due, p.open_children, p.undated_children]), [[P389, "2026-09-07", 6, 6], [P067, null, 2, 2], ["car-kit", "2026-09-18", 1, 0], ["gp", null, 1, 0], ["mid", "2026-09-15", 1, 0], ["ptwin", "2026-09-11", 1, 1]]);
  eq("C2 an undated twin stays in undated.items, not held", d.held.items.some((x) => x.id === "tw-undated"), false);
  eq("A3 held.total, held.doors", [d.held.total, d.held.doors], [7, { wayofdad: 0, fortify: 0, maddy: 0, walks: 0, house: 7 }]);
  eq("A3 counts.held", d.counts.held, 7);
  const house = d.doors.find((x) => x.id === "house");
  eq("A3 house door held", house.held, 7);
  eq("A3 house door undated = items + moves + linear", house.undated, 12 + 0 + 6);
  eq("A3 house numbers", house.numbers, [{ label: "rulings owed", value: 0 }, { label: "with no day", value: 18 }, { label: "Urgent, no day", value: 2 }, { label: "off the day", value: 7 }]);
  eq("A3 other doors carry held 0", d.doors.filter((x) => x.id !== "house").map((x) => x.held), [0, 0, 0, 0]);
  eq("A3 undated.total", d.undated.total, 18);
}
{
  // no Urgent and nothing held: the two numbers stay off, held is zero everywhere
  linearEmpty = true;
  const { d } = await morning({ tables: Object.assign(tablesFor(), { desk_items: [I("solo", "Solo task", D)], project_moves: [] }) });
  linearEmpty = false;
  const house = d.doors.find((x) => x.id === "house");
  eq("A3 house numbers without Urgent or held: as v11", house.numbers.map((n) => n.label), ["rulings owed", "with no day"]);
  eq("A3 nothing held: zeros and empty lists", [d.held.total, d.counts.held, house.held, d.held.items, d.held.linear, d.undated.linear_urgent, d.undated.linear_list, d.undated.parents], [0, 0, 0, [], [], [], [], []]);
}
{
  // C2 the column is missing (before actions_only_01): the old select, links_ready false, no twins, the same moves
  const { r, d, db } = await morning({ db: { schema: { project_moves: ["id", "project_id", "user_id", "title", "why", "stage", "target_ymd", "status", "created_at"] } } });
  eq("C2 no column: 200", r.status, 200);
  eq("C2 no column: links_ready false", d.links_ready, false);
  eq("C2 no column: every open move still a card", idsIn(d).behind.includes("move:" + FAB) && idsIn(d).later.includes("move:mv-kitchen") && idsIn(d).sitting.includes("move:mv-plain"), true);
  eq("C2 no column: no move has a twin", [find(d, "move:" + FAB).twin, find(d, "move:mv-kitchen").twin], [null, null]);
  eq("C2 no column: the desk twin is a plain card again", !!find(d, "item:" + TWIN), true);
  eq("C2 no column: held has no twin rows", d.held.items.map((x) => x.id + ":" + x.reason + ":" + x.move_id), [P389 + ":parent:null", "car-kit:parent:null", "mid:parent:null", "ptwin:parent:null"]);
  eq("C2 no column: nothing written", db.writes, []);
}

// ================= C. op tap on a move: Done and undo close and reopen both =================
async function tap(body, setup = (t) => t, dbOpts = {}) {
  const { handler } = await fresh();
  const tables = setup(tablesFor());
  const db = mockDb(tables, dbOpts);
  globalThis.__sb = db; linearCalls = [];
  // the fixture is dated D, so the tap is too: without it today's real date leaks into "reopens on today" and "days past"
  const r = await call(handler, Object.assign({ op: "tap", date: D }, body));
  return { r, db, tables, calls: linearCalls.slice() };
}
const deskWrites = (db) => db.writes.filter((w) => w.table === "desk_items");
const moveWrites = (db) => db.writes.filter((w) => w.table === "project_moves");
{
  const { r, db, tables } = await tap({ card_id: "move:" + FAB, action: "done" });
  eq("C2 done: 200 ok", [r.status, r.json.ok], [200, true]);
  eq("C2 done: the move is done", [moveWrites(db).map((w) => w.payload.status), r.json.card.status], [["done"], "done"]);
  eq("C2 done: the desk twin is closed", deskWrites(db).map((w) => [w.ids, w.payload.done, typeof w.payload.done_at, typeof w.payload.updated_at]), [[[TWIN], true, "string", "string"]]);
  eq("C2 done: the table row", (({ done }) => ({ done }))(tables.desk_items.find((x) => x.id === TWIN)), { done: true });
  eq("C2 done: twin_card and touched", [r.json.twin_card?.id, r.json.twin_card?.status, r.json.touched], ["item:" + TWIN, "done", ["move:" + FAB, "item:" + TWIN]]);
  eq("C2 done: the card's twin says closed", r.json.card.twin, { item_id: TWIN, text: "Set up the staging area", open: false });
}
for (const action of ["undo", "reopen"]) {
  const { r, db, tables } = await tap({ card_id: "move:" + FAB, action }, (t) => { t.project_moves[0].status = "done"; t.desk_items.find((x) => x.id === TWIN).done = true; t.desk_items.find((x) => x.id === TWIN).done_at = "2026-09-14T01:00:00Z"; return t; });
  eq(`C2 ${action}: the move reopens`, [r.status, moveWrites(db).map((w) => w.payload.status)], [200, ["open"]]);
  eq(`C2 ${action}: the desk twin reopens`, deskWrites(db).map((w) => [w.ids, w.payload.done, w.payload.done_at]), [[[TWIN], false, null]]);
  eq(`C2 ${action}: twin_card open, touched both`, [r.json.twin_card?.status, r.json.touched], ["open", ["move:" + FAB, "item:" + TWIN]]);
  eq(`C2 ${action}: the table row`, tables.desk_items.find((x) => x.id === TWIN).done, false);
}
{
  // undo reopens the twin even when he had closed the desk item himself in Work
  const { db } = await tap({ card_id: "move:" + FAB, action: "undo" }, (t) => { t.project_moves[0].status = "done"; t.desk_items.find((x) => x.id === TWIN).done = true; return t; });
  eq("C2 undo reopens a desk item closed in Work", deskWrites(db).map((w) => w.payload.done), [false]);
}
// undo and reopen take back a Done and nothing else: after Tomorrow or Skip the move was never done, so the Undo
// moves only the move, even when he had closed the desk item himself in Work
const CLOSED_AT = "2026-09-13T20:00:00Z";
const closedInWork = (t) => { const x = t.desk_items.find((i) => i.id === TWIN); x.done = true; x.done_at = CLOSED_AT; return t; };
for (const [was, action] of [["hold", "undo"], ["hold", "reopen"], ["skip", "undo"]]) {
  const { r, db, tables } = await tap({ card_id: "move:" + FAB, action }, (t) => { t.project_moves[0].target_ymd = "2026-09-15"; return closedInWork(t); });
  eq(`C2 ${was} then ${action} on a linked move: no desk_items row written`, [r.status, deskWrites(db).length, r.json.twin_card, r.json.twin_skipped ?? null, r.json.touched], [200, 0, null, null, ["move:" + FAB]]);
  eq(`C2 ${was} then ${action}: the move reopens on today`, moveWrites(db).map((w) => [w.payload.status, w.payload.target_ymd]), [["open", D]]);
  eq(`C2 ${was} then ${action}: the desk item he closed stays closed with his done_at`, (({ done, done_at }) => ({ done, done_at }))(tables.desk_items.find((x) => x.id === TWIN)), { done: true, done_at: CLOSED_AT });
  eq(`C2 ${was} then ${action}: the card's twin says closed`, r.json.card.twin, { item_id: TWIN, text: "Set up the staging area", open: false });
}
{
  const { r, db } = await tap({ card_id: "move:" + FAB, action: "undo" }, (t) => { t.project_moves[0].target_ymd = "2026-09-15"; return t; });
  eq("C2 hold then undo with the desk item open: no desk_items row written", [r.status, deskWrites(db).length, r.json.twin_card, r.json.touched], [200, 0, null, ["move:" + FAB]]);
}
{
  // Done on a move whose desk item he already closed: nothing written to the desk item, his done_at stays
  const { r, db, tables } = await tap({ card_id: "move:" + FAB, action: "done" }, closedInWork);
  eq("C2 Done on a twin already closed: no desk_items row written", [r.status, deskWrites(db).length, r.json.twin_card, r.json.twin_skipped, r.json.touched], [200, 0, null, "already done", ["move:" + FAB]]);
  eq("C2 Done on a twin already closed: the move is done", [moveWrites(db).map((w) => w.payload.status), r.json.card.status], [["done"], "done"]);
  eq("C2 Done on a twin already closed: done_at unchanged", tables.desk_items.find((x) => x.id === TWIN).done_at, CLOSED_AT);
}
{
  // undo of a Done whose desk item is already open (he reopened it in Work): nothing written to the desk item
  const { r, db } = await tap({ card_id: "move:" + FAB, action: "undo" }, (t) => { t.project_moves[0].status = "done"; return t; });
  eq("C2 undo of a Done with the twin already open: no desk_items row written", [r.status, deskWrites(db).length, r.json.twin_card, r.json.twin_skipped, moveWrites(db).map((w) => w.payload.status)], [200, 0, null, "already open", ["open"]]);
}
{
  // the whole round on one store: Done closes both, Undo reopens both, then Tomorrow and Undo leave the desk item alone
  const { handler } = await fresh();
  const tables = tablesFor();
  const db = mockDb(tables); globalThis.__sb = db; linearCalls = [];
  const twinRow = () => (({ done, done_at }) => ({ done, done_at }))(tables.desk_items.find((x) => x.id === TWIN));
  const a = await call(handler, { op: "tap", card_id: "move:" + FAB, action: "done" });
  eq("C2 round: Done closes both", [a.status, tables.project_moves[0].status, twinRow().done, a.json.touched], [200, "done", true, ["move:" + FAB, "item:" + TWIN]]);
  const b = await call(handler, { op: "tap", card_id: "move:" + FAB, action: "undo" });
  eq("C2 round: Undo of that Done reopens both", [b.status, tables.project_moves[0].status, twinRow(), b.json.touched], [200, "open", { done: false, done_at: null }, ["move:" + FAB, "item:" + TWIN]]);
  tables.desk_items.find((x) => x.id === TWIN).done = true; tables.desk_items.find((x) => x.id === TWIN).done_at = CLOSED_AT;
  const n = deskWrites(db).length;
  const c = await call(handler, { op: "tap", card_id: "move:" + FAB, action: "hold" });
  const u = await call(handler, { op: "tap", card_id: "move:" + FAB, action: "undo" });
  eq("C2 round: he closes the desk item in Work, then Tomorrow and Undo on the move write no desk_items row", [c.status, u.status, deskWrites(db).length - n, twinRow(), tables.project_moves[0].status], [200, 200, 0, { done: true, done_at: CLOSED_AT }, "open"]);
}
for (const action of ["hold", "skip"]) {
  const { r, db } = await tap({ card_id: "move:" + FAB, action });
  eq(`C2 ${action}: no cascade`, [r.status, deskWrites(db).length, r.json.twin_card, r.json.touched], [200, 0, null, ["move:" + FAB]]);
}
{
  const { r, db } = await tap({ card_id: "move:mv-kitchen", action: "done" });
  eq("C2 a parent twin (open children): no cascade, twin_skipped", [r.status, deskWrites(db).length, r.json.twin_card, r.json.twin_skipped, r.json.card.status], [200, 0, null, "open children", "done"]);
}
{
  const { r, db } = await tap({ card_id: "move:" + FAB, action: "done" }, (t) => { t.project_moves = t.project_moves.map(({ desk_item_id, ...m }) => m); return t; });
  eq("C2 missing column: no cascade", [r.status, deskWrites(db).length, r.json.twin_card ?? null, r.json.card.status, r.json.card.twin], [200, 0, null, "done", null]);
}
{
  const { r } = await tap({ card_id: "move:" + FAB, action: "done" }, (t) => t, { fail: { "desk_items:update": "permission denied for desk_items" } });
  eq("C2 the desk write fails: 500 with the message and the move card", [r.status, /desk twin/.test(r.json.error) && /permission denied/.test(r.json.error), r.json.card?.id, r.json.card?.status], [500, true, "move:" + FAB, "done"]);
}
{
  const { r, db } = await tap({ card_id: "item:" + TWIN, action: "done" });
  eq("C2 Done on the desk twin never closes the move", [r.status, r.json.card.status, moveWrites(db).length, deskWrites(db).length], [200, "done", 0, 1]);
}
{
  const { r } = await tap({ card_id: "item:car-child", action: "done" });
  eq("B2 a tapped child keeps its parent's why", [r.status, r.json.card.why, r.json.card.parent], [200, "Car kit", { id: "car-kit", title: "Car kit" }]);
}
{
  const { r } = await tap({ card_id: "item:orphan", action: "hold" });
  eq("B2 a tapped child of a done parent: plain why", [r.status, r.json.card.parent, r.json.card.status], [200, null, "held"]);
}

// ================= G. v15, the groups op (RULINGS 2026-10-06, yes as drawn): today's posts as groups in his account order =================
// The fixture is Tue 10-06's real shape as the hub carried it at 3:50pm PT: 24 rows across the three pillars (four Way of Dad
// with three published, twelve Fortify, eight Maddy with three texts under one piece title), plus one open row from the day
// before. step_order and photos_album as homebase wrote them (the Reddit row stripped of both, the brief's row with no clock).
const D2 = "2026-10-06";
const USER_ID = "5c048e07-15b3-4a44-98e7-33cde24017ac";
const FK = "docs/marketing/staged/fortify-post-and-go-2026-10", MK = "docs/marketing/staged/maddy-post-and-go-2026-10", WK = "docs/marketing/staged/wayofdad-open-2026-09";
const PUB_AT = "2026-10-06T15:43:52.872+00:00";
const PUB = { status: "published", published_at: PUB_AT };
const API = "http://mock.local/functions/v1/morning-api";
const fileDoor = (p) => API + "?op=photo&path=" + encodeURIComponent(p);
const R = (id, pillar, campaign, title, platform, meta, extra = {}) => Object.assign({ id, user_id: USER_ID, title, platform, format: "post", status: "draft", scheduled_for: D2, published_at: null, url: null, campaign, pillar, track: "posting", parent_post_id: null, is_canonical: true, excerpt: "Paste text for " + title + ".", updated_at: D2 + "T00:00:00Z", metadata: meta }, extra);
const ACCT = { linkedin: "LinkedIn: his own profile, Jeremy Runge (linkedin.com/in/jeremyrunge)", instagram: "Instagram: his own account (never @mymaddyapp, never @way.of.dad)", youtube: "YouTube: @jeremyarunge" };
const slotOf = (t, carried) => "Tue 10-06, " + t + " PT" + (carried ? " (carried from Mon 10-05)" : "");
const F = (id, title, platform, so, time, piece, album, image, txt, carried = false) => R(id, "fortify", "fortify-post-and-go-2026-10", title, platform, { account: ACCT[platform], slot: slotOf(time, carried), step_order: so, photos_album: album, image, vault_path: FK + "/" + txt, alt: "1: Card 1 of N. Dark card.", send_note: "How to post " + title + ".", piece_title: piece, why: "Why " + title + "." });
const pngs = (stem, n, dir = "assets/cards") => Array.from({ length: n }, (_, i) => `${dir}/${stem}-0${i + 1}.png`).join(", ");
const MACC = { instagram: "@mymaddyapp (Instagram)", facebook: "@mymaddyapp Facebook Page", tiktok: "@mymaddyapp (TikTok)", threads: "@mymaddyapp (Threads)" };
const CAR = Array.from({ length: 8 }, (_, i) => `assets/carousel/whats-new-0${i + 1}-x.png`);
const Mc = (id, platform, so, time) => R(id, "maddy", "maddy-post-and-go-2026-10", "Maddy 1.1 carousel, " + platform, platform, { account: MACC[platform], slot: slotOf(time, true), step_order: so, photos_album: "Cards/Maddy/1.1 carousel", image: platform === "threads" ? CAR : CAR.join(", "), vault_path: MK + "/01-whats-new-carousel-" + platform + ".txt", alt: "1. Three iPhone screens.", send_note: "Carousel, the eight in order.", piece_title: "What's new in Maddy 1.1: the carousel" });
const Mt = (id, who, so) => R(id, "maddy", "maddy-post-and-go-2026-10", "Text to " + who, "other", { account: "his phone (or the channel he already uses with them)", slot: slotOf("9:30am"), step_order: so, vault_path: MK + "/05-texts-ro-michele-emma-" + who.toLowerCase() + ".txt", send_note: "Paste into your thread with " + who + " and send.", piece_title: "Three texts to the people whose asks shipped" });
function postingRows() {
  return [
    R("w-x", "wayofdad", "wayofdad-open-2026-09", "Half Dome and the boots (x)", "x", { account: "X @wayofdad", slot: "Tue 2026-10-06, 7:30am Pacific, same sitting as the Instagram reel", step_order: 1, frame: "56-halfdome-cables-arms-wide.jpg", alt: "A man on the Half Dome cables.", vault_path: WK + "/daily-2026-10-06-half-dome-boots.x.txt", piece_title: "Half Dome and the boots", send_note: "One photo from iCloud." }, PUB),
    R("w-bsky", "wayofdad", "wayofdad-open-2026-09", "Half Dome and the boots (bluesky)", "bluesky", { account: "Bluesky @wayofdad.co", slot: "Tue 2026-10-06, 7:30am Pacific, same sitting as the Instagram reel", step_order: 2, frame: "56-halfdome-cables-arms-wide.jpg", alt: "A man on the Half Dome cables.", vault_path: WK + "/daily-2026-10-06-half-dome-boots.x.txt", piece_title: "Half Dome and the boots" }, PUB),
    R("w-ig", "wayofdad", "wayofdad-open-2026-09", "Half Dome and the boots (instagram feed)", "instagram", { account: "Instagram @way.of.dad", slot: "Tue 2026-10-06, 9:00am Pacific, the same sitting as X and Bluesky", step_order: 4, frame: "56-halfdome-cables-arms-wide.jpg", alt: "A man on the Half Dome cables.", vault_path: WK + "/daily-2026-10-06-half-dome-boots.ig.txt", piece_title: "Half Dome and the boots" }, PUB),
    R("w-reel", "wayofdad", "wayofdad-open-2026-09", "Reel: Nothing about you is broken (instagram)", "instagram", { account: "Instagram @way.of.dad", slot: "Tue 2026-10-06, 7:30am Pacific", step_order: 3, frame: "47-cypress-log-hands.jpg", alt: "A Reel of three stills.", vault_path: WK + "/reel-2.ig.txt", piece_title: "Reel: Nothing about you is broken", plan_page: "docs/strategy/wayofdad-plan.html", send_note: "Instagram, plus, Reel." }),
    F("f-iw-li", "2 of 10, the inner weather: LinkedIn carousel", "linkedin", 1, "8:30am", "Fortify 2 of 10: the inner weather (carousel)", "Cards/Fortify/02 The inner weather", "assets/cards/02-the-inner-weather-linkedin.pdf", "02-the-inner-weather.post.txt"),
    F("f-iw-ig", "2 of 10, the inner weather: Instagram carousel", "instagram", 2, "8:35am", "Fortify 2 of 10: the inner weather (carousel)", "Cards/Fortify/02 The inner weather", pngs("02-the-inner-weather", 5), "02-the-inner-weather.post.txt"),
    F("f-map-li", "The map: LinkedIn", "linkedin", 3, "9:00am", "Fortify: the map (ten parts, one image)", "Cards/Fortify/00 The map", "assets/map/00-the-map.png", "00-the-map.post.txt", true),
    F("f-map-ig", "The map: Instagram", "instagram", 4, "9:05am", "Fortify: the map (ten parts, one image)", "Cards/Fortify/00 The map", "assets/map/00-the-map.png", "00-the-map.post.txt", true),
    F("f-body-li", "1 of 10, the body: LinkedIn carousel", "linkedin", 5, "10:00am", "Fortify 1 of 10: the body (carousel)", "Cards/Fortify/01 The body", "assets/cards/01-the-body-linkedin.pdf", "01-the-body.post.txt", true),
    F("f-body-ig", "1 of 10, the body: Instagram carousel", "instagram", 6, "10:05am", "Fortify 1 of 10: the body (carousel)", "Cards/Fortify/01 The body", pngs("01-the-body", 6), "01-the-body.post.txt", true),
    F("f-des-li", "Desire cards: LinkedIn carousel", "linkedin", 7, "12:00pm", "Fortify desire cards (five, built 09-17)", "Cards/Fortify/Desire cards", "assets/desire/desire-fortify-linkedin.pdf", "11-desire-cards.post.txt"),
    F("f-des-ig", "Desire cards: Instagram carousel", "instagram", 8, "12:05pm", "Fortify desire cards (five, built 09-17)", "Cards/Fortify/Desire cards", pngs("rtf", 5, "assets/desire"), "11-desire-cards.post.txt"),
    F("f-body-reel", "1 of 10, the body: Instagram Reel", "instagram", 9, "5:30pm", "Fortify 1 of 10: the body (silent reel)", "Reels/Fortify", "assets/reels/01-the-body-reel.mp4", "01-the-body.reel.txt", true),
    F("f-body-yt", "1 of 10, the body: YouTube Short", "youtube", 10, "5:35pm", "Fortify 1 of 10: the body (silent reel)", "Reels/Fortify", "assets/reels/01-the-body-reel.mp4", "01-the-body.youtube.txt", true),
    F("f-iw-reel", "2 of 10, the inner weather: Instagram Reel", "instagram", 11, "6:30pm", "Fortify 2 of 10: the inner weather (silent reel)", "Reels/Fortify", "assets/reels/02-the-inner-weather-reel.mp4", "02-the-inner-weather.reel.txt"),
    F("f-iw-yt", "2 of 10, the inner weather: YouTube Short", "youtube", 12, "6:35pm", "Fortify 2 of 10: the inner weather (silent reel)", "Reels/Fortify", "assets/reels/02-the-inner-weather-reel.mp4", "02-the-inner-weather.youtube.txt"),
    Mc("m-ig", "instagram", 2, "9:10am"), Mc("m-fb", "facebook", 3, "9:15am"), Mc("m-tt", "tiktok", 4, "9:20am"), Mc("m-th", "threads", 5, "9:25am"),
    Mt("m-emma", "Emma", 6), Mt("m-michele", "Michele", 7), Mt("m-ro", "Ro", 8),
    R("m-reddit", "maddy", "maddy-post-and-go-2026-10", "Update from Maddy's dad: 1.1 is out, and your reminders are finally yours to set", "reddit", { account: "his own Reddit account", vault_path: MK + "/03-reddit-audhd-update.txt", send_note: "Create post, Text. First line is the title.", piece_title: "Maddy 1.1 update in r/AuDHD" }),
    // yesterday's open row: the morning op's behind, listed by the groups op and never grouped
    R("m-bday", "maddy", "maddy-birthday-2026-08", "Send: Maddy's birthday: the personal text", "other", { account: "his phone", slot: "Mon 10-05, 9:00am PT", send_note: "Send it." }, { scheduled_for: "2026-10-05" }),
  ];
}
async function groups(body = {}, tables) {
  const { handler } = await fresh();
  const db = mockDb(tables || Object.assign(tablesFor(), { content_calendar: postingRows() }));
  globalThis.__sb = db;
  const r = await call(handler, Object.assign({ op: "groups", date: D2, now_min: 600 }, body));
  return { r, d: r.json, db };
}
const ids = (g) => g.steps.map((s) => s.row_id);
{
  const { r, d, db } = await groups();
  eq("G 200, the engine names itself v15", [r.status, d.engine, d.order_rule], [200, "one-today v15", "account-order; step_order, then the clock, then the platform"]);
  eq("G the op writes nothing", db.writes, []);
  eq("G his account order: The Way of Dad, Fortify, Maddy", d.groups.map((g) => [g.order, g.key, g.name]), [[1, "wayofdad", "The Way of Dad"], [2, "fortify", "Fortify"], [3, "maddy", "Maddy"]]);
  eq("G one step per platform row: 4, 12, 8", d.groups.map((g) => g.steps.length), [4, 12, 8]);
  eq("G counts over the day", d.counts, { groups: 3, total: 24, done: 3, open: 21, held: 0, skipped: 0 });
  eq("G numbers run 1 to N in every group", d.groups.map((g) => g.steps.map((s) => s.n)), [[1, 2, 3, 4], Array.from({ length: 12 }, (_, i) => i + 1), Array.from({ length: 8 }, (_, i) => i + 1)]);
  const wod = d.groups[0];
  eq("G a group reads 3 of 4", [wod.count, wod.all_done, wod.first_open], [{ total: 4, done: 3, open: 1, held: 0, skipped: 0 }, false, "post:w-reel"]);
  eq("G posted rows come back done with their published_at", wod.steps.filter((s) => s.status === "done").map((s) => [s.n, s.row_id, s.done_at]), [[1, "w-x", PUB_AT], [2, "w-bsky", PUB_AT], [4, "w-ig", PUB_AT]]);
  eq("G step_order leads, as the hub gives it (the reel 3, the feed post 4)", wod.steps.map((s) => s.n + ":" + s.row_id + ":" + s.ordered_by), ["1:w-x:step_order", "2:w-bsky:step_order", "3:w-reel:step_order", "4:w-ig:step_order"]);
  eq("G what: a (x) suffix reads ', on X'", wod.steps.map((s) => s.what), ["Half Dome and the boots, on X", "Half Dome and the boots, on Bluesky", "Reel: Nothing about you is broken, on Instagram", "Half Dome and the boots, on the Instagram feed"]);
  eq("G accounts, distinct, in step order", wod.accounts, ["X @wayofdad", "Bluesky @wayofdad.co", "Instagram @way.of.dad"]);
  eq("G an iCloud frame is named, no files, no bytes", [wod.steps[0].frame, wod.steps[0].files, wod.steps[0].photo, wod.steps[0].photos_album], ["56-halfdome-cables-arms-wide.jpg", [], { path: "56-halfdome-cables-arms-wide.jpg", alt: "A man on the Half Dome cables.", url: null }, null]);
  const tapX = { card_id: "content:w-x", post_id: "w-x", action: "posted", label: "Posted" }, undoX = { card_id: "content:w-x", post_id: "w-x", action: "undo", label: "Undo" };
  eq("G a done step carries its tap and its undo; taps is the undo", [wod.steps[0].tap, wod.steps[0].undo, wod.steps[0].taps, wod.steps[0].card_id, wod.steps[0].post_id], [tapX, undoX, [undoX], "content:w-x", "w-x"]);
  const tapReel = { card_id: "content:w-reel", post_id: "w-reel", action: "posted", label: "Posted" };
  eq("G an open step: the tap, then Hold and Skip, each naming the row", wod.steps[2].taps, [tapReel, { action: "hold", label: "Hold", post_id: "w-reel" }, { action: "skip", label: "Skip", post_id: "w-reel" }]);
  eq("G done_all is the open steps' taps, in order", wod.done_all, [{ card_id: "content:w-reel", post_id: "w-reel", action: "posted" }]);
  eq("G the plan page link rides on the step", wod.steps[2].links, [{ label: "The file", href: "https://github.com/jerrunge/jr-os-docs/blob/main/" + WK + "/reel-2.ig.txt" }, { label: "The plan page", href: "https://github.com/jerrunge/jr-os-docs/blob/main/docs/strategy/wayofdad-plan.html" }]);
  eq("G next_step_id is the first open step in his order; next_by_clock_id the clock rule at 10:00am", [d.next_step_id, d.next_by_clock_id], ["post:w-reel", "post:f-body-li"]);
  const f = d.groups[1];
  eq("G Fortify in step_order", ids(f), ["f-iw-li", "f-iw-ig", "f-map-li", "f-map-ig", "f-body-li", "f-body-ig", "f-des-li", "f-des-ig", "f-body-reel", "f-body-yt", "f-iw-reel", "f-iw-yt"]);
  const pdf = FK + "/assets/cards/02-the-inner-weather-linkedin.pdf";
  const onGitHub = (p) => "https://github.com/jerrunge/jr-os-docs/blob/main/" + p;
  eq("G a kit PDF resolves against the kit folder; its url is the vault page a browser can open", f.steps[0].files, [{ path: pdf, name: "02-the-inner-weather-linkedin.pdf", kind: "pdf", url: onGitHub(pdf) }]);
  eq("G a comma-joined image string splits into files, each with a url", f.steps[1].files.map((x) => [x.kind, x.name, x.url === fileDoor(x.path)]), [1, 2, 3, 4, 5].map((i) => ["image", "02-the-inner-weather-0" + i + ".png", true]));
  eq("G photo is the first image, with the alt", f.steps[1].photo, { path: FK + "/assets/cards/02-the-inner-weather-01.png", alt: "1: Card 1 of N. Dark card.", url: fileDoor(FK + "/assets/cards/02-the-inner-weather-01.png") });
  eq("G a video: kind video, its url the vault page (his word 2026-10-07), the album beside it, photo null", [f.steps[8].files, f.steps[8].photos_album, f.steps[8].photo], [[{ path: FK + "/assets/reels/01-the-body-reel.mp4", name: "01-the-body-reel.mp4", kind: "video", url: onGitHub(FK + "/assets/reels/01-the-body-reel.mp4") }], "Reels/Fortify", null]);
  eq("G albums, distinct, in step order", f.albums, ["Cards/Fortify/02 The inner weather", "Cards/Fortify/00 The map", "Cards/Fortify/01 The body", "Cards/Fortify/Desire cards", "Reels/Fortify"]);
  eq("G the excerpt leads on every step: no hub, no vault read", [...new Set(d.groups.flatMap((g) => g.steps.map((s) => s.text.source)))], ["excerpt"]);
  eq("G text body, path and label", [f.steps[0].text, f.steps[1].text.label, f.steps[9].text.label], [{ body: "Paste text for 2 of 10, the inner weather: LinkedIn carousel.", source: "excerpt", path: FK + "/02-the-inner-weather.post.txt", label: "Text" }, "Caption", "Description"]);
  eq("G the clock, block, due and until on a step", [f.steps[0].time, f.steps[0].block, f.steps[0].due_min, f.steps[0].until_min, f.steps[6].time, f.steps[6].block], ["8:30am", "Wake", 510, 525, "12:00pm", "Midday"]);
  eq("G account, how, why, alt, piece, piece_key, pillar, track", [f.steps[0].account, f.steps[0].how, f.steps[0].why, f.steps[0].alt, f.steps[0].piece, f.steps[0].piece_key, f.steps[0].pillar, f.steps[0].track, f.steps[0].campaign], [ACCT.linkedin, "How to post 2 of 10, the inner weather: LinkedIn carousel.", "Why 2 of 10, the inner weather: LinkedIn carousel.", "1: Card 1 of N. Dark card.", "Fortify 2 of 10: the inner weather (carousel)", D2 + "|fortify 2 of 10: the inner weather (carousel)", "fortify", "posting", "fortify-post-and-go-2026-10"]);
  const m = d.groups[2];
  eq("G Maddy in step_order, the unordered row last", ids(m), ["m-ig", "m-fb", "m-tt", "m-th", "m-emma", "m-michele", "m-ro", "m-reddit"]);
  eq("G three texts under one piece title stay three steps", m.steps.filter((s) => s.piece === "Three texts to the people whose asks shipped").map((s) => s.n + ":" + s.what), ["5:Text to Emma", "6:Text to Michele", "7:Text to Ro"]);
  eq("G a text's tap is Sent", m.steps[4].tap, { card_id: "content:m-emma", post_id: "m-emma", action: "sent", label: "Sent" });
  eq("G a row with no clock and no step_order: time null, Any time, placed by the platform, last", [m.steps[7].row_id, m.steps[7].time, m.steps[7].due_min, m.steps[7].until_min, m.steps[7].block, m.steps[7].ordered_by, m.steps[7].step_order], ["m-reddit", null, null, null, "Any time", "platform", null]);
  eq("G an image list is taken as a list", [m.steps[3].files.length, m.steps[3].files[7].name, m.steps[0].files.length], [8, "whats-new-08-x.png", 8]);
  eq("G yesterday's open row: listed in behind, not grouped", [d.behind.count, d.behind.rows, d.groups.some((g) => ids(g).includes("m-bday"))], [1, [{ id: "post:m-bday", row_id: "m-bday", what: "Send: Maddy's birthday: the personal text", day: "2026-10-05", pillar: "maddy", platform: "other" }], false]);
  eq("G the clock: a test clock for the service role", [d.now_min, d.clock, d.date, d.nice_date, d.text_ready], [600, "test", D2, "Tue Oct 6", false]);
}
{
  const { r, d } = await groups({ pillar: "maddy" });
  eq("G pillar narrows to one group", [r.status, d.groups.map((g) => g.key), d.counts.total, d.next_step_id], [200, ["maddy"], 8, "post:m-ig"]);
  const bad = await groups({ pillar: "nope" });
  eq("G an unknown pillar answers 400", [bad.r.status, bad.d.error], [400, "no such pillar: nope"]);
  const none = await groups({ date: "2026-10-09" });
  eq("G a day with no rows: no groups, counts zero, next null", [none.r.status, none.d.groups, none.d.counts, none.d.next_step_id, none.d.next_by_clock_id], [200, [], { groups: 0, total: 0, done: 0, open: 0, held: 0, skipped: 0 }, null, null]);
}
{
  // no step_order anywhere: the clock, then the pillar's platform order, then the title
  const rows = postingRows().map((x) => { const meta = Object.assign({}, x.metadata); delete meta.step_order; return Object.assign({}, x, { metadata: meta }); });
  const { d } = await groups({}, Object.assign(tablesFor(), { content_calendar: rows }));
  eq("G no step_order: The Way of Dad by the clock, X before Bluesky before Instagram at 7:30, the 9:00 feed last", d.groups[0].steps.map((s) => s.row_id + ":" + s.ordered_by), ["w-x:clock", "w-bsky:clock", "w-reel:clock", "w-ig:clock"]);
  eq("G no step_order: Fortify by the clock", ids(d.groups[1]), ["f-iw-li", "f-iw-ig", "f-map-li", "f-map-ig", "f-body-li", "f-body-ig", "f-des-li", "f-des-ig", "f-body-reel", "f-body-yt", "f-iw-reel", "f-iw-yt"]);
  eq("G no step_order: three texts at one clock on one platform fall to the title; the row with no clock last", ids(d.groups[2]), ["m-ig", "m-fb", "m-tt", "m-th", "m-emma", "m-michele", "m-ro", "m-reddit"]);
  eq("G no step_order: step_order null on every step", d.groups.every((g) => g.steps.every((s) => s.step_order === null)), true);
}
{
  // a tie on step_order breaks by the clock, then the platform
  const rows = postingRows().map((x) => x.pillar === "maddy" ? Object.assign({}, x, { metadata: Object.assign({}, x.metadata, { step_order: 1 }) }) : x);
  const { d } = await groups({ pillar: "maddy" }, Object.assign(tablesFor(), { content_calendar: rows }));
  eq("G every Maddy row at step_order 1: the clock, then Instagram, Facebook, TikTok, Threads, then the texts by title", ids(d.groups[0]), ["m-ig", "m-fb", "m-tt", "m-th", "m-emma", "m-michele", "m-ro", "m-reddit"]);
}
{
  // a Story share is its own step (v14's Story rows), after the posts, with no text and the Story how
  const rows = postingRows().concat([R("w-story", "wayofdad", "wayofdad-open-2026-09", "Half Dome and the boots (instagram story)", "instagram", { account: "Instagram @way.of.dad", slot: "Tue 2026-10-06, 9:05am Pacific", story_of: "w-ig" }, { format: "story", excerpt: null })]);
  const { d } = await groups({}, Object.assign(tablesFor(), { content_calendar: rows }));
  const st = d.groups[0].steps.find((s) => s.row_id === "w-story");
  eq("G a Story share: its own step, last by platform order, Shared to the Story, no text, the Story how", [d.groups[0].steps.length, st.n, st.platform, st.platform_label, st.story, st.what, st.tap, st.text.source, st.text.body, /paper plane/.test(st.how)], [5, 5, "instagram story", "Instagram Story", true, "Half Dome and the boots: share it to your Story", { card_id: "content:w-story", post_id: "w-story", action: "posted", label: "Shared to the Story" }, "none", null, true]);
}
{
  // held and skipped read from metadata.morning as on the card; all_done when every step is done
  const rows = postingRows().map((x) => {
    if (x.id === "w-reel") return Object.assign({}, x, PUB);
    if (x.id === "f-map-li") return Object.assign({}, x, { metadata: Object.assign({}, x.metadata, { morning: { held_until: "2026-10-07" } }) });
    if (x.id === "f-map-ig") return Object.assign({}, x, { metadata: Object.assign({}, x.metadata, { morning: { skipped: D2 } }) });
    return x;
  });
  const { d } = await groups({}, Object.assign(tablesFor(), { content_calendar: rows }));
  const wod = d.groups[0], f = d.groups[1];
  eq("G every step done: all_done, first_open null, done_all empty, count 4 of 4", [wod.all_done, wod.first_open, wod.done_all, wod.count], [true, null, [], { total: 4, done: 4, open: 0, held: 0, skipped: 0 }]);
  eq("G held and skipped: neither open nor done, counted", [f.steps[2].status, f.steps[2].held_until, f.steps[3].status, f.count], ["held", "2026-10-07", "skipped", { total: 12, done: 0, open: 10, held: 1, skipped: 1 }]);
  eq("G next_step_id skips the finished group and the held and skipped steps", [d.next_step_id, f.first_open, f.done_all.length], ["post:f-iw-li", "post:f-iw-li", 10]);
}
{
  // the morning op on the same fixture: published rows stay out of the sitting, pieces group as in v14, nothing else moves
  const { handler } = await fresh();
  const db = mockDb(Object.assign(tablesFor(), { content_calendar: postingRows() })); globalThis.__sb = db; linearCalls = [];
  const r = await call(handler, { op: "morning", date: D2, now_min: 600 });
  const content = r.json.sitting.filter((c) => c.source === "content");
  eq("G morning (v15): 200, engine v15, the same next rule", [r.status, r.json.engine, r.json.next_rule, r.json.place_rule], [200, "one-today v15", "clock-15", "actions-only"]);
  eq("G morning: one card per piece, ten pieces, the three published Half Dome rows out", [content.length, content.some((c) => c.posts.some((p) => p.status === "published")), content.some((c) => /Half Dome/.test(c.what))], [10, false, false]);
  eq("G morning: the three texts are still one card there (the groups op is where they are three)", content.find((c) => c.what === "Three texts to the people whose asks shipped").posts.length, 3);
  eq("G morning: the card's photo.url stays images only", content.map((c) => c.photo && c.photo.url && /\.pdf/.test(decodeURIComponent(c.photo.url))).some(Boolean), false);
  eq("G morning writes nothing", db.writes, []);
}
{
  // the file door (GET ?op=photo): a vault PDF passes the path rule (then wants the GitHub token, absent here), a video and a
  // path outside docs/ do not; the token rides in the header, never the URL
  const { handler } = await fresh();
  globalThis.__sb = mockDb(tablesFor());
  const get = async (path) => { const res = await handler(new Request("http://local/functions/v1/morning-api?op=photo&path=" + encodeURIComponent(path), { method: "GET", headers: { authorization: "Bearer " + SERVICE } })); return [res.status, JSON.parse(await res.text()).error]; };
  eq("G file door: a vault PDF passes the path rule", await get(FK + "/assets/cards/01-the-body-linkedin.pdf"), [503, "MORNING_GH_TOKEN not set"]);
  eq("G file door: a vault image passes as before", await get(FK + "/assets/map/00-the-map.png"), [503, "MORNING_GH_TOKEN not set"]);
  eq("G file door: a video is refused", await get(FK + "/assets/reels/01-the-body-reel.mp4"), [400, "not a vault image or PDF"]);
  eq("G file door: a path outside docs/ is refused", await get("supabase/functions/morning-api/index.ts"), [400, "not a vault image or PDF"]);
}


// ================= H. v15 day two (RULINGS 2026-10-06, yes as drawn; the drawing's day two): the routines and the medicines join the groups =================
// The fixture is Thu 10-08's real shape (read live 8:15am PT): a subset of his checklist_templates rows as the hub carries them, the
// steps written by migration routine_steps_01 (scripts/routine-steps-01.json, the same file the migration was generated from), the
// medications by window, a done mark, a skip, a hold and one medicine taken.
const D3 = "2026-10-08";
const FILL = new Map(JSON.parse(readFileSync(fileURLToPath(new URL("./routine-steps-01.json", import.meta.url)), "utf8")).map((r) => [r.id, r.steps]));
const T = (id, title, anchor, sort, extra = {}) => Object.assign({ id, user_id: USER_ID, title, anchor, sort_order: sort, time: null, window_start: null, window_end: null, door: null, cadence: "daily", days: null, starts_on: null, ends_on: null, paused: false, kind: "self", key: null, why: null, first_physical_motion: null, rung_full: null, rung_reduced: null, rung_floor: null, copy: null, ask: null, links: null, source_path: null, pillar: "life", track: "health", steps: FILL.get(id) ?? null }, extra);
const SHOWER = "f75f4080-e932-48eb-849a-cb986fa27cf1", COOPER = "f158bcca-7300-4621-b9ea-65cb2039965c", BREAKFAST = "e8617b53-eaf4-479f-934c-bfc84b7b0be9", TRAIN = "b1da00e7-32b1-4632-a459-bacdf6eb94e2";
const EVE = "2b732b94-af31-4154-ad51-945808420c37", BACK = "79e4165f-5fbc-4817-995c-c3a772450bae", CLAY = "40398584-b5e7-429b-8281-13372c3a4121", FEET = "2eea2a56-4a89-4e7e-8dd2-b813d12fac25";
const REPLIES = "e105e553-927d-45f6-ad91-abaa19c3f40d", DMS = "85181c81-89da-48cc-bfa8-f8c2a3301d8c";
function dayTemplates() {
  return [
    T(SHOWER, "Shower + skincare + teeth", "wake", 0, { rung_full: "Shower, skincare, teeth.", rung_reduced: "Shower and teeth.", rung_floor: "Splash your face and brush your teeth." }),
    T(COOPER, "Cooper out + outdoor stretch (8 moves)", "wake", 1, { kind: "body", rung_full: "Cooper out, then the eight moves.", rung_reduced: "Cooper out, then three moves.", rung_floor: "Put the leash on Cooper." }),
    T("coffee", "Coffee", "levo_gap_closed", 3, { kind: "food", key: "coffee", why: "Levothyroxine needs its hour alone before anything else.", rung_full: "Coffee, once the levo hour has closed.", rung_reduced: "Coffee.", rung_floor: "Fill the kettle." }),
    T(BREAKFAST, "Breakfast", "levo_gap_closed", 5, { kind: "food", key: "breakfast", rung_full: "Five eggs over easy, two protein toast, sauteed greens, kimchi.", rung_reduced: "Five eggs over easy, one protein toast, greens.", rung_floor: "Five eggs and the greens." }),
    T("trt-thu", "Testosterone, the half dose, Thursday morning", "wake", 910, { time: "7:00am", door: "house", days: [4], kind: "body", first_physical_motion: "Wash hands, open the kit.", rung_full: "The half dose, 0.35 mL (70 mg of the 200 mg per mL vial), the site rotated from last time, then the row tapped so the log carries the time." }),
    T("lunch", "Lunch", "meal_start", 1, { kind: "food", window_start: "12:00:00", window_end: "14:00:00", rung_full: "Pick one: chicken, shrimp, tuna, turkey, cod, or last night's protein. Eight ounces, a pile of vegetables, a teaspoon of oil." }),
    T(TRAIN, "Train", "gym_leave", 6, { kind: "body", days: [1, 2, 3, 4, 5, 6], rung_full: "Today's session, every set.", rung_floor: "Put your gym shoes on." }),
    T(EVE, "Evening stretch, 8 min (Supine Figure-4, Spinal Twist, Child's Pose)", "wind_down", 10, { kind: "body", rung_full: "The three evening moves, eight minutes." }),
    T(BACK, "Back and chest, with Maddy: two minutes", "wind_down", 13, { kind: "body", starts_on: "2026-09-18", first_physical_motion: "Hand her the tube.", links: { cart: "https://example.invalid/cart" }, rung_full: "A thin layer of adapalene on dry skin across the back, chest and shoulders." }),
    T(CLAY, "Clay mask", "wind_down", 13, { cadence: "weekly", days: [5], rung_full: "Clay mask on the nose and pores, ten to fifteen minutes, then the night routine." }),
    T(FEET, "Athlete's foot care", "wind_down", 999, { kind: "body", rung_full: "Wash and dry the feet, the antifungal on both, clean socks." }),
    T("prazosin", "Prazosin, at bedtime", "lights_down", 913, { kind: "meds", door: "house", days: [0, 1, 2, 3, 4, 5, 6], pillar: null, track: null }),
    T("trazodone", "Trazodone, only if you want it", "lights_down", 914, { kind: "meds", door: "house", cadence: "as_needed", starts_on: "2026-09-25", pillar: null, track: null }),
    T("counter", "Kitchen counter clear, soap dispenser + utensil crock only", "close", 10, { kind: "home", rung_full: "Counter clear, soap and crock only." }),
    T("locks", "Lock doors, check windows", "close", 41, { kind: "home", rung_full: "Doors locked, windows checked." }),
    T(REPLIES, "Replies. Fifteen minutes.", "wake", 110, { time: "7:45am", door: "wayofdad", days: [0, 1, 2, 3, 4, 5, 6], kind: "work", ask: "how many replies", pillar: "wayofdad", track: "replies", copy: [{ label: "The five X rooms", text: "@drjoekort\n@MattBaume" }], links: [{ href: "https://x.com/notifications", label: "X notifications" }], rung_full: "Answer everyone who replied, then one useful sentence in each of the five X rooms, then three on Bluesky in the pinned feeds." }),
    T(DMS, "The DM check. Answer every DM within the day.", "wake", 111, { time: "7:50am", door: "wayofdad", days: [0, 1, 2, 3, 4, 5, 6], kind: "work", ask: "how many DMs", pillar: "wayofdad", track: "replies" }),
    T("paused", "A paused row", "wake", 2, { paused: true }),
    T("ended", "Morning read, ended", "wake", 900, { ends_on: "2026-09-20" }),
  ];
}
const MED = (id, name, timing, dose = null) => ({ id, name, dose, timing, active: true });
function dayTables(extra = {}) {
  const wod = postingRows().filter((r) => r.pillar === "wayofdad").map((r) => Object.assign({}, r, { scheduled_for: D3, published_at: r.published_at ? D3 + "T14:43:52.872+00:00" : null }));
  return Object.assign(tablesFor(), {
    content_calendar: wod,
    checklist_templates: dayTemplates(),
    checklist_completions: [
      { template_id: SHOWER, date: D3, completed_at: D3 + "T14:10:00Z", skipped: false, value: null, source: "face", action: "done" },
      { template_id: "coffee", date: D3, completed_at: D3 + "T14:40:00Z", skipped: true, value: null, source: "face", action: "skip" },
      { template_id: "lunch", date: D3, completed_at: D3 + "T15:00:00Z", skipped: true, value: null, source: "face", action: "hold", held_to: "2026-10-09" },
    ],
    medications: [MED("levo", "Levothyroxine", "on_waking"), MED("losartan", "Losartan", "with_breakfast", "100mg"), MED("omega", "Omega-3", "with_breakfast"), MED("tyrosine", "L-Tyrosine", "pre_gym", "750mg"), MED("trt-med", "Testosterone", "weekly", "0.35 mL"), MED("mag", "Magnesium Glycinate", "bedtime")],
    med_log: [{ medication_id: "levo", med_name: "Levothyroxine", taken_at: D3 + "T14:01:00Z", date: D3 }],
  }, extra);
}
async function dayGroups(body = {}, tables) {
  const { handler } = await fresh();
  const db = mockDb(tables || dayTables());
  globalThis.__sb = db;
  const r = await call(handler, Object.assign({ op: "groups", date: D3, now_min: 480 }, body));
  return { r, d: r.json, db };
}
const whats = (g) => g.steps.map((s) => s.what);
{
  const { r, d, db } = await dayGroups();
  eq("H 200, still v15, the op writes nothing", [r.status, d.engine, db.writes], [200, "one-today v15", []]);
  eq("H the parts of the day, in order, each a routine group", d.day_groups.map((g) => [g.order, g.key, g.kind, g.name, g.block]), [[1, "day:wake", "routine", "The morning routine", "Wake"], [2, "day:midday", "routine", "The midday routine", "Midday"], [3, "day:evening", "routine", "The evening routine", "Evening"], [4, "day:close", "routine", "The close", "Close"]]);
  const wake = d.day_groups[0], mid = d.day_groups[1], eve = d.day_groups[2], close = d.day_groups[3];
  eq("H the morning: on waking first, then the clock and the row's sort, the with-breakfast medicines right after Breakfast, the weekly one at its clock", whats(wake), ["Levothyroxine, on waking", "Shower + skincare + teeth", "Cooper out + outdoor stretch (8 moves)", "Testosterone, the half dose, Thursday morning", "Coffee", "Breakfast", "Losartan 100mg, with breakfast", "Omega-3, with breakfast", "Testosterone 0.35 mL, thursday, weekly"]);
  eq("H numbers run 1 to N", wake.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq("H the kicker reads the first and last clock", [wake.kicker, close.kicker], ["7:00am to 9:00am", "From 9:00pm"]);
  eq("H the midday: Lunch held, the walk to the gym's medicine, Train", [whats(mid), mid.steps[0].status, mid.steps[0].held_until], [["Lunch", "L-Tyrosine 750mg, before the gym", "Train"], "held", "2026-10-09"]);
  eq("H the evening: the clay mask is a Friday row and is absent; prazosin, then trazodone optional, then the bedtime medicine last", whats(eve), ["Evening stretch, 8 min (Supine Figure-4, Spinal Twist, Child's Pose)", "Back and chest, with Maddy: two minutes", "Athlete's foot care", "Prazosin, at bedtime", "Trazodone, only if you want it", "Magnesium Glycinate, bedtime"]);
  eq("H the close in the row's sort", whats(close), ["Kitchen counter clear, soap dispenser + utensil crock only", "Lock doors, check windows"]);
  eq("H a paused row and an ended row are absent", d.day_groups.some((g) => g.steps.some((s) => /paused|ended/i.test(s.what))), false);
  const shower = wake.steps[1], levo = wake.steps[0], coffee = wake.steps[4], cooper = wake.steps[2], breakfast = wake.steps[5];
  eq("H a done mark: done with its time", [shower.status, shower.done_at], ["done", D3 + "T14:10:00Z"]);
  eq("H a skip: skipped, not done", [coffee.status, coffee.done_at], ["skipped", null]);
  eq("H a medicine taken: done with taken_at", [levo.kind, levo.status, levo.done_at, levo.tag, levo.timing], ["medicine", "done", D3 + "T14:01:00Z", "medicine", "on_waking"]);
  eq("H a routine's tap and undo are the routine card's (routine:<id>, done, Done)", [cooper.card_id, cooper.tap, cooper.undo, cooper.taps], ["routine:" + COOPER, { card_id: "routine:" + COOPER, post_id: null, action: "done", label: "Done" }, { card_id: "routine:" + COOPER, post_id: null, action: "undo", label: "Undo" }, [{ card_id: "routine:" + COOPER, post_id: null, action: "done", label: "Done" }, { card_id: "routine:" + COOPER, post_id: null, action: "skip", label: "Skip" }]]);
  const losartan = wake.steps[6];
  eq("H a medicine's tap is the meds card's per-medicine tap (med:<window>, the medicine named, Taken)", [losartan.id, losartan.tap, losartan.undo], ["med:with_breakfast:losartan", { card_id: "med:with_breakfast", post_id: "losartan", action: "done", label: "Taken" }, { card_id: "med:with_breakfast", post_id: "losartan", action: "undo", label: "Undo" }]);
  eq("H the stretch: the 8 moves as its how-to, numbered inside the step", [cooper.howto.length, cooper.howto[0], cooper.howto[7]], [8, "Standing hip flexor lunge, 45 seconds a side, 2 rounds.", "Standing thoracic extension, 10 to 12 reps."]);
  eq("H each move with its cues, time and why, as written (the dash rule: ' - ')", [cooper.howto_detail.length, cooper.howto_detail[0].cues.length, cooper.howto_detail[0].time, /^Tight hip flexors/.test(cooper.howto_detail[0].why), cooper.howto_detail[3].why.includes(" - the muscle"), JSON.stringify(cooper.howto_detail).includes(" -- ")], [8, 4, "90 sec total", true, true, false]);
  eq("H a routine with steps shows no How (the full rung is folded into the steps)", [cooper.how, breakfast.how, breakfast.howto], [null, null, ["Get the eggs out.", "Five eggs over easy, two protein toast, sauteed greens, kimchi."]]);
  eq("H plain lines carry no detail", breakfast.howto_detail, []);
  eq("H a routine with no steps is one step, its full rung as How, its why kept", [coffee.howto, coffee.how, coffee.why], [[], "Coffee, once the levo hour has closed.", "Levothyroxine needs its hour alone before anything else."]);
  eq("H a full rung that only repeats the title is not shown", [shower.how, shower.howto.length], [null, 4]);
  eq("H no rung reaches a step: no rungs, no reduced, no floor", d.day_groups.flatMap((g) => g.steps).some((s) => "rungs" in s || JSON.stringify(s).includes("Splash your face") || JSON.stringify(s).includes("Fill the kettle")), false);
  const back = eve.steps[1];
  eq("H the first motion rides on the step", [back.first_motion, back.howto[0]], ["Hand her the tube.", "Hand Maddy the tube."]);
  const traz = eve.steps[4];
  eq("H trazodone: an optional step, tagged, never counted, never in Done for the group", [traz.optional, traz.tag, traz.status, eve.count, eve.done_all.some((t) => t.card_id === "routine:trazodone")], [true, "optional", "open", { total: 5, done: 0, open: 5, held: 0, skipped: 0, optional: 1 }, false]);
  eq("H the bedtime medicine sits in the evening, at its clock", [eve.steps[5].block, eve.steps[5].time, eve.steps[5].card_id], ["Evening", "9:30pm", "med:bedtime"]);
  eq("H the morning's count: done, open, skipped", [wake.count, wake.all_done, wake.first_open], [{ total: 9, done: 2, open: 6, held: 0, skipped: 1, optional: 0 }, false, "routine:" + COOPER]);
  eq("H Done for the group: the open steps' own taps, in order", wake.done_all, [
    { card_id: "routine:" + COOPER, post_id: null, action: "done" }, { card_id: "routine:trt-thu", post_id: null, action: "done" }, { card_id: "routine:" + BREAKFAST, post_id: null, action: "done" },
    { card_id: "med:with_breakfast", post_id: "losartan", action: "done" }, { card_id: "med:with_breakfast", post_id: "omega", action: "done" }, { card_id: "med:weekly", post_id: "trt-med", action: "done" }]);
  eq("H day counts over the parts of the day (optional out)", d.day_counts, { groups: 4, total: 19, done: 2, open: 15, held: 1, skipped: 1 });
  eq("H the steps column answered", d.steps_ready, true);
  const wod = d.groups[0];
  eq("H Replies and the DM check ride at the end of The Way of Dad, numbered on (question 7)", [wod.key, wod.kind, wod.steps.map((s) => s.n + ":" + (s.kind || "post")), whats(wod).slice(4)], ["wayofdad", "posting", ["1:post", "2:post", "3:post", "4:post", "5:routine", "6:routine"], ["Replies. Fifteen minutes.", "The DM check. Answer every DM within the day."]]);
  eq("H The Way of Dad reads 3 of 6, its Done for the group carries the two routines", [wod.count, wod.done_all.map((t) => t.card_id)], [{ total: 6, done: 3, open: 3, held: 0, skipped: 0, optional: 0 }, ["content:w-reel", "routine:" + REPLIES, "routine:" + DMS]]);
  const rep = wod.steps[4];
  eq("H Replies carries its ask, its copy blocks and its links, and its three steps", [rep.ask, rep.copies, rep.links, rep.howto], ["how many replies", [{ label: "The five X rooms", text: "@drjoekort\n@MattBaume" }], [{ href: "https://x.com/notifications", label: "X notifications" }], ["Answer everyone who replied to you.", "One useful sentence in each of the five X rooms.", "Three on Bluesky, inside the pinned feeds."]]);
  eq("H a door routine is not repeated in its part of the day", d.day_groups.some((g) => g.steps.some((s) => s.card_id === "routine:" + REPLIES)), false);
  eq("H a door of the house stays in its part of the day", wake.steps.some((s) => s.card_id === "routine:trt-thu"), true);
  eq("H the posting counts include the line's routines", d.counts, { groups: 1, total: 6, done: 3, open: 3, held: 0, skipped: 0 });
}
{
  const { d } = await dayGroups({ pillar: "wayofdad" });
  eq("H a pillar narrows to its line: no parts of the day", [d.groups.map((g) => g.key), d.day_groups, d.day_counts.total], [["wayofdad"], [], 0]);
}
{
  // before routine_steps_01: no steps column, every routine is one step with its full rung as How
  const t = dayTables(); t.checklist_templates = t.checklist_templates.map(({ steps, ...x }) => x);
  const { d } = await dayGroups({}, t);
  const cooper = d.day_groups[0].steps[2];
  eq("H no steps column: steps_ready false, the stretch one step with its full rung", [d.steps_ready, cooper.howto, cooper.how], [false, [], "Cooper out, then the eight moves."]);
}
{
  // a line routine on a day with no posts for its line: the line's group of routines alone, in account order
  const t = dayTables(); t.content_calendar = [];
  const { d } = await dayGroups({}, t);
  eq("H no Way of Dad posts: its group holds the two routines alone", [d.groups.map((g) => g.key), whats(d.groups[0]), d.groups[0].block], [["wayofdad"], ["Replies. Fifteen minutes.", "The DM check. Answer every DM within the day."], "Wake"]);
}
{
  // Friday: the clay mask joins the evening with its three steps
  const t = dayTables(); t.content_calendar = [];
  const { d } = await dayGroups({ date: "2026-10-09" }, t);
  const clay = d.day_groups.find((g) => g.key === "day:evening").steps.find((s) => s.what === "Clay mask");
  eq("H Friday: the clay mask is in the evening, its three steps", clay && clay.howto, ["Open the jar.", "Clay mask on the nose and pores, ten to fifteen minutes.", "Rinse, then the night routine."]);
  eq("H Friday: no weekly medicine (Thursday only)", d.day_groups[0].steps.some((s) => s.timing === "weekly"), false);
}
{
  // the morning op is untouched: a routine card still carries its rungs for the Chart House
  const { handler } = await fresh();
  globalThis.__sb = mockDb(dayTables()); linearCalls = [];
  const r = await call(handler, { op: "morning", date: D3, now_min: 480 });
  const c = r.json.sitting.find((x) => x.id === "routine:" + COOPER);
  eq("H morning op: the routine card keeps its rungs, no steps field", [r.status, c.rungs, "howto" in c, "steps" in c], [200, { full: "Cooper out, then the eight moves.", reduced: "Cooper out, then three moves.", floor: "Put the leash on Cooper." }, false, false]);
  eq("H morning op: trazodone (as needed) is still not a card", r.json.sitting.some((x) => x.id === "routine:trazodone"), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
