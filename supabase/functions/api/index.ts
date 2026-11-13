// Yoke AI — video generation API (Supabase Edge Function)
// Actions (POST JSON, user JWT required):
//   { action: "create", mode, prompt, quality, duration, ratio, image_path? } -> { id }
//   { action: "status", id } -> { generation, video_url? }
//
// Secrets (Supabase → Edge Functions → Secrets):
//   YOTTA_API_KEY   required — Yotta Labs AI Gateway key
//   LLM_MODEL       optional — chat model on Yotta Gateway used to rewrite prompts
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
let YOTTA_KEY = Deno.env.get("YOTTA_API_KEY") ?? "";
async function loadYottaKey(admin: any) {
  if (YOTTA_KEY) return YOTTA_KEY;
  const { data } = await admin.rpc("get_app_secret", { p_name: "yotta_api_key" });
  YOTTA_KEY = data ?? "";
  return YOTTA_KEY;
}
const LLM_MODEL = Deno.env.get("LLM_MODEL") ?? "grok-4.7";
const YOTTA = "https://gateway.yottalabs.ai";
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const RESOLUTION: Record<string, string> = { std: "540p", hd: "720p" };

// ---------- prompt rewrite (Burmese -> English scene, Burmese dialogue kept) ----------
const SYSTEM_PROMPT = `You turn a Burmese (Myanmar) video request into one English prompt for the PixVerse V6 video model.
Rules:
- Describe the scene, people, setting (Myanmar), camera and lighting in clear English.
- Any spoken words must stay in Burmese script, in quotes, written as: <who> says in Burmese: "<text>".
- If two or more people speak, say who is on the left/right and the order: first..., then...
- Keep dialogue short (one line per speaker). If no dialogue was asked for, add none.
- Output only the final prompt, no notes.`;

async function rewritePrompt(mm: string): Promise<string> {
  if (!LLM_MODEL) return fallbackPrompt(mm);
  try {
    const r = await fetch(`${YOTTA}/api/maas/chat/completions`, {
      method: "POST",
      headers: { "X-API-KEY": YOTTA_KEY, "Authorization": `Bearer ${YOTTA_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL, temperature: 0.4, max_tokens: 1500,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: mm }],
      }),
    });
    if (!r.ok) throw new Error(`llm ${r.status}`);
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content?.trim();
    return text || fallbackPrompt(mm);
  } catch (e) {
    console.error("rewritePrompt failed:", e);
    return fallbackPrompt(mm);
  }
}
const fallbackPrompt = (mm: string) =>
  `A realistic scene set in Myanmar. ${mm}. Any speech is spoken in Burmese. Natural light, cinematic.`;

// ---------- Yotta Gateway: PixVerse V6 ----------
async function submitVideo(g: any, prompt: string, imageUrl?: string): Promise<string> {
  const isI2v = g.mode === "i2v";
  const path = isI2v ? "image-to-video" : "text-to-video";
  const parameters: Record<string, unknown> = {
    prompt,
    resolution: RESOLUTION[g.quality] ?? "540p",
    duration: g.duration,
    generate_audio: true,
  };
  if (isI2v) parameters.first_frame = imageUrl;
  else parameters.aspect_ratio = g.ratio;

  const r = await fetch(`${YOTTA}/api/maas/${path}/generations`, {
    method: "POST",
    headers: { "X-API-KEY": YOTTA_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: isI2v ? "pixverse-v6-i2v" : "pixverse-v6-t2v", parameters }),
  });
  const j = await r.json().catch(() => ({}));
  const id = j?.data?.request_id ?? j?.request_id;
  if (!r.ok || !id) throw new Error(`submit failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
  return id;
}

async function pollVideo(g: any): Promise<{ state: "running" | "done" | "failed"; url?: string; error?: string }> {
  const path = g.mode === "i2v" ? "image-to-video" : "text-to-video";
  const r = await fetch(`${YOTTA}/api/maas/${path}/generations/${g.provider_request_id}`, {
    headers: { "X-API-KEY": YOTTA_KEY },
  });
  const j = await r.json().catch(() => ({}));
  const d = j?.data ?? j;
  const status = String(d?.status ?? "").toLowerCase();
  const url = d?.output_url ?? d?.output?.url ?? d?.video_url;
  if (status === "completed" || status === "succeeded" || status === "success") {
    return url ? { state: "done", url } : { state: "failed", error: "no output url" };
  }
  if (["failed", "error", "cancelled", "canceled", "rejected"].includes(status)) {
    return { state: "failed", error: d?.error?.message ?? d?.error ?? d?.message ?? status };
  }
  return { state: "running" };
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user } } = await userDb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "not signed in" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  await loadYottaKey(admin);

  // ---- create ----
  if (body.action === "create") {
    if (!YOTTA_KEY) return json({ error: "AI service is not configured yet" }, 503);
    const { data: id, error } = await userDb.rpc("create_generation", {
      p_mode: body.mode, p_prompt: String(body.prompt ?? "").slice(0, 2000),
      p_quality: body.quality, p_duration: Number(body.duration), p_ratio: body.ratio,
      p_image_path: body.image_path ?? null,
    });
    if (error) return json({ error: error.message }, 400);

    const { data: g } = await admin.from("generations").select("*").eq("id", id).single();
    try {
      const en = await rewritePrompt(g.prompt_mm);
      let imageUrl: string | undefined;
      if (g.mode === "i2v") {
        const { data: s, error: se } = await admin.storage.from("inputs").createSignedUrl(g.image_path, 3600);
        if (se || !s) throw new Error("image not found");
        imageUrl = s.signedUrl;
      }
      const reqId = await submitVideo(g, en, imageUrl);
      await admin.from("generations").update({ status: "running", prompt_en: en, provider_request_id: reqId }).eq("id", id);
      return json({ id });
    } catch (e) {
      console.error("create failed:", e);
      await admin.rpc("finish_generation", { p_id: id, p_ok: false, p_error: String(e).slice(0, 500) });
      return json({ error: "AI service error — credits refunded", id }, 502);
    }
  }

  // ---- status ----
  if (body.action === "status") {
    // RLS: the user can only read their own rows
    const { data: g } = await userDb.from("generations").select("*").eq("id", body.id).single();
    if (!g) return json({ error: "not found" }, 404);

    if (g.status === "queued" && Date.now() - new Date(g.created_at).getTime() > 3 * 60 * 1000) {
      await admin.rpc("finish_generation", { p_id: g.id, p_ok: false, p_error: "never started" });
    }
    if (g.status === "running" && g.provider_request_id) {
      const age = Date.now() - new Date(g.created_at).getTime();
      const p = await pollVideo(g);
      if (p.state === "done") {
        try {
          const vr = await fetch(p.url!);
          if (!vr.ok) throw new Error(`download ${vr.status}`);
          const bytes = new Uint8Array(await vr.arrayBuffer());
          const path = `${g.user_id}/${g.id}.mp4`;
          const { error: ue } = await admin.storage.from("videos").upload(path, bytes, { contentType: "video/mp4", upsert: true });
          if (ue) throw ue;
          await admin.rpc("finish_generation", { p_id: g.id, p_ok: true, p_video_path: path });
        } catch (e) {
          console.error("save failed:", e); // keep running; next poll retries
        }
      } else if (p.state === "failed" || age > JOB_TIMEOUT_MS) {
        await admin.rpc("finish_generation", { p_id: g.id, p_ok: false, p_error: p.error ?? "timeout" });
      }
    }

    const { data: fresh } = await userDb.from("generations").select("*").eq("id", body.id).single();
    let video_url: string | undefined;
    if (fresh?.status === "succeeded" && fresh.video_path) {
      const { data: s } = await admin.storage.from("videos").createSignedUrl(fresh.video_path, 3600);
      video_url = s?.signedUrl;
    }
    return json({ generation: fresh, video_url });
  }

  return json({ error: "unknown action" }, 400);
});
