# စမ်းရန် (Tests pending)

မဖွင့်ခင် စမ်းရမယ့် feature တွေ — စမ်းပြီး အဆင်ပြေမှ ဖွင့်ပါ။

## 1. ဇာတ်ကောင် ၄–၉ ယောက် တစ်ခန်းထဲ (Group scenes)
- Model: `minimax-h3-lite-reference-to-video` (Eachlabs, ပုံ ၉ ပုံအထိ)
- ခန့်မှန်းကုန်ကျ: scene တစ်ခု (၁၀ စက္ကန့်) ~$0.25 (480P) – $0.40 (768P)
- စမ်းရမှာ: ဇာတ်ကောင် ၄–၅ ယောက် ပုံ (AI ဖန်တီးပုံ) နဲ့ scene ၁ ခု — ရုပ်တူမှု၊ မြန်မာ ရုပ်ရည်၊ မြန်မာအသံထပ်တာ၊ Eachlabs တကယ့်ဈေး
- ဖွင့်နည်း: Supabase vault secret `group_scenes` = `on`
- မဖွင့်ခင်: scene တစ်ခုမှာ ပုံ ၃ ပုံအထိ၊ ၄ ယောက်ကျော်ရင် AI က wide shot + close-up shot တွေ ခွဲပေး

## 2. ဇာတ်လမ်းတွဲ (Series) အစအဆုံး
- Project ဖန်တီး → Story Bible → အပိုင်း (၁) scene ၃ ခု ထုတ် (105 cr) → ဆက်ထားတဲ့ video → Story Bible update → အပိုင်း (၂)

## 3. Recap
- Recap channel ပုံစံ (အသံတစ်မျိုး)၊ မူရင်း စကားကြောင်းအချိန်ကနေ clip ယူ — ၇၀% ပြီး
