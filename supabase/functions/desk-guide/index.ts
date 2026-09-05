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
  if (!text.trim()) return new Response(JSON.stringify({ error: "empty" }), { status: 400, headers });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const [boxesRes, itemsRes] = await Promise.all([
      sb.from("desk_boxes").select("id, title, why, deadline, position").eq("archived", false).order("position"),
      sb.from("desk_items").select("id, box_id, text, detail, done, due, position").order("position"),
    ]);
    const boxes = boxesRes.data ?? [];
    const items = itemsRes.data ?? [];
    const board = boxes.map((b: any) => ({
      box_id: b.id, title: b.title, deadline: b.deadline,
      items: items.filter((i: any) => i.box_id === b.id).map((i: any) => ({ item_id: i.id, text: i.text, done: i.done, due: i.due })),
    }));

    const system = [
      `You maintain Jeremy's Harbor: boxes and checklists for everything occupying his mind during a heavy season (a move, a bankruptcy filing, a job search, his daughter's housing, a relationship in a hard maybe, loneliness). He types what changed in plain words; you return ONLY a JSON object that updates the board faithfully.`,
      `Rules: never invent tasks he did not imply; never delete unless he clearly says so; when he reports something happened, check the matching item off rather than adding a duplicate; put new items in the best existing box (create a box only when nothing fits); dates only when he gives or clearly implies one; keep item text short and warm in his register; NEVER use an em dash; never scold, never advise unless he asked a question, never add "self care" filler he did not ask for.`,
      `Output: a single JSON object, no markdown fences, shape {"summary": "one or two plain sentences of what you did (or the answer, if he only asked a question)", "ops": [ ... ]}. Ops: {"op":"check","item_id":"..."} | {"op":"uncheck","item_id":"..."} | {"op":"add_item","box_id":"...","text":"...","detail":null,"due":null} | {"op":"edit_item","item_id":"...","text":?,"detail":?,"due":?} | {"op":"remove_item","item_id":"..."} | {"op":"add_box","title":"...","why":"...","deadline":null} | {"op":"move_item","item_id":"...","box_id":"..."}. Use the exact ids from the board. Empty ops array is valid when he is only asking or venting; then the summary is your short, honest, warm reply.`,
    ].join("\n\n");

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: `THE BOARD NOW:\n${JSON.stringify(board)}\n\nHIS WORDS:\n${text}` }],
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
