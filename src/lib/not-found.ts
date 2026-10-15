import page from './not-found.html?raw';

export function notFoundResponse() {
  return new Response(page, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
