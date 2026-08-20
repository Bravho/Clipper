import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { isAutoApprovedGate } from "@/config/pipelinePresentation";

/**
 * Shared push-notification constants.
 *
 * Lives in `config/` (not in PushNotificationService) because BOTH sides need
 * the same values and the service is server-only: it imports `pg`, so a client
 * component importing from it would drag the database driver into the browser
 * bundle.
 */

/**
 * The Android notification channel pipeline notices are delivered on.
 *
 * Android 8+ silently DROPS a notification whose `channel_id` does not exist on
 * the device, so this string has to be identical in two places: the channel the
 * app creates at registration time (NativePushRegistration) and the
 * `android.notification.channel_id` the server sends (PushNotificationService).
 */
export const ANDROID_CHANNEL_ID = "rclipper_pipeline";

/** User-visible channel name, shown in Android's per-app notification settings. */
export const ANDROID_CHANNEL_NAME = "ความคืบหน้าการสร้างวิดีโอ";

export const ANDROID_CHANNEL_DESCRIPTION =
  "แจ้งเตือนเมื่อขั้นตอนการสร้างวิดีโอเสร็จและต้องการให้คุณตรวจสอบ";

/**
 * Where the client keeps the native FCM/APNs token it registered.
 *
 * `signOutEverywhere()` reads this key to unregister the device on sign-out —
 * without it a signed-out phone keeps receiving another account's notifications.
 * Keep the literal in step with the copy in `src/lib/mobile/signOutEverywhere.ts`.
 */
export const PUSH_TOKEN_STORAGE_KEY = "rclipper-push-token";

/** Remembers that the user accepted the in-app pre-prompt, so it is asked once. */
export const PUSH_OPT_IN_STORAGE_KEY = "rclipper-native-push-opt-in";

/**
 * Should reaching `step` stay silent instead of notifying the requester?
 *
 * The express lane ("อนุมัติและทำทุกขั้นตอนที่เหลืออัตโนมัติ", set at the scene-plan gate)
 * clears every later review gate within seconds of the pipeline arriving at it.
 * Pushing "ready for review" for those would summon the requester to a screen
 * that is already gone — several times over — when the whole point of the button
 * was that they do not want to be involved again. So an express-lane job stays
 * silent until the pipeline reaches something that genuinely needs them:
 *
 *   - AwaitingDistributionReview — the final step, files ready to download. This
 *     one always notifies; it is the single notice an express-lane job produces.
 *   - Failed — never suppressed, on any lane.
 *   - Any gate the lane does NOT auto-approve (e.g. the per-scene script gate):
 *     the job genuinely parks there waiting for the requester, so suppressing it
 *     would strand them on a silent spinner.
 *
 * Deriving this from `isAutoApprovedGate` rather than a second hand-written list
 * is deliberate: the UI already re-labels exactly those gates as "processing",
 * and a gate added to one list but not the other would either notify about a
 * screen the requester never sees, or silence a gate that really is waiting.
 */
export function shouldSuppressPipelineNotice(
  step: VideoGenerationStep,
  autoApproveRemaining: boolean | undefined
): boolean {
  return autoApproveRemaining === true && isAutoApprovedGate(step);
}
