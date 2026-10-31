/**
 * JOSE JWT utilities for review preview tokens.
 *
 * Tokens are signed with REVIEW_PREVIEW_JWT_SECRET (HS256).
 * Payload: { item_id, asset_id, storage_key, version, type_key, jti }
 * TTL: 30 minutes by default.
 *
 * Revocation is tracked in review_preview_revocations (see migration 048).
 * Call revokePreviewToken(jti) to blacklist a token before it expires.
 */

import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import { pool } from '@/lib/db';
import { reviewItemRepository } from '@/repositories';

const PREVIEW_TTL_SECONDS = 30 * 60; // 30 minutes

export interface PreviewTokenPayload {
  item_id: string;
  asset_id?: string;
  storage_key?: string;
  version: number;
  type_key: string;
  jti: string;
}

function getSecret(): Uint8Array {
  const s = process.env.REVIEW_PREVIEW_JWT_SECRET;
  if (!s) throw new Error('REVIEW_PREVIEW_JWT_SECRET not set');
  return new TextEncoder().encode(s);
}

/**
 * Issue a signed JWT preview token for a review item asset.
 */
export async function issuePreviewToken(input: {
  itemId: string;
  assetId?: string;
  storageKey?: string;
  version: number;
  typeKey: string;
  ttlSeconds?: number;
}): Promise<string> {
  const jti = randomUUID();
  const ttl = input.ttlSeconds ?? PREVIEW_TTL_SECONDS;
  const secret = getSecret();

  return new SignJWT({
    item_id: input.itemId,
    asset_id: input.assetId,
    storage_key: input.storageKey,
    version: input.version,
    type_key: input.typeKey,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret);
}

/**
 * Revoke a preview token by its jti.
 * Inserts into review_preview_revocations so the route handler rejects it.
 */
export async function revokePreviewToken(
  jti: string,
  itemId?: string,
  expiresAt?: Date
): Promise<void> {
  const expires = expiresAt ?? new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000);
  await pool.query(
    `INSERT INTO review_preview_revocations (jti, review_item_id, expires_at)
     VALUES ($1, $2, $3) ON CONFLICT (jti) DO NOTHING`,
    [jti, itemId ?? null, expires.toISOString()]
  );
}

/**
 * Verify a preview token without checking revocation (for internal use only).
 * The route handler checks revocation separately.
 */
export async function verifyPreviewToken(token: string): Promise<PreviewTokenPayload> {
  const secret = getSecret();
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], requiredClaims: ['exp', 'jti', 'item_id', 'version', 'type_key'] });
  return {
    item_id: payload['item_id'] as string,
    asset_id: payload['asset_id'] as string | undefined,
    storage_key: payload['storage_key'] as string | undefined,
    version: payload['version'] as number,
    type_key: payload['type_key'] as string,
    jti: payload.jti as string,
  };
}

// Shared by redirect, editable page, and mutation endpoint. Fail closed on DB errors.
export async function validatePreview(token: string) {
  const payload = await verifyPreviewToken(token);
  const { rows } = await pool.query('SELECT 1 FROM review_preview_revocations WHERE jti=$1', [payload.jti]);
  if (rows.length) throw new Error('revoked');
  const item = await reviewItemRepository.findById(payload.item_id);
  if (!item || !['pending','edited'].includes(item.status) || item.version !== payload.version ||
      item.typeKey !== payload.type_key || item.expiresAt.getTime() <= Date.now()) throw new Error('invalid_preview');
  if (payload.storage_key && !item.assetRefs.some(ref => ref.storage_key === payload.storage_key &&
      (!payload.asset_id || ref.asset_id === payload.asset_id))) throw new Error('asset_mismatch');
  return { item, payload };
}
