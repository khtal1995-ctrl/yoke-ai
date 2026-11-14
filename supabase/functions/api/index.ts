// Yoke AI — video generation API (Supabase Edge Function)
// Actions (POST JSON, user JWT required):
//   { action: "create", mode, prompt, quality, duration, ratio, image_path? } -> { id }
//   { action: "status", id } -> { generation, video_url? }
//
// Secrets (Supabase → Edge Functions → Secrets):
//   YOTTA_API_KEY   required — Yotta Labs AI Gateway key
//   LLM_MODEL       optional — chat model on Yotta Gateway used to plan prompts + Burmese lines
// Vault secrets: yotta_api_key, elevenlabs_api_key (TTS, SFX, speech timing), eachlabs_api_key (audio/video merge)
// Dialogue videos: Wan 3.0 makes picture + lip movement; its speech is replaced by native Burmese voices
// placed on Wan's own speaking times, mixed with background sound, then merged (stages: dubbing → merging).
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

const RESOLUTION: Record<string, string> = { std: "480p", hd: "720p" };

// ---------- prompt rewrite (Burmese -> English scene + Burmese dialogue lines) ----------
const SYSTEM_PROMPT = `You turn a Burmese (Myanmar) video request into a plan for the Wan 3.0 video model, which generates video with native audio and lip-synced speech.
Return ONLY one JSON object, no markdown:
{"prompt": "<English prompt for Wan>", "lines": [{"who": "<short English label of the speaker, e.g. young man>", "gender": "male|female", "age": "child|young|middle|old", "emotion": "calm|polite|warm|happy|excited|shouting|angry|sad|scared|whisper", "text": "<the exact Burmese line>"}], "ambience": "<English description of the continuous background sound only: no speech, no music>", "effects": [{"text": "<one short English sound effect, e.g. burst of rifle gunfire>", "at": <second it starts>, "dur": <seconds, 0.5-4>}]}
Rules for "prompt":
- Describe the scene, people (Burmese, with age and gender), setting (Myanmar), camera and lighting in clear English. Choose camera distance to suit the story.
- Every spoken line must appear in Burmese script, in quotes, as: <who> says naturally in native Burmese (Myanmar language) with a Yangon accent: "<text>". Use exactly the same text as in "lines", in the same order.
- Write Burmese the way people actually speak, as one flowing phrase: NEVER put spaces between Burmese words. Use only ၊ or ။ where a speaker naturally pauses for breath.
- If the user wrote dialogue in quotes, use those words EXACTLY (same words, same spelling, same order); never correct, translate, shorten or paraphrase them. Only remove spaces between Burmese words.
- If the user did not quote dialogue, write short, polite, natural lines for the situation in common everyday colloquial Burmese spelling (for example ခနလေး, တခွက်, တပွဲ), matching real Myanmar customs.
- If the user asks for no speech or a silent video, never invent speech.
- Dialogue length must fit the video: at most about 8 Burmese words per 5 seconds in total. Speakers finish talking at least 1 second before the video ends, then stay silent and react.
- Only one person speaks at a time. Say who speaks first and who answers; keep the speaker's face visible while they talk.
- Describe physical actions in a clear order with direction. Objects that appear must stay consistent and never vanish.
- Mention fitting background sounds. If no dialogue was asked for, add none and return "lines": [].
Rules for "emotion": choose how each line must sound from the story (a battle cry is "shouting", a cheerful greeting is "happy", ordering food is "polite"). Never make a calm line dramatic.
Rules for "effects": list the important story sounds (gunshots, explosion, door slam, car horn, glass breaking...) with the second they happen, at most 6. In "prompt", make those actions happen at those same seconds.`

// remove spaces between Burmese characters (spaces make speech and mouth movement choppy)
const MM = "\\u1000-\\u109F\\uAA60-\\uAA7F";
const mmJoin = (s: string) => String(s ?? "").replace(new RegExp(`([${MM}])[ \\u00A0\\u200B]+(?=[${MM}])`, "g"), "$1");

// Burmese lines the customer wrote inside quotes
const userQuotedLines = (mm: string) =>
  [...String(mm).matchAll(/["“‘「]([^"”’」\n]{1,180})["”’」]/gu)].map((x) => mmJoin(x[1].trim())).filter((x) => new RegExp(`[${MM}]`).test(x));
const silentRequested = (mm: string) => /(?:စကားမပြော|စကားမပါ|အသံမပါ|တိတ်ဆိတ်|no dialogue|no speech|silent video)/iu.test(mm);

type Plan = { prompt: string; lines: { who?: string; gender?: string; age?: string; emotion?: string; text: string }[]; ambience?: string; effects?: { text: string; at: number; dur: number }[] };

async function planVideo(mm: string, duration = 10): Promise<Plan> {
  const fallback: Plan = { prompt: fallbackPrompt(mm), lines: [] };
  if (!LLM_MODEL) return fallback;
  try {
    const r = await fetch(`${YOTTA}/api/maas/chat/completions`, {
      method: "POST",
      headers: { "X-API-KEY": YOTTA_KEY, "Authorization": `Bearer ${YOTTA_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL, temperature: 0.4, max_tokens: 2000,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Video length: ${duration} seconds.\n\nRequest:\n${mm}` }],
      }),
    });
    if (!r.ok) throw new Error(`llm ${r.status}`);
    const j = await r.json();
    let text: string = j?.choices?.[0]?.message?.content?.trim() ?? "";
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    const p = JSON.parse(text.slice(a, b + 1));
    const lines = (Array.isArray(p.lines) ? p.lines : []).filter((l: any) => l && String(l.text ?? "").trim())
      .map((l: any) => ({ who: l.who, gender: String(l.gender ?? "").toLowerCase(), age: String(l.age ?? "").toLowerCase(), emotion: String(l.emotion ?? "").toLowerCase(), text: mmJoin(String(l.text).trim()) }));
    const effects = (Array.isArray(p.effects) ? p.effects : []).filter((e: any) => e && e.text && isFinite(Number(e.at))).slice(0, 6)
      .map((e: any) => ({ text: String(e.text).slice(0, 120), at: Math.max(0, Math.min(Number(e.at), duration - 0.5)), dur: Math.max(0.5, Math.min(Number(e.dur) || 1.5, 4)) }));
    let prompt = mmJoin(String(p.prompt ?? "").trim());
    if (!prompt) return fallback;
    // the customer's own quoted Burmese lines always win, word for word (only inner spaces removed)
    const quoted = userQuotedLines(mm);
    if (quoted.length && quoted.length === lines.length) {
      quoted.forEach((q, i) => { if (!prompt.includes(q)) prompt = prompt.replace(lines[i].text, q); lines[i].text = q; });
      const missing = quoted.filter((q) => !prompt.includes(q));
      if (missing.length) prompt += "\nExact Burmese dialogue, in this order: " + quoted.map((q, i) => `Line ${i + 1}: "${q}"`).join("; ");
    }
    if (silentRequested(mm)) lines.length = 0;
    return { prompt, lines, ambience: p.ambience ? String(p.ambience) : undefined, effects };
  } catch (e) {
    console.error("planVideo failed:", e);
    return fallback;
  }
}
const fallbackPrompt = (mm: string) =>
  `A realistic scene set in Myanmar. ${mmJoin(mm)}. Any speech is spoken in Burmese. Natural light, cinematic.`;

// ---------- Burmese dubbing: keep Wan's picture + mouth timing, replace its speech with native Burmese voices ----------
const SR = 24000;
const VOICES: Record<string, string> = {
  male: "eZUdq4hHF9YhlUfu5DFe",   // Yan — native Burmese young male
  female: "NBISYoQ4SVxq8eZxoHlV", // Su — native Burmese young female
};
const voiceFor = (l: any) => VOICES[l.gender === "female" ? "female" : "male"];
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
// how each line should sound: an ElevenLabs audio tag + how expressive the voice may be
const EMOTION: Record<string, { tag: string; stability: number }> = {
  calm: { tag: "", stability: 0.6 }, polite: { tag: "[politely] ", stability: 0.65 }, warm: { tag: "[warmly] ", stability: 0.55 },
  happy: { tag: "[happily] ", stability: 0.45 }, excited: { tag: "[excited] ", stability: 0.4 }, shouting: { tag: "[shouting] ", stability: 0.35 },
  angry: { tag: "[angry] ", stability: 0.4 }, sad: { tag: "[sad] ", stability: 0.5 }, scared: { tag: "[scared] ", stability: 0.4 },
  whisper: { tag: "[whispers] ", stability: 0.55 },
};
async function tts(key: string, voice: string, text: string, emotion?: string): Promise<Int16Array> {
  const e = EMOTION[emotion ?? ""] ?? EMOTION.calm;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_24000`, {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: e.tag + text, model_id: "eleven_v4", voice_settings: { stability: e.stability, similarity_boost: 0.8, speed: 1.05 } }),
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
// when does each speaker talk in Wan's own audio? (ElevenLabs Scribe, word timings + speakers)
async function speechTurns(key: string, url: string, speakers: number): Promise<{ start: number; end: number; spk: string }[]> {
  const fd = new FormData(); fd.append("model_id", "scribe_v1"); fd.append("cloud_storage_url", url);
  fd.append("diarize", "true"); fd.append("timestamps_granularity", "word"); fd.append("tag_audio_events", "false");
  if (speakers > 0) fd.append("num_speakers", String(Math.min(speakers, 8)));
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: fd });
  if (!r.ok) throw new Error("stt " + r.status + " " + (await r.text()).slice(0, 200));
  const j: any = await r.json();
  const segs: { start: number; end: number; spk: string }[] = [];
  for (const w of (j.words ?? []).filter((w: any) => w.type === "word")) {
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
// make every voice equally loud (speech RMS), with a small boost for shouting and a cut for whispering
const LOUD: Record<string, number> = { shouting: 1.35, angry: 1.15, excited: 1.1, whisper: 0.6 };
function levelVoice(x: Int16Array, emotion?: string): Int16Array {
  let peak = 1; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const gate = peak * 0.1; let sum = 0, cnt = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > gate) { sum += v * v; cnt++; } }
  const rms = Math.sqrt(sum / Math.max(1, cnt)); const target = 5200 * (LOUD[emotion ?? ""] ?? 1);
  const g = Math.min(4, target / Math.max(1, rms)); const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) { const v = x[i] * g; out[i] = Math.max(-32000, Math.min(32000, v > 24000 ? 24000 + (v - 24000) * 0.3 : v < -24000 ? -24000 + (v + 24000) * 0.3 : v)); }
  return out;
}
async function buildDubAudio(admin: any, g: any, srcUrl: string): Promise<Uint8Array> {
  const { data: key } = await admin.rpc("get_app_secret", { p_name: "elevenlabs_api_key" });
  const lines: any[] = g.dialogue?.lines ?? [];
  const total = Number(g.duration) || 10; const n = Math.round(total * SR);
  const [turnsRaw, pcms, bed, wan] = await Promise.all([
    speechTurns(key, srcUrl, new Set(lines.map((l) => l.who ?? l.gender)).size).catch((e) => { console.error(e); return []; }),
    Promise.all(lines.map((l) => tts(key, voiceFor(l), l.text, l.emotion).then(trim).then((x) => levelVoice(x, l.emotion)))),
    g.dialogue?.ambience ? sfxGen(key, g.dialogue.ambience, total) : Promise.resolve(null),
    wanSoundtrack(admin, srcUrl),
  ]);
  // only when Wan's own soundtrack is unavailable do we add guessed, timed effects
  const fx = wan ? [] : await Promise.all(((g.dialogue?.effects ?? []) as any[]).map((e) => sfxGen(key, e.text, e.dur).then((pcm) => ({ ...e, pcm })).catch(() => null)));
  const turns = turnsRaw.length ? fitTurns(turnsRaw, lines.length) : [];
  const speech = new Float32Array(n); const placed: { start: number; end: number }[] = [];
  let cursor = 0.5;
  pcms.forEach((pcm, i) => {
    let out: Int16Array | Float32Array = pcm; let start: number;
    if (turns[i]) {
      const win = turns[i].end - turns[i].start + 0.15;
      const ratio = Math.min(1, Math.max(0.72, (win * SR) / pcm.length));
      if (ratio < 0.995) out = stretch(pcm, ratio);
      start = Math.max(0, turns[i].start - 0.05);
    } else { start = cursor; }
    const s0 = Math.round(start * SR); for (let k = 0; k < out.length && s0 + k < n; k++) speech[s0 + k] += out[k];
    const end = start + out.length / SR; placed.push({ start, end }); cursor = end + 0.3;
  });
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
    return wavOf(mix);
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
  return wavOf(mix);
}
async function eachlabs(admin: any) {
  const { data: k } = await admin.rpc("get_app_secret", { p_name: "eachlabs_api_key" });
  return { "Content-Type": "application/json", Authorization: `Bearer ${k}`, "X-API-Key": k };
}

// ---------- Yotta Gateway: Wan 3.0 (native audio), PixVerse V6 fallback for i2v ----------
async function submitVideo(g: any, prompt: string, imageUrl?: string): Promise<{ id: string; model: string }> {
  const isI2v = g.mode === "i2v";
  const path = isI2v ? "image-to-video" : "text-to-video";
  const tryModel = async (model: string, extra: Record<string, unknown>) => {
    const parameters: Record<string, unknown> = {
      prompt, resolution: RESOLUTION[g.quality] ?? "480p", duration: g.duration, generate_audio: true, ...extra,
    };
    if (isI2v) parameters.first_frame = imageUrl; else parameters.aspect_ratio = g.ratio;
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
  try {
    return await tryModel(isI2v ? "wan3.0-i2v" : "wan3.0-t2v", { enhance_prompt: false });
  } catch (e) {
    console.error("wan submit failed, falling back to pixverse:", e);
    const res = g.quality === "hd" ? "720p" : "540p";
    return await tryModel(isI2v ? "pixverse-v6-i2v" : "pixverse-v6-t2v", { resolution: res });
  }
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

// plan the scene with Grok, then submit to Wan (runs in the background after "create" has answered)
async function startGeneration(admin: any, id: string) {
  const { data: g } = await admin.from("generations").select("*").eq("id", id).single();
  try {
    const plan = await planVideo(g.prompt_mm, g.duration);
    const en = plan.prompt;
    let imageUrl: string | undefined;
    if (g.mode === "i2v") {
      const { data: s, error: se } = await admin.storage.from("inputs").createSignedUrl(g.image_path, 3600);
      if (se || !s) throw new Error("image not found");
      imageUrl = s.signedUrl;
    }
    const sub = await submitVideo(g, en, imageUrl);
    await admin.from("generations").update({
      status: "running", prompt_en: en, provider_request_id: sub.id, provider: `yotta:${sub.model}`,
      dialogue: plan.lines.length ? { lines: plan.lines, ambience: plan.ambience ?? null, effects: plan.effects ?? [] } : null,
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
          if (!lines.length) await saveFrom(p.url!);
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

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin0 = createClient(SUPABASE_URL, SERVICE_KEY);
  // background tick (pg_cron every minute): keeps jobs moving even when the customer closed the app
  const cronTok = req.headers.get("x-cron-token");
  if (cronTok) {
    const { data: want } = await admin0.rpc("get_app_secret", { p_name: "cron_token" });
    if (!want || cronTok !== want) return json({ error: "bad token" }, 401);
    await loadYottaKey(admin0);
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

  // ---- create ----
  if (body.action === "create") {
    if (!YOTTA_KEY) return json({ error: "AI service is not configured yet" }, 503);
    const { data: id, error } = await userDb.rpc("create_generation", {
      p_mode: body.mode, p_prompt: String(body.prompt ?? "").slice(0, 2000),
      p_quality: body.quality, p_duration: Number(body.duration), p_ratio: body.ratio,
      p_image_path: body.image_path ?? null,
    });
    if (error) return json({ error: error.message }, 400);

    // plan + submit can take ~1 minute (Grok): answer the phone right away and keep working in the background
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
