// Yoke AI — video generation API (Supabase Edge Function)
// Actions (POST JSON, user JWT required):
//   { action: "plan", prompt, duration, mode, refs? } -> { plan_id }   (no credits; customer approves the plan first)
//   { action: "plan_status", plan_id } -> { status, summary_mm, issues, lines }
//   { action: "create", plan_id?, mode, prompt, quality, duration, ratio, image_path?, refs?, template_id? } -> { id }
//   { action: "status", id } -> { generation, video_url? }
//
// Vault secrets: yotta_api_key, elevenlabs_api_key (TTS, SFX, speech timing), eachlabs_api_key (audio/video merge)
// Dialogue videos: Wan 3.0 makes picture + lip movement; its speech is replaced by native Burmese voices
// placed on Wan's own speaking times, mixed with background sound, then merged (stages: dubbing → merging).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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
const YOTTA = "https://gateway.yottalabs.ai";
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const RESOLUTION: Record<string, string> = { std: "480p", hd: "720p" };
const GROUP_MODEL = "minimax-h3-lite-reference-to-video"; // scenes with 4-9 character photos (series group scenes)
let ADMIN: any = null; // service client for helpers that need secrets

// character photos (Wan 3.0 reference-to-video): [{path, name}] in Image 1..N order
const refNames = (refs: any) => (Array.isArray(refs) ? refs : []).map((r: any) => String(r?.name ?? "").trim()).filter(Boolean);
function cleanRefs(raw: any, uid: string): { path: string; name: string }[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 3) return null;
  const out: { path: string; name: string }[] = [];
  for (const r of raw) {
    const path = String(r?.path ?? ""), name = String(r?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!path.startsWith(uid + "/") || path.includes("..") || !name) return null;
    if (out.some((o) => o.name === name)) return null;
    out.push({ path, name });
  }
  return out;
}
const sameRefs = (a: any, b: any) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const isR2v = (g: any) => Array.isArray(g.refs) && g.refs.length > 0;

// ---------- planning: the "planner" function writes a checked plan (scene prompt, Burmese lines with acting, timeline,
// Burmese summary for the customer). It runs before any money is spent, so the customer can approve it first.
async function planVideo(mm: string, duration = 10, cast: string[] = [], engine = "", exact = false): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/planner`, {
    method: "POST", signal: AbortSignal.timeout(140000),
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(exact ? { story: mm, duration, cast, engine, exact: true } : { story: mm, duration, cast, engine }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || (!j.plan?.prompt && !j.plan?.blocked)) throw new Error(j.error ?? `planner ${r.status}`);
  return { ...j.plan, issues: j.issues ?? [] };
}
// fill a waiting plan row in the background
async function runPlan(admin: any, id: string) {
  const { data: p } = await admin.from("plans").select("*").eq("id", id).single();
  try {
    // "📄 Script အပြည့်" (owner, 25 Nov): translate only, no create rules (Omni only)
    const plan = await planVideo(p.prompt_mm, p.duration, refNames(p.refs), CUSTOMER_ENGINE, p.exact === true && CUSTOMER_ENGINE === "omni");
    await admin.from("plans").update({ status: "ready", plan, issues: plan.issues }).eq("id", id);
  } catch (e) {
    console.error("plan failed:", e);
    await admin.from("plans").update({ status: "failed", error: String(e).slice(0, 300) }).eq("id", id);
  }
}

// ---------- Burmese dubbing: keep Wan's picture + mouth timing, replace its speech with native Burmese voices ----------
const SR = 24000;
// each character gets a native Burmese voice of their own (cloned with the speakers' consent).
// Main characters always use the owner's "main character" voices; others get the next fitting voice.
const MAIN_MALE = "d4WXuYHO9Ot8KDdiOwIg"; // Yoke main character male
const MAIN_FEMALE = "12GZ6E7rJLrs85C6m4J6"; // Yoke main character female
const YOKE_MALE_1 = "B5MB163SdECMmHySTkLK"; // Yoke Male 1 — owner's own voice (second young man, middle-aged men)
const SU = "NBISYoQ4SVxq8eZxoHlV"; // Su — ElevenLabs library voice (second young woman, aunties)
const OLD_MAN = "uh7A30exzQsUAB5ovsOu"; // Old man
const CHILD = "uFPN3uAkEca3mQ6uRmBk"; // Yoke child (used for boys and girls until a boy's voice exists)
// which voices suit a character, best first; a voice already taken by another character is skipped when possible
function voiceChoices(l: any, who: string): string[] {
  const age = String(l.age ?? "");
  const female = l.gender === "female";
  if (age === "child" || /child|kid|boy|girl|son|daughter|grandchild|little/.test(who) && !/young (man|woman)|boyfriend|girlfriend/.test(who) && age !== "young")
    return [CHILD];
  if (age === "old" || /grand|old|elder/.test(who)) return female ? [SU, MAIN_FEMALE] : [OLD_MAN];
  if (age === "middle" || /uncle|aunt|father|mother|dad|mom|boss/.test(who)) return female ? [SU, MAIN_FEMALE] : [YOKE_MALE_1, OLD_MAN];
  return female ? [MAIN_FEMALE, SU] : [MAIN_MALE, YOKE_MALE_1];
}
const toI16 = (b: Uint8Array) => { const n = b.length >> 1; const o = new Int16Array(n); const dv = new DataView(b.buffer, b.byteOffset, n * 2); for (let i = 0; i < n; i++) o[i] = dv.getInt16(i * 2, true); return o; };
function wavOf(mix: Float32Array): Uint8Array {
  const n = mix.length; const buf = new Uint8Array(44 + n * 2); const dv = new DataView(buf.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 2, true);
  let peak = 1; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const norm = peak > 30000 ? 30000 / peak : 1;
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(mix[i] * norm), true);
  return buf;
}
function trim(x: Int16Array): Int16Array {
  let peak = 1; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const th = peak * 0.04, m = Math.round(0.03 * SR); let a = 0, b = x.length - 1;
  while (a < b && Math.abs(x[a]) < th) a++; while (b > a && Math.abs(x[b]) < th) b--;
  return x.slice(Math.max(0, a - m), Math.min(x.length, b + m));
}
// WSOLA time-stretch (pitch unchanged); ratio = output length / input length
function stretch(xi: Int16Array, ratio: number): Float32Array {
  const x = Float32Array.from(xi); const N = 768, Hs = N / 2, tol = 192, Ha = Hs / ratio;
  const outLen = Math.round(x.length * ratio); const y = new Float32Array(outLen + N); const ws = new Float32Array(outLen + N);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  let prev = 0;
  for (let k = 0; k * Hs < outLen; k++) {
    const nominal = Math.round(k * Ha); let best = nominal;
    if (k > 0) { const nat = prev + Hs; let bestC = -Infinity;
      for (let d = -tol; d <= tol; d += 4) { const p = nominal + d; if (p < 0 || p + N > x.length) continue;
        let c = 0; for (let i = 0; i < N; i += 2) c += x[p + i] * (x[nat + i] ?? 0); if (c > bestC) { bestC = c; best = p; } } }
    best = Math.max(0, Math.min(best, x.length - N)); prev = best;
    const o = k * Hs; for (let i = 0; i < N && best + i < x.length; i++) { y[o + i] += x[best + i] * win[i]; ws[o + i] += win[i]; }
  }
  const out = new Float32Array(outLen); for (let i = 0; i < outLen; i++) out[i] = ws[i] > 1e-3 ? y[i] / ws[i] : 0;
  return out;
}
// change the pitch but keep the length: resample (pitch moves), then WSOLA back to the original length.
// Used when two characters must share one voice (e.g. two grandfathers): the second sounds a little different.
function pitchShift(x: Int16Array, p: number): Int16Array {
  if (p === 1 || x.length < 2000) return x;
  const L = Math.round(x.length / p); const y = new Int16Array(L);
  for (let i = 0; i < L; i++) { const t = i * p, k = Math.floor(t), f = t - k; y[i] = Math.round((1 - f) * (x[k] ?? 0) + f * (x[k + 1] ?? x[k] ?? 0)); }
  const z = stretch(y, p); const out = new Int16Array(z.length);
  for (let i = 0; i < z.length; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round(z[i])));
  return out;
}
const PITCH_VARIANTS = [1, 0.9, 1.08]; // 1st, 2nd, 3rd character on the same voice
// how each line should sound: an ElevenLabs audio tag + how expressive the voice may be
const EMOTION: Record<string, { tag: string; stability: number }> = {
  calm: { tag: "", stability: 0.6 }, polite: { tag: "[politely] ", stability: 0.65 }, warm: { tag: "[warmly] ", stability: 0.55 },
  happy: { tag: "[happily] ", stability: 0.45 }, excited: { tag: "[excited] ", stability: 0.4 }, shouting: { tag: "[shouting] ", stability: 0.35 },
  angry: { tag: "[angry] ", stability: 0.4 }, sad: { tag: "[sad] ", stability: 0.5 }, scared: { tag: "[scared] ", stability: 0.4 },
  whisper: { tag: "[whispers] ", stability: 0.55 },
};
async function tts(key: string, voice: string, text: string, emotion?: string, calmer = 0, delivery = ""): Promise<Int16Array> {
  const e0 = EMOTION[emotion ?? ""] ?? EMOTION.calm;
  // the planner's own voice direction (e.g. "[breathless, voice catching with joy] [soft laugh]") is richer than one emotion word
  // one direction only (14 Nov style): the line's own tag replaces the emotion word, never stacked; voice steadiness unchanged
  const one = (String(delivery).match(/\[[^\]\[]{1,60}\]/) ?? [""])[0];
  const e = one ? { tag: `${one} `, stability: e0.stability } : e0;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_24000`, {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: e.tag + text, model_id: "eleven_v4", voice_settings: { stability: Math.min(0.85, e.stability + calmer), similarity_boost: 0.8, speed: 1.05 } }),
  });
  if (!r.ok) throw new Error("tts " + r.status + " " + (await r.text()).slice(0, 200));
  return toI16(new Uint8Array(await r.arrayBuffer()));
}
async function sfxGen(key: string, text: string, sec: number): Promise<Int16Array | null> {
  const r = await fetch(`https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_24000`, {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, duration_seconds: Math.min(Math.max(sec, 0.5), 22), prompt_influence: 0.5 }),
  });
  return r.ok ? toI16(new Uint8Array(await r.arrayBuffer())) : null;
}
// how strongly each character acts in the picture: Wan's own (unclear) speech follows its acting
const LADDER = ["whisper", "calm", "warm", "happy", "excited", "shouting"];
function shiftEmotion(e: string, step: number) {
  const i = LADDER.indexOf(e);
  if (i < 0 || !step) return e;
  return LADDER[Math.max(1, Math.min(LADDER.length - 1, i + step))];
}
function rmsOf(x: Int16Array, a: number, b: number) {
  const s = Math.max(0, Math.round(a * SR)), e = Math.min(x.length, Math.round(b * SR)); let sum = 0;
  for (let i = s; i < e; i++) sum += x[i] * x[i];
  return e > s ? Math.sqrt(sum / (e - s)) : 0;
}
// when does each speaker talk in Wan's own audio? (ElevenLabs Scribe, word timings + speakers)
async function speechTurns(key: string, url: string, speakers: number): Promise<{ start: number; end: number; spk: string }[]> {
  const fd = new FormData(); fd.append("model_id", "scribe_v1"); fd.append("cloud_storage_url", url);
  fd.append("diarize", "true"); fd.append("timestamps_granularity", "word"); fd.append("tag_audio_events", "true");
  if (speakers > 0) fd.append("num_speakers", String(Math.min(speakers, 8)));
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: fd });
  if (!r.ok) throw new Error("stt " + r.status + " " + (await r.text()).slice(0, 200));
  const j: any = await r.json();
  const segs: { start: number; end: number; spk: string; words?: any[] }[] = [];
  // real words only (Scribe also returns "?", "။" as words); whispered/unclear speech comes back as an audio event
  // like "[အလွန်လွမ်းနေတာ]" - it is still Wan talking, so it counts (to place our line and to mute Wan there)
  const words = (j.words ?? []).filter((w: any) => (w.type === "word" || (w.type === "audio_event" && /[\u1000-\u109F]/.test(w.text)))
    && /[\u1000-\u109Fa-zA-Z]/.test(w.text)).map((w: any) => ({ ...w, text: String(w.text).replace(/[\[\]()]/g, "") }));
  (segs as any).words = words; // kept for matching lines by their text (matchLines)
  for (const w of words) {
    const last = segs[segs.length - 1];
    if (last && last.spk === w.speaker_id && w.start - last.end < 0.45) last.end = w.end;
    else segs.push({ start: w.start, end: w.end, spk: w.speaker_id });
  }
  return segs;
}
// make exactly n speaking windows: merge the closest neighbours (same speaker first) or split the longest
function fitTurns(segs: { start: number; end: number; spk: string }[], n: number) {
  const s = segs.map((x) => ({ ...x }));
  while (s.length > n) {
    let bi = 0, bv = Infinity;
    for (let i = 0; i + 1 < s.length; i++) { const v = s[i + 1].start - s[i].end + (s[i].spk === s[i + 1].spk ? 0 : 1); if (v < bv) { bv = v; bi = i; } }
    s[bi].end = s[bi + 1].end; s.splice(bi + 1, 1);
  }
  while (s.length > 0 && s.length < n) {
    let bi = 0; for (let i = 1; i < s.length; i++) if (s[i].end - s[i].start > s[bi].end - s[bi].start) bi = i;
    const m = (s[bi].start + s[bi].end) / 2; s.splice(bi + 1, 0, { start: m + 0.1, end: s[bi].end, spk: s[bi].spk }); s[bi].end = m - 0.1;
  }
  return s;
}
// find each line where Wan actually says it (by the words, in order). Wan sometimes says extra words
// (a name, a sound) before the line; matching the text keeps the voice on the lips. null if a line can't be found.
function matchLines(words: { start: number; end: number; text: string }[], lines: any[]) {
  const out: { start: number; end: number; spk: string }[] = []; let from = 0;
  for (const l of lines) {
    const want = mmLetters(String(l.text ?? "")).length; let best = { score: 0, a: -1, b: -1 };
    for (let a = from; a < words.length; a++) {
      let txt = "";
      for (let b = a; b < words.length && b < a + 40; b++) {
        txt += words[b].text; const got = mmLetters(txt).length;
        if (got > want * 1.6 + 2) break;
        const sc = similar(txt, l.text); if (sc > best.score) best = { score: sc, a, b };
      }
    }
    if (best.score < 0.45) return null;
    out.push({ start: words[best.a].start, end: words[best.b].end, spk: "" }); from = best.b + 1;
  }
  return out;
}
// decode a 16-bit PCM WAV and resample to 24 kHz mono
function wavTo24k(b: Uint8Array): Int16Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 12, sr = 24000, ch = 1;
  while (o + 8 <= b.length) {
    const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), len = dv.getUint32(o + 4, true);
    if (id === "fmt ") { ch = dv.getUint16(o + 10, true); sr = dv.getUint32(o + 12, true); }
    if (id === "data") {
      const n = Math.floor(Math.min(len, b.length - o - 8) / 2 / ch); const out = new Int16Array(Math.floor(n * SR / sr));
      for (let i = 0; i < out.length; i++) { const t = i * sr / SR, k = Math.floor(t), f = t - k; let a = 0, c = 0;
        for (let q = 0; q < ch; q++) { a += dv.getInt16(o + 8 + (k * ch + q) * 2, true); c += k + 1 < n ? dv.getInt16(o + 8 + ((k + 1) * ch + q) * 2, true) : 0; }
        out[i] = Math.round(((1 - f) * a + f * c) / ch); }
      return out;
    }
    o += 8 + len + (len & 1);
  }
  throw new Error("bad wav");
}
// run an Eachlabs utility model and wait for its output URL
async function eachRun(admin: any, model: string, input: any, maxMs = 90000): Promise<string> {
  const h = await eachlabs(admin);
  const sub = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: h, body: JSON.stringify({ model, version: "0.0.1", input }) });
  const sj: any = await sub.json().catch(() => ({})); const pid = sj.predictionID ?? sj.prediction_id ?? sj.id;
  if (!pid) throw new Error(model + " submit " + sub.status + " " + JSON.stringify(sj).slice(0, 200));
  for (const t0 = Date.now(); Date.now() - t0 < maxMs;) {
    await new Promise((r) => setTimeout(r, 3000));
    const j: any = await (await fetch(`https://api.eachlabs.ai/v1/prediction/${pid}`, { headers: h })).json().catch(() => ({}));
    if (j.status === "error" || j.status === "failed") throw new Error(model + " failed");
    if ((j.status === "success" || j.status === "succeeded") && j.output) return Array.isArray(j.output) ? j.output[0] : j.output;
  }
  throw new Error(model + " timeout");
}
// Wan's own soundtrack (gunshots, footsteps, ambience...) — perfectly in time with the picture
async function wanSoundtrack(admin: any, srcUrl: string): Promise<Int16Array | null> {
  try {
    const url = await eachRun(admin, "audio-extractor", { video: srcUrl, output_format: "wav", sample_rate: 48000, speech_ready_mono: true });
    return wavTo24k(new Uint8Array(await (await fetch(url)).arrayBuffer()));
  } catch (e) { console.error("wanSoundtrack:", e); return null; }
}
// one fixed standard loudness for every voice (speech RMS); shouting/angry louder, whispering/sad softer
const LOUD: Record<string, number> = { shouting: 1.6, angry: 1.35, excited: 1.2, happy: 1.05, sad: 0.85, scared: 0.9, whisper: 0.45 };
function levelVoice(x: Int16Array, emotion?: string): Int16Array {
  let peak = 1; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const gate = peak * 0.1; let sum = 0, cnt = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > gate) { sum += v * v; cnt++; } }
  const rms = Math.sqrt(sum / Math.max(1, cnt)); const target = 5200 * (LOUD[emotion ?? ""] ?? 1);
  const g = Math.min(4, target / Math.max(1, rms)); const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) { const v = x[i] * g; out[i] = Math.max(-32000, Math.min(32000, v > 24000 ? 24000 + (v - 24000) * 0.3 : v < -24000 ? -24000 + (v + 24000) * 0.3 : v)); }
  return out;
}
// how close the heard words are to the line (0..1), Burmese letters only
const mmLetters = (t: string) => [...String(t).replace(/[^\u1000-\u109F]/g, "")];
function similar(a: string, b: string) {
  const x = mmLetters(a), y = mmLetters(b); if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) { const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur; }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}
async function heard(key: string, pcm: Int16Array): Promise<string> {
  const fd = new FormData(); fd.append("model_id", "scribe_v1"); fd.append("language_code", "mya"); fd.append("tag_audio_events", "false");
  fd.append("file", new Blob([wavOf(Float32Array.from(pcm)) as BlobPart], { type: "audio/wav" }), "l.wav");
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: fd });
  return r.ok ? String((await r.json()).text ?? "") : "";
}
// digits are read badly by the voices: say them as Burmese words (up to 99,999)
const MM_DIGIT = ["သုည", "တစ်", "နှစ်", "သုံး", "လေး", "ငါး", "ခြောက်", "ခုနစ်", "ရှစ်", "ကိုး"];
function mmNumber(n: number): string {
  if (n < 10) return MM_DIGIT[n];
  const units: [number, string, string][] = [[10000, "သောင်း", "သောင်း"], [1000, "ထောင်", "ထောင့်"], [100, "ရာ", "ရာ့"], [10, "ဆယ်", "ဆယ့်"]];
  let out = "", rest = n;
  for (const [v, plain, joined] of units) {
    const d = Math.floor(rest / v); rest %= v; if (!d) continue;
    out += (d === 1 && v === 10 && !out ? "" : MM_DIGIT[d]) + (rest ? joined : plain);
  }
  return out + (rest ? MM_DIGIT[rest] : "");
}
const spokenNumbers = (t: string) => t.replace(/[0-9\u1040-\u1049]+/g, (m) => {
  const n = Number([...m].map((c) => { const k = c.charCodeAt(0); return k >= 0x1040 ? String(k - 0x1040) : c; }).join(""));
  return n <= 99999 ? mmNumber(n) : m;
});
async function voiceLine(key: string, l0: any, voice: string): Promise<Int16Array> {
  const l = { ...l0, text: spokenNumbers(String(l0.text)) };
  // check the words came out right; one more try if not, keep the clearer take
  let best: Int16Array | null = null, bestScore = -1;
  for (let t = 0; t < 2; t++) {
    const out = trim(await tts(key, voice, sayable(String(l.spoken || l.text)), l.emotion, voice === YOKE_MALE_1 ? 0.1 : 0, String(l.delivery ?? "")));
    if (voice === SU) return levelVoice(out, l.emotion); // Su is a library voice: always clear
    const score = similar(await heard(key, out), sayable(String(l.spoken || l.text)));
    if (score > bestScore) { best = out; bestScore = score; }
    if (score >= 0.8) break;
  }
  return levelVoice(best!, l.emotion);
}
// English words inside a Burmese line are read with English stress and stretched ("baaabyyy"); say them the Yangon way.
// The planner/director give "spoken"; this is the safety net for anything left in Latin letters.
const LOANS: Record<string, string> = { baby: "ဘေဘီ", babe: "ဘိတ်", sorry: "ဆောရီး", ok: "အိုကေ", okay: "အိုကေ", bye: "ဘိုင်", "bye bye": "ဘိုင်ဘိုင်",
  "thank you": "သန့်ကျူး", thanks: "သန့်ကျူး", hello: "ဟယ်လို", hi: "ဟိုင်း", please: "ပလိစ်", love: "လပ်ဗ်", "i love you": "အိုင်လပ်ဗ်ယူ", phone: "ဖုန်း",
  car: "ကား", wow: "ဝါး", yes: "ယက်စ်", no: "နို", boss: "ဘော့စ်", bro: "ဘရို", sis: "ဆစ်စ်", honey: "ဟန်နီ", darling: "ဒါလင်", party: "ပါတီ", birthday: "ဘတ်ဒေး" };
function sayable(text: string): string {
  let t = String(text);
  for (const k of Object.keys(LOANS).sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`(^|[^A-Za-z])${k}(?=$|[^A-Za-z])`, "gi"), (_, pre) => pre + LOANS[k]);
  return t;
}
async function buildDubAudio(admin: any, g: any, srcUrl: string): Promise<Uint8Array> {
  const { data: key } = await admin.rpc("get_app_secret", { p_name: "elevenlabs_api_key" });
  const lines: any[] = g.dialogue?.lines ?? [];
  const total = Number(g.duration) || 10; const n = Math.round(total * SR);
  const stingSpec: any[] = g.dialogue?.stingers ?? [];
  const [turnsRaw, bed, wan, stings] = await Promise.all([
    lines.length ? speechTurns(key, srcUrl, new Set(lines.map((l) => l.who ?? l.gender)).size).catch((e) => { console.error(e); return []; }) : Promise.resolve([]),
    g.dialogue?.ambience ? sfxGen(key, g.dialogue.ambience, total) : Promise.resolve(null),
    wanSoundtrack(admin, srcUrl),
    (async () => { const out: (Int16Array | null)[] = []; // one at a time: ElevenLabs allows only 3 requests at once
      for (const x of stingSpec) out.push(await sfxGen(key, x.sound, 1.6).catch(() => null)); return out; })(),
  ]);
  const matched = (turnsRaw as any).words ? matchLines((turnsRaw as any).words, lines) : null;
  const turns = matched ?? (turnsRaw.length ? fitTurns(turnsRaw, lines.length) : []);
  console.log("dub timing", g.id, matched ? "by text" : "by turns", JSON.stringify(turns.map((t) => [+t.start.toFixed(2), +t.end.toFixed(2)])));
  // match each voice to the acting in the picture: calmer than usual on screen -> one step calmer, much stronger -> one step stronger
  const energy = turns.map((t) => (wan ? rmsOf(wan, t.start, t.end) : 0));
  const known = energy.filter((e) => e > 0).sort((a, b) => a - b); const med = known.length ? known[Math.floor(known.length / 2)] : 0;
  const pcms: Int16Array[] = []; const cast = new Map<string, string>(); const pitch = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) { // one at a time (ElevenLabs allows 3 at once); each man keeps his own voice
    const l = lines[i]; let emotion = l.emotion;
    if (med > 0 && energy[i] > 0 && known.length >= 2) { const r = energy[i] / med; emotion = shiftEmotion(emotion, r < 0.65 ? -1 : r > 1.5 ? 1 : 0); }
    const who = String(l.who ?? "man").toLowerCase();
    const fixed = g.dialogue?.voices?.[String(l.who ?? "")]; // series characters keep one voice in every episode
    if (!cast.has(who) && fixed) { // "voiceId" or "voiceId@pitch" (series characters that share a voice)
      const [vid, pp] = String(fixed).split("@"); let pv = Number(pp) || 1;
      const same = [...cast.keys()].filter((k) => cast.get(k) === vid && pitch.get(k) === pv).length;
      if (same) pv = PITCH_VARIANTS.find((x) => ![...cast.keys()].some((k) => cast.get(k) === vid && pitch.get(k) === x)) ?? pv;
      cast.set(who, vid); pitch.set(who, pv);
    }
    if (!cast.has(who)) {
      const opts = voiceChoices(l, who); const taken = [...cast.values()];
      const v = opts.find((o) => !taken.includes(o)) ?? opts[0];
      cast.set(who, v); pitch.set(who, PITCH_VARIANTS[Math.min(2, taken.filter((t) => t === v).length)]);
    }
    pcms.push(pitchShift(await voiceLine(key, { ...l, emotion }, cast.get(who)!), pitch.get(who) ?? 1));
  }
  // only when Wan's own soundtrack is unavailable do we add guessed, timed effects
  const fx = wan ? [] : await Promise.all(((g.dialogue?.effects ?? []) as any[]).map((e) => sfxGen(key, e.text, e.dur).then((pcm) => ({ ...e, pcm })).catch(() => null)));
  const speech = new Float32Array(n); const placed: { start: number; end: number }[] = [];
  let cursor = 0.5;
  pcms.forEach((pcm, i) => {
    let out: Int16Array | Float32Array = pcm; let start: number;
    if (turns[i]) {
      const win = turns[i].end - turns[i].start + 0.15;
      const ratio = Math.min(1, Math.max(0.83, (win * SR) / pcm.length));
      if (ratio < 0.995) out = stretch(pcm, ratio);
      start = Math.max(0, turns[i].start - 0.05);
    } else { start = Math.max(cursor, Math.min(total - 1.5, Number(lines[i]?.at) || 0)); } // no speech found: at the planned second
    const s0 = Math.round(start * SR); for (let k = 0; k < out.length && s0 + k < n; k++) speech[s0 + k] += out[k];
    const end = start + out.length / SR; placed.push({ start, end }); cursor = end + 0.3;
  });
  // reaction effects (the customer chose them): right after the line that causes the feeling, softer if someone talks over them
  const addStingers = (mix: Float32Array) => {
    const talk = new Uint8Array(n);
    for (const t of placed) for (let i = Math.max(0, Math.round(t.start * SR)); i < Math.min(n, Math.round(t.end * SR)); i++) talk[i] = 1;
    stingSpec.forEach((x, j) => {
      const pcm = stings[j]; if (!pcm?.length) return;
      const at = placed[x.after] ? placed[x.after].end + 0.05 : placed.length ? placed[placed.length - 1].end + 0.05 : Number(x.at) || 0;
      let ss = 0; for (let i = 0; i < pcm.length; i++) ss += pcm[i] * pcm[i];
      const norm = Math.min(4, 3800 / Math.max(1, Math.sqrt(ss / pcm.length))); const s0 = Math.round(at * SR); const fade = Math.round(0.15 * SR);
      for (let k = 0; k < pcm.length && s0 + k < n; k++) mix[s0 + k] += pcm[k] * norm * (talk[s0 + k] ? 0.45 : 1) * Math.min(1, (pcm.length - k) / fade);
    });
    return mix;
  };
  // Wan's soundtrack keeps every sound effect in sync; it is silenced only where Wan's (wrong) Burmese speech was
  if (wan) {
    const mute = new Float32Array(n).fill(1); const pad = Math.round(0.2 * SR), ramp = Math.round(0.06 * SR);
    for (const t of turnsRaw) { const a = Math.max(0, Math.round(t.start * SR) - pad), b = Math.min(n, Math.round(t.end * SR) + pad);
      for (let i = Math.max(0, a - ramp); i < Math.min(n, b + ramp); i++) { const d = i < a ? (a - i) / ramp : i >= b ? (i - b + 1) / ramp : 0; mute[i] = Math.min(mute[i], d); } }
    const mix = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = (wan[i] ?? 0) * mute[i];
      const fill = bed ? (bed[i % bed.length] ?? 0) * 0.55 * (1 - mute[i]) : 0; // keep the scene alive while Wan is muted
      mix[i] = speech[i] + w + fill;
    }
    return wavOf(addStingers(mix));
  }
  // background bed, ducked under speech
  const mix = new Float32Array(n); const hi = 0.9, lo = 0.5, fade = Math.round(0.25 * SR);
  const inSp = new Uint8Array(n);
  for (const t of placed) { const a = Math.max(0, Math.round(t.start * SR) - fade), b = Math.min(n, Math.round(t.end * SR) + fade); for (let i = a; i < b; i++) inSp[i] = 1; }
  let gn = hi; const step = (hi - lo) / fade;
  for (let i = 0; i < n; i++) {
    const tg = inSp[i] ? lo : hi; gn = gn > tg ? Math.max(tg, gn - step) : Math.min(tg, gn + step);
    const edge = Math.min(1, i / (0.3 * SR), (n - i) / (0.5 * SR));
    mix[i] = speech[i] + (bed ? (bed[i % bed.length] ?? 0) * gn * edge : 0);
  }
  // timed story sounds (gunshots, explosions...) on top, a little softer while someone speaks
  for (const e of fx) { if (!e?.pcm) continue; const s0 = Math.round(e.at * SR);
    for (let k = 0; k < e.pcm.length && s0 + k < n; k++) mix[s0 + k] += e.pcm[k] * (inSp[s0 + k] ? 0.6 : 0.95); }
  return wavOf(addStingers(mix));
}
async function eachlabs(admin: any) {
  const { data: k } = await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" });
  return { "Content-Type": "application/json", Authorization: `Bearer ${k}`, "X-API-Key": k };
}

// ---------- Yotta Gateway: Wan 3.0 (native audio), PixVerse V6 fallback for i2v ----------
// ---- Gemini Omni Flash through Eachlabs (Google's model; Eachlabs serves Myanmar customers) ----
// One model makes picture + Burmese speech + sound together (lips match by construction): no ElevenLabs, no dubbing.
// Omni 1.2 (owner's choice, 24 Nov 23:14): ~30% cheaper than 1.1, up to 10 photos. 1.2 copies a photo's clothes unless
// the script names them, so the planner always writes each person's clothing (and keeps everyone in frame).
const OMNI_REF = "google-gemini-omni-1-2-flash-reference-to-video"; // character/costume photos: std=360p, hd=720p
const OMNI_I2V = "google-gemini-omni-1-2-flash-image-to-video";
const OMNI_T2V = "google-gemini-omni-1-2-flash-text-to-video"; // no photo
const CUSTOMER_ENGINE = "omni"; // customers' videos: Gemini Omni Flash (speaks Burmese itself, no dubbing)
// ---- Kie.ai: the same Google Omni model (1.2), about half the price. Used for 0-2 character photos; anything else, or any
// Kie failure except a blocked photo, goes to Eachlabs. Kie can't take face photos directly: each photo becomes a Kie
// "character" first (free), and "the young man in Image 1" in the prompt becomes that character's name.
const KIE = "https://api.kie.ai/api/v1";
const KIE_MODEL = "google/gemini-omni-flash-1-2";
const USE_KIE = false; // off for now: about half of Kie's jobs failed with its own errors (24 Nov); Eachlabs is the main route
async function kieHeaders(admin: any) {
  const { data: k } = await admin.rpc("get_app_secret", { p_name: "kie_api_key" });
  if (!k) throw new Error("no kie key");
  return { "Content-Type": "application/json", Authorization: `Bearer ${k}` };
}
export function kiePrompt(prompt: string, n: number): string {
  // keep the story's own words ("the young man ...") so the model reads the scene exactly as on Eachlabs;
  // only swap the photo number for the character's name: "the young man in Image 1" -> "the young man (Char1)"
  let p = prompt;
  for (let i = 1; i <= n; i++) {
    p = p.replace(new RegExp(`\\s+(?:in|from)\\s+Image\\s*${i}\\b`, "g"), ` (Char${i})`).replace(new RegExp(`\\bImage\\s*${i}\\b`, "g"), `Char${i}`);
  }
  return p;
}
async function submitKie(admin: any, g: any, prompt: string, refUrls: string[]): Promise<string> {
  const h = await kieHeaders(admin);
  const ids: string[] = [];
  for (let i = 0; i < refUrls.length; i++) {
    // Kie can't read our signed links while generating: copy the photo into Kie's own storage first
    const up = await fetch("https://kieai.redpandaai.co/api/file-url-upload", { method: "POST", headers: h,
      body: JSON.stringify({ fileUrl: refUrls[i], uploadPath: "yoke", fileName: `${g.id}_${i + 1}.jpg` }) });
    const uj: any = await up.json().catch(() => ({}));
    const url = uj?.data?.downloadUrl;
    if (!url) throw new Error(`kie upload failed: ${JSON.stringify(uj).slice(0, 200)}`);
    const cr = await fetch(`${KIE}/omni/character/create`, { method: "POST", headers: h,
      body: JSON.stringify({ descriptions: `The face, hair and build of the person in photo ${i + 1}. Clothing is not fixed: dress them as the story and the scene call for.`, image_urls: [url], character_name: `Char${i + 1}` }) });
    const cj: any = await cr.json().catch(() => ({}));
    if (!cj?.data?.characterId) throw new Error(`kie character failed: ${JSON.stringify(cj).slice(0, 200)}`);
    ids.push(cj.data.characterId);
  }
  const input: any = { prompt: kiePrompt(prompt, ids.length).slice(0, 19000), duration: Math.min(15, Math.max(3, Number(g.duration) || 10)),
    resolution: "360p", aspect_ratio: g.ratio === "16:9" ? "16:9" : "9:16" };
  if (ids.length) input.character_ids = ids;
  const r = await fetch(`${KIE}/jobs/createTask`, { method: "POST", headers: h, body: JSON.stringify({ model: KIE_MODEL, input }) });
  const j: any = await r.json().catch(() => ({}));
  const id = j?.data?.taskId;
  if (!r.ok || j?.code !== 200 || !id) throw new Error(`kie submit failed: ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}
// photos and first frame for a generation (fresh signed links), used at start and for the Eachlabs fallback
async function omniInputs(admin: any, g: any): Promise<{ imageUrl?: string; refUrls: string[] }> {
  let imageUrl: string | undefined;
  if (g.mode === "i2v") {
    const { data: s, error: se } = await admin.storage.from("inputs").createSignedUrl(g.image_path, 3600);
    if (se || !s) throw new Error("image not found");
    imageUrl = s.signedUrl;
  }
  const refUrls: string[] = [];
  for (const r of isR2v(g) ? g.refs : []) {
    if (/^https:\/\/cdn-us\.eachlabs\.ai\//.test(String(r.url ?? ""))) { refUrls.push(r.url); continue; }
    const { data: s, error: se } = await admin.storage.from("inputs").createSignedUrl(r.path, 3600);
    if (se || !s) throw new Error("character photo not found");
    refUrls.push(s.signedUrl);
  }
  return { imageUrl, refUrls };
}
async function submitOmni(admin: any, g: any, prompt: string, imageUrl?: string, refUrls: string[] = [], noKie = false): Promise<{ id: string; model: string }> {
  if (USE_KIE && !noKie && !imageUrl && refUrls.length <= 2 && refUrls.every((u) => !/cdn-us\.eachlabs\.ai/.test(u))) {
    try { return { id: await submitKie(admin, g, prompt, refUrls), model: "kie" }; }
    catch (e) { console.error("kie submit failed, using eachlabs:", e); }
  }
  const ratio = g.ratio === "16:9" ? "16:9" : "9:16"; const duration = `${Math.min(10, Math.max(3, Number(g.duration) || 10))}s`;
  let model: string; let input: any;
  // always made at 360p: HD (720p) is the same video sharpened by an upscaler afterwards (owner's choice, 24 Nov)
  const resolution = "360p";
  if (refUrls.length) { model = OMNI_REF; input = { prompt: prompt.slice(0, 19000), image_urls: refUrls.slice(0, 10), aspect_ratio: ratio, duration, resolution }; }
  else if (imageUrl) { model = OMNI_I2V; input = { prompt: prompt.slice(0, 19000), image_url: imageUrl, aspect_ratio: ratio, duration, resolution }; }
  else { model = OMNI_T2V; input = { prompt: prompt.slice(0, 19000), aspect_ratio: ratio, duration, resolution }; }
  const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabs(admin),
    body: JSON.stringify({ model, version: "0.0.1", input }) });
  const j: any = await r.json().catch(() => ({}));
  const id = j.predictionID ?? j.prediction_id ?? j.id;
  if (!r.ok || !id) throw new Error(`submit ${model} failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
  return { id, model };
}

async function submitVideo(g: any, prompt: string, imageUrl?: string, refUrls: string[] = []): Promise<{ id: string; model: string }> {
  if (g.engine === "omni") return await submitOmni(ADMIN!, g, prompt, imageUrl, refUrls);
  const isI2v = g.mode === "i2v";
  const isRef = refUrls.length > 0;
  const path = isRef ? "reference-to-video" : isI2v ? "image-to-video" : "text-to-video";
  const tryModel = async (model: string, extra: Record<string, unknown>) => {
    const parameters: Record<string, unknown> = {
      prompt, resolution: RESOLUTION[g.quality] ?? "480p", duration: g.duration, generate_audio: true, ...extra,
    };
    if (isI2v) parameters.first_frame = imageUrl; else parameters.aspect_ratio = g.ratio;
    if (isRef) parameters.reference_items = refUrls.map((url) => ({ type: "image", url }));
    const r = await fetch(`${YOTTA}/api/maas/${path}/generations`, {
      method: "POST",
      headers: { "X-API-KEY": YOTTA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model, parameters }),
    });
    const j = await r.json().catch(() => ({}));
    const id = j?.data?.request_id ?? j?.request_id;
    if (!r.ok || !id) throw new Error(`submit ${model} failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
    return { id, model };
  };
  // group scenes (4-9 character photos, from series episodes): Wan takes only 3 photos -> MiniMax H3 Lite on Eachlabs (up to 9)
  if (refUrls.length > 3) {
    const r = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabs(ADMIN!),
      body: JSON.stringify({ model: GROUP_MODEL, version: "0.0.1", input: { prompt: prompt.slice(0, 7000), ratio: g.ratio,
        duration: g.duration, resolution: g.quality === "hd" ? "768P" : "480P", reference_image_urls: refUrls.slice(0, 9) } }) });
    const j: any = await r.json().catch(() => ({}));
    const id = j.predictionID ?? j.prediction_id ?? j.id;
    if (!r.ok || !id) throw new Error(`submit ${GROUP_MODEL} failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
    return { id, model: GROUP_MODEL };
  }
  // character photos: only Wan 3.0 keeps the faces; no fallback to a model that would ignore them
  if (isRef) return await tryModel("wan3.0-r2v", { enhance_prompt: false });
  try {
    return await tryModel(isI2v ? "wan3.0-i2v" : "wan3.0-t2v", { enhance_prompt: false });
  } catch (e) {
    console.error("wan submit failed, falling back to pixverse:", e);
    const res = g.quality === "hd" ? "720p" : "540p";
    return await tryModel(isI2v ? "pixverse-v6-i2v" : "pixverse-v6-t2v", { resolution: res });
  }
}

const SAFETY_MM = "ဇာတ်လမ်းထဲက အကြောင်းအရာကို AI ရဲ့ ဘေးကင်းရေး စစ်ဆေးမှုက လက်မခံပါ (ဥပမာ ကလေးနဲ့ အကြမ်းဖက်မှု၊ သွေး၊ အဝတ်မဲ့)။ စာသားကို ပြင်ပြီး ပြန်ထုတ်ပါ — credit ပြန်အမ်းပြီးပါပြီ။";
const FAMOUS_MM = "ထည့်ထားတဲ့ ဓာတ်ပုံထဲက လူဟာ နာမည်ကြီး လူသိများသူနဲ့ တူလို့ AI က လက်မခံပါ။ ကိုယ်ပိုင်ပုံ (သို့) တခြားပုံနဲ့ ပြန်ထုတ်ပါ — credit ပြန်အမ်းပြီးပါပြီ။";
// try 2 (rewording a customer line) stays off until the owner allows changing customer lines
const SAFE_TRIES = 1;
// Google declined an Omni prompt: the planner rewrites only the likely trigger (try 1: English only; try 2: may reword the
// line that is the trigger, keeping its meaning), then the same job is sent again with the same photos.
async function safeRetry(g: any, tryNo: number): Promise<boolean> {
  const base = String(g.prompt_en ?? "");
  if (!base) return false;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/planner`, {
    method: "POST", signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ safe_rewrite: base, safe_try: tryNo }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.prompt) throw new Error(j.error ?? `rewrite ${r.status}`);
  const { imageUrl, refUrls } = await omniInputs(ADMIN!, g);
  const sub = await submitOmni(ADMIN!, g, j.prompt + MYANMAR_LOOK, imageUrl, refUrls, true);
  const notes = [...(g.post_data?.safe_notes ?? []), j.changed_mm].filter(Boolean);
  await ADMIN!.from("generations").update({ prompt_en: j.prompt, provider: `eachlabs:${sub.model}`, provider_request_id: sub.id,
    post_data: { ...(g.post_data ?? {}), safe_tries: tryNo, safe_notes: notes } }).eq("id", g.id);
  console.log("safe retry", g.id, tryNo, j.changed_mm);
  return true;
}
async function pollVideo(g: any): Promise<{ state: "running" | "done" | "failed"; url?: string; error?: string }> {
  if (String(g.provider ?? "").startsWith("kie:")) {
    const r = await fetch(`${KIE}/jobs/recordInfo?taskId=${g.provider_request_id}`, { headers: await kieHeaders(ADMIN!) });
    const j: any = await r.json().catch(() => ({}));
    const d = j?.data ?? {};
    if (d.state === "success") {
      let urls: string[] = [];
      try { urls = JSON.parse(d.resultJson ?? "{}").resultUrls ?? []; } catch { /* below */ }
      if (urls[0]) return { state: "done", url: urls[0] };
    }
    if (d.state === "fail" || (d.state === "success")) {
      const msg = String(d.failMsg ?? "no video");
      if (/public figure|celebrit/i.test(msg)) return { state: "failed", error: FAMOUS_MM };
      if (/safety|policy|flagged|blocked|sensitive/i.test(msg)) return { state: "failed", error: SAFETY_MM };
      // Kie's own trouble (timeout, internal error): make the same video on Eachlabs instead
      console.error("kie failed, falling back to eachlabs:", msg);
      const { imageUrl, refUrls } = await omniInputs(ADMIN!, g);
      const sub = await submitOmni(ADMIN!, g, String(g.prompt_en ?? "") + MYANMAR_LOOK, imageUrl, refUrls, true);
      await ADMIN!.from("generations").update({ provider: `eachlabs:${sub.model}`, provider_request_id: sub.id }).eq("id", g.id);
      return { state: "running" };
    }
    return { state: "running" };
  }
  if (String(g.provider ?? "").includes(GROUP_MODEL) || String(g.provider ?? "").includes("gemini-omni")) {
    const r = await fetch(`https://api.eachlabs.ai/v1/prediction/${g.provider_request_id}`, { headers: await eachlabs(ADMIN!) });
    const j: any = await r.json().catch(() => ({}));
    if ((j.status === "success" || j.status === "succeeded") && j.output) return { state: "done", url: Array.isArray(j.output) ? j.output[0] : j.output };
    if (j.status === "error" || j.status === "failed") {
      const msg = String(j.error ?? j.output?.error_message ?? (typeof j.output === "string" ? j.output : "") ?? "failed") || "failed";
      // Google's safety filter: tell the customer in Burmese what to change (the charge is refunded either way)
      if (/public figure|celebrit/i.test(msg)) return { state: "failed", error: FAMOUS_MM };
      if (/safety|declined|policy|blocked/i.test(msg)) {
        // a declined job costs nothing: rewrite the likely trigger and try again (twice at most) before giving up
        const tries = Number(g.post_data?.safe_tries ?? 0);
        if (g.episode_id && String(g.provider ?? "").includes("gemini-omni") && tries < SAFE_TRIES) { // series only; ✨ create as on the morning of 25 Nov (owner)
          try { if (await safeRetry(g, tries + 1)) return { state: "running" }; }
          catch (e) { console.error("safe rewrite failed:", e); }
        }
        return { state: "failed", error: SAFETY_MM };
      }
      return { state: "failed", error: msg.slice(0, 300) };
    }
    return { state: "running" };
  }
  const path = isR2v(g) ? "reference-to-video" : g.mode === "i2v" ? "image-to-video" : "text-to-video";
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

// NOT used since 18 Nov evening (made Wan stiff, owner's call): fixed quality base (exposure, lighting, camera, image quality).
// The scene's own [Lighting]/[Camera] say what this shot is; this base makes every shot well exposed, sharp and stable.
const QUALITY_BASE = "\nQuality (always): premium cinematic image as if shot on a professional cinema camera with prime lenses. Correct exposure: no blown-out highlights, no crushed blacks, rich detail in shadows. Faces are always well lit and clearly readable: soft key light at about 45 degrees, gentle fill on the shadow side, subtle rim light separating people from the background, catchlights in the eyes; even night and indoor scenes keep faces visible with motivated practical light. Natural, accurate Southeast Asian skin tones, neutral white balance, no colour cast. Pin-sharp focus on the speaking face, smooth shallow depth of field. Stable, smooth camera motion with no jitter, no shaking and no sudden zooms; natural 24 fps motion blur. Clean, high-detail image: no flicker, no warping, no morphing, no extra fingers or limbs, natural anatomy and hands, eyes and teeth rendered cleanly, faces and clothes stay identical from the first to the last frame.";

// a warm golden look from the owner's reference video; NOT added automatically (the owner showed it as a quality example only).
// Kept for a future "style" option the customer can pick.
const HOUSE_LOOK = "\nSignature look: warm golden cinematic palette, amber and honey tones, creamy highlights, rich deep-brown shadows, gentle film contrast, never flat or grey. Interiors: low-key, moody light from warm practical lamps and windows visible in the background (2800-3200K tungsten glow), soft flattering light on faces, darker room edges, subtle haze with tiny floating dust particles catching the light, steam rising from hot drinks where it fits. Exteriors: golden-hour backlight with a soft sun flare through trees, warm atmospheric haze, lush colourful plants and flowers in the foreground, deep layered depth. Camera language: eye level, rule-of-thirds framing; conversations as shot/reverse-shot over the shoulder with the near shoulder dark and softly out of focus; medium close-ups on 50mm and emotional close-ups on 85mm; wide 24-35mm establishing shots with leading lines and a slow push-in or tracking move; very shallow depth of field with creamy bokeh; layered foreground, midground and background.";

// always appended: keeps people, clothes and signs Burmese (video models otherwise drift to South Asian looks)
const MYANMAR_LOOK = "\nStyle: authentic Myanmar. All people are Burmese (Bamar) Southeast Asian people, dressed exactly as the script describes (Myanmar dress such as longyi, htamein, eingyi and thanaka only where it fits the character and the scene). No readable text anywhere: shop signs, banners and posters are small, far in the background or softly out of focus, shown as colours and shapes, never as close-up legible lettering. No English, Chinese, Thai, Hindi or Devanagari writing. No Indian clothing, no saris.";

// Wan reads Burmese text aloud: a name written before a line ("သီရိ says: ...") gets spoken and the voice lands early.
// So outside the quoted lines every character name becomes a fixed label tied to its photo: Image 1 -> Character A, Image 2 -> Character B...
// Labels never repeat, so two young women are never mixed up. Names inside quotes (someone calling "သီရိ") stay as spoken words.
function labelCast(prompt: string, refs: any[]): string {
  const names = (refs ?? []).map((r: any, i: number) => ({ name: String(r?.name ?? "").trim(), label: `Character ${String.fromCharCode(65 + i)}` }))
    .filter((x) => x.name).sort((a, b) => b.name.length - a.name.length);
  if (!names.length) return prompt;
  return String(prompt).split(/("[^"]*")/).map((part) => {
    if (part.startsWith('"')) return part;
    for (const x of names) part = part.split(x.name).join(x.label);
    return part;
  }).join("");
}
// use the approved plan (or plan now for old clients), then submit to Wan (runs in the background after "create" has answered)
async function startGeneration(admin: any, id: string) {
  const { data: g } = await admin.from("generations").select("*").eq("id", id).single();
  try {
    let plan: any = null;
    if (g.plan_id) plan = (await admin.from("plans").select("plan").eq("id", g.plan_id).single()).data?.plan;
    if (!plan) plan = await planVideo(g.prompt_mm, g.duration, refNames(g.refs));
    // Omni prompts already say "the young man in Image 1"; renaming would also change names inside the spoken Burmese lines
    const en = g.engine === "omni" ? plan.prompt : labelCast(plan.prompt, isR2v(g) ? g.refs : []);
    const { imageUrl, refUrls } = await omniInputs(admin, g);
    const omni = g.engine === "omni";
    const sub = await submitVideo(g, en + MYANMAR_LOOK, imageUrl, refUrls);
    await admin.from("generations").update({
      status: "running", prompt_en: en, provider_request_id: sub.id,
      provider: sub.model === "kie" ? `kie:${KIE_MODEL}` : omni || sub.model === GROUP_MODEL ? `eachlabs:${sub.model}` : `yotta:${sub.model}`,
      // Omni speaks the lines itself: nothing to dub (keep the lines only as a record)
      dialogue: omni ? null : plan.lines?.length || (g.sfx && plan.stingers?.length)
        ? { lines: plan.lines ?? [], ambience: plan.ambience ?? null, effects: plan.effects ?? [], stingers: g.sfx ? plan.stingers ?? [] : [], voices: plan.voices ?? null } : null,
    }).eq("id", id);
  } catch (e) {
    console.error("create failed:", e);
    await admin.rpc("finish_generation", { p_id: id, p_ok: false, p_error: String(e).slice(0, 500) });
  }
}

// advance one running generation: wait for Wan → dub Burmese voices → merge → save
async function step(admin: any, g: any) {
  if (g.status !== "running" || !g.provider_request_id) return;

    const age = Date.now() - new Date(g.created_at).getTime();
    const saveFrom = async (url: string) => {
      const vr = await fetch(url);
      if (!vr.ok) throw new Error(`download ${vr.status}`);
      const bytes = new Uint8Array(await vr.arrayBuffer());
      const path = `${g.user_id}/${g.id}.mp4`;
      const { error: ue } = await admin.storage.from("videos").upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (ue) throw ue;
      await admin.rpc("finish_generation", { p_id: g.id, p_ok: true, p_video_path: path });
    };
    try {
      if (!g.post_stage || g.post_stage === "dubbing") {
        // 1) wait for Wan; 2) dub Burmese voices over it
        const src = g.post_data?.src;
        const p = src ? { state: "done" as const, url: src } : await pollVideo(g);
        if (p.state === "done") {
          const lines = g.dialogue?.lines ?? [];
          if (!lines.length && !g.dialogue?.stingers?.length) {
            if (g.engine === "omni" && g.quality === "hd") {
              // HD: sharpen the finished 360p video to 720p (P-Video-Upscale, about $0.01 a second)
              if (await admin.rpc("claim_post_stage", { p_id: g.id, p_from: null, p_to: "upscaling" }).then((r: any) => r.data)) {
                try {
                  const sub = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabs(admin),
                    body: JSON.stringify({ model: UPSCALER, version: "0.0.1", input: { video: p.url, target: "720p", turbo: false, fps: 24 } }) });
                  const sj: any = await sub.json().catch(() => ({}));
                  const pid = sj.predictionID ?? sj.prediction_id ?? sj.id;
                  if (!sub.ok || !pid) throw new Error("upscale submit " + sub.status + " " + JSON.stringify(sj).slice(0, 200));
                  await admin.from("generations").update({ post_updated_at: new Date().toISOString(), post_data: { src: p.url, up_id: pid } }).eq("id", g.id);
                } catch (e) {
                  console.error("upscale failed to start, delivering 360p:", e);
                  await upscaleFailed(admin, g, p.url!, String(e));
                }
              }
            } else await saveFrom(p.url!);
          }
          else if (await admin.rpc("claim_post_stage", { p_id: g.id, p_from: null, p_to: "dubbing" }).then((r: any) => r.data)) {
            await admin.from("generations").update({ post_data: { src: p.url } }).eq("id", g.id);
            try {
              const wav = await buildDubAudio(admin, g, p.url!);
              const apath = `gen/${g.id}.wav`;
              const { error: ae } = await admin.storage.from("audio").upload(apath, wav, { contentType: "audio/wav", upsert: true });
              if (ae) throw ae;
              const { data: as } = await admin.storage.from("audio").createSignedUrl(apath, 3600);
              const sub = await fetch("https://api.eachlabs.ai/v1/prediction/", { method: "POST", headers: await eachlabs(admin),
                body: JSON.stringify({ model: "ffmpeg-api-merge-audio-video", version: "0.0.1", input: { video_url: p.url, audio_url: as!.signedUrl } }) });
              const sj: any = await sub.json().catch(() => ({}));
              const pid = sj.predictionID ?? sj.prediction_id ?? sj.id;
              if (!sub.ok || !pid) throw new Error("merge submit " + sub.status + " " + JSON.stringify(sj).slice(0, 200));
              await admin.from("generations").update({ post_stage: "merging", post_updated_at: new Date().toISOString(), post_data: { src: p.url, merge_id: pid } }).eq("id", g.id);
            } catch (e) {
              console.error("dubbing failed, delivering original:", e);
              await admin.from("generations").update({ post_data: { src: p.url, dub_error: String(e).slice(0, 300) } }).eq("id", g.id);
              await saveFrom(p.url!);
            }
          } else if (g.post_stage === "dubbing" && g.post_updated_at && Date.now() - new Date(g.post_updated_at).getTime() > 240000) {
            await saveFrom(p.url!); // dubbing got stuck: give the customer the original video
          }
        } else if (p.state === "failed" || age > JOB_TIMEOUT_MS) {
          await admin.rpc("finish_generation", { p_id: g.id, p_ok: false, p_error: p.error ?? "timeout" });
        }
      } else if (g.post_stage === "upscaling") {
        const r = await fetch(`https://api.eachlabs.ai/v1/prediction/${g.post_data?.up_id}`, { headers: await eachlabs(admin) });
        const j: any = await r.json().catch(() => ({}));
        const waited = g.post_updated_at ? Date.now() - new Date(g.post_updated_at).getTime() : 0;
        if ((j.status === "success" || j.status === "succeeded") && j.output) await saveFrom(Array.isArray(j.output) ? j.output[0] : j.output);
        else if (j.status === "error" || j.status === "failed" || waited > 10 * 60 * 1000) await upscaleFailed(admin, g, g.post_data.src, String(j.error ?? "timeout"));
      } else if (g.post_stage === "merging") {
        const r = await fetch(`https://api.eachlabs.ai/v1/prediction/${g.post_data?.merge_id}`, { headers: await eachlabs(admin) });
        const j: any = await r.json().catch(() => ({}));
        if ((j.status === "success" || j.status === "succeeded") && j.output) await saveFrom(Array.isArray(j.output) ? j.output[0] : j.output);
        else if (j.status === "error" || j.status === "failed" || age > JOB_TIMEOUT_MS) await saveFrom(g.post_data.src);
      }
    } catch (e) {
      console.error("status step failed:", e); // keep running; next poll retries
    }
  }

const UPSCALER = "p-video-upscale";
// the HD sharpening failed: the customer still gets the video (360p) and the HD part of the price back
async function upscaleFailed(admin: any, g: any, src: string, why: string) {
  console.error("upscale failed:", why);
  const { data: hd } = await admin.rpc("gen_cost", { p_quality: "hd", p_duration: g.duration });
  const { data: sd } = await admin.rpc("gen_cost", { p_quality: "std", p_duration: g.duration });
  const back = Number(hd ?? 0) - Number(sd ?? 0);
  if (back > 0) await admin.rpc("_add_credits", { p_user: g.user_id, p_delta: back, p_reason: "HD ပြောင်းမရလို့ HD ကွာခြားငွေ ပြန်အမ်း", p_ref: g.id });
  const vr = await fetch(src);
  if (!vr.ok) throw new Error(`download ${vr.status}`);
  const path = `${g.user_id}/${g.id}.mp4`;
  const { error: ue } = await admin.storage.from("videos").upload(path, new Uint8Array(await vr.arrayBuffer()), { contentType: "video/mp4", upsert: true });
  if (ue) throw ue;
  await admin.rpc("finish_generation", { p_id: g.id, p_ok: true, p_video_path: path });
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin0 = createClient(SUPABASE_URL, SERVICE_KEY);
  ADMIN = admin0;
  // background tick (pg_cron every minute): keeps jobs moving even when the customer closed the app
  const cronTok = req.headers.get("x-cron-token");
  if (cronTok) {
    const { data: want } = await admin0.rpc("get_app_secret", { p_name: "cron_token" });
    if (!want || cronTok !== want) return json({ error: "bad token" }, 401);
    await loadYottaKey(admin0);
    // the "project" function starts each scene of an episode here (same pipeline as a single video)
    const cb: any = await req.clone().json().catch(() => ({}));
    // voice preview: the script's lines through the exact same voice step as a real video (same voice choice, tags,
    // steadiness, loanwords, loudness, pitch), one WAV per line + the whole script in a row, for the owner to tune by ear
    if (cb.action === "voice_preview" && Array.isArray(cb.lines)) {
      const { data: key } = await admin0.rpc("get_app_secret", { p_name: "elevenlabs_api_key" });
      const name = String(cb.name ?? "preview").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "preview";
      const cast = new Map<string, string>(); const pitch = new Map<string, number>(); const out: any[] = []; const all: Float32Array[] = [];
      for (let i = 0; i < cb.lines.length && i < 12; i++) {
        const l = cb.lines[i]; const who = String(l.who ?? "man").toLowerCase();
        const fixed = cb.voices?.[String(l.who ?? "")];
        if (!cast.has(who) && fixed) { const [vid, pp] = String(fixed).split("@"); cast.set(who, vid); pitch.set(who, Number(pp) || 1); }
        if (!cast.has(who)) { const opts = voiceChoices(l, who); const taken = [...cast.values()]; const v = opts.find((o) => !taken.includes(o)) ?? opts[0];
          cast.set(who, v); pitch.set(who, PITCH_VARIANTS[Math.min(2, taken.filter((t) => t === v).length)]); }
        const pcm = pitchShift(await voiceLine(key, l, cast.get(who)!), pitch.get(who) ?? 1);
        const f = Float32Array.from(pcm); all.push(f, new Float32Array(Math.round(0.5 * SR)));
        const path = `lab/preview/${name}/${String(i + 1).padStart(2, "0")}.wav`;
        await admin0.storage.from("audio").upload(path, wavOf(f), { contentType: "audio/wav", upsert: true });
        const { data: su } = await admin0.storage.from("audio").createSignedUrl(path, 7 * 24 * 3600);
        const e = EMOTION[l.emotion ?? ""] ?? EMOTION.calm; const one = (String(l.delivery ?? "").match(/\[[^\]\[]{1,60}\]/) ?? [""])[0];
        out.push({ who: l.who, text: l.text, said: sayable(spokenNumbers(String(l.spoken || l.text))), voice: cast.get(who), pitch: pitch.get(who),
          emotion: l.emotion ?? "calm", tag: one || e.tag.trim(), stability: e.stability, seconds: +(pcm.length / SR).toFixed(2), url: su?.signedUrl });
      }
      const joined = new Float32Array(all.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of all) { joined.set(a, o); o += a.length; }
      const jp = `lab/preview/${name}/all.wav`;
      await admin0.storage.from("audio").upload(jp, wavOf(joined), { contentType: "audio/wav", upsert: true });
      const { data: ju } = await admin0.storage.from("audio").createSignedUrl(jp, 7 * 24 * 3600);
      return json({ lines: out, all: ju?.signedUrl });
    }
    if (cb.action === "start" && /^[0-9a-f-]{36}$/i.test(String(cb.id ?? ""))) {
      const work = startGeneration(admin0, cb.id);
      // @ts-ignore EdgeRuntime is provided by Supabase
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
      return json({ ok: true });
    }
    // jobs that never started (e.g. phone lost connection) → refund after 4 minutes
    const { data: stuck } = await admin0.from("generations").select("id").eq("status", "queued").lt("created_at", new Date(Date.now() - 240000).toISOString());
    for (const q of stuck ?? []) await admin0.rpc("finish_generation", { p_id: q.id, p_ok: false, p_error: "never started" });
    const { data: rows } = await admin0.from("generations").select("*").eq("status", "running").order("created_at").limit(6);
    for (const g of rows ?? []) { try { await step(admin0, g); } catch (e) { console.error("tick", g.id, e); } }
    return json({ ok: true, n: rows?.length ?? 0 });
  }

  const auth = req.headers.get("Authorization") ?? "";
  const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user } } = await userDb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return json({ error: "not signed in" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  await loadYottaKey(admin);

  // ---- plan: write and check the plan first (no credits used); the customer approves it before "create" ----
  if (body.action === "plan") {
    const prompt = String(body.prompt ?? "").trim().slice(0, 2000);
    const duration = Number(body.duration) === 5 ? 5 : 10;
    if (!prompt) return json({ error: "empty prompt" }, 400);
    const { count } = await admin.from("plans").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if ((count ?? 0) >= 20) return json({ error: "too many plans, please wait a little" }, 429);
    const refs = body.mode === "i2v" ? [] : cleanRefs(body.refs, user.id);
    if (refs === null) return json({ error: "ဇာတ်ကောင်ပုံ ၃ ပုံအထိ၊ ပုံတိုင်းမှာ မတူတဲ့ နာမည် ထည့်ပါ" }, 400);
    const { data: p, error } = await admin.from("plans").insert({ user_id: user.id, prompt_mm: prompt, duration, mode: body.mode === "i2v" ? "i2v" : "t2v", refs: refs.length ? refs : null,
      exact: body.exact === true && body.mode !== "i2v" }).select("id").single();
    if (error) return json({ error: error.message }, 400);
    const work = runPlan(admin, p.id);
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
    return json({ plan_id: p.id });
  }
  if (body.action === "plan_status") {
    const { data: p } = await userDb.from("plans").select("*").eq("id", body.plan_id).single();
    if (!p) return json({ error: "not found" }, 404);
    if (p.status === "planning" && Date.now() - new Date(p.created_at).getTime() > 200000) return json({ status: "failed", error: "timeout" });
    return json({ status: p.status, error: p.error, summary_mm: p.plan?.summary_mm ?? null, issues: p.issues ?? [], warnings_mm: p.plan?.warnings_mm ?? [], blocked: p.plan?.blocked === true,
      lines: (p.plan?.lines ?? []).map((l: any) => ({ who: l.who, gender: l.gender, text: l.text })),
      exact: p.exact === true, prompt_en: p.exact === true ? (p.plan?.prompt ?? null) : undefined });
  }

  // ---- create ----
  if (body.action === "create") {
    if (!YOTTA_KEY) return json({ error: "AI service is not configured yet" }, 503);
    let planId: string | null = null, planRefs: any = null, engine: string | null = null;
    if (body.plan_id) {
      const { data: p } = await admin.from("plans").select("id,user_id,status,prompt_mm,duration,refs,plan").eq("id", body.plan_id).single();
      if (!p || p.user_id !== user.id || p.status !== "ready") return json({ error: "plan not ready" }, 400);
      if (p.prompt_mm !== String(body.prompt ?? "").trim().slice(0, 2000) || p.duration !== Number(body.duration)) return json({ error: "plan does not match" }, 400);
      if (!sameRefs(p.refs ?? [], cleanRefs(body.refs, user.id) ?? [])) return json({ error: "plan does not match" }, 400);
      if (p.plan?.blocked || !p.plan?.prompt) return json({ error: "ဒီဇာတ်လမ်းကို ဗီဒီယို လုပ်လို့ မရပါ။ ပြင်ရေးပြီး ပြန်စီစဉ်ပါ" }, 400);
      planId = p.id; planRefs = p.refs ?? null; engine = p.plan?.engine === "omni" ? "omni" : null;
    }
    const { data: id, error } = await userDb.rpc("create_generation", {
      p_mode: body.mode, p_prompt: String(body.prompt ?? "").slice(0, 2000),
      p_quality: body.quality, p_duration: Number(body.duration), p_ratio: body.ratio,
      p_image_path: body.image_path ?? null,
    });
    if (error) return json({ error: error.message }, 400);
    // template videos count toward "Hot"
    let tplId: string | null = null;
    if (body.template_id && /^[0-9a-f-]{36}$/i.test(String(body.template_id))) {
      const { data: t } = await admin.from("templates").select("id").eq("id", body.template_id).eq("active", true).maybeSingle();
      tplId = t?.id ?? null;
    }
    await admin.from("generations").update({ plan_id: planId, sfx: body.sfx === true, refs: body.mode === "i2v" ? null : planRefs, template_id: tplId, engine }).eq("id", id);

    // submit in the background (old clients without a plan_id: plan first, ~1 minute)
    const work = startGeneration(admin, id);
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
    return json({ id });
  }

  // ---- status ----
  if (body.action === "status") {
    // RLS: the user can only read their own rows
    const { data: g } = await userDb.from("generations").select("*").eq("id", body.id).single();
    if (!g) return json({ error: "not found" }, 404);

    if (g.status === "queued" && Date.now() - new Date(g.created_at).getTime() > 3 * 60 * 1000) {
      await admin.rpc("finish_generation", { p_id: g.id, p_ok: false, p_error: "never started" });
    }
    await step(admin, g);

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
