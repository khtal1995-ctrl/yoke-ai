// planner: Burmese story -> checked plan for Wan (prompt, Burmese lines with acting, timeline, Burmese summary)
// POST {story, duration, effort?}  auth: Bearer service-role key (from api) or x-lab-token (testing)
// returns {plan, issues, ms, passes}
const YOTTA = "https://gateway.yottalabs.ai";
const LAB = "vl_7f3k29xq81mz";
const SYSTEM_PROMPT = `You turn a Burmese (Myanmar) video request into a plan for the Wan 3.0 video model, which generates video with native audio and lip-synced speech.
Return ONLY one JSON object, no markdown:
{"prompt": "<English prompt for Wan>", "lines": [{"who": "<short English label of the speaker, e.g. young man>", "gender": "male|female", "age": "child|young|middle|old", "emotion": "calm|polite|warm|happy|excited|shouting|angry|sad|scared|whisper", "text": "<the exact Burmese line>", "at": <second this line starts>, "gesture": "<the acting while saying it, in English>"}], "speech_start": <second the first line starts>, "summary_mm": "<the plan for the customer in simple Burmese: one short line per moment with its seconds, e.g. ၀-၂ စက္ကန့် — ...; who says what with which gesture>", "ambience": "<English description of the continuous background sound only: no speech, no music>", "stingers": [{"after": <index of the line it follows (0 = first line), or -1 if there are no lines>, "at": <second it plays, used only when there are no lines>, "sound": "<short English description for a sound-effect generator>"}], "effects": [{"text": "<one short English sound effect, e.g. burst of rifle gunfire>", "at": <second it starts>, "dur": <seconds, 0.5-4>}]}
Rules for "prompt":
- Describe the scene, people (Burmese, with age and gender), setting (Myanmar), camera and lighting in clear English. Choose camera distance to suit the story.
- People look like Burmese (Bamar) people of Myanmar, Southeast Asian features, and wear clothes Myanmar people really wear for the scene (longyi, htamein, eingyi blouse, thanaka; or ordinary modern T-shirts, jeans, uniforms). Never Indian clothing (no sari, kurta, turban, bindi).
- Any written text, shop signs, bus signs or banners are in Burmese (Myanmar) script, never Hindi/Devanagari, Bengali or Tamil script. Buildings, vehicles and streets look like Myanmar.
- Every spoken line must appear in Burmese script, in quotes, as: <who> says naturally in native Burmese (Myanmar language) with a Yangon accent: "<text>". Use exactly the same text as in "lines", in the same order.
- Write Burmese the way people actually speak, as one flowing phrase: NEVER put spaces between Burmese words. Use only ၊ or ။ where a speaker naturally pauses for breath.
- If the user wrote dialogue in quotes, use those words EXACTLY (same words, same spelling, same order); never correct, translate, shorten or paraphrase them. Only remove spaces between Burmese words.
- If the user did not quote dialogue, write short, polite, natural lines for the situation in common everyday colloquial Burmese spelling (for example ခနလေး, တခွက်, တပွဲ), matching real Myanmar customs.
- If the user asks for no speech or a silent video, never invent speech.
- Lines you write yourself must follow the story's logic and each character's side: friends and partners back each other up (a girlfriend supports her own boyfriend), rivals tease each other, and nobody contradicts their own side unless the story says so.
- Dialogue length must fit the video: at most about 6 Burmese words per 5 seconds in total, spoken at a relaxed natural pace, never rushed. Speakers finish talking at least 1 second before the video ends, then stay silent and react.
- Only one person speaks at a time. Say who speaks first and who answers; keep the speaker's face visible while they talk.
- People who talk to each other stand or sit facing each other and look at the person they are speaking to, never into the camera (unless the user says they talk to the viewer). Film conversations from the side as a two-shot or over the shoulder, so both faces are seen in profile or three-quarter view. Say who looks at whom.
- Write every number in a spoken line as Burmese words, never digits (for example ဆယ်နှစ်, not ၁၀နှစ်).
- Every spoken line comes with acting that fits its meaning and emotion: a clear hand gesture, facial expression and body language, e.g. holding up both hands with ten fingers while saying "ten years", a teasing pat on the other's shoulder, a proud smirk, crossed arms, a shy smile, a hand on the heart. Describe the gesture in the same sentence as the line, and make listeners react visibly (laugh, roll their eyes, nod, look away).
- Plan the timeline in seconds. Dialogue and acting are the heart of the video: the first line starts by second 3 at the latest (by second 1 in a 5-second video). Any action before the talking takes at most 3 seconds; if the story has a long action before the talking (a race, a journey), show only its end (e.g. the cars screeching to a stop) and keep the rest for the conversation. Never drop an action the customer asked for (getting out of a car, walking out of a house...): show it, quickly if time is short, and describe it explicitly (e.g. the driver's door opens and he steps out of the car). If the customer asks for talking only, start with the people already in place.
- Describe physical actions in a clear order with direction. Objects that appear must stay consistent and never vanish.
- Mention fitting background sounds. If no dialogue was asked for, add none and return "lines": [].
Rules for "emotion": choose how each line must sound from the story (a battle cry is "shouting", a cheerful greeting is "happy", ordering food is "polite"). Never make a calm line dramatic.
Rules for "stingers": one short reaction sound effect, like in TikTok and Myanmar comedy/drama clips, placed ONLY right after the punchline: the single line where the joke lands, the brag or burn hits, the twist is revealed, or the emotional peak breaks. Usually exactly one per video (two only if the story clearly has two separate punchlines); none if there is no clear punchline. Never after set-up lines, greetings, questions, small talk or replies that just lead up to the punchline. The sound must fit the feeling of THAT punchline: heartbreak -> "soft sad violin sting"; sad defeat -> "sad descending trombone wah wah wah"; shocking reveal -> "dramatic shock sting with deep boom"; joke or awkward moment -> "cartoon boing" or "crickets chirping awkward silence"; brag, burn or roast -> "cool whoosh with bass drop" or "comedic record scratch"; tension -> "two tense heartbeat thumps"; romance or cute -> "magical sparkle chime"; good news or success -> "bright success chime ding".
Rules for "effects": list the important story sounds (gunshots, explosion, door slam, car horn, glass breaking...) with the second they happen, at most 6. In "prompt", make those actions happen at those same seconds.`;

const MM = "\\u1000-\\u109F\\uAA60-\\uAA7F";
const mmJoin = (s: string) => String(s ?? "").replace(new RegExp(`([${MM}])[ \\u00A0\\u200B]+(?=[${MM}])`, "g"), "$1");
const userQuotedLines = (mm: string) =>
  [...String(mm).matchAll(/["“‘「]([^"”’」\n]{1,180})["”’」]/gu)].map((x) => mmJoin(x[1].trim())).filter((x) => new RegExp(`[${MM}]`).test(x));
const silentRequested = (mm: string) => /(?:စကားမပြော|စကားမပါ|အသံမပါ|တိတ်ဆိတ်|no dialogue|no speech|silent video)/iu.test(mm);
const toViewerRequested = (mm: string) => /(?:ကြည့်သူ|ပရိသတ်|camera|ကင်မရာ)/iu.test(mm);

async function llm(key: string, messages: any[], effort: string) {
  const body: any = { model: "grok-4.7", temperature: 0.4, max_tokens: 3000, messages };
  if (effort) body.reasoning_effort = effort;
  const r = await fetch(`${YOTTA}/api/maas/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(110000),
    headers: { "X-API-KEY": key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`llm ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return String(j?.choices?.[0]?.message?.content ?? "").trim();
}
function parse(text: string) {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}
// clean the model's JSON; the customer's quoted words always win
function normalize(p: any, story: string, duration: number) {
  const lines = (Array.isArray(p.lines) ? p.lines : []).filter((l: any) => l && String(l.text ?? "").trim()).map((l: any) => ({
    who: l.who, gender: String(l.gender ?? "").toLowerCase(), age: String(l.age ?? "").toLowerCase(), emotion: String(l.emotion ?? "").toLowerCase(),
    text: mmJoin(String(l.text).trim()), at: Number(l.at), gesture: String(l.gesture ?? "").trim(),
  }));
  let prompt = mmJoin(String(p.prompt ?? "").trim());
  const quoted = userQuotedLines(story);
  if (quoted.length && quoted.length <= lines.length) {
    // match each quoted line to the planned line it most resembles, keep the customer's exact words
    for (const q of quoted) {
      let bi = -1, bs = 0;
      lines.forEach((l: any, i: number) => { const s = similar(l.text, q); if (s > bs) { bs = s; bi = i; } });
      if (bi >= 0 && bs > 0.4 && lines[bi].text !== q) { prompt = prompt.split(lines[bi].text).join(q); lines[bi].text = q; }
    }
  }
  if (silentRequested(story)) lines.length = 0;
  // digits make the video model mouth something odd: say numbers as Burmese words, in the lines and in the prompt
  for (const l of lines) { const w = spokenNumbers(l.text); if (w !== l.text) { prompt = prompt.split(l.text).join(w); l.text = w; } }
  const effects = (Array.isArray(p.effects) ? p.effects : []).filter((e: any) => e && e.text && isFinite(Number(e.at))).slice(0, 6)
    .map((e: any) => ({ text: String(e.text).slice(0, 120), at: Math.max(0, Math.min(Number(e.at), duration - 0.5)), dur: Math.max(0.5, Math.min(Number(e.dur) || 1.5, 4)) }));
  return { prompt, lines, effects, stingers: (Array.isArray(p.stingers) ? p.stingers : []).filter((x: any) => x && x.sound).slice(0, 2)
    .map((x: any) => ({ after: Number.isInteger(Number(x.after)) ? Number(x.after) : -1, at: Math.max(0, Math.min(Number(x.at) || 0, duration - 1)), sound: String(x.sound).slice(0, 120) })), ambience: p.ambience ? String(p.ambience) : null, speech_start: Number(p.speech_start), summary_mm: String(p.summary_mm ?? "").trim() };
}
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
const mmLetters = (t: string) => [...String(t).replace(/[^က-႟]/g, "")];
function similar(a: string, b: string) {
  const x = mmLetters(a), y = mmLetters(b); if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) { const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur; }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}
// spoken syllables (a Burmese syllable starts at a consonant/vowel letter that is not killed by asat or stacked)
const syllables = (t: string) => (t.match(/[က-အဣ-ဪဿ၌-၏](?![္်])/g) || []).length + (t.match(/[0-9၀-၉]/g) || []).length;
const SYL_PER_SEC = 5; // measured: Su speaks about 5 Burmese syllables per second

// problems we can detect before spending money on the video
function lint(plan: any, story: string, duration: number): string[] {
  const issues: string[] = [];
  const n = plan.lines.length;
  if (!plan.prompt) issues.push("The prompt is empty.");
  if (n) {
    const latest = duration <= 5 || n >= 3 ? 2 : 3.5;
    if (!isFinite(plan.speech_start)) issues.push(`Give "speech_start" (the second the first line starts).`);
    else if (plan.speech_start > latest) issues.push(`The first line starts at second ${plan.speech_start}; it must start by second ${latest}. Shorten or cut the action before the talking (show only its end).`);
    const start = isFinite(plan.speech_start) ? plan.speech_start : 1;
    const need = plan.lines.reduce((s: number, l: any) => s + syllables(l.text), 0) / SYL_PER_SEC + 0.4 * (n - 1);
    const room = duration - start - 1;
    if (need > room + 0.3) issues.push(`The dialogue needs about ${need.toFixed(1)} seconds but only ${room.toFixed(1)} seconds are left after second ${start}. Start talking earlier${userQuotedLines(story).length ? "" : " or use fewer/shorter lines"}.`);
    plan.lines.forEach((l: any, i: number) => {
      if (!l.gesture || l.gesture.length < 8) issues.push(`Line ${i + 1} has no acting: give a clear gesture, facial expression and body language that fit "${l.text}", and describe it in the prompt.`);
      if (!plan.prompt.includes(l.text)) issues.push(`Line ${i + 1} ("${l.text}") must appear in the prompt exactly, in quotes.`);
      if (/[0-9၀-၉]/.test(l.text) && !userQuotedLines(story).includes(l.text)) issues.push(`Line ${i + 1} contains digits; write the number as Burmese words.`);
    });
    // "toward the camera" counts, "never at the camera" does not
    const camera = [...plan.prompt.matchAll(/\b(toward|towards|into|at|facing|face|faces|to)\s+(the\s+)?(camera|lens|viewer|audience)\b/gi)]
      .some((m) => !/\b(never|not|no|without|away from|n't)\b[^.;]{0,25}$/i.test(plan.prompt.slice(Math.max(0, m.index! - 40), m.index)));
    if (!toViewerRequested(story) && camera)
      issues.push("Someone faces or speaks toward the camera. People who talk to each other must face each other and look at the person they speak to; film them from the side (two-shot or over the shoulder). Remove every 'toward/at/into the camera'.");
    if (new Set(plan.lines.map((l: any) => l.who)).size >= 2 && !/\b(each other|facing (him|her|them|the other)|turns? to|looks? at (him|her|the other|his friend|her friend|his|her))/i.test(plan.prompt))
      issues.push("Say clearly that the speakers face each other and who looks at whom while talking.");
  }
  if (!plan.summary_mm) issues.push(`Give "summary_mm": the plan in simple Burmese for the customer.`);
  return issues;
}

Deno.serve(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  if (req.headers.get("x-lab-token") !== LAB && auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) return new Response("no", { status: 401 });
  const { story, duration = 10, effort = "low" } = await req.json();
  const t0 = Date.now();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/get_app_secret`, { method: "POST",
    headers: { apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_name: "yotta_api_key" }) });
  const key = await r.json();
  try {
    const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Video length: ${duration} seconds.\n\nRequest:\n${story}` }];
    let raw = await llm(key, messages, effort);
    let plan = normalize(parse(raw), story, duration);
    let issues = lint(plan, story, duration), passes = 1;
    if (issues.length && Date.now() - t0 < 60000) {
      // one repair pass with the exact problems
      messages.push({ role: "assistant", content: raw }, { role: "user", content: "This plan has problems. Fix all of them and return the full corrected JSON only. Keep the customer's quoted words exactly.\n- " + issues.join("\n- ") });
      raw = await llm(key, messages, effort);
      plan = normalize(parse(raw), story, duration); issues = lint(plan, story, duration); passes = 2;
    }
    return Response.json({ plan, issues, passes, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 300), ms: Date.now() - t0 }, { status: 500 });
  }
});
