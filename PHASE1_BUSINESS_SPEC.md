# CLIPPER PROJECT — PHASE 1 BUSINESS & PRODUCT SPECIFICATION
**Version:** 1.0 (Draft for Review)
**Date:** 2026-03-07
**Prepared for:** Internal Team Review and Approval
**Phase:** Phase 1 — Business Rules, Product Rules, Policy Structure, Queue Logic Foundation, and Operational Governance

---

> **IMPORTANT:** This document is a business and product design specification only.
> No code, database schema, UI wireframes, or frontend/backend implementation is included in this phase.
> All decisions herein should be reviewed and approved before proceeding to Phase 2 (Information Architecture and Wireframes).

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Business Model Definition](#2-business-model-definition)
3. [User Roles and Responsibilities](#3-user-roles-and-responsibilities)
4. [Account and Signup Rules](#4-account-and-signup-rules)
5. [Credit System Rules](#5-credit-system-rules)
6. [Request Submission Rules](#6-request-submission-rules)
7. [Content and Materials Policy](#7-content-and-materials-policy)
8. [Ownership, License, and Usage Rights](#8-ownership-license-and-usage-rights)
9. [Storage, Retention, and File Handling Policy](#9-storage-retention-and-file-handling-policy)
10. [Service Level / Turnaround Policy](#10-service-level--turnaround-policy)
11. [Status Definitions and Transition Rules](#11-status-definitions-and-transition-rules)
12. [Queue Model Foundations](#12-queue-model-foundations)
13. [Expected Due Date Business Logic](#13-expected-due-date-business-logic)
14. [Dashboard Information Requirements (Business Level)](#14-dashboard-information-requirements-business-level)
15. [Operational Exceptions and Governance](#15-operational-exceptions-and-governance)
16. [Phase 1 Decisions to Finalize Before Phase 2](#16-phase-1-decisions-to-finalize-before-phase-2)
17. [Open Questions and Recommendations](#17-open-questions-and-recommendations)

---

## 1. EXECUTIVE SUMMARY

### 1.1 What Is Clipper Project?

Clipper Project is a **managed short-video production and distribution platform**. It enables individuals and small businesses (collectively "requesters") to submit brief creative descriptions and raw media materials, in exchange for a professionally edited, max-30-second promotional video that is then published to selected social media and video delivery channels by the platform operator's in-house production team.

Clipper Project is **not a freelance marketplace**. There is no bidding, no selecting of individual creators, and no negotiation. The operator (the platform company) is the sole service provider. Requesters interact with a structured intake system, receive a standardized production service, and receive delivery links when the content is live.

### 1.2 Core Operating Model

The core operating model operates as follows:

1. A requester creates an account and receives a starting credit balance.
2. The requester submits a clip request by completing a structured brief and uploading up to 5 video/image files.
3. The platform reserves credits upon submission and permanently deducts them upon acceptance.
4. The operator's staff reviews the request, confirms its suitability, and accepts it into the production queue.
5. Staff edits the video using the requester's materials, primarily through Canva or equivalent tools.
6. The edited clip is published to selected social media channels and/or delivery links on behalf of the platform.
7. Delivery links are sent to the requester's dashboard, completing the service cycle.

### 1.3 Why This Is Not a Marketplace

Platforms like Fiverr or Upwork act as intermediaries between independent contractors and clients. Clipper Project is fundamentally different:

- **The operator controls production end-to-end.** There are no independent sellers.
- **The operator publishes content on its own channels.** The requester receives distribution reach, not just a video file.
- **The final output belongs to the operator's publishing ecosystem.** The requester receives the right to reshare, not ownership of the master asset.
- **Pricing is fixed and standardized.** There is no bidding, custom quoting, or negotiation.
- **Quality and brand standards are set by the operator.** The operator decides whether materials are suitable and how the final edit is executed.

This model is closer to a **subscription creative service** (like a retainer-based social media video agency) but delivered through a structured, self-serve portal with defined credit-based consumption.

### 1.4 Strategic Intent for Phase 1

Phase 1 establishes the foundational rules, policies, and governance logic that all subsequent phases (wireframes, database design, development) must be built upon. Getting these foundations right prevents costly rework. Phase 1 also defines the operator's legal and operational posture — particularly around content rights, service commitments, and file handling — before the platform becomes publicly accessible.

---

## 2. BUSINESS MODEL DEFINITION

### 2.1 Core Service Definition

**Clipper Project provides a clip creation and distribution managed service.**

Specifically, the operator:
- Accepts a structured creative brief from a registered requester
- Accepts up to 5 uploaded video/image files as source material
- Produces a professionally edited promotional video of up to 30 seconds in length
- Publishes the video to one or more social media and delivery channels selected by the operator
- Returns the published links to the requester's dashboard

The service **does not include**:
- Providing stock footage or music libraries to requesters (though the operator may use licensed resources internally)
- Giving requesters the raw project file, source layers, or editable Canva/project file
- Guaranteeing specific platform-level performance metrics (views, reach, engagement)
- Reposting or managing the requester's own social media profiles

### 2.2 Value Proposition for Requesters

| Value Dimension | Description |
|---|---|
| **Convenience** | Requesters submit a brief and files — no editing skills required |
| **Speed** | Standard turnaround target of 2 working days after acceptance |
| **Distribution access** | Content is published across established social channels without requester managing accounts |
| **Low barrier** | 30 free credits mean first-time users can try the service at no cost |
| **Consistent quality** | Operator enforces production standards; requesters do not manage freelancers |
| **Single touchpoint** | One dashboard tracks status, queue position, links, and credits |

### 2.3 Value Proposition for the Operator / Operations Team

| Value Dimension | Description |
|---|---|
| **Structured intake** | All requests arrive via a validated form; no ambiguity from informal channels |
| **Credit-based gate** | Credits prevent spam requests and ensure economic sustainability |
| **Content library and reach** | Operator builds a portfolio of clips published under its channels |
| **Quality control authority** | Operator has formal policy rights to reject unsuitable materials |
| **Operations scalability** | Queue system and status workflow allow staff to manage multiple requests in parallel |
| **IP ownership** | Final edited outputs remain operator IP, building a content asset base |

### 2.4 The Role of Credits

Credits serve multiple business functions simultaneously:

- **Access control:** Credits act as the unit of service consumption. A requester without credits cannot submit a new request.
- **Spam and abuse prevention:** By limiting free credits and requiring credit spend per submission, the system naturally discourages low-effort or mass-spam submissions.
- **Economic model foundation:** The credit model is the monetization primitive. Future paid credit top-ups, subscription plans, or bundles can all be expressed in credits without changing the underlying request logic.
- **Operational throttle:** Each credit spend commits the operator to a production effort, creating a soft ceiling on unmanaged volume.

**Phase 1 credit rules (fixed):**
- New requester receives **30 free credits** upon account creation (once per unique account).
- One request (one max-30-second clip) costs **10 credits**.
- Therefore, a new requester can submit **up to 3 requests** with free credits.

> **Note on credit sale:** Phase 1 does not include credit purchase. Credit top-ups, paid plans, or bundles are deferred to a future phase. However, the business rules defined here must be designed to support credit purchase without structural redesign.

---

## 3. USER ROLES AND RESPONSIBILITIES

### 3.1 Role: Requester

**Who they are:** Any individual or small business that registers on the platform to request clip production services.

#### 3.1.1 What Requesters Can Do

- Create and manage their account (Google login or email registration)
- View their current credit balance
- Submit clip requests by completing a brief and uploading up to 5 files
- View the status, queue position, and estimated/confirmed due date for each request
- View delivery links for completed requests
- Reshare or repost the final delivered clip on their own personal or business social channels
- Contact support (when support channels are defined in future phases)

#### 3.1.2 What Requesters Cannot Do

- Edit, revise, or alter a request brief after it has been submitted (status: Submitted or later)
  > **Policy note:** Modifications to submitted requests create operational complexity. If a requester wishes to change their brief, the appropriate path is to accept a rejected or on-hold status and resubmit.
- Request a specific staff member or editor
- Dictate which social media channels the final clip is published to (this is at operator discretion)
- Claim full copyright or exclusive ownership of the final edited output
- Download the raw project file or source editing layers
- Recover uploaded source files after the 90-day deletion window has passed
- Demand a specific editing style that overrides operator production standards
- Submit content that violates the platform's content and materials policy

#### 3.1.3 Requester Responsibilities

- Providing complete, accurate, and truthful information in the clip brief
- Uploading only materials they have the legal right to use
- Confirming at submission that they have the necessary rights to uploaded materials
- Confirming credit usage at submission
- Accepting the platform's terms of service and policies at signup

#### 3.1.4 Requester Risks and Pain Points

| Risk / Pain Point | Mitigation Strategy |
|---|---|
| Misunderstanding the ownership model (expecting to own the final output) | Clear policy wording at signup and at submission |
| Submitting unusable footage and being rejected | Provide quality guidelines before submission |
| Running out of credits with no way to top up (Phase 1 limitation) | Communicate clearly that top-ups are a future feature |
| Uncertainty about when their clip will be ready | Queue visibility, confirmed due date model, status updates |
| Source files deleted before they could retrieve them | Clear notice at upload; 90-day window disclosure |
| Request rejected without clear understanding of why | Require staff to provide a rejection reason |

---

### 3.2 Role: Staff

**Who they are:** The operator's in-house production team members. Staff are responsible for reviewing requests, editing video content, publishing to channels, and managing the production queue.

#### 3.2.1 What Staff Can Do

- View all submitted requests in the staff dashboard
- Move requests through the defined status workflow
- Mark a request as Under Review, Accepted for Production, Editing, Scheduled for Publishing, Published, Delivered, On Hold, or Rejected
- Review system-estimated due dates and confirm them with an explicit action
- Adjust the estimated effort classification (Simple / Standard / Complex) before confirming a due date
- Place a request On Hold with a reason
- Reject a request with a mandatory rejection reason
- Upload or record the final published video links
- View queue position and workload summary for operational planning
- Internally note issues with a request (notes visible to staff and admin only, not requester)

#### 3.2.2 What Staff Cannot Do

- Grant or manually adjust requester credit balances (admin-only action in Phase 1)
- Permanently delete requester accounts
- Access or modify platform configuration settings
- Override confirmed due dates unilaterally without admin awareness (policy constraint, not necessarily technical block in Phase 1)
- Share or download requester source files outside of the production workflow
- Accept a request that violates the content policy (they must escalate to admin or reject)

#### 3.2.3 Staff Responsibilities

- Reviewing each submitted request promptly and accurately
- Making effort classification decisions fairly and consistently
- Confirming due dates within a defined window after acceptance (see Section 13)
- Producing video content that meets platform quality standards
- Publishing content to the designated channels
- Recording final delivery links in the system
- Moving requests through statuses accurately and promptly
- Documenting rejection reasons clearly and professionally

#### 3.2.4 Staff Risks and Pain Points

| Risk / Pain Point | Mitigation Strategy |
|---|---|
| Forgetting to confirm the due date after acceptance | System reminder or escalation notification |
| Queue overload during high-volume periods | Admin can monitor and intervene; queue visibility tools |
| Ambiguous or borderline content submissions | Clear content policy; escalation path to admin |
| Requester materials are unusable but request is already Accepted | On Hold status with clear requester notification |
| Missing published links (platform didn't go live as expected) | Defined handling for delayed publishing; partial delivery protocol |

---

### 3.3 Role: Admin

**Who they are:** The platform operator's administrative authority. Admin has full visibility and governance control over the platform.

#### 3.3.1 What Admins Can Do

- All actions available to staff
- Manage and create staff accounts
- Manually adjust requester credit balances (with documented reason)
- Override, reassign, or escalate any request at any status
- View full audit/activity logs for all requests and accounts
- Configure platform settings (future phases)
- Access financial and operational reports
- Manage the content policy and exception governance
- Handle requester disputes and escalations
- View queue-wide workload and capacity data
- Issue platform announcements or service notices (future phases)

#### 3.3.2 What Admins Cannot Do

- Act outside the defined status flow without documented justification
- Grant unlimited credits without an operational policy backing
- Alter this core policy document without a formal review process

#### 3.3.3 Admin Responsibilities

- Setting and enforcing platform policy
- Monitoring queue health and staff workload
- Reviewing exceptional cases (ambiguous content, disputed rejections, missed due dates)
- Maintaining quality standards over time
- Approving any deviations from standard operating procedure

#### 3.3.4 Admin Risks and Pain Points

| Risk / Pain Point | Mitigation Strategy |
|---|---|
| Lack of visibility into queue health | Admin dashboard with queue summary and workload metrics |
| Staff acting inconsistently on rejections | Rejection reason templates and policy documentation |
| Requester disputes over credit deductions | Clear credit policy and transaction log visible to admin |
| Platform used for abusive or illegal content | Content policy with escalation and rejection authority |

---

## 4. ACCOUNT AND SIGNUP RULES

### 4.1 Supported Signup Methods

Phase 1 supports exactly two signup pathways:

**Option A — Google Account Signup/Login**
- Requester authenticates via Google OAuth
- The platform reads the user's Google display name and verified email address
- No additional email verification step is required (Google has already verified the email)
- The platform should confirm at first login whether the requester agrees to the Terms of Service and Privacy Policy

**Option B — Email Registration**
- Requester enters their name and email address and creates a password
- The platform sends an email verification link to confirm the address
- Account is not activated (cannot submit requests or receive free credits) until email is verified
- Unverified accounts older than 7 days with no verification action should be considered inactive and subject to cleanup (implementation detail for later phases)

> **Design principle:** Do not request company name, phone number, or social media handle at signup. Requesters are individuals first; business affiliation is implied but not required.

### 4.2 Required Fields at Signup

| Field | Required? | Notes |
|---|---|---|
| Full name | Yes | Display name for the account |
| Email address | Yes | Must be a valid, verified email |
| Password | Yes (email signup only) | Must meet minimum security requirements |
| Google account | Yes (Google signup only) | Replaces email + password |
| Agreement to Terms of Service | Yes | Checkbox confirmation required before account creation |
| Agreement to Privacy Policy | Yes | Checkbox confirmation required before account creation |
| Agreement to Content and Materials Policy | Yes | Checkbox or inline notice confirmation at signup |

> **What is NOT collected at signup:** Company name, phone number, social media handles, billing information (Phase 1 is credit-only with no purchases).

### 4.3 Free Credit Grant — "Once Per Unique User" Policy

The 30 free credits are granted **once per unique account**, at the point of account activation.

- For Google accounts: credits are granted immediately upon first successful Google OAuth login and Terms of Service acceptance.
- For email accounts: credits are granted upon email verification completion.
- Credits are **not** retroactively granted if the account was created but Terms of Service were accepted at a later date.

**Uniqueness definition for Phase 1:**
- One account per email address
- Google accounts and email accounts sharing the same email address are treated as one user
  > **Implementation note (for later phases):** The system should detect if a Google email matches an existing email-registered account and prompt the user to merge or log into their existing account, rather than creating a duplicate.

### 4.4 Anti-Abuse Considerations for Free Credits

Free credits create an obvious abuse vector: a bad actor could create many accounts to harvest free credits for multiple free submissions. Phase 1 should address this as a **policy risk** and lay groundwork for mitigations:

| Abuse Vector | Policy Mitigation | Technical Mitigation (Later Phase) |
|---|---|---|
| Multiple email accounts | Terms prohibit duplicate account creation for credit farming | Email domain/IP analysis |
| Disposable email addresses | Platform reserves right to reject unrecognized email domains | Email domain blocklist |
| Multiple Google accounts | Terms prohibit use of multiple accounts for credit gain | Cross-account identity matching |
| Referral or invitation abuse | No referral program in Phase 1 | N/A |

**Policy wording for Terms of Service:**
> "Each individual may register only one Clipper Project account. Creating multiple accounts for the purpose of obtaining additional free credits, or for any other reason, is a violation of these Terms of Service and may result in termination of all associated accounts and forfeiture of any credits held therein."

### 4.5 Treatment of Inactive Users

Define an inactive user as a registered account that has:
- Never submitted a request, AND
- Has not logged in within 180 days of account creation

**Phase 1 Policy (no automated enforcement in MVP, but policy must exist):**
- Inactive accounts with unused free credits will have those credits subject to expiry after 12 months of inactivity.
- Requester will receive an email notification before credit expiry (30 days notice). *(Email notification system is a future-phase implementation.)*
- Account data is retained but credits may be flagged as expired in the system.

> **Rationale:** This prevents permanent, dormant free-credit liabilities accumulating on the platform. However, since Phase 1 does not implement paid credit purchases, this is primarily a hygiene policy rather than a financial urgency.

### 4.6 Recommended Terms and Consent Acknowledgments at Signup

The following consents should be obtained and recorded at signup:

1. **Terms of Service** — Requester confirms agreement to the platform's full Terms of Service.
2. **Privacy Policy** — Requester confirms they have read and accepted the Privacy Policy, including how their data is stored and used.
3. **Content and Materials Policy** — Requester acknowledges that submitted materials are subject to the platform's content policy and may be rejected at the operator's discretion.
4. **Credit and Service Policy** — Requester acknowledges that credits are consumed per request and that the 30 free credits are a one-time welcome grant.
5. **Ownership and Usage Rights Notice** — Requester acknowledges that the final edited video output belongs to the operator and that the requester receives a limited right to reshare, not ownership of the master asset.

**Recommended approach:** Present all five consent items as a grouped acknowledgment with inline summary text and a link to the full policy document for each item. Require a single "I agree to all of the above" checkbox before allowing account creation. Do not allow the signup to proceed without this confirmation.

---

## 5. CREDIT SYSTEM RULES

### 5.1 Credit Model Overview

| Parameter | Value |
|---|---|
| Starting credits (new requester) | 30 credits |
| Cost per request | 10 credits |
| Maximum requests with free credits | 3 |
| Credit purchase | Not available in Phase 1 |
| Credit expiry | 12 months of account inactivity (policy exists; enforcement deferred) |
| Credit transfers between accounts | Not permitted |
| Credit refunds to cash | Not applicable (Phase 1 — no paid credits) |

### 5.2 Credit Lifecycle: When Credits Move

Credits go through three states in their lifecycle:

| State | Definition |
|---|---|
| **Available** | Credits are in the requester's balance and free to use |
| **Reserved** | Credits have been committed to a request but not yet permanently deducted |
| **Deducted** | Credits have been permanently consumed |

#### 5.2.1 When Credits Are Reserved

Credits are reserved at the moment the requester **submits a request** (status moves from Draft to Submitted).

- 10 credits move from **Available** to **Reserved** at submission.
- The requester's displayed balance should show Available balance only (reserved credits are committed and not spendable).
- A requester with only 9 or fewer available credits cannot submit a new request.
- Reserved credits remain reserved until a terminal event (acceptance or rejection) occurs.

> **Rationale for reservation:** Reserving credits at submission prevents a requester from double-spending the same credits on multiple submissions while one is pending review. It also prevents a bad actor from submitting many requests and then abandoning them if credits are only deducted on acceptance.

#### 5.2.2 When Credits Are Permanently Deducted

Credits are permanently deducted when a request reaches **Accepted for Production** status.

- At the moment staff moves a request to Accepted for Production, the 10 reserved credits are converted from Reserved to Deducted.
- This is an irreversible action in the standard flow.

#### 5.2.3 When Credits Are Refunded

Credits are returned to **Available** (reservation is cancelled) in the following cases:

| Scenario | Credit Action |
|---|---|
| Staff rejects the request (Rejected status) | 10 reserved credits returned to Available |
| Staff places request On Hold due to unusable materials before acceptance | 10 reserved credits remain Reserved until resolution; see On Hold rules below |
| Requester cancels a Submitted request (if cancellation is permitted before Under Review) | 10 reserved credits returned to Available |
| Technical error during submission causes request not to complete | 10 reserved credits returned immediately |

#### 5.2.4 Credits and On Hold Status

When a request is placed On Hold:
- If the request was **not yet Accepted for Production** at the time it was placed On Hold, credits remain Reserved (not refunded, not deducted).
- If the request was placed On Hold **after Accepted for Production**, credits have already been deducted and are not refunded.
- When an On Hold request resumes (staff lifts the hold and continues), credits stay in their current state.
- If an On Hold request is subsequently Rejected, the standard rejection refund rule applies based on when deduction occurred.

### 5.3 Treatment of Rejected Requests

When staff rejects a request at any pre-acceptance status:
- Reserved credits are fully refunded to Available.
- The requester is notified of the rejection and the reason.
- The requester may submit a new, corrected request using the returned credits.

### 5.4 Treatment of Requester-Cancelled Requests

> **Phase 1 Policy Decision Required:** See Section 17 for open questions.

**Recommended Phase 1 policy:**
- Requesters may cancel a request **only before it reaches Under Review** (i.e., while it is still in Submitted status with no staff action taken).
- If the request is at Under Review or later, the requester cannot cancel self-serve. They must contact support/admin.
- For admin-approved cancellations after Under Review but before Accepted for Production: credits are refunded at admin discretion.
- For cancellations after Accepted for Production: credits are **not refunded**, as production work has been initiated.

> **Rationale:** Once staff have begun reviewing or have accepted a request, operator time and resources have been committed. A clean cancellation boundary at Under Review protects both parties.

### 5.5 Credit Policy Matrix

| Event | Available Credits | Reserved Credits | Deducted Credits |
|---|---|---|---|
| Account created, email verified | +30 (granted) | 0 | 0 |
| Request submitted (Draft → Submitted) | -10 (reserved) | +10 | 0 |
| Request accepted (Submitted → Accepted for Production) | 0 | -10 (consumed) | +10 |
| Request rejected (any pre-acceptance status → Rejected) | +10 (refund) | -10 (released) | 0 |
| Request cancelled by requester (Submitted only) | +10 (refund) | -10 (released) | 0 |
| Request placed On Hold (pre-acceptance) | 0 | stays reserved | 0 |
| Request delivered (terminal — no credit change) | 0 | 0 | 0 (already deducted) |
| Technical failure during submission | +10 (auto-refund) | -10 (released) | 0 |

### 5.6 Abuse Prevention for Credits

- Credit grants are one-time per account; system should enforce this at the data level.
- Staff and admin can view credit transaction history for any account.
- Admin has authority to void credits granted to accounts suspected of abuse.
- Multiple submissions followed by self-cancellation to "hold" a queue slot without intent to produce should be flagged as potential abuse.

### 5.7 Credit Visibility in Dashboard

Requester dashboard must display:
- **Total credits:** Available + Reserved
- **Available credits:** Credits free to use for new requests
- **Reserved credits:** Credits committed to a pending/active request
- **Deducted credits history:** A log showing when and how credits were consumed or refunded

Staff and admin dashboards must display, for any requester account:
- Full credit balance breakdown
- Full credit transaction log with timestamps and events

---

## 6. REQUEST SUBMISSION RULES

### 6.1 Clip Request Form — Required Fields

The clip request form collects the following information:

| Field | Type | Required? | Notes |
|---|---|---|---|
| Clip title | Text (short) | Yes | Internal reference title for the request |
| Clip description | Text (long) | Yes | Describes what the clip should communicate |
| Target audience | Text | Yes | Who the clip is intended for |
| Target platform(s) | Multi-select | Yes | e.g., TikTok, Instagram, Facebook, YouTube, Tvent, CDN/Link |
| Preferred style/tone | Text or select | Yes | e.g., energetic, professional, casual, cinematic |
| Preferred language | Select | Yes | Language for any text/voiceover used in the clip |
| File uploads | File upload (max 5) | Yes (at least 1) | Video and/or image files |
| Credit usage confirmation | Checkbox | Yes | Must explicitly confirm that 10 credits will be consumed |
| Material rights confirmation | Checkbox | Yes | Must confirm they have rights to upload the submitted materials |

**What the form does NOT include:**
- Company or brand name
- Phone number
- Social media handles
- Optional reference links / mood board URLs
- Subtitle or caption requirements

> **Design note on preferred style/tone:** For Phase 1, this can be a free-text field. In Phase 2+, it may evolve into a structured selector (e.g., choose from 4-5 styles). Keep it open-ended for now to avoid constraining the MVP.

### 6.2 File Upload Rules

| Rule | Specification |
|---|---|
| Maximum number of files | 5 per request |
| Accepted file types | Common video formats (MP4, MOV, AVI) and image formats (JPG, PNG, HEIC) |
| Minimum files required | 1 file (at least one file must be uploaded) |
| Maximum file size per file | To be defined in Phase 2 (recommend 500MB per file as a starting point) |
| Total upload size limit | To be defined in Phase 2 |
| File naming | System assigns internal identifiers; requester filenames are preserved for reference |
| Uploaded file ownership | Requester warrants they own or have rights to all uploaded files |

### 6.3 What Counts as One Request

One request is defined as:
- One submitted clip brief (one set of fields as described in 6.1)
- Up to 5 uploaded files associated with that brief
- One deduction of 10 credits

**Important constraints:**
- One request produces one final edited clip of up to 30 seconds.
- A request cannot span multiple clips or multiple outputs.
- If a requester wants two separate clips, they must submit two separate requests, each costing 10 credits.
- A request cannot be split or merged with another request after submission.

### 6.4 Maximum Duration Policy

- All final clips are capped at **30 seconds** in length.
- Requesters should not expect longer output even if they upload longer source footage.
- The 30-second limit applies to the final edited and published clip, not the raw uploaded materials.
- Staff will select, edit, and cut materials to fit within the 30-second limit at their professional discretion.

### 6.5 Accepted Material Scope

Acceptable uploaded materials include:
- Short video clips relevant to the described brief
- Still images or photos relevant to the brief
- Brand asset images (logos, product photos, event photos)
- Screen recordings (if relevant and of sufficient quality)

Materials that are unlikely to be usable but not automatically rejected:
- Very low-resolution footage (staff will note this and may place request On Hold or reject)
- Vertically filmed footage intended for horizontal output (staff will note and adapt if possible)

Materials that will result in rejection or On Hold (see Section 7 for full policy):
- Copyrighted material the requester does not have rights to use
- Explicitly prohibited content categories
- Footage that is wholly irrelevant to the stated brief

### 6.6 Missing or Incomplete Information Policy

If a request is submitted with:
- A vague or uninformative clip description
- No clear target audience
- File uploads that appear unrelated to the described brief

**Staff may:**
1. Place the request On Hold and send a standardized note requesting clarification from the requester.
2. Reject the request outright if the materials are so incomplete or unclear that no production is possible.

> **Phase 1 limitation:** The platform does not have an in-app messaging system in Phase 1. "Sending a note" means the On Hold status should include a visible reason/message field that appears in the requester's dashboard. Direct two-way messaging is a Phase 2+ feature.

### 6.7 If Staff Need More Information After Submission

The defined mechanism for information gaps is the **On Hold** status, used **before** Accepted for Production where possible.

**Standard practice:**
1. Staff reviews the submission during Under Review.
2. If information is insufficient but materials exist, staff places the request On Hold with a specific note visible to the requester.
3. Requester reads the note in their dashboard and understands what is needed.
4. Since Phase 1 lacks two-way messaging, the requester cannot directly reply. The intended resolution is:
   - Requester either accepts that the request will proceed as-is (staff's professional judgment), OR
   - Requester submits a new request with better materials (current request can be Rejected with credit refund to enable resubmission)

> **Open question flagged in Section 17:** Should Phase 2 include an in-app messaging or clarification thread per request? Strongly recommended.

### 6.8 Request Acceptance Criteria

For a request to be accepted from Under Review into Accepted for Production, it must meet all of the following:

| Criterion | Pass Condition |
|---|---|
| Complete brief | All required fields are filled meaningfully |
| Usable materials | At least one uploaded file is of sufficient quality to use in production |
| Rights confirmation | Requester has checked the rights confirmation box at submission |
| Policy compliance | No uploaded material violates the content policy |
| Clear creative direction | Brief provides enough creative context for staff to produce the clip |
| Platform compliance | Requested target platform(s) are supported by the operator |

If all criteria are met: request moves to Accepted for Production.
If any criterion fails: request is placed On Hold (if fixable) or Rejected (if not).

---

## 7. CONTENT AND MATERIALS POLICY

### 7.1 Overview and Purpose

This policy defines what submitted materials the operator will and will not accept for production. Its purpose is to:
- Protect the operator from legal, reputational, and regulatory risk
- Set clear expectations for requesters before they invest time in a submission
- Give staff a formal policy basis for rejection decisions
- Ensure published content across operator channels maintains quality and legal compliance

### 7.2 Requester Warranty at Submission

At the point of submission, the requester must confirm the following warranty (checkbox):

**Recommended Warranty Wording:**
> "I confirm that I have the legal right to upload all files included in this request, including all footage, images, music, logos, and any other materials. I accept full responsibility for any third-party claims arising from materials I have submitted. I understand that Clipper Project may reject my request if any submitted material is found to violate applicable law or these policies."

This warranty is a contractual statement, not merely a UX checkbox. It should be referenced in the Terms of Service and creates a documented basis for the operator to reject requests and to hold the requester responsible for damages if they breach this warranty.

### 7.3 Absolutely Prohibited Content

The following content will **never** be accepted and will result in immediate Rejection, and may result in account suspension:

| Category | Examples |
|---|---|
| Illegal content | Any content prohibited by applicable law |
| Child exploitation | Any content involving minors in a sexual or exploitative context |
| Hate speech | Content that promotes discrimination based on race, religion, gender, sexuality, disability, nationality, or other protected characteristics |
| Graphic violence or gore | Content depicting real or realistic graphic injury, death, or torture |
| Harassment or defamation | Content targeting a specific individual with intent to harass, intimidate, or defame |
| Fraudulent or deceptive advertising | Content designed to deceive consumers about a product or service in a materially misleading way |
| Pornographic content | Any sexually explicit material |
| Terrorist or extremist content | Content promoting or glorifying violence or extremist ideologies |

### 7.4 Content Requiring Staff Review and Possible Rejection

The following content categories are not automatically prohibited but require careful staff review and may be rejected at the operator's sole discretion:

| Category | Staff Action |
|---|---|
| Alcohol and gambling advertising | Review for compliance with platform channel policies; may be rejected for certain channels |
| Health and medical claims | Review for misleading claims; consult policy before accepting |
| Political or advocacy content | Case-by-case; operator may decline political advertising |
| Content involving minors (non-exploitative) | Must comply with all applicable child protection laws; requires careful review |
| Firearms, weapons, or dangerous goods | Review for legal compliance in the requester's apparent jurisdiction |
| Financial products and services | Review for regulatory disclosure compliance |
| Competitor attack advertising | May be declined at operator discretion |

### 7.5 Poor Quality or Unusable Footage

Staff may place a request On Hold or Reject it if:
- Uploaded video is too blurry, dark, or distorted to use professionally
- Audio quality is so poor that no usable audio extract is possible
- Footage is completely irrelevant to the stated brief
- File is corrupt or cannot be opened
- All uploaded files together are insufficient to produce a coherent 30-second clip

**Staff guidance:** Use On Hold for borderline cases where the requester might be able to resubmit better materials. Use Rejection only when the materials are definitively unusable and no path to production exists.

### 7.6 Copyright and Third-Party Rights

**Uploaded third-party content:**
- Requesters may not upload footage, music, or imagery that they do not have rights to use.
- Common prohibited examples: background music from commercial recordings, news footage, other creators' videos.
- Staff should flag obvious third-party copyright materials (e.g., recognizable commercial music in the background of footage) and note this in the On Hold reason or Rejection reason.

**Operator's own content in the output:**
- The operator may use licensed stock assets, royalty-free music, or platform-licensed resources (e.g., Canva's licensed library) in the production of the final clip.
- The operator will not use commercial music or unlicensed third-party content in final outputs.

### 7.7 Misleading or Unlawful Advertising Claims

The operator reserves the right to refuse production if the clip brief requests content that:
- Makes false, unsubstantiated, or misleading factual claims about a product or service
- Mimics or impersonates another brand, business, or public figure
- Contains testimonials or endorsements that are fabricated
- Promotes a scheme or product that appears to be fraudulent

### 7.8 Operator Discretion

**Recommended policy wording for Terms of Service:**
> "Clipper Project reserves the right, at its sole discretion, to decline, reject, or place on hold any clip request that it determines, in good faith, may violate applicable law, platform content policies, or the standards of the channels on which the content would be published. The operator's decision on content suitability is final. A rejection on content grounds will result in a full credit refund to the requester's account."

---

## 8. OWNERSHIP, LICENSE, AND USAGE RIGHTS

### 8.1 Overview

This section defines the intellectual property structure of the Clipper Project service. It is critically important to establish this clearly because the platform involves two distinct creative objects:

1. **Raw uploaded materials** — owned by the requester or a third party
2. **Final edited output** — created by the operator using those materials

These two objects have different ownership and licensing implications.

### 8.2 Raw Uploaded Materials — Ownership and License

**Ownership:**
Raw uploaded files (videos, images) remain the property of the requester (or the third-party owner, if the requester is using materials they have licensed from someone else).

**License granted to operator:**
By submitting a request, the requester grants the operator a **limited, non-exclusive, royalty-free license** to:
- Access, view, and use the uploaded materials for the sole purpose of producing the requested clip
- Store the materials on the operator's file storage infrastructure (DigitalOcean Spaces) for the duration of the production and for up to 90 days thereafter
- Edit, cut, transform, and adapt the materials as part of the production process

This license **does not** include:
- Using the uploaded materials in any other project, request, or production
- Publishing or distributing the raw uploaded materials independently
- Licensing the raw materials to any third party
- Retaining the raw materials beyond the 90-day deletion window

### 8.3 Final Edited Output — Ownership

**The final edited video output is the sole property of the operator (Clipper Project).**

This ownership position is based on the following principles:
- The operator's staff performed the creative editing, assembly, and production work
- The operator has applied its brand standards, creative judgment, and production tools
- The operator publishes the final output on its own channels under its own publishing authority

> **Important clarification for requesters:** Ownership of the final edited output does not mean the operator strips the requester's materials from it. It means that the assembled, edited creative work — the specific combination, sequencing, transitions, text, music, and visual treatment — is the operator's creative output.

### 8.4 Requester's Right to Reshare

Notwithstanding operator ownership of the final edited output, the requester is granted a **perpetual, non-exclusive, royalty-free license** to:
- Reshare, repost, and distribute the final published clip across their own personal and business social media channels
- Embed the final clip in their own website or marketing materials
- Reference or link to the published clip in their own content

This license **does not** include:
- Claiming authorship or sole copyright of the final edited clip
- Selling, sublicensing, or transferring rights to the final clip to any third party for commercial gain
- Altering, modifying, or creating derivative works from the final edited clip
- Removing or obscuring any credits, watermarks, or attributions the operator may place on the final clip

### 8.5 Operator's Publication Rights

The operator has the right to:
- Publish the final edited clip on any channel it operates (TikTok, Instagram, Facebook, YouTube, Tvent, CDN, etc.)
- Use the final edited clip as part of the operator's content portfolio and marketing
- Retain the final edited clip indefinitely as an asset on its channels

### 8.6 Recommended Commercial/Legal Structure

#### 8.6.1 Plain-English Policy Summary

> "When you upload files to Clipper Project, you keep ownership of those files. You're giving us permission to use them to make your clip. Once we've made the clip, the finished video belongs to us — it's our creative work. But you can freely share, repost, and use the finished clip on your own channels and website for free, forever. You just can't sell the clip to someone else or claim you own the copyright to it."

#### 8.6.2 Formal Policy Wording (for Terms of Service inclusion)

> **Section X: Intellectual Property and Usage Rights**
>
> **X.1 Uploaded Materials**
> You retain all intellectual property rights in the source materials you upload to the Clipper Project platform ("Uploaded Materials"). By submitting a clip request, you grant Clipper Project a limited, non-exclusive, royalty-free, worldwide license to use, store, reproduce, edit, transform, and adapt your Uploaded Materials solely for the purpose of fulfilling your clip request. This license terminates upon deletion of your Uploaded Materials in accordance with our Storage and Retention Policy.
>
> **X.2 Warranty Regarding Uploaded Materials**
> By submitting a clip request, you represent and warrant that you own or have obtained all necessary rights, permissions, and consents to upload and use the Uploaded Materials for the purpose of clip production. You agree to indemnify and hold Clipper Project harmless from any third-party claims arising from your breach of this warranty.
>
> **X.3 Final Edited Output**
> All rights, title, and interest in the final edited video clip produced by Clipper Project ("Final Output") vest solely in Clipper Project. The Final Output is the creative work of Clipper Project's production team and constitutes an original work of authorship owned by Clipper Project.
>
> **X.4 Requester License to Reshare**
> Subject to your continued compliance with these Terms of Service, Clipper Project grants you a perpetual, non-exclusive, royalty-free license to reshare, repost, and display the Final Output on your own personal and business social media channels and digital properties. This license does not permit you to sell, sublicense, modify, create derivative works from, or transfer the Final Output or any rights therein to any third party.
>
> **X.5 Operator Publication Rights**
> Clipper Project retains the right to publish and distribute the Final Output on any channels it operates, to include the Final Output in its content portfolio, and to use the Final Output for marketing or promotional purposes without any additional compensation to you.

### 8.7 Protection If Requester Uploads Without Authority

If it becomes apparent that a requester has uploaded materials they do not have rights to:
- The request will be Rejected immediately.
- Credits are refunded (consistent with content rejection policy).
- The operator is not liable for the requester's breach of their warranty.
- The operator will take reasonable steps to delete the unauthorized materials from its storage.
- In serious cases (e.g., large-scale copyright infringement), the account may be suspended.
- The operator may disclose requester information to rights holders or law enforcement if legally required.

---

## 9. STORAGE, RETENTION, AND FILE HANDLING POLICY

### 9.1 Business Context and Rationale

Clipper Project uses **DigitalOcean Spaces** as its file storage layer. The following policy governs how uploaded raw materials and final outputs are stored, retained, and deleted.

**Why uploaded raw media is NOT treated as a requester asset library:**
- The platform is a production service, not a cloud storage service.
- Treating uploads as a persistent asset library creates indefinite storage liability, cost, and complexity.
- Requesters who need access to their source materials should maintain their own copies.
- Permanent storage of large video files would significantly increase infrastructure costs.
- The production workflow is sequential and not designed for asset reuse across requests.
- Regulatory and privacy exposure increases with the volume of personally identifiable or business-sensitive footage retained long-term.

### 9.2 Storage Classification

| File Type | Description | Retention Period |
|---|---|---|
| Raw uploads (source files) | Videos and images uploaded by requester for a specific request | 90 days from upload date |
| Final edited output (produced clip) | The finished video produced by staff | Retained by operator indefinitely (or per a separate content retention policy to be defined) |
| Request metadata | Brief fields, status history, timestamps, links | Retained for the life of the account |
| Account data | Name, email, preferences | Retained per Privacy Policy |

### 9.3 Raw Uploads Deletion Policy

- Raw uploaded source files are automatically deleted **90 days from the date of upload**, regardless of request status.
- This applies whether the request is Delivered, On Hold, Rejected, or in any other status.
- Deletion is permanent and non-recoverable.
- Requesters should be informed of this at submission and should maintain their own copies of uploaded files.
- The 90-day window is chosen to cover the full production lifecycle (typically 2 working days) plus a generous buffer for On Hold cases, exceptions, and dispute resolution.

### 9.4 Final Output Retention

- Final edited clips published to social channels are retained on those channels per each channel's own policies.
- Final clips stored on the operator's CDN or server are subject to the operator's own content retention strategy.
- For Phase 1, define the final output as **retained indefinitely** on the operator's channels.
- The delivery link in the requester's dashboard should remain accessible as long as the clip remains live on the publishing channel.
- If a final clip is taken down from a channel (for platform policy reasons or operator decision), the delivery link may become inactive.

### 9.5 Operational Implications for Staff

- Staff should download raw uploaded files from Spaces to their production environment promptly after a request is accepted.
- Staff should not rely on raw uploads remaining accessible beyond the 90-day window.
- Completed final clips should be uploaded to publishing channels promptly and the delivery links recorded in the system.
- Staff should treat raw uploaded files as temporary working files, not as persistent references.

### 9.6 If Requester Asks for Their Old Raw Files

**Policy:**
> "We do not store your uploaded source files as a permanent library. Uploaded source files are automatically deleted 90 days after upload. We are unable to retrieve files that have been deleted. We recommend that you keep a copy of all files you upload to our platform."

If a requester asks for raw files within the 90-day window and the files have not yet been deleted:
- Phase 1 policy does not require the operator to provide raw file retrieval as a service.
- The operator may assist at its discretion but is not obligated to do so.

### 9.7 If Requester Wants to Reuse Materials in a New Request

- Requesters who wish to use similar or identical materials in a future request must upload those files again as part of the new request submission.
- The platform does not support "select from previous uploads" for source files.
- Requesters are responsible for retaining their own copies of source materials.

### 9.8 Requester-Facing Wording

#### 9.8.1 Submission Page Notice

> **About your uploaded files:**
> Files you upload are used to create your clip and are stored temporarily. Uploaded source files are automatically deleted 90 days after upload and cannot be recovered after deletion. Please keep your own copies of any files you upload.

#### 9.8.2 Formal Policy Wording (for Terms of Service / Privacy Policy inclusion)

> **File Storage and Retention**
>
> Uploaded source files (videos and images submitted as part of a clip request) are stored on Clipper Project's file storage infrastructure (DigitalOcean Spaces) solely for the purpose of fulfilling your clip request. Uploaded source files are not retained as a permanent asset library and will be automatically deleted 90 days from the date of upload, without notice.
>
> Clipper Project is not obligated to retain, archive, or return your uploaded source files. You are responsible for maintaining your own copies of any files you upload. Clipper Project accepts no liability for any loss of source files following their deletion in accordance with this policy.

#### 9.8.3 FAQ-Style Wording

**Q: Do you keep the files I upload?**
> We keep your uploaded files temporarily for the purpose of making your clip. Files are automatically deleted 90 days after you upload them. We don't store them permanently, so please make sure you keep your own copy of everything you upload.

**Q: Can I get my uploaded files back after my clip is done?**
> We don't offer a file retrieval service. Your uploaded files are stored temporarily for production purposes only. We recommend downloading or saving your files before uploading, just in case you need them again later.

**Q: Can I reuse the same files for a future request?**
> Yes — you'll just need to upload them again when you submit your next request, since we don't maintain a personal file library for each requester.

---

## 10. SERVICE LEVEL / TURNAROUND POLICY

### 10.1 Standard Service Expectation

**Business rule:** The operator targets completion of a clip within **2 working days** from the point of acceptance of a complete and usable request.

This is a **service target**, not an unconditional guarantee. The 2-working-day standard applies under normal operating conditions, after the request has been:
- Accepted for Production (passed Under Review)
- Found to contain complete and usable materials
- Added to the production queue

### 10.2 What "Working Days" Means

| Definition Component | Interpretation |
|---|---|
| Working days | Monday through Friday, excluding public holidays observed by the operator |
| Working hours | Defined by the operator (e.g., 9 AM – 6 PM local time) |
| Holiday calendar | Operator's public holiday schedule (to be defined) |
| Time zone | Operator's primary operating time zone (to be defined) |

> **Action required:** The operator must define its official business hours and public holiday schedule before Phase 2.

### 10.3 What Pauses the Clock

The 2-working-day SLA clock is paused (does not count toward the target) during:

| Pause Trigger | Resume Condition |
|---|---|
| Request placed On Hold | Clock resumes when On Hold is lifted and production resumes |
| Materials found unusable and requester notified | Clock does not start until usable materials are confirmed |
| Public holiday (per operator's calendar) | Clock resumes on next working day |
| System outage or force majeure | Clock is paused at admin discretion |

### 10.4 What Delays the Process

Factors that may cause production to exceed the 2-working-day target:

| Delay Factor | Description |
|---|---|
| Queue overload | Higher-than-normal submission volume may push the confirmed due date beyond 2 days |
| Complex request | A request classified as Complex requires more editing time |
| Channel publishing delays | Third-party platforms (e.g., TikTok upload review) may delay publishing beyond production |
| Staff absence | Unexpected staff unavailability may extend timelines |
| Ambiguous brief | If a brief requires clarification, the On Hold period extends the timeline |

### 10.5 How On Hold Affects Due Date Expectations

- When a request is placed On Hold, the system-estimated due date is effectively suspended.
- A new system-estimated due date will be calculated when the On Hold is lifted and the request re-enters the active queue.
- Staff must re-confirm the due date after lifting an On Hold.
- The requester's dashboard should clearly indicate that the request is On Hold and that the due date will be updated when production resumes.

### 10.6 Customer-Facing Wording

#### 10.6.1 Service Commitment Statement (for website / FAQ)

> **Our Standard Turnaround**
>
> We aim to complete and deliver your clip within 2 working days of accepting your request. Your actual due date is determined by our current production queue and confirmed by our team. Once confirmed, your expected due date will appear in your dashboard.
>
> The 2-working-day target applies after your request has been reviewed, accepted, and found to contain complete and usable materials. Timelines may vary if your request requires clarification, is placed on hold, or if our production queue is at higher-than-usual volume.

#### 10.6.2 Internal Operations Wording

> **Internal SLA Standard:**
> The production target is 2 working days from Accepted for Production status. Staff are responsible for confirming the due date promptly after acceptance. Queue-adjusted due dates beyond the 2-working-day standard must be noted in the request record. Admin should be notified if systemic queue overload causes due dates to exceed 3 working days as a routine pattern.

### 10.7 Risk Notes

| Risk | Recommended Mitigation |
|---|---|
| Requester interprets "2 working days" as a guarantee from signup | Use "target" and "aim" language; never use "guarantee" without qualification |
| Confirmed due date is missed by staff | Admin is notified; requester is updated; see Section 15 for exception handling |
| Queue grows faster than staff capacity | Admin dashboard should surface this early so capacity decisions can be made |
| Publishing platform delays (e.g., TikTok review) | Distinguish "Editing complete" from "Published" in status flow; inform requester |

---

## 11. STATUS DEFINITIONS AND TRANSITION RULES

### 11.1 Status Registry

#### DRAFT
| Attribute | Definition |
|---|---|
| **Meaning** | The requester has started filling in a clip request form but has not yet submitted it. |
| **Who can set it** | System (automatically, when form is opened/started) |
| **Actions allowed** | Requester may edit any field, add or remove files, and abandon the draft |
| **What happens next** | Requester submits the request → moves to Submitted |
| **Who can see it** | Requester (their own drafts only). Admin may view. Staff do not see drafts. |
| **Notes** | Credits are NOT reserved in Draft status. Drafts may be auto-deleted after a defined idle period (e.g., 30 days) in a later phase. |

---

#### SUBMITTED
| Attribute | Definition |
|---|---|
| **Meaning** | The requester has completed and submitted the request form. Credits are reserved. The request is waiting for staff review. |
| **Who can set it** | System (automatically upon successful submission) |
| **Actions allowed** | Requester may cancel (returns to credit reservation released) if no staff action has started. Staff can begin review. |
| **What happens next** | Staff begins review → moves to Under Review |
| **Who can see it** | Requester, Staff, Admin |
| **Notes** | 10 credits are reserved at this moment. Queue position is assigned. |

---

#### UNDER REVIEW
| Attribute | Definition |
|---|---|
| **Meaning** | A staff member has opened and is actively reviewing the request for completeness and policy compliance. |
| **Who can set it** | Staff (by claiming/opening a request for review) |
| **Actions allowed** | Staff may accept (→ Accepted for Production), reject (→ Rejected), or place on hold (→ On Hold). Requester cannot cancel self-serve once this status is reached. |
| **What happens next** | Staff decision determines next status |
| **Who can see it** | Requester, Staff, Admin |
| **Notes** | No credits are deducted yet. Staff should aim to complete review and move the request within 1 working day. |

---

#### ACCEPTED FOR PRODUCTION
| Attribute | Definition |
|---|---|
| **Meaning** | Staff has reviewed the request, confirmed it is complete and policy-compliant, and accepted it into the production queue. Credits are permanently deducted. |
| **Who can set it** | Staff |
| **Actions allowed** | Staff confirms the due date (mandatory action). Staff begins production planning. System calculates queue position. |
| **What happens next** | Staff begins editing → moves to Editing. Staff may also move to On Hold if an issue arises during production setup. |
| **Who can see it** | Requester, Staff, Admin |
| **Notes** | Credits deducted permanently at this point. System-estimated due date is calculated. Staff must confirm due date with an explicit action. |

---

#### EDITING
| Attribute | Definition |
|---|---|
| **Meaning** | Staff is actively producing (editing) the video clip using the requester's uploaded materials. |
| **Who can set it** | Staff |
| **Actions allowed** | Staff works on production. Staff may move to On Hold if a blocking issue arises during editing. |
| **What happens next** | Editing is complete → staff schedules for publishing (→ Scheduled for Publishing) |
| **Who can see it** | Requester, Staff, Admin |
| **Notes** | Requester sees this status and knows their clip is actively being worked on. |

---

#### SCHEDULED FOR PUBLISHING
| Attribute | Definition |
|---|---|
| **Meaning** | The edited clip is complete and has been queued or scheduled for publishing to the designated social channels. |
| **Who can set it** | Staff |
| **Actions allowed** | Staff confirms publishing schedule. Staff monitors for successful publication. |
| **What happens next** | Clip goes live on channels → moves to Published |
| **Who can see it** | Requester, Staff, Admin |
| **Notes** | Separate from Editing to account for publishing platform delays (e.g., TikTok review queues, scheduling windows). |

---

#### PUBLISHED
| Attribute | Definition |
|---|---|
| **Meaning** | The final edited clip has been successfully published to one or more designated channels. Publishing links are now recorded in the system. |
| **Who can set it** | Staff (after confirming the clip is live and recording the links) |
| **Actions allowed** | Staff records all delivery links. Admin reviews if needed. |
| **What happens next** | Staff marks as Delivered once all links are recorded and confirmed → moves to Delivered |
| **Who can see it** | Requester, Staff, Admin |
| **Notes** | Requester does not yet see the links until Delivered status; however, this distinction can be simplified in Phase 1 — see Section 17 for open question. |

---

#### DELIVERED
| Attribute | Definition |
|---|---|
| **Meaning** | The request is fully complete. All delivery links are recorded and are visible to the requester in their dashboard. The service cycle is complete. |
| **Who can set it** | Staff |
| **Actions allowed** | Requester views and uses delivery links. No further production action needed. |
| **What happens next** | Terminal status. No further movement in standard flow. |
| **Who can see it** | Requester, Staff, Admin |
| **Notes** | The requester can reshare/repost the clip from this point. This is the happy-path terminal state. |

---

#### ON HOLD
| Attribute | Definition |
|---|---|
| **Meaning** | The request has been paused due to an issue that must be resolved before production can continue. A reason must always be provided. |
| **Who can set it** | Staff (or Admin) |
| **Actions allowed** | Staff or Admin documents the hold reason. Requester sees the hold reason in their dashboard. Admin can override. |
| **What happens next** | Once the issue is resolved, staff lifts the hold → request returns to its previous active status or advances as appropriate |
| **Who can see it** | Requester (hold reason visible), Staff, Admin |
| **Notes** | Credits are not refunded when On Hold (reserved if pre-acceptance, deducted if post-acceptance). Queue position is effectively suspended during On Hold. |

---

#### REJECTED
| Attribute | Definition |
|---|---|
| **Meaning** | The request has been declined by staff and will not proceed to production. A mandatory rejection reason must be provided. |
| **Who can set it** | Staff (or Admin) |
| **Actions allowed** | Staff records rejection reason. Credits are refunded if pre-acceptance. Requester is notified. |
| **What happens next** | Terminal status. Requester may submit a new, corrected request. |
| **Who can see it** | Requester (rejection reason visible), Staff, Admin |
| **Notes** | Rejection always results in credit refund if the request was not yet Accepted for Production. After acceptance, rejection is not a standard path — admin escalation is required. |

---

### 11.2 Status Transition Table

| From Status | Allowed Next Status | Who Triggers |
|---|---|---|
| Draft | Submitted | Requester (submits form) |
| Submitted | Under Review | Staff (begins review) |
| Submitted | Rejected | Staff (immediate rejection if clearly invalid) |
| Submitted | *(cancelled)* | Requester (self-cancel before Under Review) |
| Under Review | Accepted for Production | Staff |
| Under Review | On Hold | Staff |
| Under Review | Rejected | Staff |
| Accepted for Production | Editing | Staff |
| Accepted for Production | On Hold | Staff |
| Editing | Scheduled for Publishing | Staff |
| Editing | On Hold | Staff |
| Scheduled for Publishing | Published | Staff |
| Scheduled for Publishing | On Hold | Staff |
| Published | Delivered | Staff |
| On Hold | Under Review | Staff (lifts hold, returns to review) |
| On Hold | Accepted for Production | Staff (lifts hold, resumes if previously accepted) |
| On Hold | Editing | Staff (lifts hold, resumes if previously in editing) |
| On Hold | Rejected | Staff (determines not salvageable after hold) |
| Rejected | *(terminal)* | N/A |
| Delivered | *(terminal)* | N/A |

### 11.3 Common Edge Cases and Handling Notes

| Edge Case | Recommended Handling |
|---|---|
| Requester cancels after Under Review begins | Requester cannot self-cancel; must contact admin. Admin decides credit refund. |
| Request stuck in Under Review for > 1 working day | Admin should monitor and escalate to staff if no action taken |
| On Hold reason is unclear to requester | Require staff to provide a plain-English reason in the hold notes field |
| Request needs rejection after Accepted for Production | Admin must be involved; credits are not auto-refunded; case-by-case decision |
| Staff publishes to wrong channels | Admin escalation; publishing record corrected; if re-publishing needed, handled outside the status flow |
| Two requests from same requester competing in queue | Standard queue ordering applies (see Section 12) |
| Request stays On Hold indefinitely | Admin should define a maximum On Hold duration policy (e.g., 14 days) after which it auto-Rejects |

---

## 12. QUEUE MODEL FOUNDATIONS

### 12.1 Why Model 3 Is the Right Choice

The three conceptual queue models for due date communication are:
- **Model 1:** Show only a static SLA promise ("2 working days")
- **Model 2:** Show a system-calculated estimate automatically
- **Model 3:** System calculates an estimate; staff must confirm it; confirmed date is requester-facing

**Model 3 is appropriate for Clipper Project because:**

| Reason | Detail |
|---|---|
| **Human judgment is required** | Clip production is a creative task. Staff are better positioned than an algorithm to assess whether a specific request is fast or complex. |
| **Estimate accuracy matters** | Showing an inaccurate system estimate without staff validation could create broken promises and requester disappointment. |
| **Staff accountability** | When staff explicitly confirm a due date, they are committing to a target. This creates professional accountability. |
| **Queue variability** | Queue composition varies. A system estimate must be tempered by staff knowledge of current workload quality and complexity. |
| **Phase 1 simplicity** | A full ML-based estimation engine is overkill for Phase 1. Model 3 gives good accuracy through human confirmation with minimal algorithmic complexity. |

### 12.2 System-Estimated vs. Staff-Confirmed Due Date

| Dimension | System Estimate | Staff-Confirmed Due Date |
|---|---|---|
| **Source** | Algorithm (queue depth + capacity + effort class) | Staff reviews system estimate and clicks Confirm |
| **Visibility** | Internal (staff and admin only before confirmation) | Requester-facing (shown in dashboard after confirmation) |
| **Reliability** | Indicative; may be inaccurate | Committed target; staff are accountable |
| **When generated** | Automatically when request reaches Accepted for Production | When staff clicks Confirm Due Date |
| **Who can change it** | System recalculates on queue change | Staff (before first confirmation); Admin (override at any time) |

### 12.3 When Staff Should Confirm the Due Date

**Policy:**
- Staff must confirm the due date **within 1 working day** of moving a request to Accepted for Production.
- Confirming the due date is a mandatory step before the request can move to Editing.
- The system should visually flag requests that are Accepted for Production but have no confirmed due date.

**Recommended confirmation flow:**
1. Staff accepts request (→ Accepted for Production)
2. System auto-calculates an estimated due date and presents it to staff
3. Staff reviews the estimate in light of current workload and request complexity
4. Staff may adjust the effort classification if needed (Simple / Standard / Complex)
5. Staff clicks **Confirm Due Date** — this records the confirmed date and makes it visible to the requester
6. Staff may proceed to move the request to Editing

### 12.4 If Staff Has Not Yet Confirmed the Due Date

**What the requester sees:**
> "Your request has been accepted for production. Our team is reviewing the schedule and will confirm your expected completion date shortly."

**What staff sees:**
- A clear indicator (flag or alert) on the request showing "Due Date Not Confirmed"
- The system-estimated date (for reference)

**What admin sees:**
- Any request that has been in Accepted for Production for more than 1 working day without a confirmed due date should be flagged in the admin dashboard as a pending action.

### 12.5 Queue Information Visibility

| Information | Requester | Staff | Admin |
|---|---|---|---|
| Queue position (approximate or exact) | Approximate ("You are #X in queue" or "X jobs ahead") | Exact position | Exact position |
| System-estimated due date | Not shown (only confirmed date shown) | Shown | Shown |
| Staff-confirmed due date | Shown (after confirmation) | Shown | Shown |
| Total queue depth (platform-wide) | Not shown | Shown | Shown |
| Per-staff workload | Not shown | Own workload shown | All staff shown |
| Queue position of other requesters | Not shown | Shown (anonymized) | Shown (full detail) |

### 12.6 Queue Position — Exact vs. Approximate

**Recommendation for Phase 1:** Show requester an approximate position. For example:
- "You are currently #3 in queue."
- OR "There are 2 jobs ahead of yours in the production queue."

**Rationale:**
- Exact numeric position can be misleading if queue position shifts due to On Hold or Rejected jobs dropping out.
- Approximate or rounded position is more honest and less brittle.

### 12.7 Queue Ordering Principles

**Default ordering: First-In, First-Out (FIFO) based on Acceptance Timestamp.**

- Queue position is determined by the timestamp at which a request reaches **Accepted for Production** status.
- Earlier acceptance = lower queue number = higher priority in the default queue.
- Two requests from the same requester are ordered by their individual acceptance timestamps.

### 12.8 What Jobs Count "Ahead" in the Queue

| Job Status | Counts as Ahead in Queue? |
|---|---|
| Accepted for Production | Yes |
| Editing | Yes |
| Scheduled for Publishing | Yes (counts toward staff workload) |
| On Hold | No (excluded from active queue count during hold) |
| Rejected | No |
| Delivered | No |
| Published | No |
| Draft | No |
| Submitted | No |
| Under Review | No |

> **Rationale:** Only actively progressing jobs represent real work ahead of a given request. On Hold jobs are temporarily removed from the active queue so they do not inflate the queue position for other requesters.

### 12.9 Fairness and Priority Exception Governance

**Phase 1 default: No priority exceptions.** All requests are served FIFO.

**Future-phase considerations (define now, implement later):**
- Priority queuing for paid plans or premium credits
- Admin-level manual priority override for exceptional circumstances (e.g., time-sensitive event content)
- Any override should require a documented admin reason and should be logged in the audit trail

---

## 13. EXPECTED DUE DATE BUSINESS LOGIC

### 13.1 Estimation Framework for Phase 1 MVP

The system-estimated due date is calculated using the following inputs:

| Input | Definition | Example Value |
|---|---|---|
| Queue depth | Number of jobs currently ahead in active queue | 3 jobs |
| Estimated effort per job | Effort classification per job (Simple / Standard / Complex) | Standard = 1 day |
| Staff daily capacity | Number of Standard-equivalent jobs completable per working day | 2 jobs/day |
| Calendar adjustment | Skip weekends and public holidays | Count only working days |
| Buffer | A fixed buffer added to account for real-world variance | 0.5 day (4 hours) |

### 13.2 Effort Classification System

| Classification | Description | Estimated Production Time |
|---|---|---|
| **Simple** | Short, clear brief; high-quality footage; minimal editing required | ~4 hours (0.5 working day) |
| **Standard** | Typical brief; adequate footage; standard editing | ~8 hours (1 working day) |
| **Complex** | Detailed brief; multiple clips to assemble; creative challenges | ~16 hours (2 working days) |

**Who assigns the effort classification:** Staff assigns the effort classification during the due date confirmation step, before clicking Confirm Due Date.

**Default classification:** Standard. Staff only needs to change it if the request is clearly Simple or Complex.

### 13.3 Example Estimation Logic (Plain Language)

> Scenario: 3 jobs are ahead in the queue. All are Standard. Staff daily capacity is 2 jobs/day. Today is Monday.
>
> - Job ahead load: 3 Standard jobs × 1 day/job = 3 days of work
> - At 2 jobs/day capacity: ceiling(3 / 2) = 2 days to clear the queue
> - Current request effort: Standard = 1 day
> - Buffer: 0.5 day
> - Total: 2 + 1 + 0.5 = 3.5 working days → estimated due date: Thursday (end of business)
>
> Staff reviews this estimate, agrees it is reasonable, and clicks Confirm Due Date.
> Thursday (end of day) is now the requester-facing due date.

### 13.4 Staff Adjustment Guardrails

Staff should be allowed to:
- Change the effort classification (Simple / Standard / Complex) before confirming
- Confirm a date earlier than the system estimate if workload permits
- Confirm a date later than the system estimate if they foresee complications

Staff should NOT be allowed to:
- Set a confirmed due date more than 2 business days later than the system estimate without a documented reason (admin oversight required)
- Confirm a due date that has already passed

### 13.5 Explaining the Date to the Requester

**Recommended requester dashboard wording:**
> "Your expected completion date is [DATE]. This date has been reviewed and confirmed by our production team based on current queue and workload. If any changes occur, we will update your dashboard."

**If date has not yet been confirmed:**
> "Your request has been accepted. Our team is finalizing your expected completion date and will confirm it shortly."

**If request is On Hold:**
> "Your request is currently on hold. [Hold reason]. Your expected completion date will be updated once production resumes."

### 13.6 Estimation Accuracy and Risk Notes

| Risk | Mitigation |
|---|---|
| System underestimates complex jobs | Staff adjusts effort classification before confirming |
| Queue grows faster than estimated (new submissions push back dates) | Confirmed due date is fixed at confirmation; queue growth does not retroactively change it |
| Staff is absent / capacity drops | Admin should monitor capacity; if confirmed dates are at risk, admin should update and notify requester |
| Requester expects the due date to be exactly when the clip is "in hand" | Clarify that the due date is the estimated completion and publishing date; delivery links will follow |

### 13.7 Target SLA vs. Displayed Due Date

| Concept | Definition |
|---|---|
| **Target SLA** | "2 working days" — the operator's standard service commitment |
| **System-estimated due date** | Algorithm output based on queue, effort, and capacity |
| **Staff-confirmed due date** | The date staff explicitly commits to; shown to requester |

The confirmed due date is the **single source of truth** for the requester. The target SLA is a marketing and policy promise. They may differ (e.g., if the queue is at 4 days, the confirmed date will be 4 days out, not 2), and this is acceptable as long as the requester's confirmed due date was set honestly.

---

## 14. DASHBOARD INFORMATION REQUIREMENTS (BUSINESS LEVEL)

> **Note:** This section defines what information must be available in each dashboard from a business logic and operations perspective. UI layout, visual design, and frontend implementation are deferred to Phase 2.

### 14.1 A. Requester Dashboard

**Purpose:** Give the requester full visibility into their account, credits, and active/past requests.

#### Key Summary Cards
- Available credit balance
- Reserved credit balance
- Total requests submitted
- Active requests (in progress)
- Completed/delivered requests

#### Per-Request Information
- Request title
- Current status
- Queue position (approximate, e.g., "2 jobs ahead")
- Confirmed due date (if confirmed; "Pending confirmation" if not)
- Submitted date
- On Hold reason (if applicable)
- Rejection reason (if applicable)
- Delivery links (if Delivered)
- Credit used per request

#### Credit Information
- Total credits available
- Total credits reserved (committed to active requests)
- Credit transaction history (log of grants, reservations, deductions, refunds)

#### Status and Delivery Information
- Current status label (with plain-English status description)
- Visual status progress indicator (e.g., step-by-step indicator showing current stage)
- Delivery links for completed requests (TikTok, Facebook, Instagram, YouTube, Tvent, CDN/Link)

#### Decisions the Requester Dashboard Supports
- Understanding where their request is in the process
- Planning whether to submit another request (based on credit balance and queue position)
- Accessing their delivered clips for resharing

---

### 14.2 B. Staff Dashboard

**Purpose:** Enable staff to manage their production queue efficiently, review requests, confirm due dates, and record delivery.

#### Key Summary Cards
- Total active requests (Accepted for Production + Editing + Scheduled for Publishing)
- Requests pending due date confirmation
- Requests On Hold
- Requests completed today / this week
- Staff's own assigned/in-progress requests

#### Queue Information
- Full active queue with queue position for each request
- Filter and sort by status, acceptance date, effort classification, confirmed due date
- Visual flag for requests with no confirmed due date
- Visual flag for requests approaching or past their confirmed due date

#### Per-Request Information (in staff view)
- Requester name and account ID
- Request title and brief
- All uploaded files (accessible during active production)
- Current status
- Effort classification (editable before due date confirmation)
- System-estimated due date
- Confirmed due date (or "Not confirmed" flag)
- Internal notes field (staff-only)
- Rejection reason field (if rejecting)
- On Hold reason field (if placing on hold)
- Delivery link entry fields (for recording published links)
- Status action buttons (e.g., Accept, Confirm Due Date, Move to Editing, Reject, On Hold, Mark Published, Deliver)

#### Decisions the Staff Dashboard Supports
- Prioritizing which request to work on next
- Identifying requests that need due date confirmation
- Identifying On Hold requests awaiting resolution
- Recording completion and delivery information

---

### 14.3 C. Admin Dashboard

**Purpose:** Provide the operator with full operational oversight, exception handling authority, and governance visibility.

#### Key Summary Cards
- Total requests by status (platform-wide)
- Total requests submitted this week / this month
- Average time from Submitted to Delivered (rolling average)
- Requests overdue (past confirmed due date)
- Requests On Hold > X days
- Active requesters (accounts with at least one active request)
- Credit transaction volume (grants, deductions, refunds)
- New accounts created this week / month

#### Queue Information (Full View)
- Platform-wide queue with all active requests
- Per-staff workload summary
- Queue depth and estimated time to clear at current capacity
- Requests flagged as overdue
- Requests awaiting due date confirmation beyond 1 working day

#### Per-Request Admin Controls
- All information visible to staff
- Full audit trail / status history log
- Credit override capability (manual grant or deduction with mandatory reason)
- Ability to reassign requests between staff members
- Ability to override confirmed due date with mandatory reason
- Ability to bypass standard status transition (with logged justification)
- Ability to suspend or deactivate requester accounts

#### Financial and Operational Reports
- Credit grant and deduction totals by period
- Request volume by status, by requester, by period
- Rejection rate (% of submitted requests rejected)
- On Hold rate and average hold duration
- Delivery turnaround times

#### Decisions the Admin Dashboard Supports
- Identifying operational bottlenecks and queue health issues
- Resolving exception cases (disputed rejections, overdue requests, abuse)
- Ensuring staff are confirming due dates and meeting commitments
- Making capacity decisions (e.g., hiring, workload redistribution)

---

## 15. OPERATIONAL EXCEPTIONS AND GOVERNANCE

### 15.1 Exception: Unusable Uploads

**Scenario:** Staff reviews a submitted request and finds that uploaded files are blurry, corrupt, irrelevant, or otherwise unusable for production.

**Recommended handling:**
1. Staff places request On Hold (if the issue might be correctable) with a note clearly explaining what the problem is.
2. Since Phase 1 lacks two-way messaging, the note should be specific and actionable: e.g., "The uploaded video file appears to be corrupted and cannot be opened. Please submit a new request with a working video file."
3. Alternatively, if the materials are so clearly unusable that no production path exists, staff Rejects the request with a descriptive rejection reason.
4. Credits are refunded on rejection (or kept reserved on hold until resolution).
5. Admin should review repeated On Holds or rejections from the same requester for potential patterns.

---

### 15.2 Exception: Copyright Violation by Requester

**Scenario:** Staff identifies during review or editing that uploaded materials contain clearly copyrighted content the requester does not have rights to (e.g., a copyrighted song, news footage, another brand's content).

**Recommended handling:**
1. Staff must NOT proceed with production using the infringing materials.
2. Staff places the request On Hold (if the issue is limited to specific files and the request could proceed without them) or Rejects it outright (if the infringement is fundamental to the request).
3. The hold/rejection note should clearly state: "We've identified that [specific material] may be subject to third-party copyright. We're unable to use this material. Please review the content you have submitted."
4. Credits are refunded if rejected before acceptance.
5. Admin is notified of any serious or repeated copyright issues for potential account action.
6. The operator should document the incident internally for its own compliance records.

---

### 15.3 Exception: Requester Requests Cancellation

**Scenario:** A requester wants to cancel a request that is in progress.

**Recommended handling by status:**

| Status at Time of Request | Handling |
|---|---|
| Draft | Requester can simply abandon the draft. No credits involved. |
| Submitted (no staff action yet) | Requester can self-cancel. Credits are refunded. |
| Under Review or later | Requester cannot self-cancel. Must contact support/admin. |
| Under Review | Admin may approve cancellation; credits refunded at admin discretion. |
| Accepted for Production or later | Admin may approve cancellation; credits are NOT refunded (production work has been initiated). |

---

### 15.4 Exception: Requester Requests Raw Files After Deletion

**Scenario:** It has been more than 90 days since upload, files have been deleted, and the requester contacts support asking for them.

**Recommended handling:**
1. Inform the requester that raw uploaded files are automatically deleted 90 days from upload and are non-recoverable.
2. Reference the notice that was displayed at submission and in the Terms of Service.
3. The operator is not obligated to retrieve, reconstruct, or compensate for deleted raw files.
4. Staff should respond with empathy but firmness: "We're sorry for any inconvenience. As stated in our file storage policy and the notice shown when you uploaded your files, source files are automatically deleted after 90 days and cannot be recovered. We recommend keeping a copy of all files you upload to our platform."

---

### 15.5 Exception: Staff Misses Confirmed Due Date

**Scenario:** A request's confirmed due date has passed and it has not been delivered.

**Recommended handling:**
1. Admin dashboard should flag all overdue requests automatically.
2. Admin should contact the responsible staff member to understand the cause of the delay.
3. If the delay is within the operator's control (e.g., staff forgot, got busy): the request should be expedited immediately.
4. The requester's dashboard should ideally show an updated status or acknowledgment (e.g., "We're working to complete your request. We apologize for the delay." — implementation detail for a later phase).
5. Admin may choose to offer a credit adjustment or gesture of goodwill for significant delays (at discretion; no automatic policy in Phase 1).
6. Repeated missed due dates by a staff member should be addressed through internal HR/performance processes, not through platform logic.

---

### 15.6 Exception: Queue Overload

**Scenario:** The volume of new submissions exceeds staff production capacity and the queue grows to a length that cannot realistically meet the standard 2-working-day target.

**Recommended handling:**
1. Admin dashboard should surface queue depth vs. capacity mismatch early.
2. Admin has the authority to:
   - Temporarily pause new submissions (by disabling the submission form) while the queue clears.
   - Prioritize older requests to clear backlog.
   - Display a platform-wide notice (future phase) about longer-than-usual turnaround times.
3. For already-accepted requests, staff should confirm realistic due dates rather than optimistic ones.
4. The platform should never silently allow requesters to accumulate wait times without updated information.

---

### 15.7 Exception: Ambiguous or Risky Content

**Scenario:** A submitted request is not clearly prohibited but raises concerns (e.g., borderline political content, health claims, questionable but not illegal material).

**Recommended handling:**
1. Staff should not make unilateral decisions on ambiguous content. Flag to admin immediately.
2. Admin reviews the request and makes a policy determination: Accept, On Hold (with clarification request), or Reject.
3. The decision should be documented with a brief rationale in the request's internal notes.
4. If the decision sets a precedent, admin should update the internal content policy reference document.
5. The requester is notified of the decision with an appropriate explanation.

---

### 15.8 Exception: System Estimate vs. Real Workload Mismatch

**Scenario:** The system calculates an estimated due date of 2 days, but staff knows the current queue contains several Complex requests that will take much longer.

**Recommended handling:**
1. This is exactly why Model 3 (human confirmation) is in place.
2. Staff should adjust effort classifications before confirming and should set a realistic confirmed date.
3. If the system estimate is consistently inaccurate, admin should review and adjust the effort-per-job estimates or capacity parameters used in the estimation algorithm.
4. Staff should never confirm an unrealistic due date to please the requester. Honest confirmed dates are better than broken promises.

---

### 15.9 Exception: Staff Forgets to Confirm Due Date

**Scenario:** A request has been Accepted for Production but staff has not confirmed the due date, and the request sits unactioned.

**Recommended handling:**
1. The system should display a prominent flag/alert on all requests that are Accepted for Production without a confirmed due date.
2. After 1 working day without confirmation, the admin dashboard should escalate this as a pending action.
3. Admin should follow up with the relevant staff member.
4. Implementation note (for later phase): consider a system notification/reminder to staff after 4 hours without confirmation.

---

### 15.10 Exception: No Final Publish Link Available Yet

**Scenario:** The clip has been produced but the target social platform (e.g., TikTok) is still processing the upload, has not yet approved it, or the scheduling window has not arrived.

**Recommended handling:**
1. The status **Scheduled for Publishing** exists precisely for this gap.
2. Staff should move to Scheduled for Publishing once the clip is submitted to the platform for publishing.
3. Staff should monitor for successful publishing and move to Published once the clip is confirmed live.
4. The requester sees Scheduled for Publishing and understands the clip is complete but not yet live.
5. If publishing is delayed significantly (e.g., platform rejection), staff places on On Hold with an explanation: "Your clip was submitted to [platform] but we are awaiting confirmation that it has been published. We will update you shortly."

---

## 16. PHASE 1 DECISIONS TO FINALIZE BEFORE PHASE 2

The following is a complete checklist of decisions that must be confirmed/approved before moving to Phase 2 (Information Architecture and Wireframes):

### 16.1 Business and Policy Decisions

- [ ] **Legal entity confirmation:** Confirm the legal entity name that will own the platform, the IP, and be the contracting party in the Terms of Service.
- [ ] **Operator's operating time zone:** Define the official business time zone for working day calculations.
- [ ] **Operator's working hours:** Define official business hours (e.g., 9 AM – 6 PM) for SLA and due date purposes.
- [ ] **Public holiday calendar:** Define which country's/region's public holidays are observed.
- [ ] **Maximum On Hold duration:** Confirm how many days a request can sit On Hold before it is auto-rejected (recommendation: 14 calendar days).
- [ ] **Inactive account credit expiry period:** Confirm the 12-month inactivity credit expiry policy or adjust the timeline.
- [ ] **Draft auto-delete period:** Confirm how long unsaved drafts are retained before being auto-deleted (recommendation: 30 days).
- [ ] **Published vs. Delivered distinction:** Confirm whether Published and Delivered should remain as two separate statuses or be merged into one (recommendation: keep separate; see Section 17).
- [ ] **Requester cancellation boundary:** Confirm that Submitted is the last self-cancel point and that post-Under-Review cancellations require admin approval.
- [ ] **Paid credit model timeline:** Confirm that credit purchases are out of scope for Phase 1 and plan Phase 2 credit purchase feature.
- [ ] **Content policy categories:** Review and approve the prohibited and borderline content categories in Section 7.
- [ ] **Ownership policy language:** Review and approve the formal ownership policy wording in Section 8.6.2.
- [ ] **Storage retention policy language:** Review and approve the formal storage policy wording in Section 9.8.2.
- [ ] **Service level wording:** Approve the customer-facing turnaround wording in Section 10.6.1.

### 16.2 Operational Decisions

- [ ] **Staff capacity per day:** Define the standard staff daily capacity in Standard-job equivalents for the estimation formula (e.g., 2 jobs/day per staff member).
- [ ] **Number of staff members in Phase 1:** Confirm how many staff accounts will be set up at launch.
- [ ] **Maximum file size per upload:** Define the per-file and total upload size limits.
- [ ] **Accepted file types:** Confirm the list of accepted video and image file formats.
- [ ] **Social media channels at launch:** Confirm which publishing channels are active at Phase 1 launch (TikTok, Facebook, Instagram, YouTube, Tvent, CDN/Link).
- [ ] **Buffer in estimation formula:** Approve the 0.5-day buffer in the estimation logic or adjust.

### 16.3 Product Decisions

- [ ] **Queue position display:** Confirm approximate queue position ("X jobs ahead") vs. exact queue position for requester view.
- [ ] **Delivery link visibility:** Confirm whether delivery links are visible at Published status or only at Delivered status.
- [ ] **In-app messaging (Phase 2 scope):** Confirm that a two-way communication/clarification thread per request is planned for Phase 2.
- [ ] **Admin override scope:** Confirm which admin override capabilities are in scope for Phase 1 vs. later phases.
- [ ] **Duplicate account detection:** Confirm how aggressively the platform should enforce single-account-per-user policy at Phase 1.

---

## 17. OPEN QUESTIONS AND RECOMMENDATIONS

### OQ-1: Should Published and Delivered Be Merged Into One Status?

**The issue:** Having two separate statuses (Published and Delivered) adds a step that may confuse requesters or add unnecessary workflow complexity. However, the distinction exists to account for the lag between "we published it" and "we have recorded all links and confirmed full delivery."

**Recommendation:** Keep them separate. The Published → Delivered transition is typically seconds to minutes and is a system hygiene step. More importantly, in some cases, not all planned channels may publish simultaneously (e.g., TikTok processes faster than YouTube). Delivered should mean "all links are confirmed and recorded." This protects against premature delivery notification.

**Decision needed from owner:** Confirm keep separate, or confirm merge.

---

### OQ-2: Should Phase 1 Include In-App Messaging or a Clarification Thread?

**The issue:** Currently, On Hold is the only way for staff to communicate with requesters about issues. This is a one-way signal (staff writes a note; requester reads it; requester has no way to respond in-app). This creates friction for cases where a simple back-and-forth could resolve an issue quickly.

**Recommendation:** Defer in-app messaging to Phase 2, but design the On Hold note field to be rich enough (long text, specific instructions) to minimize the need for real-time back-and-forth. For Phase 1, requesters who need to respond can do so by submitting a new request with corrected materials (after the original is Rejected, allowing credit refund).

**Decision needed from owner:** Confirm defer to Phase 2, or accept the limitation and design a workaround for Phase 1 launch.

---

### OQ-3: What Should the Email Domain/Disposable Email Policy Be at Signup?

**The issue:** Disposable email services (e.g., Mailinator, Temp Mail) can be used to create throwaway accounts to harvest free credits. Phase 1 should have a policy position on this.

**Recommendation:** Block known disposable email domains at signup using a regularly updated blocklist. This is a lightweight mitigation that significantly reduces throwaway account creation without creating friction for legitimate users. Implement at the policy level now; technical implementation in Phase 2.

**Decision needed from owner:** Confirm disposable email blocking policy, or accept the risk for Phase 1.

---

### OQ-4: Should "Preferred Style/Tone" Be a Free-Text Field or a Structured Selector?

**The issue:** A free-text field gives requesters flexibility but may produce inconsistent or unhelpful inputs. A structured selector (e.g., dropdown with 4-6 options: Energetic, Professional, Casual, Cinematic, Inspirational, Humorous) is easier for staff to interpret but may not cover all preferences.

**Recommendation:** Start with a structured selector plus an optional "additional notes" free-text field. This balances structure and flexibility. However, the selector options need to be defined by the operator based on the production styles the team can realistically execute.

**Decision needed from owner:** Define the list of style/tone options the operator wants to offer, or confirm free-text approach for Phase 1.

---

### OQ-5: What Is the Policy for Requests That Are On Hold for a Very Long Time?

**The issue:** If a requester ignores an On Hold notice and never resubmits or responds, the request can sit On Hold indefinitely, consuming reserved credits and queue space.

**Recommendation:** Set a maximum On Hold duration of **14 calendar days**. After 14 days with no resolution, the request is automatically moved to Rejected with a note: "This request was placed on hold on [date] due to [reason]. As no response or corrective action was received within 14 days, the request has been closed. Your credits have been refunded." Admin can override in exceptional circumstances.

**Decision needed from owner:** Confirm 14-day auto-reject, or set a different duration.

---

### OQ-6: Should Requesters Be Able to Edit Their Draft Before Submitting?

**The issue:** Standard assumption is yes — a Draft is editable. But the question is whether any of the fields should be locked or warned against after a first save, to prevent confusion.

**Recommendation:** All fields in Draft status should be fully editable with no restrictions. This is standard behavior and creates no operational risk, since credits are not yet reserved. Confirm this is the intended behavior.

**Decision needed from owner:** Confirm full Draft editability (recommended default).

---

### OQ-7: Should the Platform Support Multiple Languages in the Interface?

**The issue:** The clip request form includes a "Preferred language" field for the clip's content. But the platform interface itself may need to support multiple languages if the requester base is international.

**Recommendation:** Phase 1 should be English-only for the interface. The "Preferred language" field in the request form handles multi-language clip content without requiring UI localization. Localization can be considered in a later phase as the requester base grows.

**Decision needed from owner:** Confirm English-only interface for Phase 1.

---

*End of Clipper Project Phase 1 Business and Product Specification — v1.0*

---

**DOCUMENT STATUS:** Draft — Pending Owner Review and Approval
**NEXT STEP:** Owner reviews, approves decisions in Section 16, and answers open questions in Section 17. Once approved, proceed to Phase 2: Information Architecture and Wireframes.
