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
Photos: ကောင်းခန့် = lab_kaungkhant.jpg, ဒေါ်မေမြတ် = lab_mother.jpg; young woman = lab_sr_sr_girl.jpg (owner-approved 25 Nov 02:28; any photo not listed here → no photo, let the AI draw the person); ဦးသီဟ = no approved photo yet (the sent one was a flagged famous face).

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

# Product decisions still in force
- Extra working rules: discuss before acting; never change the customer's story; tests use Standard and the shortest length that proves the point; secrets only in the Supabase vault; avoid SQL DELETE.
- Prices (owner, 24 Nov 23:24; 1 cr = 100 Ks): 10 s HD 40 cr (4,000 Ks) / 10 s 360p 30 cr (3,000) / 5 s HD 25 cr (2,500) / 5 s 360p 15 cr (1,500). HD = 360p + AI upscale to 720p. Series scene: HD 40 / std 30.
- Faces must stay the same in every scene. Photo check on upload: on.
- Series: one project per story, episodes made one by one, Story Bible so the AI remembers; 3 input ways (full script, idea, AI-suggested ideas). Scene AI check + free redo: OFF (owner pays for redos). Per-scene redo button, title card, help button: on hold — don't add. Group scenes (4–9 people): off until tested on Omni.
- Recap feature: paused at ~70% (recap-channel style, one casual voice; Burmese subtitles with ass filter shaping=complex). ElevenLabs voices are only for Recap now — Omni videos are never dubbed.
- The old Wan 3.0 + ElevenLabs dubbing rules (voices, emotion tags, Character A/B naming, text-matched dub timing) are retired — do not use them for customer videos.

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

## 25 Nov 02:30 — series acting and cuts (owner feedback on the mall test)
- Owner: cuts between scenes unnatural; scene 2 stood still ~2 s before acting; the young woman looked happy for no reason.
- Fix A: director cuts on action — each scene is already moving in its first second and continues the previous scene's movement; no held poses at start or end; something happens every second.
- Fix B: director writes "reactions" per scene: each person's feeling step by step with its cause; nobody smiles without a reason.
- Episode planning takes `max_scenes` (owner: tests ≤ 3 scenes).
- Note: Claude's earlier mother/son and mall tests broke rule 3 (Claude wrote the stories and scene text) — do not repeat.

## 25 Nov 02:40 — AI character portraits, 10 photos per scene (owner)
- After the Story Bible, every character without a photo gets an AI face portrait (Seedream `bytedance-seedream-v5-lite-text-to-image`, 3:4, 2K, ~160 Ks each), saved as its photo (`photo_ai = true`). The Bible AI writes `portrait_en` (face/hair/build only, English) for it. Customer sees it and can upload their own photo or redraw.
- Price (owner): first portrait of a character FREE (our cost), each redraw 2 credits (200 Ks), refunded if drawing fails. `ai_draws` counts drawings.
- Series scenes: up to 10 photos per Omni scene (was 3). Scene cast is still at most 6 named characters (MAX_CAST) — ask the owner before raising it.

## 25 Nov 02:50 — customer photos of characters and places (owner)
- "New series" form: optional 👥 character photos (name + photo, up to 10; photo check runs on upload) and 🏞️ place photos (name + photo, up to 10). Story Bible keeps those exact names; only characters without a photo get an AI portrait.
- A scene in one of the customer's places uses that place photo as an Omni reference ("<name> (place)", counted in the 10) → the video is shot in exactly that location. No place photo → the AI chooses a place that fits the story.
- Scene splitting writes each scene's `place`; the customer can change it per scene (dropdown) and edit places in the Story Bible. Table `project_places`, column `episode_scenes.place`.

## 25 Nov 09:10 — series scenes: simple and natural (owner)
- Owner: series videos looked forced ("doing every order"), the car moved after a door closed. Cause: Claude's 02:30 rules ("something happens every second", step-by-step reactions), the whole-episode outline in every scene, and naming people who are not in the scene.
- Now: one simple moment per scene (1–2 main actions + lines, calm real-life pace), short subtle acting, one-sentence reactions with a reason, never name people not in the scene, no whole-episode outline in a scene prompt (only series title, place/time, this scene, its people, director notes).
- Fix A ("cut on action, something every second") is replaced by this; do not bring it back.

## 25 Nov 09:45 — Latin words in Burmese lines (owner)
- Omni said "ကျွန်တော် Ko ပါ" as "ကျွန်တော်ကိုပါ ကျွန်တော်ကိုပါ" (stumbled on the Latin name and repeated). Owner OK'd changing customer lines for this one case: the Omni planner writes any Latin-letter word inside a Burmese line in Burmese script as a Yangon person says it (Ko → ကို, Sorry → ဆောရီး, OK → အိုကေ). Nothing else in the line changes; the exact-line check now ignores only the Latin words. Works for ✨ and series.
- Shots ep 2 test (09:20, 3 scenes, owner-approved script): 0 declines, $0.7285 ≈ 3,278 Ks; Omni also added soft background music (transcript), not checked yet.

## 25 Nov 09:50 — outfits stay the same between scenes (owner)
- Owner: outfits changed from scene to scene. Cause: each scene's planner chose clothes by itself and the Bible looks had no colours.
- Now the director writes each person's exact outfit per scene (colour, garment, fabric, shoes) and copies it word for word while the place and time stay the same; the planner must use those words unchanged. Outfits change only when place/time changes or the story says so.
- Also removed the leftover "already moving, no pause / cut on action" labels from the director notes (should have gone at 09:10).

## 25 Nov 10:00 — scenes continue from the previous shot (owner chose option 2)
- Owner: scenes did not connect (each scene is a separate Omni video that never sees the one before).
- Director marks `continues: true` when a scene is in the same place/time and picks up straight from the previous one. Such a scene waits until the previous scene is done; its last frame (Eachlabs ffmpeg `-sseof -0.3`, saved to inputs as frame_<sceneId>.jpg, `episode_scenes.prev_frame`) goes to Omni as a reference "previous shot" with the character photos; the planner matches its place, background, light, camera side, positions and clothes.
- Slower (continuing scenes run one after another). Extend (Omni continues the video itself) explained to owner, not tested yet: 3 s test ≈ 450 Ks.
- Shots: the lead "Ko" now uses lab_kaungkhant.jpg (owner, 25 Nov 09:51); name stays "Ko".

## 25 Nov 11:00 — scenes are 5 or 10 seconds, no filler (owner)
- Owner: the 3 scenes held ~15 s of story but each was 10 s, so the AI padded them with extra actions.
- Scene splitting now gives each scene `seconds` 5 or 10 (just long enough: one quick action + one short line = 5). `episode_scenes.seconds`; `episode_scene_generation` charges `gen_cost(quality, seconds)`; the customer can change it per scene. Director and Omni planner: only what the story says, no extra actions or filler.
- Prices NOT changed (owner): 5 s = 15 cr (HD 25), 10 s = 30 cr (HD 40), as already in gen_cost.

## 25 Nov 11:45 — no repeated actions between scenes (owner)
- Shots ep 4 test (5+5+10 s, owner: "good"): 20 s instead of 30, no filler, bag handed back, 4 lines right; Eachlabs $0.5011 ≈ 2,255 Ks (5 s = half of 10 s). 60 cr.
- Owner: he picked the bag up, then sat down again at the cut and stood up — should pick up and stand. Cause: director ended scene 2 "still crouched" and scene 3 started "crouched, then rise"; the video may already have stood up.
- Now: small physical actions finish inside the same scene (crouch to pick up → stand up), scenes end on a natural resting pose; a scene with a previous-shot frame starts exactly as that image shows (image wins over the text), never repeating an action.

## 25 Nov 12:00 — Claude makes episodes the way the app does (owner)
- Owner: Claude must make series episodes exactly as the app does (owner gives idea/script; the app's AI splits scenes, director, planner); Claude never writes scenes or prompts.
- Cron now resumes scene splitting: an episode in status "planning" with no `planning_since` or older than 4 min gets the same `planEpisode` again (`episodes.max_scenes`, `planning_since`). Also helps customers when splitting stops.
- How Claude makes an episode for the owner: insert `episodes` (project, user, next num, input_mode idea|script, input_mm = owner's text exactly, status "planning", max_scenes) → wait for status "ready" → show the owner the AI's scenes, seconds and price → on OK set status "producing" and cost (same as the app's produce).
- Episode cost after splitting now sums 5 s / 10 s prices.

## 25 Nov 12:40 — ✨ create back to the morning version (owner)
- Owner: things that worked were getting worse. ✨ create (single customer video) now uses EXACTLY the Omni planner rules of the morning of 25 Nov (`OMNI_SYSTEM_CREATE` = planner v31 / commit 1f415b6 text, checked identical), the morning's exact-line check and cast limits, and NO automatic safety rewrite (api: series only).
- Today's rules (Latin → Burmese script, add nothing, director clothing words, place / previous-shot photos, safety rewrite) apply to SERIES only (`project` sends `series: true` to the planner).
- Do not change ✨ create rules again without the owner; test series changes on series only.
- Omni 1.1 comparison (A, same inputs): scene 1 declined by Google safety (1.2 accepted the same prompt), scene 2 ok $0.352, scene 3 submit timed out (unknown whether made). Stopped by owner.

## 25 Nov 14:20 — series "Script" mode = owner's exact script + scene photos (owner)
- Owner writes a detailed script (camera, clothes, place, lines) and can add one photo per scene ("📷 ဒီ scene ရဲ့ပုံ", `episode_scenes.photo_path`). With these, no Claude/AI rules are wanted.
- Script mode now: NO director, NO previous-frame chaining, NO series rules, NO ✨ create rules (owner 14:19: they fill in details/framing). Each scene's prompt = the script translated exactly (`OMNI_SYSTEM_EXACT`: translate, add/drop/change nothing, Burmese lines word for word, Look/Dialogue/Motion, Image N) + one extra rule only when a scene photo is sent: use its place, furniture, colours, light and clothes; draw off-photo parts in the same style; faces from character photos (`SCENE_PHOTO_RULE`, planner `scene_photo: true`). Up to 8 character photos + the scene photo.
- Idea mode keeps the series rules (director, frames, etc.). ✨ create unchanged.
- Scene text limit 900 → 2000 characters (detailed scripts).

## 25 Nov 14:21 — series hidden; everything in ✨ create (owner)
- The 📁 series tab is hidden from the app (nav button `class="hidden"`). Code, tables and test data stay.
- Plan (owner): make everything in ✨ create; below it, an editing-style area that collects the videos (in rolls) so they can be put together. Design to be agreed with the owner first.
- Commit afcdc15 (series script mode translate-only rules) is on main but was NOT deployed (live: planner v41, project v29).

## 25 Nov 14:40 — 🎞️ Rolls under ✨ create (owner)
- Customer's finished videos can be collected in Rolls ("➕ Roll ထဲ ထည့်" under every finished ✨ video and in Videos), ordered (↑ ↓ ✕), renamed, deleted, and joined into one video with "🎬 ဆက်မည်" — FREE (owner; Eachlabs ffmpeg cost is ours, a few tens of Ks).
- Tables `rolls`, `roll_items` (RLS on, accessed only through the `project` function: roll_list / roll_create / roll_add / roll_update / roll_delete / roll_join). Joining = same ffmpeg concat as series (first clip's ratio, 720 if any clip is HD, 24 fps, silent clips get silence); the project tick polls `rolls.status = 'joining'`. Max 30 rolls per user, 30 videos per roll.
- No scene photo in ✨ create (owner said no).
- New tables in this project get NO grants for service_role by default: after creating a table, `grant select, insert, update, delete ... to service_role` (rolls/roll_items/project_places were "permission denied" until 25 Nov 15:20).

## 25 Nov 14:45 — ✨ create: "✍️ အကြမ်း" / "📄 Script အပြည့်" (owner)
- ✨ create has a style choice. ✍️ အကြမ်း (default) = the morning rules, unchanged. 📄 Script အပြည့် = translate only (`OMNI_SYSTEM_EXACT`): add/drop/change nothing, Burmese lines word for word, no clothing/framing/fill-in rules; the exact-line check still runs.
- `plans.exact`; api `plan` takes `exact: true` (t2v only); `plan_status` returns `prompt_en` for exact plans and the plan card shows the full English prompt so the owner can check it before spending credits. Price unchanged.
- Videos then go into a 🎞️ Roll and are joined (free).

## 25 Nov 15:00 — ✨ create: "🅿️ Prompt" = the customer's English prompt sent to Omni unchanged (owner)
- Owner will write the English prompt himself (no AI in between). Third style choice "🅿️ Prompt": api `plan` with `raw: true` saves the text as the plan prompt directly (no planner, no checks), plan card shows it, and the video is submitted with exactly that text — NO MYANMAR_LOOK line added (`plan.raw`, `generations.post_data.raw`). Up to 4000 characters (DB check `generations_prompt_mm_check` raised to 4000 at 15:56). Character photos are Image 1-3 in order. Works in ✨ create and 🖼️ image→video (fixed 15:15: first version only worked without a start image).
- ✍️ အကြမ်း (morning rules) and 📄 Script အပြည့် (translate only) stay.

## 25 Nov 15:45 — real progress while a video is made (owner)
- The "1–3 minutes" text is replaced by the job's real stage from the server (api `status` → `progress {stage: waiting|making|hd|finishing, elapsed, expected}`; waiting/making comes from the live Eachlabs prediction status) and a bar timed against the MEDIAN real time of the last 20 finished videos with the same engine/quality/length (cached 10 min; fallback 90 s / HD 150 s). The bar stops at 95% until the video is really ready; past the usual time it says so.

## CURRENT STATE (25 Nov, 02:30)
- ✨ ဖန်တီး and 📁 ဇာတ်လမ်းတွဲ both make video with Omni 1.2 on Eachlabs, same planner rules, HD = upscale to 720p. Series HD not yet tested end to end.
- Open: AI father portrait for the Kaung Khant story not approved yet (https://cdn-us.eachlabs.ai/uploads/1202d8fb-8ad7-40fb-89c7-6664583ca449.jpg); scene-1 pronunciation issue from the 25 Nov series test; Kie.ai off (USE_KIE=false, 12 free credits); keep Eachlabs > $10; lab-only edge functions `labupload`, `labpeek`.

## HOW CLAUDE TESTS WITHOUT THE OWNER (read this — never ask the owner to test, log in, or give a JWT/password)
- Use the Supabase MCP `execute_sql` and `net.http_post` (pg_net) from SQL. Read results from `net._http_response` by id a few seconds later.
- Server-to-server auth: header `x-cron-token` = `(select decrypted_secret from vault.decrypted_secrets where name='cron_token')`.
  - `api` has verify_jwt=true, so also send `Authorization: Bearer <legacy anon JWT>` (the eyJhbGciOiJIUzI1NiIs... anon key of project isceklnjifckepgumale; the sb_publishable key fails). `{action:"start", id}` starts a generation row.
  - `planner` (verify_jwt=false): header `x-lab-token: vl_7f3k29xq81mz`, body `{engine:"omni", duration, cast:[names], story}` → `{plan:{prompt,lines,summary_mm,warnings_mm,blocked}}`.
  - `project` (verify_jwt=false): `x-cron-token` + `{action:"tick"}` moves producing/stitching episodes forward (see top of project/index.ts for the rest).
  - `labpeek` (lab): `x-cron-token` + `{action:"words", url|path}` → Burmese transcript of a video (check spoken lines).
  - Transcript check (owner, 25 Nov): use **Gemini** first — POST `https://api.eachlabs.ai/v1/chat/completions` (Bearer eachlabs_api_key) `{model:"google/gemini-3.6-flash", temperature:0, messages:[{role:"user", content:[{type:"text", text:"Transcribe exactly every word spoken in this video, in Burmese script…"},{type:"video_url", video_url:{url:<video url>}}]}]}` (~20 Ks). Scribe (labpeek) only as a second opinion; if they disagree, tell the owner the exact words and let him listen. `labupload` (lab): `{action:"sign", paths:[...]}` → signed URLs of inputs-bucket files.
- Admin/test user (owner's account) id `7b451c1f-fdba-4079-8f7c-dd48ea8f4eaa`. Give it test credits with `select public._add_credits(uid, 100, 'Admin test credit (...)', null)` — free, it is our own ledger.
- To make a test video like a customer: insert into `plans` (status 'ready', plan from the planner response) and `generations` (engine 'omni', quality, duration 5|10, ratio, cost gen_cost(), plan_id, refs [{name, path}]), charge `_add_credits(u,-cost,...)`, then `net.http_post` api `{action:"start", id}`. Poll the row; Eachlabs output/cost: GET `https://api.eachlabs.ai/v1/prediction/<provider_request_id>` with `X-API-Key` from vault `eachlabs_api_key` (metrics.cost = real $).
- Character photos already uploaded (inputs bucket, under the admin user): lab_kaungkhant.jpg, lab_mother.jpg, lab_sr_sr_girl.jpg (owner-approved young woman) (lab_father.jpg = flagged famous face, do not use; any other lab_* photo is NOT approved → no photo).
- Always: show the owner the cost in Kyat and get OK first; then verify (transcript, cost) before saying it worked. Push code to `main` (not a side branch) and deploy edge functions as one-line shims importing the pinned commit.

## 25 Nov — ပုံ→Video က ပုံအချိုးအတိုင်း လိုက်တယ်
- Bug: ratio ရွေးစရာကို i2v မှာ ဖျောက်ထားပေမဲ့ 9:16 အမြဲ ပို့နေခဲ့တယ်။ အလျားလိုက်ပုံဆို AI က ဖြတ်ပြီး ပြန်ဆွဲလို့ မျက်နှာ ပြောင်းသွားတယ်။
- ပြင်ချက်: ပုံတင်တာနဲ့ အလျား>အမြင့် ဆို 16:9၊ မဟုတ်ရင် 9:16 (opt.imgRatio)။ Toast နဲ့ ပြောပြတယ်။

## 25 Nov — ✨ ဖန်တီးမှာ 5 စက္ကန့် ပြန်ထည့်
- Owner ခိုင်းချက်: location တူ 14 s ကို 10 + 5 ခွဲထုတ်ဖို့။ ဈေးက DB gen_cost အတိုင်း: 5 s = 15 cr (HD 25)။ API/plan က 5|10 လက်ခံပြီးသား။
- 3–15 s စက္ကန့်တိုင်း (ဥပမာ 4 s, 15 s) က owner ဈေးမသတ်မှတ်ရသေးလို့ မထည့်ရသေး။

## 25 Nov — Safety ငြင်းရင် Google ရဲ့ မူရင်းစာကို သိမ်း
- generations.post_data.provider_error ထဲ သိမ်းတယ် (customer ကို SAFETY_MM ပဲ ပြမြဲ)။ ဘာကြောင့် ငြင်းလဲ owner ကို ပြောနိုင်ဖို့။

## 25 Nov — ✍️ စာ→Video ပုံ ၃ → ၉ ပုံ
- cleanRefs (api) နဲ့ castAdd (app) ကို 9 ထိ တိုး။ Omni ref-to-video က 10 ယူပေမဲ့ planner (✨ 9 names) နဲ့ Kie fallback (9) ကြောင့် 9။
- 🅿️ Prompt မှာ Image 1..9 = ထည့်တဲ့ အစဉ်။

## 25 Nov — ပုံ→Video မှာ အဆုံးပုံ (end frame)
- Omni i2v ရဲ့ `end_image_url` (Eachlabs schema: optional, end image ပါရင် max 10s)။ App မှာ "အဆုံးပုံ (မထည့်လည်း ရ)" နေရာ။
- generations.end_image_path (inputs bucket၊ user ကိုယ်ပိုင် path ပဲ လက်ခံ၊ engine omni + i2v မှာပဲ)။ omniInputs → endUrl → submitOmni။
- ဈေး မပြောင်း။ အဆုံးပုံကို ပထမပုံနဲ့ အခန်း/ထောင့် တူအောင် ဆွဲဖို့ app tip ထဲ ရေးထား။

## 25 Nov — 🅿️ Prompt 4,000 → 8,000 လုံး
- Owner ရဲ့ prompt (4,535 လုံး) textarea maxLength မှာ ပြတ်သွားလို့။ app maxLength၊ api plan/create slice၊ generations_prompt_mm_check အကုန် 8000။ Omni က 20,000 ထိ ယူတယ်။
