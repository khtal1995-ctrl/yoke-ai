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
//   { action: "check_photo", path } -> { ok, problems_mm }                     AI checks a character photo right after upload
// SCENE_QC (off for now): AI checks every finished scene and re-makes a bad one once at our cost.
// Cron: x-cron-token + { action: "tick" } moves producing/stitching episodes forward.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOTTA = "https://gateway.yottalabs.ai";
const SERIES_ENGINE = "omni";   // series scenes: Gemini Omni 1.2 (picture + Burmese speech together, no Wan/ElevenLabs dubbing)
const MAX_SCENES = 30;          // one episode: at most 5 minutes (30 x 10 s)
const PARALLEL = 2;             // scenes rendering at the same time per episode (Eachlabs: max 2 concurrent when balance is low)
const MAX_ATTEMPTS = 2;         // a failed scene is refunded and tried once more
const MAX_CHARS = 30;           // characters in one series
const MAX_CAST = 6;
const PORTRAIT_REDRAW_CR = 2;   // AI face portrait: the first one of a character is free, each redraw 2 credits (owner, 25 Nov)
const SCENE_QC = false;         // AI check of every finished scene: off (re-making bad scenes for free would cost us; decide later)
const QC_REDOS = 1;             // when SCENE_QC is on: automatic re-renders after a failed AI check (credits refunded, so the customer pays once)             // named characters in one 10-second scene (the video model takes at most 3 photos)

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
// NFC: Burmese marks typed in a different order (e.g. ့ and ်) become the same text, so names always match
const clip = (x: any, n: number) => String(x ?? "").normalize("NFC").trim().slice(0, n);

// the owner's voices (same ids as the api function's dubbing)
const V = {
  MAIN_MALE: "d4WXuYHO9Ot8KDdiOwIg", MAIN_FEMALE: "12GZ6E7rJLrs85C6m4J6", MALE_1: "B5MB163SdECMmHySTkLK",
  SU: "NBISYoQ4SVxq8eZxoHlV", OLD_MAN: "uh7A30exzQsUAB5ovsOu", CHILD: "uFPN3uAkEca3mQ6uRmBk",
};
function pickVoice(c: any, taken: string[]): string {
  const f = c.gender === "female";
  const opts = c.age === "child" ? [V.CHILD] : c.age === "old" ? (f ? [V.SU, V.MAIN_FEMALE] : [V.OLD_MAN, V.MALE_1])
    : c.age === "middle" ? (f ? [V.SU, V.MAIN_FEMALE] : [V.MALE_1, V.OLD_MAN]) : (f ? [V.MAIN_FEMALE, V.SU] : [V.MAIN_MALE, V.MALE_1]);
  const base = (v: string) => v.split("@")[0];
  const free = opts.find((o) => !taken.some((t) => base(t) === o));
  if (free) return free;
  // more characters than voices: the same voice with a different pitch ("id@0.9"), fixed for the whole series
  const n = taken.filter((t) => base(t) === opts[0]).length;
  return n >= 3 ? opts[0] : `${opts[0]}@${[1, 0.9, 1.08][n]}`;
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

// grok with images: content = text + image urls
async function visionJson(admin: any, system: string, text: string, images: string[]): Promise<any> {
  const key = await yotta(admin);
  const r = await fetch(`${YOTTA}/api/maas/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(90000),
    headers: { "X-API-KEY": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-4.7", temperature: 0.1, max_tokens: 800, reasoning_effort: "low",
      messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] }] }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}`);
  const txt = String((await r.json())?.choices?.[0]?.message?.content ?? "");
  return JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
}

const BURMESE_STYLE = "Write everything for the customer in natural, simple Burmese (Myanmar Unicode). People and places are Burmese/Myanmar.";

// ---------- Story Bible ----------
async function loadBible(admin: any, projectId: string) {
  const [{ data: p }, { data: chars }, { data: eps }, { data: places }] = await Promise.all([
    admin.from("projects").select("*").eq("id", projectId).single(),
    admin.from("project_characters").select("*").eq("project_id", projectId).order("sort"),
    admin.from("episodes").select("num,title,summary_mm,status").eq("project_id", projectId).order("num"),
    admin.from("project_places").select("*").eq("project_id", projectId).order("sort"),
  ]);
  return { p, chars: chars ?? [], eps: eps ?? [], places: places ?? [] };
}
function bibleText(b: any, beforeNum?: number) {
  const done = b.eps.filter((e: any) => e.status === "done" && e.summary_mm && (beforeNum == null || e.num < beforeNum));
  return [
    `Series title: ${b.p.title}`,
    b.p.premise_mm ? `Story: ${b.p.premise_mm}` : "",
    b.p.setting_mm ? `Places and time: ${b.p.setting_mm}` : "",
    (b.places ?? []).length ? `The customer's own places (with photos; use these exact names): ${b.places.map((x: any) => x.name).join(", ")}` : "",
    "Characters (keep their names, looks and personalities exactly):",
    ...b.chars.map((c: any) => `- ${c.name} (${c.gender}, ${c.age}): looks: ${c.look_mm ?? "-"}; personality and relationships: ${c.personality_mm ?? "-"}`),
    done.length ? "What happened so far:" : "This is the first episode.",
    ...done.map((e: any) => `- Episode ${e.num}${e.title ? ` "${e.title}"` : ""}: ${e.summary_mm}`),
    b.p.state_mm ? `Where everyone is and what is going on now: ${b.p.state_mm}` : "",
  ].filter(Boolean).join("\n");
}

async function draftBible(admin: any, id: string) {
  const { data: p } = await admin.from("projects").select("*").eq("id", id).single();
  const given = ((await admin.from("project_characters").select("name").eq("project_id", id)).data ?? []).map((c: any) => c.name);
  const gplaces = ((await admin.from("project_places").select("name").eq("project_id", id)).data ?? []).map((x: any) => x.name);
  try {
    const out = await llmJson(admin, `You plan a Burmese short-drama series from a customer's idea. ${BURMESE_STYLE}
Return ONLY JSON: {"premise_mm": "<what the series is about, 2-4 sentences>", "setting_mm": "<main places and time, 1-3 sentences>",
"characters": [{"name": "<Burmese name>", "gender": "male|female", "age": "child|young|middle|old", "look_mm": "<face, hair, usual clothes, 1 sentence>", "portrait_en": "<English: face, hair, skin and build only, for a portrait photo; no clothes, no names>", "personality_mm": "<character and relationships to the others, 1-2 sentences>"}]}
Rules: keep every name, place and fact the customer wrote; only add what is missing. All the main and supporting characters the idea needs (usually 2 to 12). Realistic Myanmar names, clothes and places.`,
      `Series title: ${p.title}\nIdea: ${p.idea_mm}` +
      (given.length ? `\nCharacters the customer already named (they have photos; include each one with exactly this name and decide gender, age, looks and personality from the idea): ${given.join(", ")}` : "") +
      (gplaces.length ? `\nPlaces the customer gave (with photos; use these exact names in setting_mm): ${gplaces.join(", ")}` : ""));
    const chars = (Array.isArray(out?.characters) ? out.characters : []).slice(0, MAX_CHARS);
    const taken: string[] = [];
    const rows = chars.filter((c: any) => clip(c?.name, 30)).map((c: any, i: number) => {
      const row = { project_id: id, name: clip(c.name, 30), gender: c.gender === "female" ? "female" : "male",
        age: ["child", "young", "middle", "old"].includes(c.age) ? c.age : "young",
        look_mm: clip(c.look_mm, 300), personality_mm: clip(c.personality_mm, 400), portrait_en: clip(c.portrait_en, 500) || null, sort: i, voice_id: "" };
      row.voice_id = pickVoice(row, taken); taken.push(row.voice_id);
      return row;
    });
    if (rows.length) await admin.from("project_characters").upsert(rows, { onConflict: "project_id,name" });
    // every character without a photo gets an AI face portrait (first one free), so faces stay the same in every scene
    try { await drawPortraits(admin, id); } catch (e) { console.error("portraits", id, e); }
    await admin.from("projects").update({ premise_mm: clip(out?.premise_mm, 1200), setting_mm: clip(out?.setting_mm, 800), status: "ready", updated_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    await admin.from("projects").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", id);
  }
}

// ---------- AI face portraits for characters without a photo (Seedream v5 lite, ~160 Ks a picture) ----------
const PORTRAIT_MODEL = "bytedance-seedream-v5-lite-text-to-image";
const AGE_EN: Record<string, string> = { child: "child of about ten", young: "young adult in their early twenties", middle: "middle-aged adult in their late forties", old: "elderly person in their late sixties" };
function portraitPrompt(c: any) {
  const who = `${c.gender === "female" ? "Burmese (Myanmar) woman" : "Burmese (Myanmar) man"}, ${AGE_EN[c.age] ?? AGE_EN.young}`;
  return `Photorealistic head-and-shoulders portrait photo of one ordinary, non-famous ${who}. ${c.portrait_en ?? ""} ` +
    `Face looking straight at the camera, neutral relaxed expression, plain simple top, plain light grey background, soft even daylight, sharp focus, natural skin. ` +
    `One person only, no text, no logo, not a celebrity.`;
}
async function drawOne(admin: any, c: any, userId: string): Promise<string | null> {
  const h = await eachlabsHeaders(admin);
  const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: h,
    body: JSON.stringify({ model: PORTRAIT_MODEL, version: "0.0.1", input: { prompt: portraitPrompt(c), aspect_ratio: "3:4", resolution: "2K", output_format: "jpeg" } }) });
  const j: any = await r.json().catch(() => ({}));
  const pid = j.predictionID ?? j.prediction_id ?? j.id;
  if (!r.ok || !pid) throw new Error("portrait submit " + r.status + " " + JSON.stringify(j).slice(0, 200));
  for (let t = 0; t < 40; t++) {
    await new Promise((ok) => setTimeout(ok, 3000));
    const pr = await fetch(`https://api.eachlabs.ai/v1/prediction/${pid}`, { headers: h });
    const pj: any = await pr.json().catch(() => ({}));
    if ((pj.status === "success" || pj.status === "succeeded") && pj.output) {
      const url = Array.isArray(pj.output) ? pj.output[0] : pj.output;
      const img = await fetch(url);
      if (!img.ok) throw new Error(`portrait download ${img.status}`);
      const path = `${userId}/ai_${c.id}_${Date.now()}.jpg`;
      const { error } = await admin.storage.from("inputs").upload(path, new Uint8Array(await img.arrayBuffer()), { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      return path;
    }
    if (pj.status === "error" || pj.status === "failed") throw new Error("portrait failed: " + String(pj.output ?? pj.error ?? "").slice(0, 200));
  }
  throw new Error("portrait timeout");
}
// first portrait of each character without a photo: free (owner, 25 Nov)
async function drawPortraits(admin: any, projectId: string) {
  const { data: p } = await admin.from("projects").select("user_id").eq("id", projectId).single();
  const { data: chars } = await admin.from("project_characters").select("*").eq("project_id", projectId).is("photo_path", null).eq("ai_draws", 0);
  await Promise.all((chars ?? []).map(async (c: any) => {
    try {
      const path = await drawOne(admin, c, p.user_id);
      await admin.from("project_characters").update({ photo_path: path, photo_ai: true, ai_draws: 1 }).eq("id", c.id).is("photo_path", null);
    } catch (e) { console.error("portrait", c.id, e); }
  }));
}

// ---------- episode planning: scenes of about 10 seconds each ----------
async function planEpisode(admin: any, epId: string, maxScenes = MAX_SCENES) {
  const { data: ep } = await admin.from("episodes").select("*").eq("id", epId).single();
  try {
    const b = await loadBible(admin, ep.project_id);
    const names = b.chars.map((c: any) => c.name);
    const group = await groupScenesOn(admin);
    const out = await llmJson(admin, `You split one episode of a Burmese short-drama series into scenes for an AI video model that makes 10-second clips with native Burmese speech. ${BURMESE_STYLE}
Return ONLY JSON: {"title_mm": "<short episode title>", "scenes": [{"story_mm": "<this scene in Burmese: where, who, what they do, the exact Burmese lines in quotes, their emotion>", "seconds": 5, "cast": ["<character names in this scene>"], "place": "<one of the customer's place names if the scene happens there, else empty>"}], "warnings_mm": ["<a problem with the story so far, in Burmese>"]}
Rules:
- "seconds": 5 or 10 — just long enough for what happens, never padded: 5 for one quick action and at most one short line (about 6 Burmese words), 10 when there is more (two lines, or an action plus a longer line). Real-life pace: a bump and "sorry" takes 5 seconds, not 10.
- One scene = one moment of 5 or 10 seconds: one place, at most 6 named characters (crowds are fine as background), at most 2 short lines of dialogue (about 12 Burmese words in total). Long conversations go over several scenes.
- ${group ? "Up to 9 named characters can be together in one shot." : "When more than 3 named characters are together (a family meal, a meeting), film it like a drama: one wide shot of the whole group where faces are small, then separate scenes with close-ups of at most 3 of them each; never more than 3 named characters close to the camera in one scene."}
- Use the characters' names exactly. Keep their looks, personalities and relationships from the Story Bible. Continue from where the story is now.
- Every scene must make sense on its own: say the place and the characters again in each scene (the video model sees one scene at a time).
- Dialogue is the heart: punchlines, brags, twists and emotional lines are spoken by the characters themselves.
- If the customer gave a full script (mode "script"): keep their story, order and quoted words exactly; only split it into scenes.
- If the customer gave only an idea (mode "idea"): write a complete, dramatic episode from it with a hook at the start and a cliffhanger at the end; ${maxScenes < 6 ? `exactly ${maxScenes} scenes (a short episode: tell the whole idea in them)` : "6 to 12 scenes unless the idea asks for more"}.
- At most ${maxScenes} scenes.
- "warnings_mm": list real contradictions with the Story Bible (a character who left or died appears again, a broken relationship, a wrong place). Empty list if none. Never warn about style.
- "place": ${(b.places ?? []).length ? `when a scene happens in one of the customer's places (${b.places.map((x: any) => x.name).join(", ")}), write that exact name; otherwise "" and choose a fitting place yourself in story_mm.` : `always "".`}
- "cast" may only contain these names: ${names.join(", ") || "(none yet)"}. Other people (a seller, a crowd) are described in story_mm but not listed.`,
      `${bibleText(b, ep.num)}\n\nEpisode ${ep.num}. Mode: ${ep.input_mode}.\nCustomer's ${ep.input_mode === "script" ? "script" : "idea"}:\n${ep.input_mm}`, 8000);
    const scenes = (Array.isArray(out?.scenes) ? out.scenes : []).filter((s: any) => clip(s?.story_mm, 2000)).slice(0, maxScenes);
    if (!scenes.length) throw new Error("no scenes");
    await admin.from("episode_scenes").delete().eq("episode_id", epId).eq("status", "pending");
    await admin.from("episode_scenes").insert(scenes.map((s: any, i: number) => ({
      episode_id: epId, idx: i, story_mm: clip(s.story_mm, 2000),
      cast_names: (Array.isArray(s.cast) ? s.cast : []).map((n: any) => clip(n, 30)).filter((n: string) => names.includes(n)).slice(0, MAX_CAST),
      place: (b.places ?? []).some((x: any) => x.name === s.place) ? s.place : null,
      seconds: Number(s.seconds) === 5 ? 5 : 10,
    })));
    const { data: pr } = await admin.from("projects").select("quality").eq("id", ep.project_id).single();
    const cost = scenes.reduce((t: number, x: any) => t + (Number(x.seconds) === 5 ? (pr.quality === "hd" ? 25 : 15) : (pr.quality === "hd" ? 40 : 30)), 0);
    await admin.from("episodes").update({ status: "ready", title: clip(out.title_mm, 80) || null, cost,
      warnings: (Array.isArray(out.warnings_mm) ? out.warnings_mm : []).map((w: any) => clip(w, 300)).filter(Boolean).slice(0, 5) }).eq("id", epId);
  } catch (e) {
    await admin.from("episodes").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", epId);
  }
}

// group scenes (4-9 character photos in one frame, MiniMax H3 Lite) stay off until tested: vault secret group_scenes = "on"
async function groupScenesOn(admin: any) {
  return (await admin.rpc("get_app_secret", { p_name: "group_scenes" })).data === "on";
}

// ---------- producing: plan each scene with the planner, pay for it, start it through the api pipeline ----------
const sameWords = (a: any, b: any) => String(a ?? "").replace(/[\s၊။,.!?…]/g, "") === String(b ?? "").replace(/[\s၊။,.!?…]/g, "");
// ---- director (OpenAI GPT through the Eachlabs LLM router; OpenAI serves Myanmar) ----
const DIRECTOR_MODEL = "openai/gpt-6.2-sol";
const DIRECTOR_SYSTEM = `You are an experienced Myanmar film director and acting coach preparing a short Burmese drama for an AI video model and an AI voice actor.
Always refer to characters by their exact names as given, in every field (never transliterate or translate a name).
Read the WHOLE story first: who these people are to each other, what happened before, what each moment means to them.
Then, for every scene, decide:
1. continuity (English, short): where the people in this scene are and what they hold at the START and at the END. Each scene shows ONE simple moment: only what the story says happens in it (no extra actions, no filler, nothing added to fill time), at a natural real-life pace, like a real film; each scene's length in seconds is given. Do not list many small movements; leave small details to the actors. Start naturally from where the previous scene ended (no long frozen pose at the start), but never rush. Props, vehicles and rooms stay where they are unless the story moves them. Finish small physical actions inside the same scene (someone who bends or crouches to pick something up stands back up in that scene) and end each scene on a natural resting pose, so the next scene never has to repeat or undo an action. Never mention or name anyone who is not in this scene.
2. for every spoken line:
   - "text": the customer's words EXACTLY as written (never change, add or remove words).
   - "feeling_mm": in simple Burmese, what this person truly feels inside at this moment and why (the subtext, not the surface).
   - "face": English: one short, subtle, natural expression or gesture while saying it, and how the listener reacts. Keep it small and real; no over-acting.
3. "notes_mm": 1-2 simple Burmese sentences on the mood of the scene and how it connects to the next.
4. "reactions" (English): one short sentence per person in this scene: what they feel and WHY, caused by what just happened to them (e.g. bumped into by a stranger -> startled, then softens when he apologises kindly). Nobody smiles or looks happy without a reason in the story.
5. "outfits" (English): for every person in the scene, exactly what they wear, specific enough to look the same every time: colour, kind of garment, fabric/pattern, shoes or accessories if visible (e.g. "a light-blue cotton blouse with a high round neck, a knee-length navy pleated skirt, white flats"). Fit who they are and the place, time and situation. When a scene continues in the same place and time as the scene before it, copy each person's outfit text word for word; change it only when the story moves to another place or time or says they change clothes. The same staff and rooms stay the same too.
6. "continues": true when this scene happens in the same place and time as the scene before it and picks up straight from where it ended; false for the first scene or when the place or time changes.
Return ONLY JSON: {"scenes":[{"idx":0,"continues":false,"start":"...","end":"...","notes_mm":"...","reactions":"...","outfits":[{"who":"...","wears":"..."}],"lines":[{"who":"...","text":"...","feeling_mm":"...","face":"..."}]}]}`;

async function direct(admin: any, ep: any, b: any, scenes: any[]) {
  const user = `[Series so far]\n${bibleText(b, ep.num)}\n\nCharacters:\n` +
    b.chars.map((c: any) => `- ${c.name} (${c.gender}, ${c.age}): ${c.look_mm ?? ""}. Personality: ${c.personality_mm ?? ""}`).join("\n") +
    `\n\nScenes of episode ${ep.num}:\n` + scenes.map((s: any) => `${s.idx}. (${s.seconds === 5 ? 5 : 10} seconds) [${(s.cast_names ?? []).join(", ")}]${s.place ? ` (at ${s.place})` : ""} ${s.story_mm}`).join("\n");
  const r = await fetch("https://api.eachlabs.ai/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(100000),
    headers: { Authorization: `Bearer ${(await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" })).data}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: DIRECTOR_MODEL, max_tokens: 6000, messages: [{ role: "system", content: DIRECTOR_SYSTEM }, { role: "user", content: user }] }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`director ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  const txt = String(j.choices?.[0]?.message?.content ?? "");
  const out = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
  if (!Array.isArray(out.scenes)) throw new Error("director: no scenes");
  out.usage = j.usage; out.model = DIRECTOR_MODEL;
  return out;
}
function directorNotes(d: any, idx: number, fromFrame = false): string {
  const sc = (d?.scenes ?? []).find((x: any) => Number(x.idx) === idx);
  if (!sc) return "";
  const lines = (sc.lines ?? []).map((l: any) => `- ${l.who} says "${l.text}": feels ${l.feeling_mm}; acting: ${l.face}`).join("\n");
  return `\n[Director's notes: follow them exactly; keep every quoted line word for word]\nScene starts: ${fromFrame ? `exactly as the previous shot image shows (if this text differs from the image, follow the image; never repeat an action that already happened there). ${sc.start}` : sc.start}\nScene ends: ${sc.end}\nReactions and why: ${sc.reactions ?? ""}\n${lines}` +
    ((sc.outfits ?? []).length ? `\nClothing (use exactly these words, do not change or add colours): ${sc.outfits.filter((o: any) => o?.who && o?.wears).map((o: any) => `${o.who} wears ${o.wears}`).join("; ")}` : "");
}

// script mode (owner, 25 Nov 14:14): the customer writes every detail (camera, clothes, place) and may add one photo per scene.
// The prompt is the script translated exactly with the ✨ create rules; nothing is invented; the scene photo sets the look.
async function startExactScene(admin: any, ep: any, b: any, s: any, ordered: any[], chars: any[]) {
  const refs = ordered.filter((c: any) => c.photo_path).slice(0, s.photo_path ? 8 : 9).map((c: any) => ({ path: c.photo_path, name: c.name })); // planner (✨ rules) takes 9 references
  if (s.photo_path) refs.push({ path: s.photo_path, name: "scene photo" });
  const story = `${s.story_mm}\n` +
    `Characters: ${chars.map((c: any) => `${c.name} (${c.gender}, ${c.age})`).join("; ") || "as written"}. Use each character's name as "who" for their lines.`;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/planner`, {
    method: "POST", signal: AbortSignal.timeout(140000), headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ story, duration: s.seconds === 5 ? 5 : 10, cast: refs.map((x: any) => x.name), engine: "omni", scene_photo: !!s.photo_path, exact: true }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.plan?.prompt) throw new Error(j.error ?? `planner ${r.status}`);
  const { data: plan, error: pe } = await admin.from("plans").insert({ user_id: ep.user_id, prompt_mm: s.story_mm, duration: s.seconds === 5 ? 5 : 10, mode: "t2v",
    status: "ready", plan: j.plan, issues: j.issues ?? [], refs: refs.length ? refs : null }).select("id").single();
  if (pe) throw new Error(pe.message);
  const { data: gid, error } = await admin.rpc("episode_scene_generation", { p_scene: s.id, p_plan: plan.id, p_refs: refs });
  if (error) throw new Error(error.message);
  const { error: ee } = await admin.from("generations").update({ engine: "omni" }).eq("id", gid);
  if (ee) throw new Error(`set engine: ${ee.message}`);
  const tok = (await admin.rpc("get_app_secret", { p_name: "cron_token" })).data;
  await fetch(`${SUPABASE_URL}/functions/v1/api`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-token": tok, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action: "start", id: gid }) });
}

async function startScene(admin: any, ep: any, b: any, s: any, scenes: any[]) {
  const total = scenes.length;
  const chars = b.chars.filter((c: any) => s.cast_names.includes(c.name));
  // the video model takes at most 3 photos: the first 3 characters (in the scene's order) with a photo; the rest are drawn from their saved looks
  const ordered = s.cast_names.map((n: string) => chars.find((c: any) => c.name === n)).filter(Boolean);
  const place = (b.places ?? []).find((x: any) => x.name === s.place && x.photo_path);
  const maxRefs = SERIES_ENGINE === "omni" ? 10 : (await groupScenesOn(admin)) ? 9 : 3;
  if (ep.input_mode === "script" && SERIES_ENGINE === "omni") return startExactScene(admin, ep, b, s, ordered, chars);
  const frame = SERIES_ENGINE === "omni" && s.prev_frame ? s.prev_frame : null;
  const extra = (place && SERIES_ENGINE === "omni" ? 1 : 0) + (frame ? 1 : 0);
  const refs = ordered.filter((c: any) => c.photo_path).slice(0, maxRefs - extra).map((c: any) => ({ path: c.photo_path, name: c.name }));
  if (place && SERIES_ENGINE === "omni") refs.push({ path: place.photo_path, name: `${place.name} (place)` });
  if (frame) refs.push({ path: frame, name: "previous shot" });
  // keep it simple (owner, 25 Nov): only this scene and the people in it; never the other scenes or people not in it
  const story = `[Series context, keep it consistent; do not show it as text]\nSeries: ${b.p.title}\n${b.p.setting_mm ? `Places and time: ${b.p.setting_mm}\n` : ""}\n` +
    `[This video: scene ${s.idx + 1} of ${total} of episode ${ep.num}]\n${s.story_mm}\n` +
    (place && SERIES_ENGINE === "omni" ? `Place: this scene happens at ${place.name}; Image ${refs.findIndex((r: any) => r.name === `${place.name} (place)`) + 1} is a photo of this place: use exactly this location.\n` : "") +
    (frame ? `Continuity: Image ${refs.length} is the last frame of the previous shot. This video continues straight from it: the same place, background, light, camera side, the people's positions and their clothes.\n` : "") +
    `Characters in this scene: ${chars.map((c: any) => `${c.name} (${c.gender}, ${c.age}, ${c.look_mm ?? ""})`).join("; ") || "as described"}. Use each character's name as "who" for their lines.` + directorNotes(ep.director, s.idx, !!frame);
  const r = await fetch(`${SUPABASE_URL}/functions/v1/planner`, {
    method: "POST", signal: AbortSignal.timeout(140000),
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ story, duration: s.seconds === 5 ? 5 : 10, cast: refs.map((x: any) => x.name), engine: SERIES_ENGINE, series: true }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.plan?.prompt) throw new Error(j.error ?? `planner ${r.status}`);
  const voices: Record<string, string> = {};
  for (const c of b.chars) if (c.voice_id) voices[c.name] = c.voice_id;
  const { data: plan, error: pe } = await admin.from("plans").insert({ user_id: ep.user_id, prompt_mm: s.story_mm, duration: s.seconds === 5 ? 5 : 10, mode: "t2v",
    status: "ready", plan: { ...j.plan, voices }, issues: j.issues ?? [], refs: refs.length ? refs : null }).select("id").single();
  if (pe) throw pe;
  const { data: gid, error } = await admin.rpc("episode_scene_generation", { p_scene: s.id, p_plan: plan.id, p_refs: refs });
  if (error) throw new Error(error.message);
  // the RPC does not set the engine: without this the api starts the scene on Wan (engine null)
  if (SERIES_ENGINE === "omni") {
    const { error: ee } = await admin.from("generations").update({ engine: SERIES_ENGINE }).eq("id", gid);
    if (ee) throw new Error(`set engine: ${ee.message}`);
  }
  const tok = (await admin.rpc("get_app_secret", { p_name: "cron_token" })).data;
  await fetch(`${SUPABASE_URL}/functions/v1/api`, { method: "POST", headers: { "Content-Type": "application/json", "x-cron-token": tok, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ action: "start", id: gid }) });
}

// 3 frames of the scene side by side (Eachlabs ffmpeg), then grok compares them with the character photos and the scene text
async function checkScene(admin: any, ep: any, s: any) {
  const { data: g } = await admin.from("generations").select("id,video_path,cost").eq("id", s.generation_id).single();
  const pass = async (qc: any) => { s.status = "done"; await admin.from("episode_scenes").update({ status: "done", qc }).eq("id", s.id); };
  if (!s.qc_id) {
    const { data: su } = await admin.storage.from("videos").createSignedUrl(g.video_path, 3600);
    const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabsHeaders(admin),
      body: JSON.stringify({ model: "eachlabs-video-api", version: "0.0.1", input: { mode: "run_ffmpeg", input_url: su!.signedUrl, output_format: "jpg",
        argv: ["ffmpeg", "-i", "{input}", "-vf", "fps=0.3,scale=480:-2,tile=3x1", "-frames:v", "1", "{output}"] } }) });
    const j: any = await r.json().catch(() => ({}));
    const pid = j.predictionID ?? j.prediction_id ?? j.id;
    if (!pid) return pass({ pass: true, skipped: "frames" });
    s.qc_id = pid; await admin.from("episode_scenes").update({ qc_id: pid }).eq("id", s.id);
    return;
  }
  const r = await fetch(`https://api.eachlabs.ai/v1/prediction/${s.qc_id}`, { headers: await eachlabsHeaders(admin) });
  const j: any = await r.json().catch(() => ({}));
  if (j.status === "error" || j.status === "failed") return pass({ pass: true, skipped: "frames" });
  if (!((j.status === "success" || j.status === "succeeded") && j.output)) return; // still making the frames
  const frames = Array.isArray(j.output) ? j.output[0] : j.output;
  const b = await loadBible(admin, ep.project_id);
  const chars = b.chars.filter((c: any) => s.cast_names.includes(c.name));
  const photos: string[] = [], labels: string[] = [];
  for (const c of chars.filter((c: any) => c.photo_path).slice(0, 4)) {
    const { data: u } = await admin.storage.from("inputs").createSignedUrl(c.photo_path, 3600);
    if (u?.signedUrl) { photos.push(u.signedUrl); labels.push(c.name); }
  }
  const out = await visionJson(admin, `You check one AI-generated 10-second video scene before a paying customer sees it. Image 1 shows 3 frames of the scene side by side. ${photos.length ? `The next images are the reference photos of: ${labels.join(", ")} (in that order).` : ""}
Return ONLY JSON: {"pass": true|false, "problems_mm": ["<each serious problem in simple Burmese>"]}
Fail ONLY for serious problems a viewer would notice: a character's face clearly different from their reference photo; clearly the wrong number of main people; melted or deformed faces, extra arms or legs; large garbled or fake writing filling the screen; the scene shows something completely different from the description. Small flaws, style, lighting and background details pass.`,
    `Scene description (Burmese): ${s.story_mm}\nCharacters who should appear: ${chars.map((c: any) => `${c.name} (${c.gender}, ${c.age}; ${c.look_mm ?? ""})`).join("; ") || "as described"}`, [frames, ...photos]);
  const ok = out?.pass !== false;
  const qc = { pass: ok, problems_mm: (Array.isArray(out?.problems_mm) ? out.problems_mm : []).map((x: any) => clip(x, 200)).slice(0, 4), frames };
  if (ok || s.qc_redos >= QC_REDOS) return pass(qc);
  // make it again; give the credits back first so the customer pays for this scene only once
  await admin.rpc("_add_credits", { p_user: ep.user_id, p_delta: g.cost, p_reason: `အပိုင်း (${ep.num}) scene ${s.idx + 1} — AI စစ်ဆေးမှု မအောင် ပြန်ထုတ် (credit ပြန်အမ်း)`, p_ref: g.id });
  s.status = "pending";
  await admin.from("episode_scenes").update({ status: "pending", qc, qc_id: null, qc_redos: s.qc_redos + 1, attempts: 0 }).eq("id", s.id);
}

async function eachlabsHeaders(admin: any) {
  const { data: k } = await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" });
  return { "Content-Type": "application/json", "X-API-Key": k };
}

// the last frame of a finished scene (Eachlabs ffmpeg), saved in inputs so the next scene can start from it
async function lastFrame(admin: any, ep: any, prev: any): Promise<string | null> {
  const { data: g } = await admin.from("generations").select("video_path").eq("id", prev.generation_id).single();
  if (!g?.video_path) return null;
  const { data: su } = await admin.storage.from("videos").createSignedUrl(g.video_path, 3600);
  const h = await eachlabsHeaders(admin);
  const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: h,
    body: JSON.stringify({ model: "eachlabs-video-api", version: "0.0.1", input: { mode: "run_ffmpeg", input_url: su!.signedUrl, output_format: "jpg",
      argv: ["ffmpeg", "-sseof", "-0.3", "-i", "{input}", "-frames:v", "1", "-q:v", "2", "{output}"] } }) });
  const j: any = await r.json().catch(() => ({}));
  const pid = j.predictionID ?? j.prediction_id ?? j.id;
  if (!pid) return null;
  for (let t = 0; t < 12; t++) {
    await new Promise((ok) => setTimeout(ok, 3000));
    const pj: any = await (await fetch(`https://api.eachlabs.ai/v1/prediction/${pid}`, { headers: h })).json().catch(() => ({}));
    if ((pj.status === "success" || pj.status === "succeeded") && pj.output) {
      const img = await fetch(Array.isArray(pj.output) ? pj.output[0] : pj.output);
      if (!img.ok) return null;
      const path = `${ep.user_id}/frame_${prev.id}.jpg`;
      const { error } = await admin.storage.from("inputs").upload(path, new Uint8Array(await img.arrayBuffer()), { contentType: "image/jpeg", upsert: true });
      return error ? null : path;
    }
    if (pj.status === "error" || pj.status === "failed") return null;
  }
  return null;
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
        if (g.status === "succeeded") { s.status = SCENE_QC ? "checking" : "done"; await admin.from("episode_scenes").update({ status: s.status, qc_id: null }).eq("id", s.id); }
        if (g.status === "failed") { s.status = s.attempts < MAX_ATTEMPTS ? "pending" : "failed"; await admin.from("episode_scenes").update({ status: s.status }).eq("id", s.id); }
      }
      // 1b) AI check of finished scenes (preview frames -> vision); a bad scene is made again once, at our cost
      for (const s of scenes.filter((x: any) => x.status === "checking")) {
        try { await checkScene(admin, ep, s); } catch (e) { console.error("qc", s.id, e); s.status = "done"; await admin.from("episode_scenes").update({ status: "done" }).eq("id", s.id); }
      }
      // 2) start the next scenes (one or two per minute; the planner takes ~30-60 s)
      const b = await loadBible(admin, ep.project_id);
      // 1c) director: once per episode, before the first scene, a strong model reads the whole episode and decides
      //     each line's feeling, voice and acting, and where everyone/everything is at each scene's start and end
      // script mode: the customer's detailed script + scene photos are the whole truth: no director, no previous-frame chaining
      if (ep.input_mode !== "script" && !ep.director && scenes.some((x: any) => x.status === "pending")) {
        let d: any;
        try { d = await direct(admin, ep, b, scenes); } catch (e) { console.error("director", ep.id, e); d = { failed: String((e as any)?.message ?? e).slice(0, 300) }; }
        ep.director = d; await admin.from("episodes").update({ director: d }).eq("id", ep.id);
        return; // scenes start on the next tick
      }
      let running = scenes.filter((s: any) => s.status === "running" || s.status === "checking").length;
      const t0 = Date.now();
      for (const s of scenes.filter((x: any) => x.status === "pending")) {
        if (running >= PARALLEL || Date.now() - t0 > 50000) break;
        // a scene that continues the previous one waits for it and gets its last frame as a reference (owner, 25 Nov)
        const cont = SERIES_ENGINE === "omni" && ep.input_mode !== "script" && s.idx > 0 && (ep.director?.scenes ?? []).find((x: any) => Number(x.idx) === s.idx)?.continues === true;
        if (cont) {
          const prev = scenes.find((x: any) => x.idx === s.idx - 1);
          if (prev && prev.status !== "done" && prev.status !== "failed") continue;
          if (prev?.status === "done" && !s.prev_frame) {
            s.prev_frame = await lastFrame(admin, ep, prev).catch((e) => { console.error("last frame", prev.id, e); return null; });
            if (s.prev_frame) await admin.from("episode_scenes").update({ prev_frame: s.prev_frame }).eq("id", s.id);
          }
        }
        try { await startScene(admin, ep, b, s, scenes); running++; }
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
      if (now.some((s: any) => ["pending", "running", "checking"].includes(s.status))) return;
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
      if ((ep.stitch_tries ?? 0) >= 2) {
        await admin.from("episodes").update({ status: "failed", error: "Scene တွေ ဆက်တာ မအောင်မြင်ပါ — \"ပြန်ထုတ်\" နှိပ်ပါ (scene တွေ ပြန်မထုတ်ပါ၊ ဆက်ရုံပဲ)" }).eq("id", ep.id);
        return;
      }
      // join with our own ffmpeg: every scene scaled/padded to one size, one frame rate, one audio format
      // (scenes differ: dubbed ones come from the merge step, others are Wan's own file)
      const { data: pr } = await admin.from("projects").select("ratio,quality").eq("id", ep.project_id).single();
      const base = pr?.quality === "hd" ? 720 : 480;
      const long = Math.round(base * 16 / 9 / 2) * 2;
      const [W, H] = pr?.ratio === "16:9" ? [long, base] : pr?.ratio === "1:1" ? [base, base] : [base, long];
      const argv: string[] = ["ffmpeg", "-y"];
      urls.forEach((_, i) => argv.push("-i", `{input${i}}`));
      const fc: string[] = [];
      urls.forEach((_, i) => {
        fc.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v${i}]`);
        fc.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      });
      fc.push(urls.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${urls.length}:v=1:a=1[v][a]`);
      argv.push("-filter_complex", fc.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "{output}");
      await admin.from("episodes").update({ stitch_tries: (ep.stitch_tries ?? 0) + 1 }).eq("id", ep.id);
      const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabsHeaders(admin),
        body: JSON.stringify({ model: "eachlabs-video-api", version: "0.0.1", input: { mode: "run_ffmpeg", input_urls: urls, output_format: "mp4", argv } }) });
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

// ---------- 🎞️ Rolls (owner, 25 Nov): a customer's own videos collected in order and joined into one, free ----------
async function rollClips(admin: any, roll: any) {
  const { data: items } = await admin.from("roll_items").select("id,generation_id,sort").eq("roll_id", roll.id).order("sort");
  const ids = (items ?? []).map((x: any) => x.generation_id);
  const { data: gens } = ids.length ? await admin.from("generations").select("id,user_id,video_path,ratio,quality,duration,audio,prompt_mm,status").in("id", ids) : { data: [] };
  return (items ?? []).map((x: any) => ({ item: x, g: (gens ?? []).find((g: any) => g.id === x.generation_id) }))
    .filter((x: any) => x.g && x.g.user_id === roll.user_id && x.g.status === "succeeded" && x.g.video_path);
}
async function joinRoll(admin: any, roll: any) {
  if (roll.status === "joining" && roll.join_id) {
    const r = await fetch(`https://api.eachlabs.ai/v1/prediction/${roll.join_id}`, { headers: await eachlabsHeaders(admin) });
    const j: any = await r.json().catch(() => ({}));
    if ((j.status === "success" || j.status === "succeeded") && j.output) {
      const vr = await fetch(Array.isArray(j.output) ? j.output[0] : j.output);
      if (!vr.ok) throw new Error(`download ${vr.status}`);
      const path = `${roll.user_id}/roll_${roll.id}_${Date.now()}.mp4`;
      const { error } = await admin.storage.from("videos").upload(path, new Uint8Array(await vr.arrayBuffer()), { contentType: "video/mp4", upsert: true });
      if (error) throw error;
      await admin.from("rolls").update({ status: "done", video_path: path, join_id: null, error: null, updated_at: new Date().toISOString() }).eq("id", roll.id);
    } else if (j.status === "error" || j.status === "failed") {
      await admin.from("rolls").update(roll.join_tries >= 2 ? { status: "failed", join_id: null, error: "ဆက်လို့ မရပါ — ပြန်ကြိုးစားပါ" } : { join_id: null, updated_at: new Date(0).toISOString() }).eq("id", roll.id);
    }
    return;
  }
  const clips = await rollClips(admin, roll);
  if (clips.length < 2) { await admin.from("rolls").update({ status: "failed", error: "video ၂ ခု အနည်းဆုံး ထည့်ပါ" }).eq("id", roll.id); return; }
  const urls: string[] = [];
  for (const c of clips) { const { data: su } = await admin.storage.from("videos").createSignedUrl(c.g.video_path, 6 * 3600); urls.push(su!.signedUrl); }
  // one size for all (the first clip's ratio; HD if any clip is HD), one frame rate, one audio format; silent clips get silence
  const first = clips[0].g, base = clips.some((c: any) => c.g.quality === "hd") ? 720 : 480;
  const long = Math.round(base * 16 / 9 / 2) * 2;
  const [W, H] = first.ratio === "16:9" ? [long, base] : first.ratio === "1:1" ? [base, base] : [base, long];
  const argv: string[] = ["ffmpeg", "-y"];
  urls.forEach((_, i) => argv.push("-i", `{input${i}}`));
  const fc: string[] = [];
  // transition between clips (owner, 26 Nov): cut | dissolve (one picture melts into the next) | fadeblack (dip to black).
  // For the soft ones every clip is first made exactly its own length (last frame held a moment if it is a little short),
  // so the 0.5 s overlaps land at the right times; the sound crossfades over the same 0.5 s.
  const tr = roll.transition === "dissolve" ? "fade" : roll.transition === "fadeblack" ? "fadeblack" : null, T = 0.5;
  const D = clips.map((c: any) => Number(c.g.duration) || 10);
  clips.forEach((c: any, i: number) => {
    const fit = tr ? `,tpad=stop_mode=clone:stop_duration=1,trim=duration=${D[i]},setpts=PTS-STARTPTS` : "";
    const afit = tr ? `,apad,atrim=duration=${D[i]},asetpts=PTS-STARTPTS` : "";
    fc.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p${fit}[v${i}]`);
    // sound (owner, 27 Nov: backgrounds jump at the joins): every clip is brought to the same loudness; on a plain cut each
    // clip's sound also fades in/out over 0.25 s (the picture still cuts) so the change of background is not a hard jump
    const lev = `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,`;
    const soft = tr ? "" : `,afade=t=in:d=0.25,areverse,afade=t=in:d=0.25,areverse`;
    fc.push(c.g.audio === false ? `aevalsrc=0:c=stereo:s=48000:d=${D[i]}[a${i}]` : `[${i}:a]${lev}aformat=sample_fmts=fltp:channel_layouts=stereo${afit}${soft}[a${i}]`);
  });
  if (!tr) fc.push(clips.map((_: any, i: number) => `[v${i}][a${i}]`).join("") + `concat=n=${clips.length}:v=1:a=1[v][a]`);
  else {
    let vPrev = "v0", aPrev = "a0", t = D[0];
    for (let i = 1; i < clips.length; i++) {
      const vo = i === clips.length - 1 ? "v" : `vx${i}`, ao = i === clips.length - 1 ? "a" : `ax${i}`;
      fc.push(`[${vPrev}][v${i}]xfade=transition=${tr}:duration=${T}:offset=${(t - T).toFixed(2)}[${vo}]`);
      fc.push(`[${aPrev}][a${i}]acrossfade=d=${T}[${ao}]`);
      vPrev = vo; aPrev = ao; t = t - T + D[i];
    }
  }
  argv.push("-filter_complex", fc.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "{output}");
  const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabsHeaders(admin),
    body: JSON.stringify({ model: "eachlabs-video-api", version: "0.0.1", input: { mode: "run_ffmpeg", input_urls: urls, output_format: "mp4", argv } }) });
  const j: any = await r.json().catch(() => ({}));
  const pid = j.predictionID ?? j.prediction_id ?? j.id;
  if (!r.ok || !pid) throw new Error("roll join submit " + r.status + " " + JSON.stringify(j).slice(0, 200));
  await admin.from("rolls").update({ status: "joining", join_id: pid, join_tries: (roll.join_tries ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", roll.id);
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
    const { data: rolls } = await admin.from("rolls").select("*").eq("status", "joining").order("updated_at").limit(5);
    // a roll just asked to join is submitted by that request; the tick picks it up only if nothing was submitted for 2 minutes
    await Promise.all((rolls ?? []).filter((r: any) => r.join_id || Date.now() - new Date(r.updated_at).getTime() > 120000)
      .map((r: any) => joinRoll(admin, r).catch((err) => console.error("roll", r.id, err))));
    // scene splitting that never started or stopped (no result after 4 minutes): run the same scene splitting again
    const { data: stuck } = await admin.from("episodes").select("id,max_scenes,planning_since").eq("status", "planning").order("created_at").limit(2);
    for (const e of stuck ?? []) {
      if (e.planning_since && Date.now() - new Date(e.planning_since).getTime() < 4 * 60000) continue;
      await admin.from("episodes").update({ planning_since: new Date().toISOString() }).eq("id", e.id);
      bg(planEpisode(admin, e.id, e.max_scenes ?? MAX_SCENES));
    }
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
      const okPath = (x: any) => { const ph = String(x ?? ""); return ph.startsWith(uid + "/") && !ph.includes("..") ? ph : null; };
      const gc = (Array.isArray(body.characters) ? body.characters : []).map((c: any) => ({ name: clip(c?.name, 30), photo: okPath(c?.photo_path) })).filter((c: any) => c.name).slice(0, 10);
      const gp = (Array.isArray(body.places) ? body.places : []).map((x: any) => ({ name: clip(x?.name, 40), photo: okPath(x?.photo_path) })).filter((x: any) => x.name && x.photo).slice(0, 10);
      if (gc.length) await admin.from("project_characters").upsert(gc.map((c: any, i: number) => ({ project_id: p.id, name: c.name, photo_path: c.photo, sort: i, voice_id: "" })), { onConflict: "project_id,name" });
      if (gp.length) await admin.from("project_places").upsert(gp.map((x: any, i: number) => ({ project_id: p.id, name: x.name, photo_path: x.photo, sort: i })), { onConflict: "project_id,name" });
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
      const { data: places } = await admin.from("project_places").select("*").eq("project_id", p.id).order("sort");
      for (const x of places ?? []) x.photo_url = await sign("inputs", x.photo_path);
      for (const e of eps ?? []) e.video_url = e.status === "done" ? await sign("videos", e.video_path) : null;
      const open = (eps ?? []).filter((e: any) => e.status !== "done").pop() ?? null;
      const wantEp = isId(body.episode_id) ? (eps ?? []).find((e: any) => e.id === body.episode_id) : open;
      let scenes: any[] = [];
      if (wantEp) {
        const { data } = await admin.from("episode_scenes").select("id,idx,story_mm,cast_names,place,seconds,photo_path,status,attempts,qc_redos").eq("episode_id", wantEp.id).order("idx");
        scenes = data ?? [];
        for (const x of scenes) if (x.photo_path) x.photo_url = await sign("inputs", x.photo_path);
      }
      return json({ project: p, characters: chars ?? [], places: places ?? [], episodes: eps ?? [], scenes, scenes_episode: wantEp?.id ?? null });
    }
    case "update_bible": {
      const p = await ownProject(body.id);
      if (!p) return json({ error: "not found" }, 404);
      const upd: any = { updated_at: new Date().toISOString() };
      for (const k of ["premise_mm", "setting_mm", "state_mm"]) if (k in body) upd[k] = clip(body[k], 1500);
      if ("title" in body && clip(body.title, 80)) upd.title = clip(body.title, 80);
      await admin.from("projects").update(upd).eq("id", p.id);
      if (Array.isArray(body.characters)) {
        if (body.characters.length > MAX_CHARS) return json({ error: "ဇာတ်ကောင် ၃၀ ယောက်အထိ" }, 400);
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
          row.photo_ai = !!(prev && prev.photo_ai && prev.photo_path === photo);
          row.voice_id = prev?.voice_id || pickVoice(row, taken); taken.push(row.voice_id);
          if (prev) await admin.from("project_characters").update(row).eq("id", prev.id);
          else await admin.from("project_characters").insert(row);
          keep.push(name);
        }
        const gone = (old ?? []).filter((o: any) => !keep.includes(o.name)).map((o: any) => o.id);
        if (gone.length) await admin.from("project_characters").delete().in("id", gone);
      }
      if (Array.isArray(body.places)) {
        const list = body.places.map((x: any, i: number) => ({ project_id: p.id, name: clip(x?.name, 40), photo_path: String(x?.photo_path ?? ""), sort: i }))
          .filter((x: any) => x.name && x.photo_path.startsWith(uid + "/") && !x.photo_path.includes("..")).slice(0, 10);
        await admin.from("project_places").delete().eq("project_id", p.id);
        if (list.length) await admin.from("project_places").insert(list);
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
      const maxScenes = Math.min(MAX_SCENES, Math.max(1, Math.round(Number(body.max_scenes) || MAX_SCENES)));
      await admin.from("episodes").update({ max_scenes: maxScenes, planning_since: new Date().toISOString() }).eq("id", epId);
      bg(planEpisode(admin, epId, maxScenes));
      return json({ episode_id: epId });
    }
    case "episode_update": {
      const ep = await ownEpisode(body.episode_id);
      if (!ep) return json({ error: "not found" }, 404);
      if ("summary_mm" in body && ep.status === "done") await admin.from("episodes").update({ summary_mm: clip(body.summary_mm, 1200) }).eq("id", ep.id);
      if (Array.isArray(body.scenes)) {
        if (ep.status !== "ready") return json({ error: "can't edit now" }, 400);
        const list = body.scenes.map((s: any) => ({ story_mm: clip(s?.story_mm, 2000), cast_names: (Array.isArray(s?.cast_names) ? s.cast_names : []).map((n: any) => clip(n, 30)).slice(0, MAX_CAST), place: clip(s?.place, 40) || null, seconds: Number(s?.seconds) === 5 ? 5 : 10,
        photo_path: String(s?.photo_path ?? "").startsWith(uid + "/") && !String(s.photo_path).includes("..") ? String(s.photo_path) : null })).filter((s: any) => s.story_mm);
        if (!list.length || list.length > MAX_SCENES) return json({ error: `scene ၁ ခုမှ ${MAX_SCENES} ခုအထိ` }, 400);
        await admin.from("episode_scenes").delete().eq("episode_id", ep.id);
        await admin.from("episode_scenes").insert(list.map((s: any, i: number) => ({ episode_id: ep.id, idx: i, ...s })));
        const { data: pr } = await admin.from("projects").select("quality").eq("id", ep.project_id).single();
        await admin.from("episodes").update({ cost: (pr.quality === "hd" ? 40 : 30) * list.length }).eq("id", ep.id);
      }
      return json({ ok: true });
    }
    case "produce": {
      const ep = await ownEpisode(body.episode_id);
      if (!ep || ep.status !== "ready") return json({ error: "episode not ready" }, 400);
      const { data: secs } = await admin.from("episode_scenes").select("seconds").eq("episode_id", ep.id);
      const { data: pr } = await admin.from("projects").select("quality").eq("id", ep.project_id).single();
      const cost = (secs ?? []).reduce((t: number, x: any) => t + (x.seconds === 5 ? (pr.quality === "hd" ? 25 : 15) : (pr.quality === "hd" ? 40 : 30)), 0);
      const { data: prof } = await admin.from("profiles").select("credits").eq("id", uid).single();
      if ((prof?.credits ?? 0) < cost) return json({ error: "insufficient credits", need: cost }, 400);
      await admin.from("episodes").update({ status: "producing", cost, error: null }).eq("id", ep.id).eq("status", "ready");
      bg(advance(admin, { ...ep, status: "producing" }).catch((e) => console.error(e)));
      return json({ ok: true, cost });
    }
    case "roll_list": {
      const { data: rolls } = await admin.from("rolls").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(30);
      const out = [];
      for (const r of rolls ?? []) {
        const clips = await rollClips(admin, r);
        const paths = clips.map((c: any) => c.g.video_path).concat(r.video_path ? [r.video_path] : []);
        const { data: signed } = paths.length ? await admin.storage.from("videos").createSignedUrls(paths, 3600) : { data: [] };
        const url = (p: string) => (signed ?? []).find((x: any) => x.path === p)?.signedUrl ?? null;
        out.push({ ...r, video_url: r.video_path ? url(r.video_path) : null,
          clips: clips.map((c: any) => ({ id: c.g.id, prompt_mm: c.g.prompt_mm, duration: c.g.duration, url: url(c.g.video_path) })) });
      }
      return json({ rolls: out });
    }
    case "roll_create": {
      const { count } = await admin.from("rolls").select("id", { count: "exact", head: true }).eq("user_id", uid);
      if ((count ?? 0) >= 30) return json({ error: "Roll ၃၀ ထက် မများရပါ — မလိုတာ ဖျက်ပါ" }, 400);
      // section (owner, 27 Nov): 📝 story rolls and 🎬 director rolls are kept apart
      const section = body.section === "i2v" ? "i2v" : "t2v";
      const { data: r, error } = await admin.from("rolls").insert({ user_id: uid, title: clip(body.title, 60) || "Roll", section }).select("id").single();
      if (error) return json({ error: error.message }, 400);
      if (isId(body.generation_id)) {
        const { data: g } = await admin.from("generations").select("id").eq("id", body.generation_id).eq("user_id", uid).eq("status", "succeeded").maybeSingle();
        if (g) await admin.from("roll_items").insert({ roll_id: r.id, generation_id: g.id, sort: 0 });
      }
      return json({ id: r.id });
    }
    case "roll_add": {
      const { data: r } = await admin.from("rolls").select("id").eq("id", body.id).eq("user_id", uid).maybeSingle();
      const { data: g } = await admin.from("generations").select("id").eq("id", body.generation_id).eq("user_id", uid).eq("status", "succeeded").maybeSingle();
      if (!r || !g) return json({ error: "not found" }, 404);
      const { data: last } = await admin.from("roll_items").select("sort").eq("roll_id", r.id).order("sort", { ascending: false }).limit(1);
      const { count } = await admin.from("roll_items").select("id", { count: "exact", head: true }).eq("roll_id", r.id);
      if ((count ?? 0) >= 30) return json({ error: "Roll တစ်ခုမှာ video ၃၀ ထက် မများရ" }, 400);
      await admin.from("roll_items").insert({ roll_id: r.id, generation_id: g.id, sort: (last?.[0]?.sort ?? -1) + 1 });
      await admin.from("rolls").update({ status: "idle", updated_at: new Date().toISOString() }).eq("id", r.id).neq("status", "joining");
      return json({ ok: true });
    }
    case "roll_update": {
      const { data: r } = await admin.from("rolls").select("*").eq("id", body.id).eq("user_id", uid).maybeSingle();
      if (!r) return json({ error: "not found" }, 404);
      if (r.status === "joining") return json({ error: "ဆက်နေတုန်း ခဏစောင့်ပါ" }, 400);
      const upd: any = { updated_at: new Date().toISOString() };
      if (typeof body.title === "string") upd.title = clip(body.title, 60) || r.title;
      if (Array.isArray(body.order)) {
        // the new order of generation ids; ids not in the list are removed from the roll
        const keep = body.order.filter((x: any) => isId(x)).slice(0, 30);
        const { data: items } = await admin.from("roll_items").select("id,generation_id").eq("roll_id", r.id);
        for (const it of items ?? []) {
          const i = keep.indexOf(it.generation_id);
          if (i < 0) await admin.from("roll_items").delete().eq("id", it.id);
          else await admin.from("roll_items").update({ sort: i }).eq("id", it.id);
        }
        upd.status = "idle";
      }
      await admin.from("rolls").update(upd).eq("id", r.id);
      return json({ ok: true });
    }
    case "roll_delete": {
      const { error } = await admin.from("rolls").delete().eq("id", body.id).eq("user_id", uid);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    case "roll_join": {
      const { data: r } = await admin.from("rolls").select("*").eq("id", body.id).eq("user_id", uid).maybeSingle();
      if (!r) return json({ error: "not found" }, 404);
      if (r.status === "joining") return json({ ok: true });
      const clips = await rollClips(admin, r);
      if (clips.length < 2) return json({ error: "video ၂ ခု အနည်းဆုံး ထည့်ပါ" }, 400);
      const transition = ["cut", "dissolve", "fadeblack"].includes(body.transition) ? body.transition : (r.transition ?? "cut");
      await admin.from("rolls").update({ status: "joining", join_id: null, join_tries: 0, error: null, transition, updated_at: new Date().toISOString() }).eq("id", r.id);
      bg(joinRoll(admin, { ...r, transition, status: "idle", join_tries: 0 }).catch(async (e) => {
        console.error("roll join", r.id, e);
        // Eachlabs busy (429: only 2 jobs at once while the balance is low): stay "joining"; the next cron tick tries again
        if (/ 429 /.test(String(e?.message ?? e))) await admin.from("rolls").update({ updated_at: new Date(0).toISOString() }).eq("id", r.id);
        else await admin.from("rolls").update({ status: "failed", error: "ဆက်လို့ မရပါ — ပြန်ကြိုးစားပါ" }).eq("id", r.id);
      }));
      return json({ ok: true });
    }
    case "draw_photo": {
      const p = await ownProject(body.id);
      if (!p) return json({ error: "not found" }, 404);
      const { data: c } = await admin.from("project_characters").select("*").eq("project_id", p.id).eq("id", body.char_id).maybeSingle();
      if (!c) return json({ error: "not found" }, 404);
      const price = c.ai_draws > 0 ? PORTRAIT_REDRAW_CR : 0;
      if (price) {
        const { data: prof } = await admin.from("profiles").select("credits").eq("id", uid).single();
        if ((prof?.credits ?? 0) < price) return json({ error: "insufficient credits", need: price }, 400);
        await admin.rpc("_add_credits", { p_user: uid, p_delta: -price, p_reason: `ဇာတ်ကောင်ပုံ ပြန်ဆွဲ — ${c.name}`, p_ref: null });
      }
      try {
        const path = await drawOne(admin, c, uid);
        await admin.from("project_characters").update({ photo_path: path, photo_ai: true, ai_draws: c.ai_draws + 1 }).eq("id", c.id);
        return json({ ok: true, photo_path: path, photo_url: await sign("inputs", path), cost: price });
      } catch (e) {
        console.error("draw_photo", c.id, e);
        if (price) await admin.rpc("_add_credits", { p_user: uid, p_delta: price, p_reason: `ဇာတ်ကောင်ပုံ ဆွဲမရ — credit ပြန်အမ်း (${c.name})`, p_ref: null });
        return json({ error: "ပုံဆွဲလို့ မရပါ — ခဏနေ ပြန်ကြိုးစားပါ" + (price ? " (credit ပြန်အမ်းပြီး)" : "") }, 500);
      }
    }
    case "check_photo": {
      const path = String(body.path ?? "");
      if (!path.startsWith(uid + "/") || path.includes("..")) return json({ error: "invalid photo" }, 400);
      const { data: u } = await admin.storage.from("inputs").createSignedUrl(path, 600);
      if (!u?.signedUrl) return json({ error: "not found" }, 404);
      try {
        const out = await visionJson(admin, `You check a character photo a customer uploaded for an AI video. The photo will be used to keep this one character's face and look the same in every scene.
Return ONLY JSON: {"ok": true|false, "problems_mm": ["<each problem in short, simple Burmese, with what to do>"]}
Not ok when: more than one person or character is clearly visible (should be one only); no face or head visible, face turned away or covered; very blurry, very dark or tiny face; it is not a photo or drawing of a character at all (e.g. a screenshot of text). Animal, cartoon and costume characters are fine. Otherwise ok with an empty list.`,
          "Check this character photo.", [u.signedUrl]);
        return json({ ok: out?.ok !== false, problems_mm: (Array.isArray(out?.problems_mm) ? out.problems_mm : []).map((x: any) => clip(x, 200)).slice(0, 3) });
      } catch { return json({ ok: true, problems_mm: [] }); } // never block the customer because the checker is down
    }
    case "resume": {
      const ep = await ownEpisode(body.episode_id);
      if (!ep || ep.status !== "failed") return json({ error: "nothing to resume" }, 400);
      const { count } = await admin.from("episode_scenes").select("id", { count: "exact", head: true }).eq("episode_id", ep.id).neq("status", "pending");
      if (!count) return json({ error: "nothing to resume" }, 400); // never started: plan again instead
      await admin.from("episode_scenes").update({ status: "pending", attempts: 0 }).eq("episode_id", ep.id).eq("status", "failed");
      await admin.from("episodes").update({ status: "producing", error: null, stitch_tries: 0 }).eq("id", ep.id);
      bg(advance(admin, { ...ep, status: "producing", stitch_tries: 0 }).catch((e) => console.error(e)));
      return json({ ok: true });
    }
  }
  return json({ error: "unknown action" }, 400);
});
