jest.mock('@/repositories', () => ({ createReviewService: jest.fn(), uploadedAssetRepository: { findById: jest.fn() }, reviewItemRepository: { findOpenByJobGate: jest.fn(async () => null) } }));
import { gateAudience, onLineReviewGate, LINE_REVIEW_GATES } from '@/services/review/lineReviewGate';
import { createReviewService } from '@/repositories';
import { assertDurationAllowed, assertRevisionAllowed } from '@/services/review/ReviewService';
test('production gate hook chooses one audience and visits storyboard, voice, then video', async () => {
  process.env.REVIEW_SYSTEM_ENABLED = 'true';
  const createItem = jest.fn();
  (createReviewService as jest.Mock).mockReturnValue({ createItem });
  const request = { id: 'r', userId: 'shop', intakeChannel: 'line', shopReviewPreferences: { storyboard: true, voice: true } } as never;
  for (const step of LINE_REVIEW_GATES) await onLineReviewGate(request, { id: 'j', currentStep: step } as never);
  expect(createItem.mock.calls.map(([input]) => input.typeKey)).toEqual(['script','tts','video']);
  expect(createItem.mock.calls.map(([input]) => input.payload.audience)).toEqual(['shop','shop','admin']);
  expect(gateAudience({ shopReviewPreferences: { storyboard: false } } as never, LINE_REVIEW_GATES[0])).toBe('admin');
  await onLineReviewGate({ intakeChannel: 'studio' } as never, { currentStep: LINE_REVIEW_GATES[0] } as never);
  expect(createItem).toHaveBeenCalledTimes(3);
});
test('production limits accept boundaries and reject excess, zero, and non-finite durations', () => {
  expect(() => assertRevisionAllowed(1)).not.toThrow();
  expect(() => assertRevisionAllowed(2)).toThrow('max_revisions');
  expect(() => assertDurationAllowed(90)).not.toThrow();
  for (const duration of [91,0,-1,NaN,Infinity]) expect(() => assertDurationAllowed(duration)).toThrow();
});
