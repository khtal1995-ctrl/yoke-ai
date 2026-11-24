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
