import { rawImageResponse } from '../lib/raw-image';

export async function GET({ params }: { params: { code?: string } }) {
  return rawImageResponse(params.code ?? '');
}
