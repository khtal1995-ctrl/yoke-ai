// faceswap: put a person (from one photo) into an uploaded scene video, keeping the scene's motion and sound.
// Admin-only while testing. Uses Eachlabs "p-video-replace" (720p, $0.03 per output second).
// POST {action:"create", video_path, face_path, target?, seconds?} -> {id}
// POST {action:"status", id} -> {status, url?, error?}
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user } } = await userDb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "not signed in" }, 401);
  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!prof?.is_admin) return json({ error: "admins only for now" }, 403);

  const { data: key } = await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" });
  const h = { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-API-Key": key };
  const body = await req.json().catch(() => ({}));

  if (body.action === "create") {
    const own = (p: string) => typeof p === "string" && p.startsWith(user.id + "/");
    if (!own(body.video_path) || !own(body.face_path)) return json({ error: "bad files" }, 400);
    const sign = async (p: string) => (await admin.storage.from("inputs").createSignedUrl(p, 3600)).data?.signedUrl;
    const [video, face] = await Promise.all([sign(body.video_path), sign(body.face_path)]);
    if (!video || !face) return json({ error: "file not found" }, 400);
    const target = String(body.target ?? "").trim().slice(0, 200);
    const input: Record<string, unknown> = { video, images: [face], resolution: "720p", save_audio: true };
    if (target) input.instruction_prompt = `Replace only this person with the person in the reference image: ${target}. Keep everyone else, the background, the camera and the motion unchanged.`;
    const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: h, body: JSON.stringify({ model: "p-video-replace", version: "0.0.1", input }) });
    const j: any = await r.json().catch(() => ({}));
    const pid = j.predictionID ?? j.prediction_id ?? j.id;
    if (!r.ok || !pid) return json({ error: "submit " + r.status + " " + JSON.stringify(j).slice(0, 300) }, 502);
    const { data: row, error } = await admin.from("faceswaps").insert({ user_id: user.id, video_path: body.video_path, face_path: body.face_path,
      target: target || null, seconds: Number(body.seconds) || null, provider_id: pid }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    return json({ id: row.id });
  }

  if (body.action === "status") {
    const { data: fs } = await admin.from("faceswaps").select("*").eq("id", body.id).single();
    if (!fs || fs.user_id !== user.id) return json({ error: "not found" }, 404);
    const signOut = async (p: string) => (await admin.storage.from("videos").createSignedUrl(p, 3600)).data?.signedUrl;
    if (fs.status === "done") return json({ status: "done", url: await signOut(fs.result_path) });
    if (fs.status === "failed") return json({ status: "failed", error: fs.error });
    const r = await fetch(`https://api.eachlabs.ai/v1/prediction/${fs.provider_id}`, { headers: h });
    const j: any = await r.json().catch(() => ({}));
    if (j.status === "error" || j.status === "failed") {
      const err = String(j.error ?? j.message ?? j.status).slice(0, 300);
      await admin.from("faceswaps").update({ status: "failed", error: err }).eq("id", fs.id);
      return json({ status: "failed", error: err });
    }
    if ((j.status === "success" || j.status === "succeeded") && j.output) {
      const out = Array.isArray(j.output) ? j.output[0] : j.output;
      const vr = await fetch(out);
      if (!vr.ok) return json({ status: "running" });
      const path = `${user.id}/fs_${fs.id}.mp4`;
      const { error } = await admin.storage.from("videos").upload(path, new Uint8Array(await vr.arrayBuffer()), { contentType: "video/mp4", upsert: true });
      if (error) return json({ status: "running", note: error.message });
      await admin.from("faceswaps").update({ status: "done", result_path: path }).eq("id", fs.id);
      return json({ status: "done", url: await signOut(path) });
    }
    return json({ status: "running" });
  }
  return json({ error: "unknown action" }, 400);
});
