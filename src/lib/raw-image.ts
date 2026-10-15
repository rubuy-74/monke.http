import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getStatus } from './statuses';
import { notFoundResponse } from './not-found';

export async function rawImageResponse(code: string) {
  const status = getStatus(code);

  if (!status) {
    return notFoundResponse();
  }

  for (const [extension, contentType] of [
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['svg', 'image/svg+xml'],
  ]) {
    if (extension === 'svg' && !import.meta.env.DEV) continue;
    let image: Buffer;
    try {
      image = await readFile(resolve(process.cwd(), 'public', 'images', `${status.code}.${extension}`));
			console.log(image)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

		console.log(contentType)
    return new Response(new Uint8Array(image), {
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': contentType,
      },
    });
  }

  return notFoundResponse();
}
