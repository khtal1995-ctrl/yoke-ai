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
- Price: Standard 35 cr (3,500 Ks, Omni 360p), HD 60 cr (6,000 Ks, Omni 720p). gen_cost hd = 6/s. Series HD also 60 cr/scene (series still on Wan).
- Planner returns warnings_mm (too long / Google safety / copyrighted) and blocked=true when a story can't be made; app shows spoken lines + warnings and hides the produce button when blocked.

## 24 Nov (evening) — owner decisions
- Customers: Eachlabs Omni **1.2** (360p 10s ≈ $0.24 ≈ 1,090 Ks; 1.1 was $0.345). Owner compared same scene: 1.2 OK.
- Planner framing rule: everyone fully visible chest-up, never shoot past backs of heads; groups from side/wide.
- Clothes/props/acting: let the AI choose naturally from the story (owner liked pyjamas in bed). Do NOT force the photo's outfit.
- Kie.ai: code kept (characters for faces, Eachlabs fallback) but USE_KIE=false — ~half its jobs failed with Kie errors. Retest later with the 12 free credits.
- Photos flagged "prominent public figure" by Google are refused (Burmese message, refund). The father photo sent on 24 Nov was flagged; an AI father portrait was made instead (not yet approved).
- Eachlabs: balance < $10 → max 2 concurrent jobs (429). Owner to keep > $10.
