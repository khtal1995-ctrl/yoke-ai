# OWNER RULES — read first, follow always
1. Reply in Burmese only. Short messages.
2. Before ANY paid action (Eachlabs, Yotta, ElevenLabs, even 1 Ks) show the price in Kyat ($1 ≈ 4,500 Ks) and wait for the owner's OK.
3. NEVER write video prompts, scene scripts or test stories yourself. Prompts/scripts come only from the app's own AI (planner / series director), exactly as a customer would get them. Test stories: use the owner's own text word for word (e.g. the Kaung Khant story below) or ask the owner for one. Do not invent a story and do not edit the planner's output by hand.
4. Never ask the owner to test in the app, log in, or give a JWT/password — see "HOW CLAUDE TESTS WITHOUT THE OWNER" at the bottom.
5. Verify (transcript, cost, status) before saying something worked. Commit to `main`, deploy pinned-commit shims.
6. Only faces the owner owns/has consent for; no celebrities, no copyrighted characters.

Owner's test story (Kaung Khant, rich heir) — use as is for series tests:
စံအိမ်ကြီးရဲ့ အပေါ်ကနေ Drone Camera ဖြတ်သွားမယ်။ Supercar တွေ၊ Private Jet တွေ၊ Helicopter တွေ၊ ကိုယ်ပိုင်ရေကန်တွေကို ပြမယ်။ အဲဒီနောက် ကောင်လေးရဲ့ အိပ်ခန်းထဲကို Camera က ဝင်လာမယ်။ ကောင်းခန့်က အိပ်ရာနိုးနေပြီ။ ဝန်ထမ်းသုံးယောက် သူ့ရှေ့မှာ ရပ်စောင့်နေကြတယ်။
ဝန်ထမ်း: "သခင်လေး၊ ဒီနေ့အတွက် ကားဘယ်စီး ပြင်ပေးရမလဲခင်ဗျ။" ကောင်းခန့်: "မနေ့က မှာထားတဲ့ကား ရောက်ပြီလား။" ဝန်ထမ်း: "ရောက်ပါပြီ သခင်လေး။ ဒါပေမဲ့ သခင်လေးလိုချင်တဲ့ အရောင်တော့ မဟုတ်သေးပါဘူး။" ကောင်းခန့်က မျက်မှောင်ကြုတ်လိုက်တယ်။ ကောင်းခန့်: "ငါ အနက်ရောင်လိုချင်တယ်လို့ ပြောထားတယ်မဟုတ်လား။" ဝန်ထမ်း: "ဟုတ်ပါတယ် သခင်လေး။ အခုရောက်လာတာ အဖြူရောင်ဖြစ်နေလို့ပါ။" ကောင်းခန့်: "ဒါဆို အသစ်တစ်စီး ထပ်ဝယ်လိုက်လေ။ ဒီလောက်လေးတောင် ငါပြောမှ လုပ်တတ်ကြတာလား။" ဝန်ထမ်းတွေ တိတ်သွားကြတယ်။ ကောင်းခန့်က ထပြီး အဝတ်လဲခန်းထဲ ဝင်သွားမယ်။ Camera က သန်းချီတန်တဲ့ နာရီတွေ၊ ရှားပါးဖိနပ်တွေ၊ Luxury ပစ္စည်းတွေကို ဖြတ်ပြမယ်။ နောက်တော့ ကောင်းခန့်က မိဘနှစ်ယောက်ရှိတဲ့ မနက်စာစားခန်းထဲ ဝင်လာမယ်။ ဦးသီဟ: "မင်းကတော့ တစ်နေ့တစ်နေ့ ပိုပြီးကြီးကျယ်လာပြီနော်။" ကောင်းခန့်: "အဖေ့သားပဲဗျာ။ ဒီလောက်တော့ ရှိရမှာပေါ့။" ဒေါ်မေမြတ်: "သားရယ်… ပိုက်ဆံရှိတိုင်း အရာအားလုံးကို လုပ်လို့ရတာမဟုတ်ဘူးနော်။" ကောင်းခန့်: (ပြုံးရင်း) "အမေကလည်း… ဒီခေတ်မှာ ပိုက်ဆံနဲ့ မရတာ ဘာရှိလို့လဲ။"
Photos: ကောင်းခန့် = lab_kaungkhant.jpg, ဒေါ်မေမြတ် = lab_mother.jpg; ဦးသီဟ = no approved photo yet (the sent one was a flagged famous face).

# WHAT WORKED (owner-approved, 23–25 Nov) — keep doing exactly this
Goal: customer videos look like a film — natural Burmese speech and acting, one click, no dubbing (owner's TikTok reference = Google Omni Flash).
Engine
- Gemini Omni **1.2** on Eachlabs (`google-gemini-omni-1-2-flash-{reference|image|text}-to-video`), input `{prompt, image_urls ≤10, aspect_ratio 9:16|16:9, duration "5s"|"10s", resolution "360p"}`. Omni speaks the Burmese lines itself; never dub Omni videos.
- Real costs: 10 s 360p ≈ $0.24 (≈1,090 Ks); 1.1 was $0.345. HD = the same 360p video sharpened by `p-video-upscale` (target 720p) ≈ $0.11 per 10 s — customer sees the identical video, just sharper. Direct 720p was $0.70 and gives a *different* take (other clothes) — don't use it.
- Video-extend (1.2) bills only the new seconds (3 s ≈ $0.10) — good for continuing a scene in the same place.
- 1.2 copies the clothes in the reference photo unless the script names clothes → the clothing rule below is what makes 1.2 right.
Script (planner, OMNI_SYSTEM) — the owner liked these results
- Faithful translation; every action in order; every Burmese line word for word with its speaker; format Look / Dialogue (Myanmar) / Motion Video Prompt as a flowing story paragraph with camera and acting, no timestamps.
- Refer to photos as "the young man in Image 1"; ကောင်လေး/ကောင်မလေး = adults (early twenties); never children in violence.
- If speech is allowed but not given, write 1–2 short natural Burmese lines; a line never describes the speaker's own action. Never copy the customer's instructions-to-the-app into the prompt. Fill in film details (place, light, camera, reactions).
- Clothing: the script AI decides and WRITES each person's clothes to fit who they are (very rich heir → visibly expensive designer clothes even at home/pool; staff → work uniforms), the place, the time and the situation (in bed → pyjamas). Photos give face/hair/build only. Same place + same time = same clothes; place/time changes → change clothes to fit. Tested: bedroom pyjamas ✓, pool shirt+shorts ✓, "richest young master" pool: designer swim shorts, gold watch, silk shirt ✓ ("Good").
- Framing: everyone fully visible chest-up; never shoot past backs of heads (1.2 obeys camera words literally — "from the foot of the bed… their bowed heads" gave cut-off heads).
- Continuation scenes: tell the planner "this continues the previous scene; don't show waking again" and give it what was said before (otherwise "the colour" became a random object instead of the car).
- MYANMAR_LOOK must not say "plain/everyday clothes" (it made the rich heir look poor). It now says: dressed exactly as the script describes.
- Warnings to the customer (warnings_mm): too long for the length, Google safety risks, copyrighted characters → original look; `blocked` when it can't be made (child bleeding etc.) — produce button hidden.
What did NOT work
- Wan + ElevenLabs dubbing (lip-sync, over-acting, "Baaaby", foreign-sounding clone) — replaced by Omni.
- Kie.ai: half its jobs failed (timeout/internal error); faces need "characters" (max 2 per video). Code kept, USE_KIE=false.
- Photos Google calls a "prominent public figure" are refused (the father photo). App shows a Burmese message and refunds.
- Eachlabs balance < $10 → only 2 jobs at once (429). Start scenes one or two at a time.
- Separate clips of the same place without context → clothes/room/staff change between clips.
Checks that caught real problems
- Transcribe every finished video (labpeek words) and compare with the script lines; read the real cost from the Eachlabs prediction; read the generation row's provider/engine (series once ran on Wan by mistake because engine wasn't set).

# Owner's decisions — read before every task

## Working rules
- Reply in Burmese only. Money in Myanmar Kyat ($1 ≈ 4,500 Ks).
- **Before anything that costs money (even 1 Ks): show the price in Kyat and wait for OK.** Never decide on my own.
- Tests: standard quality and the shortest length that proves the point, unless the owner asks otherwise. Say the price first.
- Discuss before acting; don't change the customer's story.
- Verify results (frames, audio timing) before saying something works.
- Never ask for passwords or login codes; payments and accounts are done by the owner.
- Secrets live in the Supabase vault, never in chat or the repo.
- Only faces the owner owns or has consent for; no celebrities, no copyrighted characters; no copyright-bypass tricks.
- Avoid SQL DELETE. Empty the lab-tmp branch after imports.

## Voices (ElevenLabs, owner's own)
- Main young characters: the owner's separately made voices — **ask which ones if unsure; never guess.**
  - "Yoke main character male" d4WXuYHO9Ot8KDdiOwIg, "Yoke main character female" 12GZ6E7rJLrs85C6m4J6
  - other young voices: "Young" RaXLAvAOptVErMcTikpw, "Yoke Young Man 1/2", "Yan", "Su - Calm" NBISYoQ4SVxq8eZxoHlV
  - "Yoke Male 1" B5MB163SdECMmHySTkLK = the owner's own voice; "Old man" uh7A30exzQsUAB5ovsOu; "Yoke child" uFPN3uAkEca3mQ6uRmBk
- Voices: plain natural everyday speech by default (14 Nov style). At most ONE emotion tag per line, never stacked; extra direction only when the story clearly needs it (crying, shouting, whisper, shock). No added laughs/sighs/breaths. Over-acting = bad.

## Video quality
- 18 Nov evening: the 8-section prompt + fixed quality base made Wan stiff ("doing what it's told"). REVERTED to the 14 Nov style:
  one natural story paragraph (what worked: tea shop, racing, podcast videos). Change prompt style only one thing at a time, tested.
- The warm reference look (HOUSE_LOOK) is only an example — kept for a future style option, not forced.
- Faces must stay the same in every scene.
- Wan reads Burmese text aloud → no Burmese names outside quotes in the Wan prompt (Character A/B/C = Image 1/2/3).
- Voice must sit on the lips: place each line where Wan actually says it (text match).

## Series
- Project per story, episodes made one by one, Story Bible so the AI remembers.
- 3 input ways: full script, idea only, AI-suggested ideas. ≤30 characters, ≤3 photos per Wan scene.
- Group scenes (4–9 people, MiniMax) built but OFF until tested.
- Photo check on upload: on. Scene AI check + free redo: OFF (owner pays for redos).
- Per-scene redo button, title card, help button: on hold — don't add.
- Scenes must connect (positions, props, who holds what) — continuity fix pending owner's OK.

## Recap (paused at ~70%)
- Recap-channel style, casual and fast, one voice; not fairy-tale. Watching it = understanding the whole video.
- Burmese subtitles: ass filter with shaping=complex.

## Pricing notes
- 1 cr = 100 Ks. std 10 s = 35 cr, HD 10 s = 50 cr.
- Wan cost ≈ 3,000 Ks per 10 s std, ≈ 6,300 Ks per 10 s HD → HD loses money at 50 cr; review later.

## Omni (Gemini Omni Flash via Eachlabs) — owner's rules, 23 Nov
- Engine for quality: picture + Burmese speech made together by Omni; no ElevenLabs/dubbing. ~$1.02 per 10 s (≈4,600 Ks).
- Tests go through the app's own path (planner engine="omni"), never prompts hand-written by Claude.
- Planner (Omni writer) rules: faithful translation of the customer's Burmese; leave nothing out (every action, order, cause→effect);
  dialogue in Burmese word for word with speaker; format like the owner's reference video: Look / Dialogue (Myanmar) / Motion Video Prompt
  (story paragraph with camera movement and acting, no timestamps). The "add nothing" rule was REMOVED by the owner.
- Added 23 Nov: write 1-2 short Burmese lines if speech allowed but not given; never copy instructions-to-the-app into the prompt; fill in film details (place, light, effects, camera, reactions) that fit the story.

## 24 Nov — Omni live for customers
- Single videos (t2v / i2v / template) now plan + produce with Gemini Omni 1.1 Flash (api CUSTOMER_ENGINE = "omni"). No photo → Omni text-to-video.
- Price (owner, 24 Nov 23:24): 10s HD 40 cr (4,000 Ks) / 10s 360p 30 cr (3,000) / 5s HD 25 cr (2,500) / 5s 360p 15 cr (1,500). HD = 360p + AI upscale to 720p. Series scene: HD 40 / std 30.
- Planner returns warnings_mm (too long / Google safety / copyrighted) and blocked=true when a story can't be made; app shows spoken lines + warnings and hides the produce button when blocked.

## 24 Nov (evening) — owner decisions
- Customers: Eachlabs Omni **1.2** (360p 10s ≈ $0.24 ≈ 1,090 Ks; 1.1 was $0.345). Owner compared same scene: 1.2 OK.
- Planner framing rule: everyone fully visible chest-up, never shoot past backs of heads; groups from side/wide.
- Clothes/props/acting: let the AI choose naturally from the story (owner liked pyjamas in bed). Do NOT force the photo's outfit.
- Kie.ai: code kept (characters for faces, Eachlabs fallback) but USE_KIE=false — ~half its jobs failed with Kie errors. Retest later with the 12 free credits.
- Photos flagged "prominent public figure" by Google are refused (Burmese message, refund). The father photo sent on 24 Nov was flagged; an AI father portrait was made instead (not yet approved).
- Eachlabs: balance < $10 → max 2 concurrent jobs (429). Owner to keep > $10.
- (23:14) App on Omni **1.2** (owner: keep 1.2; the pool tests were 1.2). Planner now writes each person's clothing to fit who they are (rich/poor, job), the place and situation; photos give face only. MYANMAR_LOOK no longer says "plain everyday clothes". Tested on 1.2: pool scene (plain shirt/shorts) and "richest young master" pool scene (designer swim shorts, gold watch, silk shirt) — owner: Good.

## 25 Nov — Series on Omni 1.2 (owner decisions + test results)
- Series scenes now go through Omni 1.2 (`project` SERIES_ENGINE = "omni"). `episode_scene_generation` RPC does not set the engine, so `project` sets `generations.engine = "omni"` after it (without this scenes went to Wan — happened once, ~3 Wan videos made by mistake, not approved).
- Series page: 1:1 ratio removed (Omni does not make it).
- At most 2 scenes rendering at once (`PARALLEL = 2`): Eachlabs balance ≤ $10 gives a 2-job limit (429). Owner topped up on 25 Nov.
- Clothing: series does NOT have its own clothing rules. Planner Omni rules (Clothing, Framing, Burmese lines) and api MYANMAR_LOOK are the only rules. Director only gives the whole-story context and: same place and time → same clothing, same staff and rooms.
- Wan-era voice tags and "spoken" fields removed from the director and from the scene plan (owner, 25 Nov). Director keeps only text, feeling and acting.
- Test 25 Nov (3 scenes, 360p, 9:16, Omni 1.2): all 3 succeeded, stitched. Eachlabs cost $0.7411 ≈ 3,335 Ks (owner OK 3,270). Transcript: scene 2 and 3 lines right; scene 1 line came out "မေမေ ဟေးအင်းနဲ့ အံကောင်းလိုက်တာ" (not "ဟင်းရနံ့ ကောင်းလိုက်တာ") — pronunciation problem to check.
- Test projects "Omni series test" and "Omni series test 2" stay in the DB (owner: do not delete).
- Google safety declines (Omni): NO customer warnings/limits (owner). Instead the api rewrites the likely trigger and resubmits (declined jobs cost $0). `SAFE_TRIES = 1`: try 1 changes only the English, Burmese lines stay exact. Try 2 (may reword a customer line) is built but OFF until the owner allows changing customer lines.
- Test 25 Nov 02:10 (mall story, 3 scenes 360p): scene 3 "ကျွန်တော် ဇေယျာပါ၊ ဖုန်းနံပါတ်လေး ရနိုင်မလား" was declined twice, then passed after try 1 with the line unchanged → asking for a phone number is fine; the English ("Neither takes out a phone") was the likely trigger. All 3 lines spoken right. Cost $0.7347 ≈ 3,306 Ks.

## NEXT (handoff, 25 Nov 00:45) — start here in a new chat
State now:
- Single video (✨ ဖန်တီး tab): Omni 1.2 on Eachlabs, 360p; HD = P-Video-Upscale to 720p; planner rules (clothing, framing, Burmese lines). Owner approved.
- Series (📁 ဇာတ်လမ်းတွဲ tab, `project` function): STILL Wan 3.0 + ElevenLabs dubbing. Prices already 30/40 cr per scene.
Task: move series to Omni 1.2 so scenes connect like a film:
  1. Each scene planned with the whole story as context (planner currently sees only its own scene — caused "wakes up again" / "colour of what?" errors).
  2. Same clothing per character within the same place/time; same staff/rooms.
  3. Consider Eachlabs Omni 1.2 video-extend for continuous scenes in the same place (3s test cost $0.10, bills only the new seconds).
  4. Stitch all scenes into one video (existing ffmpeg join in `project`).
  5. Show the owner the cost in Kyat and get OK before any paid test.
Open items: AI father portrait for the Kaung Khant story not yet approved (https://cdn-us.eachlabs.ai/uploads/1202d8fb-8ad7-40fb-89c7-6664583ca449.jpg); Kie.ai off (USE_KIE=false, 12 free credits left); Eachlabs balance should stay > $10 (2-job limit below that); temp edge function `labupload` (lab only) exists.

## HOW CLAUDE TESTS WITHOUT THE OWNER (read this — never ask the owner to test, log in, or give a JWT/password)
- Use the Supabase MCP `execute_sql` and `net.http_post` (pg_net) from SQL. Read results from `net._http_response` by id a few seconds later.
- Server-to-server auth: header `x-cron-token` = `(select decrypted_secret from vault.decrypted_secrets where name='cron_token')`.
  - `api` has verify_jwt=true, so also send `Authorization: Bearer <legacy anon JWT>` (the eyJhbGciOiJIUzI1NiIs... anon key of project isceklnjifckepgumale; the sb_publishable key fails). `{action:"start", id}` starts a generation row.
  - `planner` (verify_jwt=false): header `x-lab-token: vl_7f3k29xq81mz`, body `{engine:"omni", duration, cast:[names], story}` → `{plan:{prompt,lines,summary_mm,warnings_mm,blocked}}`.
  - `project` (verify_jwt=false): `x-cron-token` + `{action:"tick"}` moves producing/stitching episodes forward (see top of project/index.ts for the rest).
  - `labpeek` (lab): `x-cron-token` + `{action:"words", url|path}` → Burmese transcript of a video (check spoken lines). `labupload` (lab): `{action:"sign", paths:[...]}` → signed URLs of inputs-bucket files.
- Admin/test user (owner's account) id `7b451c1f-fdba-4079-8f7c-dd48ea8f4eaa`. Give it test credits with `select public._add_credits(uid, 100, 'Admin test credit (...)', null)` — free, it is our own ledger.
- To make a test video like a customer: insert into `plans` (status 'ready', plan from the planner response) and `generations` (engine 'omni', quality, duration 5|10, ratio, cost gen_cost(), plan_id, refs [{name, path}]), charge `_add_credits(u,-cost,...)`, then `net.http_post` api `{action:"start", id}`. Poll the row; Eachlabs output/cost: GET `https://api.eachlabs.ai/v1/prediction/<provider_request_id>` with `X-API-Key` from vault `eachlabs_api_key` (metrics.cost = real $).
- Character photos already uploaded (inputs bucket, under the admin user): lab_kaungkhant.jpg, lab_mother.jpg (lab_father.jpg = flagged famous face, do not use).
- Always: show the owner the cost in Kyat and get OK first; then verify (transcript, cost) before saying it worked. Push code to `main` (not a side branch) and deploy edge functions as one-line shims importing the pinned commit.
