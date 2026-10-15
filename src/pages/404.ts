import { rawImageResponse } from '../lib/raw-image';

export function GET() {
  return rawImageResponse('404');
}
