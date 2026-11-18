// project: story series made episode by episode.
// The Story Bible (characters with fixed photo + voice, places, what happened, where everyone is now) lives in the database;
// every new episode is written from that saved record, so the story stays consistent even weeks later.
//
// Actions (POST JSON, user JWT):
//   { action: "create", title, idea, ratio?, quality? } -> { id }            AI drafts the Story Bible from the idea
//   { action: "get", id } -> { project, characters, episodes, scenes }       scenes of the latest episode
//   { action: "list" } -> { projects }
//   { action: "update_bible", id, premise_mm?, setting_mm?, state_mm?, characters?: [...] }
//   { action: "suggest", id } -> { ideas: [{title_mm, idea_mm}] }           3 ideas for the next episode
//   { action: "episode_plan", id, mode: "script"|"idea", text, episode_id? } -> { episode_id }   scenes + story checks, no credits
//   { action: "episode_update", episode_id, scenes: [{story_mm, cast_names}], summary_mm? }      edit before paying
//   { action: "produce", episode_id } -> { ok }                               pays scene by scene in the background
//   { action: "resume", episode_id }                                          try failed scenes again
// Cron: x-cron-token + { action: "tick" } moves producing/stitching episodes forward.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOTTA = "https://gateway.yottalabs.ai";
const MAX_SCENES = 30;          // one episode: at most 5 minutes (30 x 10 s)
const PARALLEL = 3;             // scenes rendering at the same time per episode
const MAX_ATTEMPTS = 2;         // a failed scene is refunded and tried once more

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const bg = (work: Promise<unknown>) => {
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else return work;
};
const isId = (x: any) => /^[0-9a-f-]{36}$/i.test(String(x ?? ""));
const clip = (x: any, n: number) => String(x ?? "").trim().slice(0, n);

// the owner's voices (same ids as the api function's dubbing)
const V = {
  MAIN_MALE: "d4WXuYHO9Ot8KDdiOwIg", MAIN_FEMALE: "12GZ6E7rJLrs85C6m4J6", MALE_1: "B5MB163SdECMmHySTkLK",
  SU: "NBISYoQ4SVxq8eZxoHlV", OLD_MAN: "uh7A30exzQsUAB5ovsOu", CHILD: "uFPN3uAkEca3mQ6uRmBk",
};
function pickVoice(c: any, taken: string[]): string {
  const f = c.gender === "female";
  const opts = c.age === "child" ? [V.CHILD] : c.age === "old" ? (f ? [V.SU, V.MAIN_FEMALE] : [V.OLD_MAN, V.MALE_1])
    : c.age === "middle" ? (f ? [V.SU, V.MAIN_FEMALE] : [V.MALE_1, V.OLD_MAN]) : (f ? [V.MAIN_FEMALE, V.SU] : [V.MAIN_MALE, V.MALE_1]);
  return opts.find((o) => !taken.includes(o)) ?? opts[0];
}

// ---------- LLM (grok via Yotta, same as the planner) ----------
let YKEY = "";
async function yotta(admin: any) {
  if (!YKEY) YKEY = (await admin.rpc("get_app_secret", { p_name: "yotta_api_key" })).data ?? "";
  return YKEY;
}
async function llmJson(admin: any, system: string, user: string, maxTokens = 4000): Promise<any> {
  const key = await yotta(admin);
  for (let t = 0; t < 2; t++) {
    const r = await fetch(`${YOTTA}/api/maas/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(110000),
      headers: { "X-API-KEY": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.7", temperature: 0.5, max_tokens: maxTokens, reasoning_effort: "low",
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) { if (t) throw new Error(`llm ${r.status}`); continue; }
    const txt = String((await r.json())?.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try { return JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); } catch { if (t) throw new Error("llm bad json"); }
  }
}

const BURMESE_STYLE = "Write everything for the customer in natural, simple Burmese (Myanmar Unicode). People and places are Burmese/Myanmar.";

// ---------- Story Bible ----------
async function loadBible(admin: any, projectId: string) {
  const [{ data: p }, { data: chars }, { data: eps }] = await Promise.all([
    admin.from("projects").select("*").eq("id", projectId).single(),
    admin.from("project_characters").select("*").eq("project_id", projectId).order("sort"),
    admin.from("episodes").select("num,title,summary_mm,status").eq("project_id", projectId).order("num"),
  ]);
  return { p, chars: chars ?? [], eps: eps ?? [] };
}
function bibleText(b: any, beforeNum?: number) {
  const done = b.eps.filter((e: any) => e.status === "done" && e.summary_mm && (beforeNum == null || e.num < beforeNum));
  return [
    `Series title: ${b.p.title}`,
    b.p.premise_mm ? `Story: ${b.p.premise_mm}` : "",
    b.p.setting_mm ? `Places and time: ${b.p.setting_mm}` : "",
    "Characters (keep their names, looks and personalities exactly):",
    ...b.chars.map((c: any) => `- ${c.name} (${c.gender}, ${c.age}): looks: ${c.look_mm ?? "-"}; personality and relationships: ${c.personality_mm ?? "-"}`),
    done.length ? "What happened so far:" : "This is the first episode.",
    ...done.map((e: any) => `- Episode ${e.num}${e.title ? ` "${e.title}"` : ""}: ${e.summary_mm}`),
    b.p.state_mm ? `Where everyone is and what is going on now: ${b.p.state_mm}` : "",
  ].filter(Boolean).join("\n");
}

async function draftBible(admin: any, id: string) {
  const { data: p } = await admin.from("projects").select("*").eq("id", id).single();
  try {
    const out = await llmJson(admin, `You plan a Burmese short-drama series from a customer's idea. ${BURMESE_STYLE}
Return ONLY JSON: {"premise_mm": "<what the series is about, 2-4 sentences>", "setting_mm": "<main places and time, 1-3 sentences>",
"characters": [{"name": "<Burmese name>", "gender": "male|female", "age": "child|young|middle|old", "look_mm": "<face, hair, usual clothes, 1 sentence>", "personality_mm": "<character and relationships to the others, 1-2 sentences>"}]}
Rules: keep every name, place and fact the customer wrote; only add what is missing. 2 to 6 main characters. Realistic Myanmar names, clothes and places.`,
      `Series title: ${p.title}\nIdea: ${p.idea_mm}`);
    const chars = (Array.isArray(out?.characters) ? out.characters : []).slice(0, 6);
    const taken: string[] = [];
    const rows = chars.filter((c: any) => clip(c?.name, 30)).map((c: any, i: number) => {
      const row = { project_id: id, name: clip(c.name, 30), gender: c.gender === "female" ? "female" : "male",
        age: ["child", "young", "middle", "old"].includes(c.age) ? c.age : "young",
        look_mm: clip(c.look_mm, 300), personality_mm: clip(c.personality_mm, 400), sort: i, voice_id: "" };
      row.voice_id = pickVoice(row, taken); taken.push(row.voice_id);
      return row;
    });
    if (rows.length) await admin.from("project_characters").upsert(rows, { onConflict: "project_id,name" });
    await admin.from("projects").update({ premise_mm: clip(out?.premise_mm, 1200), setting_mm: clip(out?.setting_mm, 800), status: "ready", updated_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    await admin.from("projects").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", id);
  }
}

// ---------- episode planning: scenes of about 10 seconds each ----------
async function planEpisode(admin: any, epId: string) {
  const { data: ep } = await admin.from("episodes").select("*").eq("id", epId).single();
  try {
    const b = await loadBible(admin, ep.project_id);
    const names = b.chars.map((c: any) => c.name);
    const out = await llmJson(admin, `You split one episode of a Burmese short-drama series into scenes for an AI video model that makes 10-second clips with native Burmese speech. ${BURMESE_STYLE}
Return ONLY JSON: {"title_mm": "<short episode title>", "scenes": [{"story_mm": "<this 10-second scene in Burmese: where, who, what they do, the exact Burmese lines in quotes, their emotion>", "cast": ["<character names in this scene>"]}], "warnings_mm": ["<a problem with the story so far, in Burmese>"]}
Rules:
- One scene = one moment of about 10 seconds: one place, at most 3 characters, at most 2 short lines of dialogue (about 12 Burmese words in total). Long conversations go over several scenes.
- Use the characters' names exactly. Keep their looks, personalities and relationships from the Story Bible. Continue from where the story is now.
- Every scene must make sense on its own: say the place and the characters again in each scene (the video model sees one scene at a time).
- Dialogue is the heart: punchlines, brags, twists and emotional lines are spoken by the characters themselves.
- If the customer gave a full script (mode "script"): keep their story, order and quoted words exactly; only split it into scenes.
- If the customer gave only an idea (mode "idea"): write a complete, dramatic episode from it with a hook at the start and a cliffhanger at the end; 6 to 12 scenes unless the idea asks for more.
- At most ${MAX_SCENES} scenes.
- "warnings_mm": list real contradictions with the Story Bible (a character who left or died appears again, a broken relationship, a wrong place). Empty list if none. Never warn about style.
- "cast" may only contain these names: ${names.join(", ") || "(none yet)"}. Other people (a seller, a crowd) are described in story_mm but not listed.`,
      `${bibleText(b, ep.num)}\n\nEpisode ${ep.num}. Mode: ${ep.input_mode}.\nCustomer's ${ep.input_mode === "script" ? "script" : "idea"}:\n${ep.input_mm}`, 8000);
    const scenes = (Array.isArray(out?.scenes) ? out.scenes : []).filter((s: any) => clip(s?.story_mm, 900)).slice(0, MAX_SCENES);
    if (!scenes.length) throw new Error("no scenes");
    await admin.from("episode_scenes").delete().eq("episode_id", epId).eq("status", "pending");
    await admin.from("episode_scenes").insert(scenes.map((s: any, i: number) => ({
      episode_id: epId, idx: i, story_mm: clip(s.story_mm, 900),
      cast_names: (Array.isArray(s.cast) ? s.cast : []).map((n: any) => clip(n, 30)).filter((n: string) => names.includes(n)).slice(0, 3),
    })));
    const { data: pr } = await admin.from("projects").select("quality").eq("id", ep.project_id).single();
    const per = pr.quality === "hd" ? 50 : 35;
    await admin.from("episodes").update({ status: "ready", title: clip(out.title_mm, 80) || null, cost: per * scenes.length,
      warnings: (Array.isArray(out.warnings_mm) ? out.warnings_mm : []).map((w: any) => clip(w, 300)).filter(Boolean).slice(0, 5) }).eq("id", epId);
  } catch (e) {
    await admin.from("episodes").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", epId);
  }
}

// ---------- producing: plan each scene with the planner, pay for it, start it through the api pipeline ----------
async function startScene(admin: any, ep: any, b: any, s: any, total: number) {
  const chars = b.chars.filter((c: any) => s.cast_names.includes(c.name));
  const refs = chars.filter((c: any) => c.photo_path).slice(0, 3).map((c: any) => ({ path: c.photo_path, name: c.name }));
  const story = `[Series context, keep it consistent; do not show it as text]\n${bibleText(b, ep.num)}\n\n` +
    `[This video: scene ${s.idx + 1} of ${total} of episode ${ep.num}]\n${s.story_mm}\n` +
    `Characters in this scene: ${chars.map((c: any) => `${c.name} (${c.gender}, ${c.age}, ${c.look_mm ?? ""})`).join("; ") || "as described"}. Use each character's name as "who" for their lines.`;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/planner`, {
    method: "POST", signal: AbortSignal.timeout(140000),
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ story, duration: 10, cast: refs.map((x: any) => x.name) }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.plan?.prompt) throw new Error(j.error ?? `planner ${r.status}`);
  const voices: Record<string, string> = {};
  for (const c of b.chars) if (c.voice_id) voices[c.name] = c.voice_id;
  const { data: plan, error: pe } = await admin.from("plans").insert({ user_id: ep.user_id, prompt_mm: s.story_mm, duration: 10, mode: "t2v",
    status: "ready", plan: { ...j.plan, voices }, issues: j.issues ?? [], refs: refs.length ? refs : null }).select("id").single();
  if (pe) throw pe;
  const { data: gid, error } = await admin.rpc("episode_scene_generation", { p_scene: s.id, p_plan: plan.id, p_refs: refs });
  if (error) throw new Error(error.message);
  const tok = (await admin.rpc("get_app_secret", { p_name: "cron_token" })).data;
  await fetch(`${SUPABASE_URL}/functions/v1/api`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-token": tok, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action: "start", id: gid }) });
}

async function eachlabsHeaders(admin: any) {
  const { data: k } = await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" });
  return { "Content-Type": "application/json", "X-API-Key": k };
}

async function advance(admin: any, ep: any) {
  if (!(await admin.rpc("claim_episode", { p_id: ep.id, p_seconds: 110 })).data) return;
  try {
    if (ep.status === "producing") {
      const { data: scenes } = await admin.from("episode_scenes").select("*").eq("episode_id", ep.id).order("idx");
      // 1) running scenes: done, or failed (refunded by finish_generation) -> try again
      const gids = scenes.filter((s: any) => s.status === "running" && s.generation_id).map((s: any) => s.generation_id);
      const { data: gens } = gids.length ? await admin.from("generations").select("id,status,error").in("id", gids) : { data: [] };
      for (const g of gens ?? []) {
        const s = scenes.find((x: any) => x.generation_id === g.id);
        if (g.status === "succeeded") { s.status = "done"; await admin.from("episode_scenes").update({ status: "done" }).eq("id", s.id); }
        if (g.status === "failed") { s.status = s.attempts < MAX_ATTEMPTS ? "pending" : "failed"; await admin.from("episode_scenes").update({ status: s.status }).eq("id", s.id); }
      }
      // 2) start the next scenes (one or two per minute; the planner takes ~30-60 s)
      const b = await loadBible(admin, ep.project_id);
      let running = scenes.filter((s: any) => s.status === "running").length;
      const t0 = Date.now();
      for (const s of scenes.filter((x: any) => x.status === "pending")) {
        if (running >= PARALLEL || Date.now() - t0 > 50000) break;
        try { await startScene(admin, ep, b, s, scenes.length); running++; }
        catch (e) {
          const msg = String((e as any)?.message ?? e);
          if (/insufficient credits/.test(msg)) {
            await admin.from("episodes").update({ status: "failed", error: "credit မလောက်ပါ — credit ဖြည့်ပြီး ဆက်ထုတ်ပါ" }).eq("id", ep.id);
            return;
          }
          console.error("scene start failed", s.id, msg);
          await admin.from("episode_scenes").update({ attempts: s.attempts + 1, status: s.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending" }).eq("id", s.id);
        }
      }
      // 3) everything finished?
      const { data: now } = await admin.from("episode_scenes").select("status,generation_id,idx").eq("episode_id", ep.id).order("idx");
      if (now.some((s: any) => s.status === "pending" || s.status === "running")) return;
      const bad = now.filter((s: any) => s.status === "failed").map((s: any) => s.idx + 1);
      if (bad.length) {
        await admin.from("episodes").update({ status: "failed", error: `Scene ${bad.join(", ")} မအောင်မြင်ပါ (credit ပြန်အမ်းပြီး) — "ပြန်ထုတ်" နှိပ်ပါ` }).eq("id", ep.id);
        return;
      }
      // 4) join the scenes into one episode video
      const { data: gv } = await admin.from("generations").select("id,video_path").in("id", now.map((s: any) => s.generation_id));
      const urls: string[] = [];
      for (const s of now) {
        const path = gv.find((g: any) => g.id === s.generation_id)?.video_path;
        const { data: su } = await admin.storage.from("videos").createSignedUrl(path, 6 * 3600);
        urls.push(su!.signedUrl);
      }
      if (urls.length === 1) { await saveEpisode(admin, ep, urls[0]); return; }
      const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabsHeaders(admin),
        body: JSON.stringify({ model: "eachlabs-video-api", version: "0.0.1", input: { capability: "concat", input_urls: urls, params: {} } }) });
      const j: any = await r.json().catch(() => ({}));
      const pid = j.predictionID ?? j.prediction_id ?? j.id;
      if (!r.ok || !pid) throw new Error("concat submit " + r.status + " " + JSON.stringify(j).slice(0, 200));
      await admin.from("episodes").update({ status: "stitching", stitch_id: pid }).eq("id", ep.id);
    } else if (ep.status === "stitching") {
      const r = await fetch(`https://api.eachlabs.ai/v1/prediction/${ep.stitch_id}`, { headers: await eachlabsHeaders(admin) });
      const j: any = await r.json().catch(() => ({}));
      if ((j.status === "success" || j.status === "succeeded") && j.output) await saveEpisode(admin, ep, Array.isArray(j.output) ? j.output[0] : j.output);
      else if (j.status === "error" || j.status === "failed") {
        // joining failed: try once more on the next tick
        await admin.from("episodes").update({ status: "producing", stitch_id: null }).eq("id", ep.id);
      }
    }
  } finally {
    await admin.from("episodes").update({ locked_until: null }).eq("id", ep.id);
  }
}

async function saveEpisode(admin: any, ep: any, url: string) {
  const vr = await fetch(url);
  if (!vr.ok) throw new Error(`download ${vr.status}`);
  const path = `${ep.user_id}/ep_${ep.id}.mp4`;
  const { error } = await admin.storage.from("videos").upload(path, new Uint8Array(await vr.arrayBuffer()), { contentType: "video/mp4", upsert: true });
  if (error) throw error;
  await admin.from("episodes").update({ status: "done", video_path: path, finished_at: new Date().toISOString(), error: null }).eq("id", ep.id);
  await rememberEpisode(admin, ep.id);
}

// after an episode: write what happened and where everyone is now into the Story Bible
async function rememberEpisode(admin: any, epId: string) {
  try {
    const { data: ep } = await admin.from("episodes").select("*").eq("id", epId).single();
    const { data: scenes } = await admin.from("episode_scenes").select("idx,story_mm").eq("episode_id", epId).order("idx");
    const b = await loadBible(admin, ep.project_id);
    const out = await llmJson(admin, `You keep the Story Bible of a Burmese drama series. ${BURMESE_STYLE}
Return ONLY JSON: {"summary_mm": "<what happened in this episode, 2-4 sentences>", "state_mm": "<after this episode: where each main character is, how they feel, relationships, open questions; 2-5 sentences>"}`,
      `${bibleText(b, ep.num)}\n\nEpisode ${ep.num} scenes:\n${scenes.map((s: any) => `${s.idx + 1}. ${s.story_mm}`).join("\n")}`);
    await admin.from("episodes").update({ summary_mm: clip(out?.summary_mm, 1200) }).eq("id", epId);
    await admin.from("projects").update({ state_mm: clip(out?.state_mm, 1500), updated_at: new Date().toISOString() }).eq("id", ep.project_id);
  } catch (e) { console.error("remember failed", e); }
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const cronTok = req.headers.get("x-cron-token");
  if (cronTok) {
    const { data: want } = await admin.rpc("get_app_secret", { p_name: "cron_token" });
    if (!want || cronTok !== want) return json({ error: "bad token" }, 401);
    const { data: eps } = await admin.from("episodes").select("*").in("status", ["producing", "stitching"]).order("created_at").limit(5);
    await Promise.all((eps ?? []).map((e: any) => advance(admin, e).catch((err) => console.error("tick", e.id, err))));
    return json({ ok: true, n: eps?.length ?? 0 });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await userDb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "not signed in" }, 401);
  const uid = user.id;
  const ownProject = async (id: any) => {
    if (!isId(id)) return null;
    const { data } = await admin.from("projects").select("*").eq("id", id).eq("user_id", uid).maybeSingle();
    return data;
  };
  const ownEpisode = async (id: any) => {
    if (!isId(id)) return null;
    const { data } = await admin.from("episodes").select("*").eq("id", id).eq("user_id", uid).maybeSingle();
    return data;
  };
  const sign = async (bucket: string, path: string | null) => path ? (await admin.storage.from(bucket).createSignedUrl(path, 3600)).data?.signedUrl ?? null : null;

  switch (body.action) {
    case "create": {
      const title = clip(body.title, 80), idea = clip(body.idea, 3000);
      if (!title || !idea) return json({ error: "ဇာတ်လမ်းနာမည်နဲ့ idea ထည့်ပါ" }, 400);
      const { count } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", new Date(Date.now() - 3600000).toISOString());
      if ((count ?? 0) >= 10) return json({ error: "too many projects, please wait a little" }, 429);
      const { data: p, error } = await admin.from("projects").insert({ user_id: uid, title, idea_mm: idea,
        ratio: ["9:16", "16:9", "1:1"].includes(body.ratio) ? body.ratio : "9:16", quality: body.quality === "hd" ? "hd" : "std" }).select("id").single();
      if (error) return json({ error: error.message }, 400);
      bg(draftBible(admin, p.id));
      return json({ id: p.id });
    }
    case "list": {
      const { data } = await admin.from("projects").select("id,title,status,updated_at").eq("user_id", uid).order("updated_at", { ascending: false }).limit(50);
      return json({ projects: data ?? [] });
    }
    case "get": {
      const p = await ownProject(body.id);
      if (!p) return json({ error: "not found" }, 404);
      const { data: chars } = await admin.from("project_characters").select("*").eq("project_id", p.id).order("sort");
      const { data: eps } = await admin.from("episodes").select("*").eq("project_id", p.id).order("num");
      for (const c of chars ?? []) c.photo_url = await sign("inputs", c.photo_path);
      for (const e of eps ?? []) e.video_url = e.status === "done" ? await sign("videos", e.video_path) : null;
      const open = (eps ?? []).filter((e: any) => e.status !== "done").pop() ?? null;
      const wantEp = isId(body.episode_id) ? (eps ?? []).find((e: any) => e.id === body.episode_id) : open;
      let scenes: any[] = [];
      if (wantEp) {
        const { data } = await admin.from("episode_scenes").select("id,idx,story_mm,cast_names,status,attempts").eq("episode_id", wantEp.id).order("idx");
        scenes = data ?? [];
      }
      return json({ project: p, characters: chars ?? [], episodes: eps ?? [], scenes, scenes_episode: wantEp?.id ?? null });
    }
    case "update_bible": {
      const p = await ownProject(body.id);
      if (!p) return json({ error: "not found" }, 404);
      const upd: any = { updated_at: new Date().toISOString() };
      for (const k of ["premise_mm", "setting_mm", "state_mm"]) if (k in body) upd[k] = clip(body[k], 1500);
      if ("title" in body && clip(body.title, 80)) upd.title = clip(body.title, 80);
      await admin.from("projects").update(upd).eq("id", p.id);
      if (Array.isArray(body.characters)) {
        if (body.characters.length > 8) return json({ error: "ဇာတ်ကောင် ၈ ယောက်အထိ" }, 400);
        const { data: old } = await admin.from("project_characters").select("*").eq("project_id", p.id);
        const keep: string[] = []; const taken = (old ?? []).map((c: any) => c.voice_id);
        for (const [i, c] of body.characters.entries()) {
          const name = clip(c?.name, 30); if (!name) continue;
          const photo = c.photo_path ? String(c.photo_path) : null;
          if (photo && (!photo.startsWith(uid + "/") || photo.includes(".."))) return json({ error: "invalid photo" }, 400);
          const prev = (old ?? []).find((o: any) => (isId(c.id) && o.id === c.id) || o.name === name);
          const row: any = { project_id: p.id, name, gender: c.gender === "female" ? "female" : "male",
            age: ["child", "young", "middle", "old"].includes(c.age) ? c.age : "young",
            look_mm: clip(c.look_mm, 300), personality_mm: clip(c.personality_mm, 400), photo_path: photo, sort: i };
          row.voice_id = prev?.voice_id || pickVoice(row, taken); taken.push(row.voice_id);
          if (prev) await admin.from("project_characters").update(row).eq("id", prev.id);
          else await admin.from("project_characters").insert(row);
          keep.push(name);
        }
        const gone = (old ?? []).filter((o: any) => !keep.includes(o.name)).map((o: any) => o.id);
        if (gone.length) await admin.from("project_characters").delete().in("id", gone);
      }
      return json({ ok: true });
    }
    case "suggest": {
      const p = await ownProject(body.id);
      if (!p) return json({ error: "not found" }, 404);
      const b = await loadBible(admin, p.id);
      const out = await llmJson(admin, `You suggest what happens next in a Burmese drama series. ${BURMESE_STYLE}
Return ONLY JSON: {"ideas": [{"title_mm": "<2-5 words with one emoji>", "idea_mm": "<the next episode in 1-2 sentences>"}]} with exactly 3 different ideas (e.g. romance, conflict, twist) that continue the story logically.`, bibleText(b));
      return json({ ideas: (out?.ideas ?? []).slice(0, 3).map((x: any) => ({ title_mm: clip(x.title_mm, 60), idea_mm: clip(x.idea_mm, 400) })) });
    }
    case "episode_plan": {
      const p = await ownProject(body.id);
      if (!p || p.status !== "ready") return json({ error: "project not ready" }, 400);
      const text = clip(body.text, 12000);
      if (!text) return json({ error: "empty" }, 400);
      const mode = body.mode === "script" ? "script" : "idea";
      let epId: string;
      const { data: eps } = await admin.from("episodes").select("id,num,status").eq("project_id", p.id).order("num");
      const prev = isId(body.episode_id) ? (eps ?? []).find((e: any) => e.id === body.episode_id) : null;
      if (prev) {
        if (!["ready", "failed"].includes(prev.status)) return json({ error: "episode is being made" }, 400);
        const { count } = await admin.from("episode_scenes").select("id", { count: "exact", head: true }).eq("episode_id", prev.id).neq("status", "pending");
        if (count) return json({ error: "episode already started" }, 400);
        await admin.from("episodes").update({ input_mode: mode, input_mm: text, status: "planning", error: null, warnings: [] }).eq("id", prev.id);
        epId = prev.id;
      } else {
        if ((eps ?? []).some((e: any) => ["planning", "producing", "stitching"].includes(e.status))) return json({ error: "အရင်အပိုင်း ပြီးအောင် စောင့်ပါ" }, 400);
        const num = ((eps ?? []).at(-1)?.num ?? 0) + 1;
        const { data: e, error } = await admin.from("episodes").insert({ project_id: p.id, user_id: uid, num, input_mode: mode, input_mm: text }).select("id").single();
        if (error) return json({ error: error.message }, 400);
        epId = e.id;
      }
      bg(planEpisode(admin, epId));
      return json({ episode_id: epId });
    }
    case "episode_update": {
      const ep = await ownEpisode(body.episode_id);
      if (!ep) return json({ error: "not found" }, 404);
      if ("summary_mm" in body && ep.status === "done") await admin.from("episodes").update({ summary_mm: clip(body.summary_mm, 1200) }).eq("id", ep.id);
      if (Array.isArray(body.scenes)) {
        if (ep.status !== "ready") return json({ error: "can't edit now" }, 400);
        const list = body.scenes.map((s: any) => ({ story_mm: clip(s?.story_mm, 900), cast_names: (Array.isArray(s?.cast_names) ? s.cast_names : []).map((n: any) => clip(n, 30)).slice(0, 3) })).filter((s: any) => s.story_mm);
        if (!list.length || list.length > MAX_SCENES) return json({ error: `scene ၁ ခုမှ ${MAX_SCENES} ခုအထိ` }, 400);
        await admin.from("episode_scenes").delete().eq("episode_id", ep.id);
        await admin.from("episode_scenes").insert(list.map((s: any, i: number) => ({ episode_id: ep.id, idx: i, ...s })));
        const { data: pr } = await admin.from("projects").select("quality").eq("id", ep.project_id).single();
        await admin.from("episodes").update({ cost: (pr.quality === "hd" ? 50 : 35) * list.length }).eq("id", ep.id);
      }
      return json({ ok: true });
    }
    case "produce": {
      const ep = await ownEpisode(body.episode_id);
      if (!ep || ep.status !== "ready") return json({ error: "episode not ready" }, 400);
      const { count } = await admin.from("episode_scenes").select("id", { count: "exact", head: true }).eq("episode_id", ep.id);
      const { data: pr } = await admin.from("projects").select("quality").eq("id", ep.project_id).single();
      const cost = (pr.quality === "hd" ? 50 : 35) * (count ?? 0);
      const { data: prof } = await admin.from("profiles").select("credits").eq("id", uid).single();
      if ((prof?.credits ?? 0) < cost) return json({ error: "insufficient credits", need: cost }, 400);
      await admin.from("episodes").update({ status: "producing", cost, error: null }).eq("id", ep.id).eq("status", "ready");
      bg(advance(admin, { ...ep, status: "producing" }).catch((e) => console.error(e)));
      return json({ ok: true, cost });
    }
    case "resume": {
      const ep = await ownEpisode(body.episode_id);
      if (!ep || ep.status !== "failed") return json({ error: "nothing to resume" }, 400);
      const { count } = await admin.from("episode_scenes").select("id", { count: "exact", head: true }).eq("episode_id", ep.id).neq("status", "pending");
      if (!count) return json({ error: "nothing to resume" }, 400); // never started: plan again instead
      await admin.from("episode_scenes").update({ status: "pending", attempts: 0 }).eq("episode_id", ep.id).eq("status", "failed");
      await admin.from("episodes").update({ status: "producing", error: null }).eq("id", ep.id);
      bg(advance(admin, { ...ep, status: "producing" }).catch((e) => console.error(e)));
      return json({ ok: true });
    }
  }
  return json({ error: "unknown action" }, 400);
});
