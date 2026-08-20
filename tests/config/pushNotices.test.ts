import { VideoGenerationStep } from "@/domain/enums/VideoGenerationStep";
import { isAutoApprovedGate } from "@/config/pipelinePresentation";
import { shouldSuppressPipelineNotice } from "@/config/push";

/**
 * The requester's contract with the express lane: press "approve everything from
 * here" at the scene-plan gate and the phone stays quiet until the finished
 * files are ready to download. These tests pin that behaviour, because the
 * suppression set and the pipeline's gates live in different files and a new
 * gate added to one but not the other silently breaks it in one of two ways —
 * either a burst of notices for screens the requester never sees, or a job
 * parked on a real gate with no notification at all.
 */

/** Every gate the express lane clears on the requester's behalf. */
const AUTO_APPROVED = [
  VideoGenerationStep.AwaitingVideoApproval,
  VideoGenerationStep.AwaitingAnimationApproval,
  VideoGenerationStep.AwaitingFinalApproval,
  VideoGenerationStep.AwaitingOverlayApproval,
  VideoGenerationStep.AwaitingAdditionalRatios,
];

describe("express-lane push suppression", () => {
  it("stays silent on every gate the lane approves automatically", () => {
    for (const step of AUTO_APPROVED) {
      expect(shouldSuppressPipelineNotice(step, true)).toBe(true);
    }
  });

  it("still notifies on the final step, which is the whole point of the lane", () => {
    expect(
      shouldSuppressPipelineNotice(VideoGenerationStep.AwaitingDistributionReview, true)
    ).toBe(false);
  });

  it("never suppresses a failure, on any lane", () => {
    expect(shouldSuppressPipelineNotice(VideoGenerationStep.Failed, true)).toBe(false);
    expect(shouldSuppressPipelineNotice(VideoGenerationStep.Failed, false)).toBe(false);
  });

  it("notifies on gates the lane does NOT clear, so the job cannot park silently", () => {
    // The per-scene script gate is not auto-approved: _autoAdvanceIfEnabled has
    // no case for it, so a job reaching it really is waiting for the requester.
    expect(
      shouldSuppressPipelineNotice(VideoGenerationStep.AwaitingSceneScriptApproval, true)
    ).toBe(false);
    expect(
      isAutoApprovedGate(VideoGenerationStep.AwaitingSceneScriptApproval)
    ).toBe(false);
  });

  it("suppresses nothing at all on a normal (non-express) job", () => {
    for (const step of Object.values(VideoGenerationStep)) {
      expect(shouldSuppressPipelineNotice(step, false)).toBe(false);
      expect(shouldSuppressPipelineNotice(step, undefined)).toBe(false);
    }
  });

  it("suppression tracks the UI's auto-approved set exactly", () => {
    // If these two ever drift, the pipeline either notifies about a screen shown
    // as "processing" or silences one shown as "waiting for you".
    for (const step of Object.values(VideoGenerationStep)) {
      expect(shouldSuppressPipelineNotice(step, true)).toBe(isAutoApprovedGate(step));
    }
  });
});
