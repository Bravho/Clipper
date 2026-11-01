/**
 * check-line-test-env.cjs
 *
 * Pre-flight environment check for the Phase 2 LINE webhook test run.
 * Reads process.env ONLY — never prints values, secrets, or URLs.
 * Prints PASS or FAIL per check so Tho can verify the setup before starting the server.
 *
 * Usage:
 *   node scripts/check-line-test-env.cjs
 *
 * Expected exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */

'use strict';

let passed = 0;
let failed = 0;

function check(label, condition, failNote) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}${failNote ? '  ← ' + failNote : ''}`);
    failed++;
  }
}

console.log('');
console.log('=== LINE Phase 2 Test Environment Pre-flight Check ===');
console.log('');

// 1. Stripe safety
check(
  'STRIPE_ALLOW_LIVE is false or unset',
  process.env.STRIPE_ALLOW_LIVE !== 'true',
  'Must be false — live Stripe events are rejected'
);

check(
  'STRIPE_SECRET_KEY is a test key (sk_test_... prefix)',
  !process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_'),
  'Set STRIPE_SECRET_KEY to a Stripe test-mode key'
);

// 2. LINE test mode — at least one tagging strategy must be active
const hasTestMode = process.env.LINE_TEST_MODE === 'true';
const hasTestShopId = !!(process.env.LINE_TEST_SHOP_ID && process.env.LINE_TEST_SHOP_ID.trim());
check(
  'LINE test tagging is active (LINE_TEST_MODE=true or LINE_TEST_SHOP_ID set)',
  hasTestMode || hasTestShopId,
  'Set LINE_TEST_MODE=true or LINE_TEST_SHOP_ID=<lineUserId>'
);

// 3. Required feature flags
check(
  'REVIEW_SYSTEM_ENABLED=true',
  process.env.REVIEW_SYSTEM_ENABLED === 'true',
  'Set REVIEW_SYSTEM_ENABLED=true'
);

check(
  'LINE_INTAKE_ENABLED=true',
  process.env.LINE_INTAKE_ENABLED === 'true',
  'Set LINE_INTAKE_ENABLED=true'
);

check(
  'RENDER_LANE_ENABLED=true',
  process.env.RENDER_LANE_ENABLED === 'true',
  'Set RENDER_LANE_ENABLED=true'
);

// 4. LINE OA credentials present (existence only, values not printed)
check(
  'LINE_CHANNEL_SECRET is set',
  !!process.env.LINE_CHANNEL_SECRET,
  'Set LINE_CHANNEL_SECRET from LINE OA Manager'
);

check(
  'LINE_CHANNEL_ACCESS_TOKEN is set',
  !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
  'Set LINE_CHANNEL_ACCESS_TOKEN from LINE OA Manager'
);

check(
  'LINE_CHANNEL_ID is set',
  !!process.env.LINE_CHANNEL_ID,
  'Set LINE_CHANNEL_ID from LINE OA Manager'
);

// 5. Review system minimum requirements
check(
  'REVIEW_PREVIEW_JWT_SECRET is set',
  !!process.env.REVIEW_PREVIEW_JWT_SECRET,
  'Generate with: openssl rand -base64 32'
);

check(
  'REVIEW_PUBLIC_ORIGIN is set',
  !!process.env.REVIEW_PUBLIC_ORIGIN,
  'Set to the cloudflared tunnel URL: https://<random>.trycloudflare.com'
);

check(
  'REVIEW_ADMIN_TOKEN is set',
  !!process.env.REVIEW_ADMIN_TOKEN,
  'Generate with: openssl rand -base64 32'
);

// 6. DB credentials present
check(
  'PGHOST is set',
  !!process.env.PGHOST,
  'Set PGHOST to the database server hostname'
);

check(
  'PGDATABASE is set',
  !!process.env.PGDATABASE,
  'Set PGDATABASE to the database name'
);

// 7. Gemini key (required for AI pipeline)
check(
  'GEMINI_API_KEY is set',
  !!process.env.GEMINI_API_KEY,
  'Required for AI storyboard/script generation'
);

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('All checks passed. Safe to start the server.');
} else {
  console.log('Fix the failed checks before starting the server.');
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
