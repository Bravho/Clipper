// Route-level regression coverage lives in SubmitRouteProduction.test.ts.
import { PostgresClipRequestRepository } from '@/repositories/postgres/PostgresClipRequestRepository';
jest.mock('@/lib/db', () => ({ pool: {} }));
test('Postgres maps LINE fields and preserves the default for legacy studio rows', async () => {
  const query = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'r', intake_channel: 'line', package_order_id: 'o', external_ref: 'x', render_lane: 'mac_mini' }] })
    .mockResolvedValueOnce({ rows: [{ id: 's' }] });
  const repo = new PostgresClipRequestRepository({ query } as never);
  expect(await repo.findById('r')).toMatchObject({ intakeChannel: 'line', packageOrderId: 'o', externalRef: 'x', renderLane: 'mac_mini' });
  expect((await repo.findById('s'))?.intakeChannel).toBe('studio');
});
