// desk-api v1: the Harbor's data door (boxes and lists for everything occupying
// his mind, RULINGS 2026-08-29). Same posture and SAME DEVICE TOKEN as the Eddy:
// one pairing covers his personal tools. RLS-sealed tables, service role inside,
// idempotent upserts on client UUIDs. verify_jwt=false is deliberate.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_HASH = "65c1760f8404c8eec8bbc938ac3c9a0ab60623eea93a643f25214cd628fc9e4f";
const ALLOWED_ORIGINS = ["https://jerrunge.github.io", "https://jeremyrunge.com", "https://www.jeremyrunge.com", "http://localhost:4181"];

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

Deno.serve(async (req: Request) => {
  const headers = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers }); }
  if (!body.token || (await sha256hex(String(body.token))) !== TOKEN_HASH) {
    return new Response(JSON.stringify({ error: "bad token" }), { status: 403, headers });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (body.op === "board") {
      const [boxes, items, log] = await Promise.all([
        sb.from("desk_boxes").select("*").eq("archived", false).order("position"),
        sb.from("desk_items").select("*").order("position"),
        sb.from("desk_log").select("at, actor, summary").order("at", { ascending: false }).limit(12),
      ]);
      return new Response(JSON.stringify({ boxes: boxes.data ?? [], items: items.data ?? [], log: log.data ?? [] }), { headers });
    }
    if (body.op === "sync") {
      const results: any[] = [];
      for (const o of (body.ops ?? []).slice(0, 100)) {
        try {
          if (o.kind === "item_add") {
            await sb.from("desk_items").upsert({ id: o.id, box_id: o.box_id, text: String(o.text ?? "").slice(0, 500), detail: o.detail ?? null, due: o.due ?? null, position: o.position ?? 999, source: "him" });
          } else if (o.kind === "item_set") {
            const patch: any = { updated_at: new Date().toISOString() };
            for (const k of ["text", "detail", "due", "position", "box_id", "linear_ref"]) if (k in o) patch[k] = o[k];
            if ("done" in o) { patch.done = !!o.done; patch.done_at = o.done ? new Date().toISOString() : null; }
            await sb.from("desk_items").update(patch).eq("id", o.id);
          } else if (o.kind === "item_del") {
            await sb.from("desk_items").delete().eq("id", o.id);
          } else if (o.kind === "box_add") {
            await sb.from("desk_boxes").upsert({ id: o.id, title: String(o.title ?? "").slice(0, 120), why: o.why ?? null, deadline: o.deadline ?? null, hue: o.hue ?? "harbor", position: o.position ?? 999 });
          } else if (o.kind === "box_set") {
            const patch: any = { updated_at: new Date().toISOString() };
            for (const k of ["title", "why", "deadline", "hue", "position", "archived"]) if (k in o) patch[k] = o[k];
            await sb.from("desk_boxes").update(patch).eq("id", o.id);
          } else if (o.kind === "log") {
            await sb.from("desk_log").insert({ actor: "him", summary: String(o.summary ?? "").slice(0, 300) });
          }
          results.push({ id: o.id ?? null, ok: true });
        } catch (e) { results.push({ id: o.id ?? null, ok: false, error: String(e).slice(0, 160) }); }
      }
      return new Response(JSON.stringify({ results }), { headers });
    }
    return new Response(JSON.stringify({ error: "unknown op" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 300) }), { status: 500, headers });
  }
});
