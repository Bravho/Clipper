/**
 * Tests for STUDIO_ONLY exemption of LINE-intake requests.
 *
 * The gate at POST /api/requests/[id]/submit checks isStudioOnly().
 * LINE-intake requests (intakeChannel === 'line') must bypass it.
 */

import { MockClipRequestRepository } from '@/repositories/mock/MockClipRequestRepository';
import { Platform } from '@/domain/enums/Platform';
import { RequestStatus } from '@/domain/enums/RequestStatus';

const VALID_BRIEF = {
  title: 'Test LINE video',
  description: 'A description that is definitely long enough to pass validation.',
  targetAudience: 'Business owners',
  targetPlatforms: [Platform.Facebook] as [Platform, ...Platform[]],
  preferredStyle: 'Professional',
  preferredLanguage: 'Thai',
  durationSeconds: 30,
};

describe('STUDIO_ONLY exemption: LINE-intake requests', () => {
  it('studio (default) request does NOT have intakeChannel=line', async () => {
    const repo = new MockClipRequestRepository(new Map());
    const req = await repo.create({ userId: 'user-studio', ...VALID_BRIEF });
    expect(req.intakeChannel).toBeUndefined();
  });

  it('intakeChannel truthy check: "line" is truthy', () => {
    const channel = 'line' as 'studio' | 'web' | 'line' | undefined;
    expect(channel === 'line').toBe(true);
  });

  it('intakeChannel truthy check: undefined is falsy', () => {
    const channel = undefined as 'studio' | 'web' | 'line' | undefined;
    expect(channel === 'line').toBe(false);
  });

  it('intakeChannel truthy check: "studio" is falsy for LINE check', () => {
    const channel = 'studio' as 'studio' | 'web' | 'line' | undefined;
    expect(channel === 'line').toBe(false);
  });
});

describe('STUDIO_ONLY gate logic (unit)', () => {
  /**
   * Mirrors the gate logic from the submit route:
   *   if (isStudioOnly() && !rendersOnDevice) {
   *     const isLineIntake = current?.intakeChannel === 'line';
   *     if (!isLineIntake && (!current || current.status === Draft)) → reject
   *   }
   */
  function shouldReject(opts: {
    studioOnly: boolean;
    rendersOnDevice: boolean;
    intakeChannel?: 'studio' | 'web' | 'line';
    status?: RequestStatus;
  }): boolean {
    const { studioOnly, rendersOnDevice, intakeChannel, status } = opts;
    if (!studioOnly || rendersOnDevice) return false;
    const isLineIntake = intakeChannel === 'line';
    if (isLineIntake) return false;
    if (!status || status === RequestStatus.Draft) return true;
    return false;
  }

  it('rejects a non-LINE draft when studio_only=true and !rendersOnDevice', () => {
    expect(shouldReject({
      studioOnly: true,
      rendersOnDevice: false,
      intakeChannel: undefined,
      status: RequestStatus.Draft,
    })).toBe(true);
  });

  it('does NOT reject a LINE intake even when studio_only=true', () => {
    expect(shouldReject({
      studioOnly: true,
      rendersOnDevice: false,
      intakeChannel: 'line',
      status: RequestStatus.Draft,
    })).toBe(false);
  });

  it('does NOT reject when rendersOnDevice=true (phone render path)', () => {
    expect(shouldReject({
      studioOnly: true,
      rendersOnDevice: true,
      intakeChannel: undefined,
      status: RequestStatus.Draft,
    })).toBe(false);
  });

  it('does NOT reject when studioOnly=false (gate disabled)', () => {
    expect(shouldReject({
      studioOnly: false,
      rendersOnDevice: false,
      intakeChannel: undefined,
      status: RequestStatus.Draft,
    })).toBe(false);
  });

  it('does NOT reject an already-Submitted request (idempotent recovery)', () => {
    expect(shouldReject({
      studioOnly: true,
      rendersOnDevice: false,
      intakeChannel: undefined,
      status: RequestStatus.Submitted,
    })).toBe(false);
  });
});
