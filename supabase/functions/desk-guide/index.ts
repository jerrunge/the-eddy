// desk-guide v1: the Harbor's Claude input. He types or dictates what changed in
// plain words; Claude reads the whole board and returns structured ops; this
// function applies them and logs what it did, so his board updates through
// conversation. His edits always outrank; everything is visible in the log.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.40.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_HASH = "65c1760f8404c8eec8bbc938ac3c9a0ab60623eea93a643f25214cd628fc9e4f";
const ALLOWED_ORIGINS = ["https://jerrunge.github.io", "https://jeremyrunge.com", "https://www.jeremyrunge.com", "http://localhost:4181"];

function cors(origin: string | null) {
  const o = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), { status: 500, headers });
  const text = String(body.text ?? "").slice(0, 8000);
  const hasFocus = !!body.item_id && ["decide", "expand", "note"].includes(body.mode);
  if (!text.trim() && !hasFocus) return new Response(JSON.stringify({ error: "empty" }), { status: 400, headers });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const mode = ["decide", "expand", "note"].includes(body.mode) ? body.mode : "update";
    const focusId = body.item_id ?? null;
    const [boxesRes, itemsRes, papersRes] = await Promise.all([
      sb.from("desk_boxes").select("id, title, why, deadline, position").eq("archived", false).order("position"),
      sb.from("desk_items").select("id, box_id, parent_item_id, kind, text, detail, done, due, body, options, choice, position").order("position"),
      sb.from("papers").select("id, category, title, doc_date, box_id").eq("archived", false).order("doc_date", { ascending: false }).limit(200),
    ]);
    const boxes = boxesRes.data ?? [];
    const items = itemsRes.data ?? [];
    const papers = papersRes.data ?? [];
    const board = boxes.map((b: any) => ({
      box_id: b.id, title: b.title, deadline: b.deadline,
      items: items.filter((i: any) => i.box_id === b.id && !i.parent_item_id).map((i: any) => ({
        item_id: i.id, text: i.text, kind: i.kind, done: i.done, due: i.due,
        subitems: items.filter((c: any) => c.parent_item_id === i.id).map((c: any) => ({ item_id: c.id, text: c.text, done: c.done })),
      })),
      papers_filed: papers.filter((p: any) => p.box_id === b.id).map((p: any) => p.title || p.category),
    }));
    const papersByCategory: Record<string, number> = {};
    for (const p of papers as any[]) papersByCategory[p.category] = (papersByCategory[p.category] ?? 0) + 1;
    const focus = focusId ? items.find((i: any) => i.id === focusId) : null;

    const base = [
      `You maintain Jeremy's Harbor: boxes and checklists for everything occupying his mind during a heavy season (a move by Oct 30, a bankruptcy filing, an urgent job search, his autistic daughter Maddy's group-home search, a relationship with David in a painful maybe, loneliness, his dog Cooper's living). He has ADHD and OCD; a wall of undifferentiated tasks is exactly what overwhelms him, so your job is to make the next move obvious and small.`,
      `Voice: warm, plain, short, his register. NEVER an em dash. Never scold. Never add self-care filler. Never invent facts about his life he did not give you.`,
      `Items have a kind: "task" (a checkbox), "note" (holds durable body text he is writing, e.g. what he needs from David, his two stories, Maddy's words), "decision" (holds options and a recorded choice). Items can have subitems (a sub-checklist). Use the exact ids from the board. Each box may list papers_filed: documents he photographed and filed to that box (mail, notices, statements). You cannot edit papers, but you can tell him what is already filed when it answers a question (e.g. which attorney documents he has captured).`,
      `Output ONLY a JSON object, no markdown fences: {"summary": "...", "ops": [...]}. Op types: {"op":"check","item_id"} | {"op":"uncheck","item_id"} | {"op":"add_item","box_id","text","detail":null,"due":null} | {"op":"add_subitems","parent_item_id","texts":["...","..."]} | {"op":"edit_item","item_id","text":?,"detail":?,"due":?} | {"op":"set_kind","item_id","kind":"task|note|decision"} | {"op":"set_body","item_id","body":"full replacement text"} | {"op":"append_body","item_id","text":"appended"} | {"op":"set_options","item_id","options":[{"label":"...","note":"..."}]} | {"op":"set_choice","item_id","choice":"..."} | {"op":"remove_item","item_id"} | {"op":"move_item","item_id","box_id"} | {"op":"add_box","title","why","deadline":null}. Empty ops is valid when he only asked or vented; then summary is your short honest reply.`,
    ];
    const modeLine: Record<string, string> = {
      update: `He is updating the board in his own words. Reflect exactly what changed: check off what he did, add what is new to the best box, edit dates. When something is clearly a big multi-step item, you may break it into subitems with add_subitems.`,
      expand: focus ? `BREAK THIS ITEM INTO A CLEAR CHECKLIST. Item: "${focus.text}". Return add_subitems with 4 to 8 concrete, ordered, startable steps in his register. If it is really a decision, instead set_kind decision and set_options. Keep each step short. summary = one warm line.` : `Break the item he names into steps.`,
      decide: focus ? `WALK HIM THROUGH THIS DECISION using the whole board as real context (his deadlines, his money, Maddy, Cooper, David). Item: "${focus.text}". Current options: ${JSON.stringify(focus.options ?? null)}. Lay out the real options with an honest one-line tradeoff each via set_options, then write your reasoning and a clear recommendation into the body via set_body (plain paragraphs, name the tradeoff that actually decides it, never pretend it is easy). Do NOT set_choice; the choice is his. summary = your recommendation in one or two sentences.` : `Help him decide the item he names.`,
      note: focus ? `Help him with this note. Item: "${focus.text}". Current body: ${JSON.stringify(focus.body ?? "")}. Take what he said and set_body to a clean, honest version in his own voice, or append_body if he is adding. Keep it his, not yours. summary = one line.` : `Help him write the note he names.`,
    };
    const system = [...base, modeLine[mode]].join("\n\n");

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      system,
      messages: [{ role: "user", content: `THE BOARD NOW:\n${JSON.stringify(board)}\n\nPAPERS FILED BY CATEGORY: ${JSON.stringify(papersByCategory)}\n\n${focus ? `THE ITEM IN FOCUS: ${JSON.stringify({ id: focus.id, text: focus.text, kind: focus.kind, body: focus.body, options: focus.options })}\n\n` : ""}HIS WORDS:\n${text || "(he tapped the button without typing; use the item and board)"}` }],
    });
    let raw = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    raw = raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch {
      return new Response(JSON.stringify({ summary: raw.slice(0, 400), applied: 0, note: "no structured changes" }), { headers });
    }

    let applied = 0; const skipped: string[] = [];
    for (const o of (parsed.ops ?? []).slice(0, 40)) {
      try {
        if (o.op === "check" || o.op === "uncheck") {
          await sb.from("desk_items").update({ done: o.op === "check", done_at: o.op === "check" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", o.item_id);
        } else if (o.op === "add_item") {
          await sb.from("desk_items").insert({ id: crypto.randomUUID(), box_id: o.box_id, text: String(o.text ?? "").slice(0, 500), detail: o.detail ?? null, due: o.due ?? null, position: 500, source: "claude" });
        } else if (o.op === "add_subitems") {
          const box = items.find((i: any) => i.id === o.parent_item_id)?.box_id;
          const rows = (o.texts ?? []).slice(0, 12).map((t: string, n: number) => ({ id: crypto.randomUUID(), box_id: box, parent_item_id: o.parent_item_id, text: String(t).slice(0, 400), position: n + 1, source: "claude" }));
          if (rows.length) await sb.from("desk_items").insert(rows);
        } else if (o.op === "set_kind") {
          await sb.from("desk_items").update({ kind: o.kind, updated_at: new Date().toISOString() }).eq("id", o.item_id);
        } else if (o.op === "set_body") {
          await sb.from("desk_items").update({ body: String(o.body ?? "").slice(0, 8000), body_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", o.item_id);
        } else if (o.op === "append_body") {
          const cur = items.find((i: any) => i.id === o.item_id)?.body ?? "";
          await sb.from("desk_items").update({ body: (cur + "\n" + String(o.text ?? "")).slice(0, 8000), body_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", o.item_id);
        } else if (o.op === "set_options") {
          await sb.from("desk_items").update({ options: o.options ?? null, kind: "decision", updated_at: new Date().toISOString() }).eq("id", o.item_id);
        } else if (o.op === "set_choice") {
          await sb.from("desk_items").update({ choice: o.choice ?? null, updated_at: new Date().toISOString() }).eq("id", o.item_id);
        } else if (o.op === "edit_item") {
          const patch: any = { updated_at: new Date().toISOString() };
          for (const k of ["text", "detail", "due"]) if (o[k] !== undefined) patch[k] = o[k];
          await sb.from("desk_items").update(patch).eq("id", o.item_id);
        } else if (o.op === "remove_item") {
          await sb.from("desk_items").delete().eq("id", o.item_id);
        } else if (o.op === "move_item") {
          await sb.from("desk_items").update({ box_id: o.box_id, updated_at: new Date().toISOString() }).eq("id", o.item_id);
        } else if (o.op === "add_box") {
          await sb.from("desk_boxes").insert({ id: crypto.randomUUID(), title: String(o.title ?? "").slice(0, 120), why: o.why ?? null, deadline: o.deadline ?? null, hue: "harbor", position: 99 });
        } else { skipped.push(o.op); continue; }
        applied++;
      } catch { skipped.push(o.op); }
    }
    const summary = String(parsed.summary ?? "Done.").slice(0, 500);
    await sb.from("desk_log").insert({ actor: "claude", summary: applied ? `${summary} (${applied} change${applied === 1 ? "" : "s"})` : summary });
    return new Response(JSON.stringify({ summary, applied, skipped }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
