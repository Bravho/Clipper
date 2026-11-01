/**
 * adminReviewApi.test.ts
 *
 * Tests for GET /api/admin/review and POST /api/admin/review/[id]/decision.
 * Route handlers are imported directly and called with mocked NextRequest objects.
 * The @/repositories module is mocked so no DB is needed.
 */

import { NextRequest } from 'next/server';

// ─── Shared mock state ───────────────────────────────────────────────────────
let mockItems: unknown[] = [];
let mockDecideResult: unknown = null;
let mockDecideError: Error | null = null;

jest.mock('@/repositories', () => ({
  createReviewService: () => ({
    listPending: jest.fn(async () => mockItems),
    decide: jest.fn(async () => {
      if (mockDecideError) throw mockDecideError;
      return mockDecideResult;
    }),
  }),
}));

// ─── Lazy imports after mock setup ───────────────────────────────────────────
import { GET } from '@/app/api/admin/review/route';
import { POST } from '@/app/api/admin/review/[id]/decision/route';

const TOKEN = 'super-secret-token';

function makeGetRequest(token?: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/review', {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function makePostRequest(id: string, body: unknown, token?: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/review/${id}/decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.REVIEW_ADMIN_TOKEN = TOKEN;
  mockItems = [];
  mockDecideResult = null;
  mockDecideError = null;
});

afterEach(() => {
  delete process.env.REVIEW_ADMIN_TOKEN;
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/review
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/review', () => {
  test('returns 503 when REVIEW_ADMIN_TOKEN is not set', async () => {
    delete process.env.REVIEW_ADMIN_TOKEN;
    const res = await GET(makeGetRequest(TOKEN));
    expect(res.status).toBe(503);
  });

  test('returns 401 when token is missing', async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  test('returns 401 when token is wrong', async () => {
    const res = await GET(makeGetRequest('wrong-token'));
    expect(res.status).toBe(401);
  });

  test('returns 200 with items when token is correct', async () => {
    mockItems = [{ id: 'item-1', typeKey: 'video' }];
    const res = await GET(makeGetRequest(TOKEN));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe('item-1');
  });

  test('returns empty items array when queue is empty', async () => {
    mockItems = [];
    const res = await GET(makeGetRequest(TOKEN));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/review/[id]/decision
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/review/[id]/decision', () => {
  const PARAMS = { params: { id: 'item-1' } };

  test('returns 503 when REVIEW_ADMIN_TOKEN is not set', async () => {
    delete process.env.REVIEW_ADMIN_TOKEN;
    const res = await POST(makePostRequest('item-1', { version: 1, decision: 'approve' }, TOKEN), PARAMS);
    expect(res.status).toBe(503);
  });

  test('returns 401 when token is missing', async () => {
    const res = await POST(makePostRequest('item-1', { version: 1, decision: 'approve' }), PARAMS);
    expect(res.status).toBe(401);
  });

  test('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/admin/review/item-1/decision', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(400);
  });

  test('returns 400 when decision is missing', async () => {
    const res = await POST(makePostRequest('item-1', { version: 1 }, TOKEN), PARAMS);
    expect(res.status).toBe(400);
  });

  test('returns 400 when version is missing', async () => {
    const res = await POST(makePostRequest('item-1', { decision: 'approve' }, TOKEN), PARAMS);
    expect(res.status).toBe(400);
  });

  test('returns 400 when decision is invalid', async () => {
    const res = await POST(makePostRequest('item-1', { version: 1, decision: 'delete' }, TOKEN), PARAMS);
    expect(res.status).toBe(400);
  });

  test('returns 400 when manual_reply is missing replyText', async () => {
    const res = await POST(makePostRequest('item-1', { version: 1, decision: 'manual_reply' }, TOKEN), PARAMS);
    expect(res.status).toBe(400);
  });

  test('returns 200 with updated item on successful approve', async () => {
    mockDecideResult = { id: 'item-1', status: 'approved', version: 2 };
    const res = await POST(makePostRequest('item-1', { version: 1, decision: 'approve' }, TOKEN), PARAMS);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.item.status).toBe('approved');
  });

  test('returns 200 with updated item on successful manual_reply', async () => {
    mockDecideResult = { id: 'item-1', status: 'approved', version: 2 };
    const res = await POST(
      makePostRequest('item-1', { version: 1, decision: 'manual_reply', replyText: 'ตอบลูกค้า' }, TOKEN),
      PARAMS,
    );
    expect(res.status).toBe(200);
  });

  test('returns 409 on version_conflict', async () => {
    const err = new Error('version_conflict') as Error & { code?: string };
    err.code = 'version_conflict';
    mockDecideError = err;
    const res = await POST(makePostRequest('item-1', { version: 1, decision: 'approve' }, TOKEN), PARAMS);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('version_conflict');
  });

  test('returns 409 on render_not_ready', async () => {
    const err = new Error('render_not_ready') as Error & { code?: string };
    err.code = 'render_not_ready';
    mockDecideError = err;
    const res = await POST(makePostRequest('item-1', { version: 1, decision: 'approve' }, TOKEN), PARAMS);
    expect(res.status).toBe(409);
  });
});
