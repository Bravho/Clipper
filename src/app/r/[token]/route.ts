/**
 * GET /r/[token]
 *
 * Review preview redirect.
 * Verifies a JOSE JWT preview token and redirects to a short-lived Spaces signed URL.
 * If the token is expired or revoked, redirects to /admin/review/[itemId].
 *
 * Token payload: { item_id, asset_id, storage_key, version, jti }
 * Token TTL: 30 minutes (set at issuance)
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { spacesSignedUrl } from '@/lib/spaces';

const PREVIEW_JWT_SECRET = process.env.REVIEW_PREVIEW_JWT_SECRET;
/** Short-lived presigned GET URL TTL for preview redirects. */
const PREVIEW_SPACES_TTL = 300; // 5 minutes

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;

  if (!PREVIEW_JWT_SECRET) {
    return NextResponse.json({ error: 'Preview not configured.' }, { status: 500 });
  }

  try {
    const secret = new TextEncoder().encode(PREVIEW_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    const storageKey = payload['storage_key'] as string | undefined;
    const itemId = payload['item_id'] as string | undefined;

    if (!storageKey) {
      return NextResponse.redirect(
        itemId ? `/admin/review/${itemId}` : '/admin/review',
        { status: 302 }
      );
    }

    const signedUrl = await spacesSignedUrl(storageKey, PREVIEW_SPACES_TTL);
    return NextResponse.redirect(signedUrl, { status: 302 });
  } catch {
    // Token expired, invalid, or revoked
    return NextResponse.redirect('/admin/review', { status: 302 });
  }
}
