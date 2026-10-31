import { NextRequest, NextResponse } from 'next/server';
import { validatePreview } from '@/lib/review/previewToken';
import { spacesSignedUrl } from '@/lib/spaces';
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { item, payload } = await validatePreview(params.token);
    if (['script','tts','video'].includes(item.typeKey)) return NextResponse.redirect(new URL('/r/' + encodeURIComponent(params.token) + '/storyboard', request.url));
    if (!payload.storage_key) throw new Error('missing_asset');
    return NextResponse.redirect(await spacesSignedUrl(payload.storage_key, 300), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch { return NextResponse.json({ error: 'Link expired or unavailable' }, { status: 410 }); }
}
