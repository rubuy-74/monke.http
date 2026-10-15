import type { APIRoute } from 'astro';
import { getVisibleStatuses } from '../lib/visible-statuses';
import { notFoundResponse } from '../lib/not-found';

export const GET: APIRoute = async ({ url }) => {
  const code = url.searchParams.get('code') ?? '';
  if (!/^[1-5]\d{2}$/.test(code)) {
    return new Response('Enter a three-digit HTTP status code.', { status: 400 });
  }
  const statuses = await getVisibleStatuses();
  if (!statuses.some(status => String(status.code) === code)) {
    return notFoundResponse();
  }
  return new Response(null, {
    status: 302,
    headers: { Location: `/${code}`, 'Cache-Control': 'no-store' },
  });
};
