import { SignJWT, importPKCS8 } from "jose";
import { pool } from "@/lib/db";
import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";

type NativePlatform = "ios" | "android";

interface PushDevice {
  token: string;
  platform: NativePlatform;
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

function requestPath(requestId: string): string {
  return `/dashboard/requests/${encodeURIComponent(requestId)}`;
}

async function googleAccessToken(): Promise<string> {
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
  if (!response.ok) throw new Error(`FCM OAuth failed (${response.status}).`);
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token) throw new Error("FCM OAuth returned no access token.");
  return result.access_token;
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
          data: { path: requestPath(requestId), requestId, eventKey: notice.eventKey },
          android: { priority: "high" },
        },
      }),
    }
  );
  if (!response.ok) throw new Error(`FCM send failed (${response.status}).`);
}

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

  const key = await importPKCS8(privateKey, "ES256");
  const bearer = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);
  const host =
    process.env.APNS_ENVIRONMENT === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  const response = await fetch(`${host}/3/device/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${bearer}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: notice.title, body: notice.body },
        sound: "default",
      },
      path: requestPath(requestId),
      requestId,
      eventKey: notice.eventKey,
    }),
  });
  if (!response.ok) throw new Error(`APNs send failed (${response.status}).`);
}

export class PushNotificationService {
  async registerDevice(
    userId: string,
    platform: NativePlatform,
    token: string
  ): Promise<void> {
    await pool.query(
      `INSERT INTO push_devices (user_id, platform, token)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         enabled = TRUE,
         updated_at = NOW(),
         last_seen_at = NOW()`,
      [userId, platform, token]
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

  async notifyPipelineStep(
    jobId: string,
    requestId: string,
    step: VideoGenerationStep
  ): Promise<void> {
    const notice = NOTICES[step];
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
      `SELECT token, platform
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
        } else {
          await sendIos(device.token, notice, requestId);
        }
        delivered = true;
      } catch (err) {
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
