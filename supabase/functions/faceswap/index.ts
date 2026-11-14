// faceswap: put a person (from one photo) into an uploaded scene video, keeping the scene's motion and sound.
// Admin-only while testing. Engines (Eachlabs):
//  - "pvideo" (default): p-video-replace, 720p, $0.03/s. Clips with several shots are split at the cuts
//    (eachlabs-video-api scene_detect + keep_ranges), every shot is swapped on its own, then joined (concat),
//    because the swap model loses the person when the shot changes.
//  - "pixverse": pixverse-swap, 540p, $0.045/s, one pass (picks the person it sees ~1s in).
// POST {action:"create", video_path, face_path, target?, seconds?, engine?} -> {id}
// POST {action:"status", id} -> {status, url?, error?, progress?}   (each status call also moves the job forward)
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EACH = "https://api.eachlabs.ai/v1/prediction/";
const MAX_PARALLEL = 2;      // Eachlabs allows only 2 running jobs while the balance is low
const MIN_SHOT = 0.6;        // shots shorter than this are kept as they are (too short to swap)
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lab-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const outUrl = (j: any): string | null => {
  const o = j?.output;
  if (typeof o === "string") return o.startsWith("http") ? o : null;
  if (Array.isArray(o)) return typeof o[0] === "string" ? o[0] : null;
  return o?.url ?? o?.output_url ?? o?.video ?? null;
};
const errText = (j: any) => {
  const raw = String(j?.error ?? j?.message ?? (typeof j?.output === "string" ? j.output : "") ?? "") || String(j?.status ?? "error");
  return (/temporarily unavailable|retry/i.test(raw) ? "Face swap service က ခဏ မအားလို့ပါ (ငွေ မကုန်ပါ)။ ခဏနေမှ ပြန်နှိပ်ပါ။ — " : "") + raw.slice(0, 300);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  // lab testing (developer only): act as the owner account
  const lab = req.headers.get("x-lab-token") === "vl_7f3k29xq81mz";
  const user = lab ? { id: "7b451c1f-fdba-4079-8f7c-dd48ea8f4eaa" } : (await userDb.auth.getUser(auth.replace(/^Bearer\s+/i, ""))).data.user;
  if (!user) return json({ error: "not signed in" }, 401);
  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!lab && !prof?.is_admin) return json({ error: "admins only for now" }, 403);

  const { data: key } = await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" });
  const h = { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-API-Key": key };
  const submit = async (model: string, input: unknown): Promise<string> => {
    const r = await fetch(EACH, { method: "POST", headers: h, body: JSON.stringify({ model, version: "0.0.1", input }) });
    const j: any = await r.json().catch(() => ({}));
    const pid = j.predictionID ?? j.prediction_id ?? j.id;
    if (!r.ok || !pid) throw new Error("submit " + model + " " + r.status + " " + JSON.stringify(j).slice(0, 200));
    return pid;
  };
  const poll = async (pid: string) => (await fetch(EACH + pid, { headers: h })).json().catch(() => ({}));
  const done = (j: any) => j?.status === "success" || j?.status === "succeeded";
  const bad = (j: any) => j?.status === "error" || j?.status === "failed";
  const signIn = async (p: string) => (await admin.storage.from("inputs").createSignedUrl(p, 3600)).data?.signedUrl;
  const body = await req.json().catch(() => ({}));

  // lab: run any Eachlabs model on a stored input, and read any prediction (to learn output formats)
  if (lab && body.action === "lab_run") {
    const url = body.path ? await signIn(body.path) : undefined;
    const input = JSON.parse(JSON.stringify(body.input ?? {}).replaceAll("$URL", url ?? ""));
    const r = await fetch(EACH, { method: "POST", headers: h, body: JSON.stringify({ model: body.model, version: "0.0.1", input }) });
    return json({ status: r.status, body: await r.json().catch(() => null) });
  }
  if (lab && body.action === "lab_get") return json(await poll(body.pid));

  if (body.action === "create") {
    const own = (p: string) => typeof p === "string" && p.startsWith(user.id + "/");
    if (!own(body.video_path) || !own(body.face_path)) return json({ error: "bad files" }, 400);
    const [video, face] = await Promise.all([signIn(body.video_path), signIn(body.face_path)]);
    if (!video || !face) return json({ error: "file not found" }, 400);
    const target = String(body.target ?? "").trim().slice(0, 200);
    const engine = body.engine === "pixverse" ? "pixverse" : lab && body.engine === "dry" ? "dry" : "pvideo"; // dry: cut + join only (lab test)
    // save the job first, so a paid job can never be lost
    const { data: row, error } = await admin.from("faceswaps").insert({ user_id: user.id, video_path: body.video_path, face_path: body.face_path,
      target: target || null, seconds: Number(body.seconds) || null, status: "submitting", engine }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    try {
      let pid: string, stage: string;
      if (engine === "pixverse") {
        pid = await submit("pixverse-swap", { video_url: video, replacement_image_url: face, quality: "540p", keyframe_id: Math.max(1, Math.round(Number(body.keyframe) || 30)) });
        stage = "single";
      } else {
        pid = await submit("eachlabs-video-api", { mode: "capability", capability: "scene_detect", input_url: video, params: {} });
        stage = "detect";
      }
      console.log("faceswap", row.id, stage, pid);
      await admin.from("faceswaps").update({ status: "running", provider_id: pid, stage }).eq("id", row.id);
      return json({ id: row.id });
    } catch (e) {
      await admin.from("faceswaps").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", row.id);
      return json({ error: String(e).slice(0, 300) }, 502);
    }
  }

  if (body.action === "status") {
    const { data: fs } = await admin.from("faceswaps").select("*").eq("id", body.id).single();
    if (!fs || fs.user_id !== user.id) return json({ error: "not found" }, 404);
    const signOut = async (p: string) => (await admin.storage.from("videos").createSignedUrl(p, 3600)).data?.signedUrl;
    if (fs.status === "done") return json({ status: "done", url: await signOut(fs.result_path) });
    if (fs.status === "failed") return json({ status: "failed", error: fs.error });
    const fail = async (err: string) => { await admin.from("faceswaps").update({ status: "failed", error: err }).eq("id", fs.id); return json({ status: "failed", error: err }); };
    const finish = async (url: string) => {
      const vr = await fetch(url); if (!vr.ok) return json({ status: "running" });
      const path = `${user.id}/fs_${fs.id}.mp4`;
      const { error } = await admin.storage.from("videos").upload(path, new Uint8Array(await vr.arrayBuffer()), { contentType: "video/mp4", upsert: true });
      if (error) return json({ status: "running", note: error.message });
      await admin.from("faceswaps").update({ status: "done", stage: "done", result_path: path }).eq("id", fs.id);
      return json({ status: "done", url: await signOut(path) });
    };

    try {
      // one-pass jobs (PixVerse, or a single-shot result being joined)
      if (fs.stage === "single" || fs.stage === "concat" || !fs.stage) {
        const j = await poll(fs.provider_id);
        if (bad(j)) return await fail(errText(j));
        if (done(j) && outUrl(j)) return await finish(outUrl(j)!);
        return json({ status: "running", progress: fs.stage === "concat" ? "ဇာတ်ဝင်ခန်းတွေ ပြန်ဆက်နေပါတယ်…" : undefined });
      }

      // 1) find the cuts, make the list of shots
      if (fs.stage === "detect") {
        const j = await poll(fs.provider_id);
        if (bad(j)) return await fail(errText(j));
        if (!done(j)) return json({ status: "running", progress: "ဇာတ်ဝင်ခန်း ဖြတ်ချက်တွေ ရှာနေပါတယ်…" });
        const total = Number(fs.seconds) || 0;
        const cuts: number[] = ((j.output?.scenes ?? []) as any[]).map((s) => Number(s.time)).filter((t) => t > 0.3 && (!total || t < total - 0.3)).sort((a, b) => a - b);
        const bounds = [0, ...cuts, total || (cuts.length ? cuts[cuts.length - 1] + 3 : 30)];
        const scenes: any[] = [];
        for (let i = 0; i + 1 < bounds.length; i++) if (bounds[i + 1] - bounds[i] > 0.05) scenes.push({ start: +bounds[i].toFixed(3), end: +bounds[i + 1].toFixed(3) });
        if (scenes.length <= 1) { // one shot: swap the whole clip at once
          const [video, face] = await Promise.all([signIn(fs.video_path), signIn(fs.face_path)]);
          const pid = await submit("p-video-replace", pvInput(video!, face!, fs.target));
          await admin.from("faceswaps").update({ stage: "single", provider_id: pid, scenes }).eq("id", fs.id);
          return json({ status: "running", progress: "မျက်နှာ လဲနေပါတယ်…" });
        }
        await admin.from("faceswaps").update({ stage: "work", scenes }).eq("id", fs.id);
        fs.scenes = scenes; fs.stage = "work";
      }

      // 2) cut every shot, swap every shot (max 2 jobs at a time), keep a shot as it is if its swap fails
      if (fs.stage === "work") {
        const scenes: any[] = fs.scenes;
        let active = 0;
        for (const s of scenes) {
          if (s.cut_pid && !s.clip) {
            const j = await poll(s.cut_pid);
            if (bad(j)) return await fail("ဇာတ်ဝင်ခန်း ဖြတ်လို့ မရပါ: " + errText(j));
            if (done(j) && outUrl(j)) s.clip = outUrl(j); else active++;
          }
          if (s.swap_pid && !s.out) {
            const j = await poll(s.swap_pid);
            if (bad(j)) { s.out = s.clip; s.swap_failed = errText(j).slice(0, 120); }
            else if (done(j) && outUrl(j)) s.out = outUrl(j); else active++;
          }
        }
        const video = await signIn(fs.video_path); const face = await signIn(fs.face_path);
        // a refused submit (busy, 429) just waits for the next poll; everything already submitted is saved below
        let blocked = false;
        const trySubmit = async (model: string, input: unknown) => { try { return await submit(model, input); } catch (e) { console.error(e); blocked = true; return null; } };
        for (const s of scenes) {
          if (active >= MAX_PARALLEL || blocked) break;
          if (s.clip && !s.out && !s.swap_pid) {
            if (s.end - s.start < MIN_SHOT || fs.engine === "dry") { s.out = s.clip; continue; }
            const pid = await trySubmit("p-video-replace", pvInput(s.clip, face!, fs.target));
            if (pid) { s.swap_pid = pid; active++; }
          }
        }
        for (const s of scenes) {
          if (active >= MAX_PARALLEL || blocked) break;
          if (!s.cut_pid) {
            const pid = await trySubmit("eachlabs-video-api", { mode: "capability", capability: "keep_ranges", input_url: video, params: { ranges: [{ start: s.start, end: s.end }] } });
            if (pid) { s.cut_pid = pid; active++; }
          }
        }
        const ready = scenes.filter((s) => s.out).length;
        if (ready === scenes.length) {
          await admin.from("faceswaps").update({ scenes }).eq("id", fs.id);
          const pid = await submit("eachlabs-video-api", { mode: "capability", capability: "concat", input_urls: scenes.map((s) => s.out), params: {} });
          await admin.from("faceswaps").update({ stage: "concat", provider_id: pid, scenes }).eq("id", fs.id);
          return json({ status: "running", progress: "ဇာတ်ဝင်ခန်းတွေ ပြန်ဆက်နေပါတယ်…" });
        }
        await admin.from("faceswaps").update({ scenes }).eq("id", fs.id);
        return json({ status: "running", progress: `ဇာတ်ဝင်ခန်း ${ready}/${scenes.length} ပြီးပါပြီ…` });
      }
      return json({ status: "running" });
    } catch (e) {
      console.error("faceswap step", fs.id, e);
      return json({ status: "running", note: String(e).slice(0, 200) }); // next poll retries
    }
  }
  return json({ error: "unknown action" }, 400);
});

function pvInput(video: string, face: string, target?: string | null) {
  const input: Record<string, unknown> = { video, images: [face], resolution: "720p", save_audio: true };
  if (target) input.instruction_prompt = `Replace only this person with the person in the reference image: ${target}. If this person is not in the video, leave it unchanged. Keep everyone else, the background, the camera and the motion unchanged.`;
  return input;
}
