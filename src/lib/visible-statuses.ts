import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Dirent } from 'node:fs';
import { statuses } from './statuses';

export async function getVisibleStatuses() {
  if (import.meta.env.DEV) return statuses;

  let files: Dirent[];
  try {
    files = await readdir(resolve(process.cwd(), 'public/images'), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const publishedCodes = new Set(files.filter(file => file.isFile() && /^\d{3}\.(jpg|jpeg|png)$/.test(file.name))
    .map(file => Number(file.name.split('.')[0])));
  return statuses.filter(status => publishedCodes.has(status.code));
}
