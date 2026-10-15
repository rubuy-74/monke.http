import { getVisibleStatuses } from '../lib/visible-statuses';

export async function GET({ url }: { url: URL }) {
  const statuses = await getVisibleStatuses();
  if (statuses.length === 0) return Response.redirect(new URL('/', url), 302);
  const status = statuses[Math.floor(Math.random() * statuses.length)];
  return Response.redirect(new URL(`/description/${status.code}`, url), 302);
}
