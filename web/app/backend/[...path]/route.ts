
import { NextRequest, NextResponse } from 'next/server';

// Server-side reverse proxy.
// The browser never needs the API host or Supabase credentials.

export const runtime = 'nodejs';

const MAX_BODY = 1024 * 1024;

function backend(): string {
  const raw =
    process.env.API_INTERNAL_URL ||
    (process.env.API_INTERNAL_HOST
      ? `http://${process.env.API_INTERNAL_HOST}:${process.env.API_INTERNAL_PORT || '4000'}`
      : 'http://localhost:4000');

  const url = new URL(raw);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid API_INTERNAL_URL configuration');
  }

  return url.origin;
}

function publicOrigin(): string {
  const raw = process.env.WEB_ORIGIN;

  if (!raw) {
    throw new Error('WEB_ORIGIN is not configured');
  }

  const url = new URL(raw);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    raw !== url.origin
  ) {
    throw new Error('Invalid WEB_ORIGIN configuration');
  }

  return url.origin;
}

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const method = req.method.toUpperCase();

  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return NextResponse.json(
      { message: 'Method not allowed' },
      { status: 405 }
    );
  }

  // Validate the browser origin against the configured
  // public website URL, not the internal proxy URL.
  if (method !== 'GET') {
    let allowedOrigin: string;

    try {
      allowedOrigin = publicOrigin();
    } catch {
      return NextResponse.json(
        { message: 'Invalid website origin configuration' },
        { status: 500 }
      );
    }

    const origin = req.headers.get('origin');

    if (origin !== allowedOrigin) {
      return NextResponse.json(
        { message: 'Origin denied' },
        { status: 403 }
      );
    }
  }

  const { path } = await ctx.params;

  if (
    !Array.isArray(path) ||
    !path.length ||
    path.some(
      segment => !/^[a-zA-Z0-9._-]{1,120}$/.test(segment)
    )
  ) {
    return NextResponse.json(
      { message: 'Invalid path' },
      { status: 400 }
    );
  }

  const len = Number(req.headers.get('content-length') || 0);

  if (len > MAX_BODY) {
    return NextResponse.json(
      { message: 'Payload too large' },
      { status: 413 }
    );
  }

  let body: ArrayBuffer | undefined;

  if (method !== 'GET') {
    body = await req.arrayBuffer();

    if (body.byteLength > MAX_BODY) {
      return NextResponse.json(
        { message: 'Payload too large' },
        { status: 413 }
      );
    }
  }

  try {
    const target = new URL(
      `${backend()}/${path.join('/')}`
    );

    target.search = req.nextUrl.search;

    const headers = new Headers();

    const cookie = req.headers.get('cookie');

    if (cookie) {
      headers.set('cookie', cookie);
    }

    headers.set('accept', 'application/json');
    headers.set('X-Jawaher-Client', 'web');

    if (method !== 'GET') {
      headers.set('content-type', 'application/json');
    }

    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000)
    });

    const outHeaders = new Headers();

    outHeaders.set(
      'content-type',
      upstream.headers.get('content-type') ||
        'application/json'
    );

    outHeaders.set('cache-control', 'no-store');

    for (const value of upstream.headers.getSetCookie()) {
      outHeaders.append('set-cookie', value);
    }

    return new NextResponse(
      await upstream.arrayBuffer(),
      {
        status: upstream.status,
        headers: outHeaders
      }
    );
  } catch (error) {
    console.error('Jawaher API proxy error:', error);

    return NextResponse.json(
      {
        message:
          'تعذر الوصول إلى خادم جواهر؛ راجعي إعدادات النشر'
      },
      { status: 502 }
    );
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE
};
