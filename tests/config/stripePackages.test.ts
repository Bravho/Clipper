import { createHmac } from 'crypto';
import { PACKAGES, findPackageByCode, STRIPE_WEBHOOK_TOLERANCE_SECONDS } from '@/config/stripePackages';
import { verifyStripeSignature } from '@/lib/stripe/stripeSignature';

describe('stripePackages config', () => {
  it('has exactly 4 packages', () => {
    expect(PACKAGES).toHaveLength(4);
  });

  it('trial package has correct price and clips', () => {
    const p = findPackageByCode('trial');
    expect(p).toBeDefined();
    expect(p!.priceBaht).toBe(299);
    expect(p!.clipsIncluded).toBe(2);
    expect(p!.revisionsPerClip).toBe(2);
    expect(p!.maxDurationSeconds).toBe(90);
  });

  it('starter package is 1490 baht / 8 clips', () => {
    const p = findPackageByCode('starter');
    expect(p!.priceBaht).toBe(1490);
    expect(p!.clipsIncluded).toBe(8);
  });

  it('growth package is 2690 baht / 12 clips', () => {
    const p = findPackageByCode('growth');
    expect(p!.priceBaht).toBe(2690);
    expect(p!.clipsIncluded).toBe(12);
  });

  it('pro package is 4290 baht / 16 clips', () => {
    const p = findPackageByCode('pro');
    expect(p!.priceBaht).toBe(4290);
    expect(p!.clipsIncluded).toBe(16);
  });

  it('all packages have revisionsPerClip=2', () => {
    for (const p of PACKAGES) {
      expect(p.revisionsPerClip).toBe(2);
    }
  });

  it('all packages have maxDurationSeconds=90', () => {
    for (const p of PACKAGES) {
      expect(p.maxDurationSeconds).toBe(90);
    }
  });

  it('returns undefined for unknown code', () => {
    expect(findPackageByCode('unknown-code')).toBeUndefined();
  });

  it('tolerance is 300 seconds', () => {
    expect(STRIPE_WEBHOOK_TOLERANCE_SECONDS).toBe(300);
  });
});

describe('verifyStripeSignature', () => {
  const SECRET = 'whsec_test_secret';

  function makeHeader(body: string, nowSeconds?: number): string {
    const t = nowSeconds ?? Math.floor(Date.now() / 1000);
    const payload = `${t}.${body}`;
    const sig = createHmac('sha256', SECRET).update(payload).digest('hex');
    return `t=${t},v1=${sig}`;
  }

  it('accepts a valid signature', () => {
    const body = '{"type":"checkout.session.completed"}';
    const header = makeHeader(body);
    const result = verifyStripeSignature(Buffer.from(body), header, SECRET);
    expect(result.ok).toBe(true);
  });

  it('rejects a missing header', () => {
    const body = '{}';
    const result = verifyStripeSignature(Buffer.from(body), null, SECRET);
    expect(result.ok).toBe(false);
  });

  it('rejects a tampered body', () => {
    const body = '{"original":true}';
    const header = makeHeader(body);
    const result = verifyStripeSignature(Buffer.from('{"tampered":true}'), header, SECRET);
    expect(result.ok).toBe(false);
  });

  it('rejects a stale timestamp beyond tolerance', () => {
    const body = '{}';
    const staleTimestamp = Math.floor(Date.now() / 1000) - 400;
    const header = makeHeader(body, staleTimestamp);
    const result = verifyStripeSignature(Buffer.from(body), header, SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/skew/i);
  });

  it('accepts a timestamp within tolerance window', () => {
    const body = '{"ok":true}';
    const recentTimestamp = Math.floor(Date.now() / 1000) - 200;
    const header = makeHeader(body, recentTimestamp);
    const result = verifyStripeSignature(Buffer.from(body), header, SECRET, Math.floor(Date.now() / 1000));
    expect(result.ok).toBe(true);
  });
});
