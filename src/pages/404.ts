import { rawImageResponse } from '../lib/raw-image';
import type { APIRoute } from 'astro';
import { notFoundResponse } from '../lib/not-found';

export const GET: APIRoute = ({ url }) => {
  if (url.pathname !== '/404') {
    return notFoundResponse();
  }
  return rawImageResponse('404');
};
