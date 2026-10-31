import Stripe from 'stripe';
import { NextRequest } from 'next/server';
jest.mock('@/repositories/index', () => ({ servicePackageRepository: {
  findOrderByStripeSession: jest.fn(async () => null), findOrderById: jest.fn(), updateOrderStatus: jest.fn() } }));
import { servicePackageRepository } from '@/repositories/index';
import { POST } from '@/app/api/stripe/webhook/route';
const repo = servicePackageRepository as jest.Mocked<typeof servicePackageRepository>;
const stripe = new Stripe('sk_test_fixture');
beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  repo.findOrderById.mockResolvedValue({ id: 'order', status: 'pending_payment', packageCode: 'trial' } as never);
  jest.clearAllMocks();
});
async function send(overrides: Record<string, unknown> = {}, type = 'checkout.session.completed', live = false, valid = true) {
  const payload = JSON.stringify({ id: 'evt', type, livemode: live, data: { object: {
    id: 'cs_fixture', client_reference_id: 'order', payment_status: 'paid', amount_total: 29900, currency: 'thb', ...overrides } } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: valid ? 'whsec_fixture' : 'wrong' });
  return POST(new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signature } }));
}
test.each(['checkout.session.completed','checkout.session.async_payment_succeeded'])('Stripe constructEvent verifies %s and links order by client reference', async type => {
  const spy = jest.spyOn(stripe.webhooks, 'constructEvent');
  expect((await send({},type)).status).toBe(200);
  expect(repo.findOrderById).toHaveBeenCalledWith('order');
  expect(repo.updateOrderStatus).toHaveBeenCalledWith('order','active','stripe:cs_fixture');
  spy.mockRestore();
});
test.each([{ payment_status: 'unpaid' }, { amount_total: 29899 }, { amount_total: undefined }, { currency: undefined }, { currency: 'usd' }])('does not activate invalid payment %j', async overrides => {
  await send(overrides);
  expect(repo.updateOrderStatus).not.toHaveBeenCalled();
});
test('rejects bad signature and live events', async () => {
  expect((await send({},undefined,false,false)).status).toBe(401);
  expect((await send({},undefined,true)).status).toBe(400);
  expect(repo.updateOrderStatus).not.toHaveBeenCalled();
});
