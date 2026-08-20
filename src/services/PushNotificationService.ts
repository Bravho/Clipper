import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import webpush from "web-push";
import { pool } from "@/lib/db";
import { ANDROID_CHANNEL_ID } from "@/config/push";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

type DevicePlatform = "ios" | "android" | "web";

/** Web Push subscription keys (from the browser's PushSubscription). */
interface WebPushKeys {
  p256dh: string;
  auth: string;
}

interface PushDevice {
  token: string;
  platform: DevicePlatform;
  p256dh: string | null;
  auth: string | null;
}

// Configure the VAPID identity once (lazily) for Web Push. Missing keys means
// web delivery is simply skipped — native (FCM/APNs) is unaffected.
let vapidConfigured: boolean | null = null;
function ensureVapidConfigured(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@rclipper.com";
  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

interface PipelineNotice {
  eventKey: string;
  title: string;
  body: string;
}

const NOTICES: Partial<Record<VideoGenerationStep, PipelineNotice>> = {
  [VideoGenerationStep.AwaitingContentApproval]: {
    eventKey: "content-ready",
    title: "เนื้อหาพร้อมตรวจสอบ",
    body: "วิดีโอของคุณมีขั้นตอนใหม่ที่ต้องตรวจสอบ",
  },
  [VideoGenerationStep.AwaitingSceneDesignApproval]: {
    eventKey: "scene-design-ready",
    title: "ฉากพร้อมตรวจสอบ",
    body: "กรุณาตรวจสอบการออกแบบฉากของวิดีโอ",
  },
  [VideoGenerationStep.AwaitingSceneScriptApproval]: {
    eventKey: "scene-script-ready",
    title: "บทฉากพร้อมตรวจสอบ",
    body: "กรุณาตรวจสอบบทฉากก่อนสร้างวิดีโอ",
  },
  [VideoGenerationStep.AwaitingVideoApproval]: {
    eventKey: "video-ready",
    title: "วิดีโอพร้อมตรวจสอบ",
    body: "เปิดคำขอเพื่อดูและอนุมัติวิดีโอ",
  },
  [VideoGenerationStep.AwaitingVoiceApproval]: {
    eventKey: "voice-ready",
    title: "เสียงพร้อมตรวจสอบ",
    body: "เสียงสำหรับวิดีโอของคุณพร้อมตรวจสอบแล้ว",
  },
  [VideoGenerationStep.AwaitingAnimationApproval]: {
    eventKey: "animation-ready",
    title: "ภาพเคลื่อนไหวพร้อมตรวจสอบ",
    body: "เปิดคำขอเพื่อดำเนินการขั้นตอนถัดไป",
  },
  [VideoGenerationStep.AwaitingOverlayApproval]: {
    eventKey: "overlay-ready",
    title: "คำบรรยายพร้อมตรวจสอบ",
    body: "คำบรรยายและภาพซ้อนพร้อมตรวจสอบแล้ว",
  },
  [VideoGenerationStep.AwaitingAdditionalRatios]: {
    eventKey: "additional-ratios-ready",
    title: "พร้อมสร้างรูปแบบช่องทางอื่น",
    body: "เปิดคำขอเพื่อสร้างวิดีโอในอัตราส่วนสำหรับช่องทางที่เหลือ",
  },
  [VideoGenerationStep.AwaitingFinalApproval]: {
    eventKey: "final-ready",
    title: "วิดีโอฉบับสุดท้ายพร้อมแล้ว",
    body: "เปิดคำขอเพื่อตรวจสอบวิดีโอฉบับสุดท้าย",
  },
  [VideoGenerationStep.AwaitingDistributionReview]: {
    eventKey: "downloads-ready",
    title: "ไฟล์วิดีโอพร้อมดาวน์โหลด",
    body: "รูปแบบวิดีโอสำหรับช่องทางของคุณพร้อมแล้ว",
  },
  [VideoGenerationStep.Failed]: {
    eventKey: "generation-failed",
    title: "การสร้างวิดีโอต้องตรวจสอบ",
    body: "เปิดคำขอเพื่อดูรายละเอียดและลองอีกครั้ง",
  },
  [VideoGenerationStep.Complete]: {
    eventKey: "complete",
    title: "งานวิดีโอเสร็จสมบูรณ์",
    body: "วิดีโอของคุณพร้อมใช้งานแล้ว",
  },
};

/**
 * Steps the pipeline reaches once PER SCENE (it loops through them for each scene
 * via currentSceneIndex). Their dedup key and copy carry the scene number so
 * EVERY scene's review gate notifies — not just the first. Without this, the
 * `(job_id, event_key)` uniqueness would suppress scenes 2..N. Re-entering the
 * same scene's gate (e.g. after a revision the user themself triggered) still
 * dedupes on the same per-scene key, avoiding spam.
 */
const PER_SCENE_NOTICE: Partial<
  Record<VideoGenerationStep, (sceneNumber: number) => PipelineNotice>
> = {
  [VideoGenerationStep.AwaitingSceneScriptApproval]: (n) => ({
    eventKey: `scene-script-ready-${n}`,
    title: `บทฉากที่ ${n} พร้อมตรวจสอบ`,
    body: "กรุณาตรวจสอบบทฉากก่อนสร้างวิดีโอ",
  }),
  [VideoGenerationStep.AwaitingVideoApproval]: (n) => ({
    eventKey: `video-ready-${n}`,
    title: `วิดีโอฉากที่ ${n} พร้อมตรวจสอบ`,
    body: "เปิดคำขอเพื่อดูและอนุมัติวิดีโอของฉากนี้",
  }),
};

function requestPath(requestId: string): string {
  return `/dashboard/requests/${encodeURIComponent(requestId)}`;
}

/**
 * A delivery failure that carries the HTTP status the push service returned, so
 * the caller can prune a subscription the service reports as gone. Plain
 * `Error`s thrown here used to lose the status, which meant native tokens were
 * retried forever after the app was uninstalled.
 */
class PushDeliveryError extends Error {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "PushDeliveryError";
    this.statusCode = statusCode;
  }
}

/* -- FCM (Android) --------------------------------------------------------- */

/** Google's OAuth access tokens last an hour. Minting one per notification adds
 *  a round trip to every send, so keep it until just before it expires. */
let fcmAccessToken: { value: string; expiresAt: number } | null = null;

async function googleAccessToken(): Promise<string> {
  if (fcmAccessToken && fcmAccessToken.expiresAt > Date.now() + 60_000) {
    return fcmAccessToken.value;
  }
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) throw new Error("FCM credentials are not configured.");

  const key = await importPKCS8(privateKey, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    fcmAccessToken = null;
    throw new Error(`FCM OAuth failed (${response.status}).`);
  }
  const result = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!result.access_token) throw new Error("FCM OAuth returned no access token.");
  fcmAccessToken = {
    value: result.access_token,
    expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
  };
  return fcmAccessToken.value;
}

async function sendAndroid(
  token: string,
  notice: PipelineNotice,
  requestId: string
): Promise<void> {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  if (!projectId) throw new Error("FCM_PROJECT_ID is not configured.");
  const accessToken = await googleAccessToken();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: notice.title, body: notice.body },
          // `data` is what the app reads on tap. Every value must be a string —
          // FCM rejects the whole message if one is not.
          data: { path: requestPath(requestId), requestId, eventKey: notice.eventKey },
          android: {
            priority: "high",
            notification: {
              // Must match the channel NativePushRegistration creates, or
              // Android 8+ drops the notification silently.
              channel_id: ANDROID_CHANNEL_ID,
              // Collapse a repeat of the same pipeline event rather than stack it.
              tag: notice.eventKey,
              sound: "default",
            },
          },
        },
      }),
    }
  );
  if (response.ok) return;

  const body = await response.text().catch(() => "");
  // Only two responses mean "this token is dead": UNREGISTERED (app uninstalled
  // or token rotated) and SENDER_ID_MISMATCH (token belongs to another Firebase
  // project). A bare 400 usually means OUR payload is wrong — pruning on that
  // would disable every device on the account, so it is deliberately not mapped.
  const gone = response.status === 404 || /UNREGISTERED|SENDER_ID_MISMATCH/i.test(body);
  throw new PushDeliveryError(
    `FCM send failed (${response.status}): ${body.slice(0, 300)}`,
    gone ? 410 : response.status
  );
}

/* -- APNs (iOS) ------------------------------------------------------------ */

/**
 * Apple rejects a provider token refreshed more often than once every 20 minutes
 * (403 TooManyProviderTokenUpdates) AND one older than 60 minutes (403
 * ExpiredProviderToken), so the JWT must be cached and re-minted somewhere in
 * between — not generated per notification, which the previous version did.
 */
let apnsProviderJwt: { value: string; issuedAt: number } | null = null;
const APNS_TOKEN_TTL_MS = 45 * 60 * 1000;

async function apnsProviderToken(
  keyId: string,
  teamId: string,
  privateKeyPem: string
): Promise<string> {
  if (apnsProviderJwt && Date.now() - apnsProviderJwt.issuedAt < APNS_TOKEN_TTL_MS) {
    return apnsProviderJwt.value;
  }
  const key = await importPKCS8(privateKeyPem, "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);
  apnsProviderJwt = { value, issuedAt: Date.now() };
  return value;
}

/**
 * Deliver one APNs alert.
 *
 * This MUST go over HTTP/2: the APNs provider API speaks HTTP/2 only, and Node's
 * global `fetch` (undici) is HTTP/1.1 — so the previous `fetch`-based version
 * could never have delivered a single iOS notification. `node:http2` is the
 * supported client.
 */
async function sendIos(
  token: string,
  notice: PipelineNotice,
  requestId: string
): Promise<void> {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || "com.rclipper.app";
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!keyId || !teamId || !privateKey) throw new Error("APNs credentials are not configured.");

  const bearer = await apnsProviderToken(keyId, teamId, privateKey);
  const host =
    process.env.APNS_ENVIRONMENT === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";

  const payload = JSON.stringify({
    aps: {
      alert: { title: notice.title, body: notice.body },
      sound: "default",
      // Group every notice for one request into the same iOS notification thread.
      "thread-id": requestId,
    },
    path: requestPath(requestId),
    requestId,
    eventKey: notice.eventKey,
  });

  await new Promise<void>((resolve, reject) => {
    const session = http2.connect(host);
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      session.close();
      if (err) reject(err);
      else resolve();
    };

    session.on("error", (err) => finish(err));
    session.setTimeout(15_000, () =>
      finish(new PushDeliveryError("APNs request timed out."))
    );

    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${encodeURIComponent(token)}`,
      authorization: `bearer ${bearer}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      // Replace an undelivered notice for the same pipeline event instead of
      // stacking a second copy on the lock screen. Max 64 bytes.
      "apns-collapse-id": notice.eventKey.slice(0, 64),
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    });

    let status = 0;
    let body = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[":status"]) || 0;
    });
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("error", (err) => finish(err));
    request.on("end", () => {
      if (status === 200) {
        finish();
        return;
      }
      let reason = "";
      try {
        reason = String((JSON.parse(body) as { reason?: unknown })?.reason ?? "");
      } catch {
        reason = body.slice(0, 200);
      }
      // A stale provider JWT is recoverable — drop it so the next send re-mints.
      if (status === 403 && /ExpiredProviderToken|InvalidProviderToken/.test(reason)) {
        apnsProviderJwt = null;
      }
      // 410 Unregistered, and 400 BadDeviceToken, both mean the token is dead.
      // Anything else (payload/auth/config errors) must NOT prune the device.
      const gone = status === 410 || (status === 400 && /BadDeviceToken/.test(reason));
      finish(
        new PushDeliveryError(`APNs send failed (${status} ${reason}).`, gone ? 410 : status)
      );
    });
    request.end(payload);
  });
}

/**
 * Deliver a browser (Web Push) notification via the VAPID protocol. The service
 * worker (public/sw.js) receives this JSON in its `push` event and renders it.
 * Throws a WebPushError whose statusCode is 404/410 when the subscription has
 * expired, so the caller can prune it.
 */
async function sendWeb(
  device: PushDevice,
  notice: PipelineNotice,
  requestId: string
): Promise<void> {
  if (!ensureVapidConfigured()) throw new Error("VAPID keys are not configured.");
  if (!device.p256dh || !device.auth) throw new Error("Web Push subscription is missing keys.");

  const payload = JSON.stringify({
    title: notice.title,
    body: notice.body,
    data: { path: requestPath(requestId), requestId, eventKey: notice.eventKey },
  });

  await webpush.sendNotification(
    { endpoint: device.token, keys: { p256dh: device.p256dh, auth: device.auth } },
    payload,
    { TTL: 60 * 60 * 24 } // keep for a day if the browser is offline
  );
}

export class PushNotificationService {
  async registerDevice(
    userId: string,
    platform: DevicePlatform,
    token: string,
    keys?: WebPushKeys
  ): Promise<void> {
    await pool.query(
      `INSERT INTO push_devices (user_id, platform, token, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         enabled = TRUE,
         updated_at = NOW(),
         last_seen_at = NOW()`,
      [userId, platform, token, keys?.p256dh ?? null, keys?.auth ?? null]
    );
  }

  async disableDevice(userId: string, token: string): Promise<void> {
    await pool.query(
      `UPDATE push_devices
       SET enabled = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND token = $2`,
      [userId, token]
    );
  }

  /** Disable a device by token alone — used to prune an expired subscription the
   *  push service reported as gone (404/410) during delivery. */
  async disableDeviceByToken(token: string): Promise<void> {
    await pool.query(
      `UPDATE push_devices SET enabled = FALSE, updated_at = NOW() WHERE token = $1`,
      [token]
    );
  }

  async notifyPipelineStep(
    jobId: string,
    requestId: string,
    step: VideoGenerationStep,
    /**
     * Zero-based scene index for steps that recur per scene. Drives a per-scene
     * dedup key + copy so each scene's review gate notifies. Ignored for one-shot
     * steps.
     */
    sceneIndex?: number
  ): Promise<void> {
    const perScene = PER_SCENE_NOTICE[step];
    const notice =
      perScene && typeof sceneIndex === "number"
        ? perScene(sceneIndex + 1)
        : NOTICES[step];
    if (!notice) return;

    const owner = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM clip_requests WHERE id = $1",
      [requestId]
    );
    const userId = owner.rows[0]?.user_id;
    if (!userId) return;

    const inserted = await pool.query(
      `INSERT INTO push_notification_deliveries
         (user_id, request_id, job_id, event_key, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_id, event_key) DO NOTHING
       RETURNING id`,
      [userId, requestId, jobId, notice.eventKey, notice.title, notice.body]
    );
    if (inserted.rowCount === 0) return;

    const devices = await pool.query<PushDevice>(
      `SELECT token, platform, p256dh, auth
       FROM push_devices
       WHERE user_id = $1 AND enabled = TRUE`,
      [userId]
    );
    if (devices.rowCount === 0) return;

    let delivered = false;
    for (const device of devices.rows) {
      try {
        if (device.platform === "android") {
          await sendAndroid(device.token, notice, requestId);
        } else if (device.platform === "web") {
          await sendWeb(device, notice, requestId);
        } else {
          await sendIos(device.token, notice, requestId);
        }
        delivered = true;
      } catch (err) {
        // Prune a subscription the push service reports as gone (browser
        // unsubscribed / token rotated) so we stop trying it. 404/410 for Web
        // Push; FCM/APNs surface similar "unregistered" errors as HTTP 404/410.
        const statusCode =
          typeof (err as { statusCode?: unknown })?.statusCode === "number"
            ? (err as { statusCode: number }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          await this.disableDeviceByToken(device.token).catch(() => {});
        }
        console.error("[push] delivery failed:", err);
      }
    }
    if (delivered) {
      await pool.query(
        `UPDATE push_notification_deliveries
         SET delivered_at = NOW()
         WHERE job_id = $1 AND event_key = $2`,
        [jobId, notice.eventKey]
      );
    }
  }
}

export const pushNotificationService = new PushNotificationService();
