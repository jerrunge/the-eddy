// papers-api v1: the platform's document door. His mail and documents, captured
// by phone. Files never transit this function: it hands the client short-lived
// signed upload URLs, then records the row; reads hand back signed view URLs.
// Same device token as the Eddy and the Harbor. Private bucket, service role
// inside, RLS sealed. verify_jwt=false is deliberate.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_HASH = "65c1760f8404c8eec8bbc938ac3c9a0ab60623eea93a643f25214cd628fc9e4f";
const ALLOWED_ORIGINS = ["https://jerrunge.github.io", "https://jeremyrunge.com", "https://www.jeremyrunge.com", "http://localhost:4181"];
const BUCKET = "papers";
const CATEGORIES = ["house", "money", "legal", "maddy", "health", "work", "cooper", "personal"];

function cors(origin: string | null) {
  const o = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const safeExt = (e: string) => (String(e || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg");

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
  const store = sb.storage.from(BUCKET);
  try {
    if (body.op === "list") {
      let q = sb.from("papers").select("id, category, title, note, doc_date, storage_path, thumb_path, mime, size_bytes, box_id, item_id, created_at").eq("archived", false).order("doc_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(400);
      if (body.category && CATEGORIES.includes(body.category)) q = q.eq("category", body.category);
      if (body.box_id) q = q.eq("box_id", body.box_id);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      const thumbPaths = rows.map((r: any) => r.thumb_path).filter(Boolean);
      const signed = thumbPaths.length ? await store.createSignedUrls(thumbPaths, 3600) : { data: [] };
      const urlByPath: Record<string, string> = {};
      for (const s of (signed.data ?? []) as any[]) if (s?.path && s?.signedUrl) urlByPath[s.path] = s.signedUrl;
      const out = rows.map((r: any) => ({ ...r, thumb_url: r.thumb_path ? (urlByPath[r.thumb_path] ?? null) : null }));
      const counts: Record<string, number> = {};
      const all = await sb.from("papers").select("category, box_id").eq("archived", false);
      for (const r of (all.data ?? []) as any[]) { counts[r.category] = (counts[r.category] ?? 0) + 1; if (r.box_id) counts["box:" + r.box_id] = (counts["box:" + r.box_id] ?? 0) + 1; }
      return new Response(JSON.stringify({ papers: out, counts }), { headers });
    }

    if (body.op === "prepare") {
      const id = String(body.id || crypto.randomUUID());
      const yyyy = new Date().getFullYear();
      const ext = safeExt(body.ext);
      const path = `${yyyy}/${id}.${ext}`;
      const thumbPath = body.thumb ? `${yyyy}/${id}-thumb.jpg` : null;
      const main = await store.createSignedUploadUrl(path);
      if (main.error) throw main.error;
      let thumb: any = null;
      if (thumbPath) { const t = await store.createSignedUploadUrl(thumbPath); if (t.error) throw t.error; thumb = { path: thumbPath, url: t.data.signedUrl }; }
      return new Response(JSON.stringify({ id, main: { path, url: main.data.signedUrl }, thumb }), { headers });
    }

    if (body.op === "record") {
      const cat = CATEGORIES.includes(body.category) ? body.category : "personal";
      const row = {
        id: body.id, category: cat,
        title: body.title ? String(body.title).slice(0, 200) : null,
        note: body.note ? String(body.note).slice(0, 2000) : null,
        doc_date: body.doc_date || null,
        storage_path: String(body.storage_path), thumb_path: body.thumb_path || null,
        mime: body.mime || null, size_bytes: body.size_bytes ?? null,
        box_id: body.box_id || null, item_id: body.item_id || null,
      };
      const { error } = await sb.from("papers").upsert(row);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, id: body.id }), { headers });
    }

    if (body.op === "view") {
      const { data: row, error } = await sb.from("papers").select("storage_path, mime").eq("id", body.id).single();
      if (error || !row) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
      const s = await store.createSignedUrl(row.storage_path, 3600);
      if (s.error) throw s.error;
      return new Response(JSON.stringify({ url: s.data.signedUrl, mime: row.mime }), { headers });
    }

    if (body.op === "set") {
      const patch: any = { updated_at: new Date().toISOString() };
      if ("title" in body) patch.title = body.title ? String(body.title).slice(0, 200) : null;
      if ("note" in body) patch.note = body.note ? String(body.note).slice(0, 2000) : null;
      if ("doc_date" in body) patch.doc_date = body.doc_date || null;
      if ("category" in body && CATEGORIES.includes(body.category)) patch.category = body.category;
      if ("box_id" in body) patch.box_id = body.box_id || null;
      if ("item_id" in body) patch.item_id = body.item_id || null;
      const { error } = await sb.from("papers").update(patch).eq("id", body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (body.op === "delete") {
      const { data: row } = await sb.from("papers").select("storage_path, thumb_path").eq("id", body.id).single();
      if (row) {
        const paths = [row.storage_path, row.thumb_path].filter(Boolean) as string[];
        if (paths.length) await store.remove(paths);
        await sb.from("papers").delete().eq("id", body.id);
      }
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "unknown op" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e).slice(0, 300) }), { status: 500, headers });
  }
});
