import { timingSafeEqual, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';

/** Backend-only cache invalidation; the secret travels in the Authorization header. */
const SECRET = process.env.REVALIDATE_SECRET || '';
const digest = (value: string) => createHash('sha256').update(value).digest();

export async function POST(req: NextRequest) {
  if (SECRET.length < 32) {
    return NextResponse.json({ ok: false, error: 'Revalidation is not configured' }, { status: 503 });
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!timingSafeEqual(digest(token), digest(SECRET))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  }
  const { path, tag } = body as { path?: unknown; tag?: unknown };
  if ((!path && !tag)
    || (path !== undefined && (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 1024))
    || (tag !== undefined && (typeof tag !== 'string' || !tag || tag.length > 256))) {
    return NextResponse.json({ ok: false, error: 'Invalid path or tag' }, { status: 400 });
  }
  try {
    if (typeof path === 'string') revalidatePath(path);
    if (typeof tag === 'string') revalidateTag(tag, 'max');
    return NextResponse.json({ ok: true, path, tag });
  } catch {
    return NextResponse.json({ ok: false, error: 'Revalidation failed' }, { status: 500 });
  }
}
