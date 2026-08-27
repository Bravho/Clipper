# App Store rejection — Guidelines 5.1.1(i) & 5.1.2(i): third-party AI data sharing

**Status:** analysis + remediation plan (not yet implemented)
**Guidelines:** 5.1.1(i) Data Collection & Storage · 5.1.2(i) Data Use & Sharing
**Root issue:** the app sends the user's personal data (uploaded photos/videos and
their typed brief) to third-party AI services without an in-app disclosure of
*what* is sent and *to whom*, and without asking the user's *permission before*
sending it. A privacy-policy clause alone does **not** satisfy this guideline —
Apple states this explicitly.

---

## 1. What Apple requires (the four tests)

Personal data may only be used/transmitted/shared to a third-party AI service after
ALL of these are met:

1. **Disclose what data will be sent.**
2. **Specify who the data is sent to.**
3. **Obtain the user's permission before sending data.**
4. **Privacy policy** identifies what data is collected, how, all uses of it, and
   confirms any third party it is shared with provides the *same or equal*
   protection.

> Apple's note: "only including this information in the app's Terms of Service or
> Privacy Policy is **not** sufficient." → An **in-app, just-in-time disclosure +
> explicit opt-in** is required *before* the data leaves the device/service.

---

## 2. What RClipper actually sends, and to whom (ground truth from the code)

The 5-step pipeline (`src/services/VideoGenerationService.ts`) transmits the
requester's data to these external AI providers. Note: despite the filename
`chatGptVisionService.ts`, the active code calls **Google's Gemini API** via the
`GoogleGenAI` SDK — not OpenAI.

| Provider (recipient) | Service / endpoint | Data actually sent | Where in code |
|---|---|---|---|
| **Google LLC** — Gemini API | `generativelanguage.googleapis.com` (Gemini 2.5 Flash) | **Uploaded images + sampled video frames (base64)** + the requester's **text brief/description**, target audience, place/business info → scene plan + Thai/EN/ZH scripts + storyboard | `src/lib/ai/chatGptVisionService.ts` (`new GoogleGenAI`, `inlineData`) |
| **Google LLC** — Veo | Veo 3.1 via Gemini API (`GoogleGenAI`) | **Approved scene images (base64)** + scene scripts → generated video clips | `src/lib/ai/veoService.ts` |
| **Google LLC** — Gemini | `generativelanguage.googleapis.com` | **Generated video audio** → subtitles; **caption/title text** → translations | `src/lib/ai/geminiSubtitlesService.ts`, `src/lib/ai/marketingCopyService.ts` |
| **ElevenLabs, Inc.** | `api.elevenlabs.io/v1/text-to-speech/...` | **Script text** (derived from the user's brief/images) → synthesized MP3 voice; (also staff voice recordings for speech-to-speech) | `src/lib/ai/elevenLabsTtsService.ts` |
| **Anthropic (Claude)** | configured (`ANTHROPIC_API_KEY`) | Configured but the active motion-graphics path is deferred; `marketingCopyService` currently routes to Gemini. **Verify before naming it** as an active recipient. | `src/config/aiTools.ts` (`claude`) |

The uploaded media can contain **faces, other identifiable people, audio, and
location** — this is exactly the "personal data" Apple is protecting. Config for
all keys lives in `src/config/aiTools.ts` (`AI_CONFIG`).

---

## 3. What already exists (and why it is not enough)

- **Privacy policy** (`src/app/(public)/privacy/page.tsx`, v1.4.0), §3 "AI and
  service providers": mentions transmitting media to "contracted hosting, storage,
  authentication, payment, email, **AI, voice, video-generation**, and
  media-processing providers." → Real but **generic**: it does **not name** Google
  / Gemini / Veo or ElevenLabs, does not say *what* goes to each, and does not
  include the required **"same or equal protection"** confirmation.
- **Consent recording infrastructure** exists and is reusable:
  `ConsentService.recordConsents()`, `PolicyType` enum, `CURRENT_POLICY_VERSIONS`
  (`src/config/policyVersions.ts`), per-user `TermsAcceptance` records.
- **Signup consent is implicit** — `SignupForm.tsx` shows a passive "by clicking
  Create account you agree to…" line; `signupSchema.ts` comment says "No explicit
  checkbox fields required." (A `LegalConsentCheckboxes` component exists but is
  **not wired into any form**.)
- **Request-submit gate** (`NewRequestForm.tsx`, Section 4) already has the right
  *pattern* — two required, default-unchecked checkboxes (`creditConfirmed`,
  `rightsConfirmed`), validated server-side as `z.literal(true)` in
  `src/app/api/requests/[id]/submit/route.ts` and persisted on the `ClipRequest`.
  **Neither checkbox mentions AI or third-party data sharing.**

**Gap summary vs the four tests:**

| Apple test | Status | Why |
|---|---|---|
| 1. Disclose *what* data is sent | ❌ | No in-app disclosure at the point of sharing; only a generic policy line |
| 2. Specify *who* it goes to | ❌ | Providers (Google/Gemini/Veo, ElevenLabs) never named anywhere |
| 3. Permission *before* sending | ❌ | Submit checkboxes cover credits + ownership only; no AI-sharing opt-in |
| 4. Privacy policy completeness | ⚠️ Partial | Covers collection/use + generic "AI providers", but unnamed and missing the equal-protection confirmation; and policy alone is insufficient |

---

## 4. Remediation — how to close the gap

### A. In-app just-in-time disclosure + explicit opt-in (the core fix)

The earliest point the requester's data leaves for a third-party AI service is when
the submitted request enters the pipeline (Gemini vision on the uploaded images +
brief). The natural, defensible consent point is the **New Request submit screen**
(`NewRequestForm.tsx`, Section 4 "ก่อนส่งคำขอ"), where the two required checkboxes
already live.

1. Add a **third required, default-unchecked checkbox** `aiDataConsent`, mirroring
   the existing `rightsConfirmed` wiring. Suggested label (TH, with the recipients
   named):
   > "ฉันเข้าใจและอนุญาตให้ RClipper ส่งรูปภาพ/วิดีโอที่อัปโหลดและรายละเอียดที่กรอก
   > ไปยังบริการ AI ของบุคคลที่สาม — **Google (Gemini และ Veo)** และ
   > **ElevenLabs** — เพื่อสร้างสคริปต์ วิดีโอ และเสียงพากย์ ([ดูรายละเอียดข้อมูลที่ส่ง](…))"
2. Make it block submit (unchecked → error), like `rightsConfirmed`.
3. Add matching English copy if EN locale is shipped.
4. **Wire it end-to-end**, following the `rightsConfirmed` trail exactly:
   - `src/features/requests/validation/clipRequestSchema.ts` → add
     `aiDataConsent: z.literal(true, { … })`.
   - `NewRequestForm.tsx` → register the checkbox; include
     `aiDataConsent: true` in the POST bodies (lines ~822, ~1174) and the submit call.
   - `src/app/api/requests/[id]/submit/route.ts` → add `aiDataConsent: z.literal(true)`
     to the parsed schema and require it.
   - Persist it: add `ai_data_consent BOOLEAN` on `ClipRequest` (model
     `src/domain/models/ClipRequest.ts`, `ClipRequestService`, and a migration under
     `migrations/`) so each request carries a timestamped, per-request record of
     consent — the audit trail Apple wants.

### B. A short disclosure surface behind the checkbox link

Add a dedicated section/page (or a modal) reachable from the checkbox link that
states plainly:
- **What is sent:** uploaded photos and videos (which may show faces, voices, and
  locations), the video clips' audio, the text brief, place names / selected map
  location / coordinates, and business details.
- **Who receives it:** Google LLC (Gemini API for scene/script analysis and
  subtitles; Veo for video generation) and ElevenLabs, Inc. (voice synthesis).
- **Why:** to generate the script, storyboard, video, subtitles, and voice-over.
- Links to Google's and ElevenLabs' privacy/terms, and a line that these providers
  are contractually required to protect the data to an equivalent standard.

### C. Privacy policy update (§3), and version bump

- Rewrite §3 of `privacy/page.tsx` to **name the subprocessors** and say what each
  receives (mirror the table in §2 above). Add the required sentence, e.g.:
  > "These AI providers act as our processors under contractual terms that require
  > them to protect your data to the same or an equivalent standard as this policy,
  > to use it only to perform the requested processing, and not for their own
  > purposes."
- Only add Anthropic/Claude here **if** it is actually in the live path (see §2).
- Bump `PolicyType.PrivacyPolicy` version in `src/config/policyVersions.ts`
  (1.4.0 → 1.5.0) and update the effective date + the version shown on the page.
  Optionally register a new `PolicyType.AiDataProcessing` if you want the opt-in
  logged through `ConsentService` as a first-class, versioned acceptance rather than
  (or in addition to) a per-request boolean.

### D. App Store Connect — reply + metadata

1. **App Privacy ("nutrition label"):** ensure the data types (Photos/Videos, User
   Content, Audio, Location, plus the brief text) are marked as **collected** and,
   where applicable, **shared with third parties** / used for app functionality.
   Mismatch here can trigger the same rejection.
2. **Reply to the rejection** in Resolution Center and add reviewer notes in **App
   Review Information** (draft in §5).

### E. (Optional, lower priority) Signup consent

Not strictly required by 5.1.x, but wiring the unused `LegalConsentCheckboxes`
into signup — or at least keeping the passive-agreement line — reduces overall
privacy-consent risk and is cheap given the component already exists.

---

## 5. Draft reply to App Review

> Thank you for the review. RClipper generates short videos from user-provided
> photos, video clips, and a text brief, and this processing uses third-party AI
> services. We have updated the app to meet Guidelines 5.1.1(i) and 5.1.2(i):
>
> 1. **Disclosure of what is sent:** Before a request is submitted, the app now
>    shows an explicit notice that the user's uploaded photos/videos and the
>    details they enter will be sent to third-party AI services to generate the
>    script, video, and voice-over.
> 2. **Who it is sent to:** The notice names the recipients — Google (Gemini API
>    and Veo) for scene/script/video generation and subtitles, and ElevenLabs for
>    voice synthesis.
> 3. **Permission before sending:** The user must affirmatively opt in via a
>    required, unchecked-by-default confirmation before any data is transmitted;
>    the request cannot be submitted otherwise, and consent is recorded per request.
> 4. **Privacy policy:** Our privacy policy (updated to v1.5.0) now identifies the
>    data we collect, how we collect it, all uses, names these AI subprocessors and
>    what each receives, and confirms they are contractually required to provide the
>    same or an equivalent level of protection.
>
> We have also reviewed our App Privacy details to reflect data shared with these
> providers. Please let us know if any further detail would help.

*(If the AI processing were ever removed, the alternative reply is to confirm the
app sends no user data to a third-party AI service and add that to App Review
Information — not applicable here, since it does.)*

---

## 6. Implementation checklist

- [ ] Add `aiDataConsent` checkbox to `NewRequestForm.tsx` (required, unchecked)
- [ ] `aiDataConsent: z.literal(true)` in `clipRequestSchema.ts` + submit route
- [ ] Include `aiDataConsent` in POST bodies; persist `ai_data_consent` on ClipRequest (+ migration)
- [ ] Disclosure surface (page/modal) naming data + Google/Gemini/Veo + ElevenLabs
- [ ] Rewrite privacy policy §3 with named subprocessors + equal-protection clause
- [ ] Bump PrivacyPolicy to 1.5.0 in `policyVersions.ts` + page header/date
- [ ] (Optional) `PolicyType.AiDataProcessing` logged via ConsentService
- [ ] Update App Store Connect → App Privacy data-sharing labels
- [ ] Reply in Resolution Center + add App Review Information notes
- [ ] Verify whether Anthropic/Claude is in the live path before naming it
