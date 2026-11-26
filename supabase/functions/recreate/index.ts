// recreate: put the customer (from their photos) into a template video, keeping its moves, camera and cuts.
// Like Higgsfield "Recreate": the template sets the AI engine and the hidden instructions; the customer only adds photos.
// POST {action:"create", template_id, face_paths:[...]} (user JWT) -> {id}      charges template.price credits
// POST {action:"status", id} (user JWT) -> {status, url?, error?}               also moves the job forward
// POST {action:"tick"} (x-cron-token) -> moves every running job forward (pg_cron, every minute)
// Engines (Eachlabs): genjutsu-light (default, $0.10/s 720p), genjutsu ($0.34/s 720p), kling-o3 (3 people max, 3-10 s video).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EACH = "https://api.eachlabs.ai/v1/prediction/";
const TIMEOUT_MS = 50 * 60 * 1000; // Genjutsu can queue for a long time
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const outUrl = (j: any): string | null => {
  const o = j?.output;
  if (typeof o === "string") return o.startsWith("http") ? o : null;
  if (Array.isArray(o)) return typeof o[0] === "string" ? o[0] : null;
  return o?.url ?? o?.video ?? null;
};
const ERR: [RegExp, string][] = [
  [/insufficient credits/i, "insufficient credits"], [/too many running/i, "too many running jobs"],
  [/photo count/i, "photo count"], [/template not found/i, "template not found"], [/invalid photo/i, "invalid photo"],
];

// the hidden instructions: who becomes whom, everything else unchanged
function buildPrompt(t: any, outfit = "photo"): string {
  const slots: any[] = Array.isArray(t.slots) ? t.slots : [];
  const kling = t.engine === "kling-o3";
  const ref = (i: number) => (kling ? `@Element${i + 1}` : `@Image ${i + 1}`);
  const who = slots.map((s, i) => `Replace ${String(s.who || (slots.length === 1 ? "the main person" : `person ${i + 1}`)).slice(0, 120)} with the person in ${ref(i)}.`).join(" ");
  // outfit (owner, 26 Nov): the customer chooses their photo's clothes or the template video's clothes
  const clothes = outfit === "video"
    ? `glasses only if the photo has them. Keep the clothes, shoes and accessories exactly as worn in the source video. `
    : `glasses only if the photo has them, accessories, and the same clothes and shoes as in the photo. `;
  return `${kling ? "In @Video1: " : ""}${who} Each new person must look exactly as in their photo: the same face, skin, hairstyle, ` + clothes +
    `Everything else must stay identical to the source video in every frame: the same background, place, objects, sky, effects, ` +
    `every shot change, the camera framing and movement, the colours and the lighting. Keep every body movement, gesture and the timing exactly as in the source video. ` +
    `Every hand action and every object a person holds must match the source video: what is held, how it is held, and when it is held, thrown or put down.` +
    (t.prompt_extra ? " " + String(t.prompt_extra).slice(0, 1500) : "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));

  const { data: key } = await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" });
  const h = { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-API-Key": key };
  const signIn = async (p: string) => (await admin.storage.from("inputs").createSignedUrl(p, 3 * 3600)).data?.signedUrl;
  const signOut = async (p: string) => (await admin.storage.from("videos").createSignedUrl(p, 3600)).data?.signedUrl;
  const tplUrl = (p: string) => `${SUPABASE_URL}/storage/v1/object/public/templates/${p}`;

  // submit the job to Eachlabs (refund if it cannot even start)
  async function submit(id: string) {
    const { data: r } = await admin.from("recreates").select("*, templates(*)").eq("id", id).single();
    const t = r.templates;
    try {
      const faces: string[] = [];
      for (const p of r.face_paths) { const u = await signIn(p); if (!u) throw new Error("photo not found"); faces.push(u); }
      const video = tplUrl(t.video_path);
      let model: string, input: any;
      if (t.engine === "kling-o3") {
        model = "kling-o3-standard-video-to-video-edit";
        input = { video_url: video, prompt: buildPrompt(t, r.outfit), keep_audio: true, elements: faces.map((u) => ({ frontal_image_url: u, reference_image_urls: [u] })) };
      } else {
        model = t.engine === "genjutsu" ? "genjutsu-motion-transfer" : "genjutsu-light-motion-transfer";
        input = { video_url: video, image_urls: faces, prompt: buildPrompt(t, r.outfit), resolution: t.resolution === "480p" ? "480p" : "720p" };
      }
      const res = await fetch(EACH, { method: "POST", headers: h, body: JSON.stringify({ model, version: "0.0.1", input }) });
      const j: any = await res.json().catch(() => ({}));
      const pid = j.predictionID ?? j.prediction_id ?? j.id;
      if (!res.ok || !pid) throw new Error("submit " + res.status + " " + JSON.stringify(j).slice(0, 200));
      await admin.from("recreates").update({ provider_id: pid }).eq("id", id);
    } catch (e) {
      console.error("recreate submit", id, e);
      await admin.rpc("finish_recreate", { p_id: id, p_ok: false, p_error: String(e).slice(0, 300) });
    }
  }

  // one step for one running job: poll Eachlabs, save the video when it is ready
  async function step(r: any) {
    if (r.status !== "running") return;
    if (!(await admin.rpc("claim_recreate", { p_id: r.id, p_seconds: 110 })).data) return;
    try {
      if (!r.provider_id) {
        if (Date.now() - new Date(r.created_at).getTime() > 3 * 60000) await submit(r.id); // the first submit never happened
        return;
      }
      const j: any = await (await fetch(EACH + r.provider_id, { headers: h })).json().catch(() => ({}));
      if (j.status === "error" || j.status === "failed") {
        await admin.rpc("finish_recreate", { p_id: r.id, p_ok: false, p_error: String(j.error ?? j.status).slice(0, 300) });
      } else if ((j.status === "success" || j.status === "succeeded") && outUrl(j)) {
        const vr = await fetch(outUrl(j)!);
        if (!vr.ok) return;
        const path = `${r.user_id}/rc_${r.id}.mp4`;
        const { error } = await admin.storage.from("videos").upload(path, new Uint8Array(await vr.arrayBuffer()), { contentType: "video/mp4", upsert: true });
        if (error) { console.error("recreate save", error.message); return; }
        await admin.rpc("finish_recreate", { p_id: r.id, p_ok: true, p_path: path });
      } else if (Date.now() - new Date(r.created_at).getTime() > TIMEOUT_MS) {
        await admin.rpc("finish_recreate", { p_id: r.id, p_ok: false, p_error: "timeout" });
      }
    } finally {
      await admin.from("recreates").update({ locked_until: null }).eq("id", r.id);
    }
  }

  // background tick
  if (body.action === "tick") {
    const { data: want } = await admin.rpc("get_app_secret", { p_name: "cron_token" });
    if (!want || req.headers.get("x-cron-token") !== want) return json({ error: "bad token" }, 401);
    const { data: rows } = await admin.from("recreates").select("*").eq("status", "running").order("created_at").limit(8);
    for (const r of rows ?? []) { try { await step(r); } catch (e) { console.error("tick", r.id, e); } }
    return json({ ok: true, n: rows?.length ?? 0 });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userDb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "not signed in" }, 401);

  if (body.action === "create") {
    const faces = Array.isArray(body.face_paths) ? body.face_paths.map(String).slice(0, 8) : [];
    const { data: id, error } = await userDb.rpc("start_recreate", { p_template: body.template_id, p_faces: faces });
    if (error) { const m = ERR.find(([r]) => r.test(error.message)); return json({ error: m ? m[1] : error.message }, 400); }
    if (body.outfit === "video") await admin.from("recreates").update({ outfit: "video" }).eq("id", id);
    const work = submit(id);
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
    return json({ id });
  }

  if (body.action === "status") {
    const { data: r } = await userDb.from("recreates").select("*").eq("id", body.id).single(); // RLS: own rows only
    if (!r) return json({ error: "not found" }, 404);
    if (r.status === "running") { await step(r).catch((e) => console.error("status step", e)); }
    const { data: f } = await userDb.from("recreates").select("*").eq("id", body.id).single();
    return json({ status: f.status, error: f.error, cost: f.cost, url: f.status === "done" && f.result_path ? await signOut(f.result_path) : undefined });
  }

  return json({ error: "unknown action" }, 400);
});
