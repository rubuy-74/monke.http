import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_UPLOAD = 10 * 1024 * 1024;
const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const imageID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png)$/;
const rasterExtensions = ['jpg', 'jpeg', 'png'];

export function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function atomicWrite(destination, bytes) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function regularFile(file) {
  try {
    return (await lstat(file)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Callers must serialize mutations. The HTTP server owns that queue.
export async function createLibrary({ root = defaultRoot } = {}) {
  const statuses = JSON.parse(await readFile(path.join(root, 'src/data/statuses.json'), 'utf8'));
  const byCode = new Map(statuses.map(status => [String(status.code), status]));
  const directory = path.join(root, 'tools/image-manager/library');
  const published = path.join(root, 'public/images');

  function status(code) {
    if (!['string', 'number'].includes(typeof code) || !byCode.has(String(code))) {
      throw invalid('Unknown status code.', 404);
    }
    return byCode.get(String(code));
  }

  function codeDirectory(code) {
    return path.join(directory, String(status(code).code));
  }

  function alternativePath(code, id) {
    const dir = codeDirectory(code);
    if (typeof id !== 'string' || !imageID.test(id)) throw invalid('Invalid alternative ID.');
    return path.join(dir, id);
  }

  async function selectedID(code) {
    try {
      const { selected } = JSON.parse(await readFile(path.join(codeDirectory(code), 'selection.json'), 'utf8'));
      if (selected !== null && (typeof selected !== 'string' || !imageID.test(selected))) {
        throw new Error('Invalid selection metadata.');
      }
      return selected;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function list(code) {
    const dir = codeDirectory(code);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries = [];
    }
    const selected = await selectedID(code);
    return entries.filter(entry => entry.isFile() && imageID.test(entry.name))
      .map(entry => ({ id: entry.name, selected: entry.name === selected }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function upload(code, bytes) {
    const dir = codeDirectory(code);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_UPLOAD) {
      throw invalid('Upload must be at most 10 MB.', 413);
    }
    let extension;
    if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      extension = 'jpg';
    } else if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      extension = 'png';
    } else {
      throw invalid('Only JPEG or PNG image bytes are accepted.');
    }
    const id = `${randomUUID()}.${extension}`;
    await atomicWrite(path.join(dir, id), bytes);
    return id;
  }

  async function readAlternative(code, id) {
    const file = alternativePath(code, id);
    if (!(await regularFile(file))) throw invalid('Alternative not found.', 404);
    return readFile(file);
  }

  async function removeRasters(code, keep) {
    status(code);
    for (const extension of rasterExtensions) {
      if (extension !== keep) await rm(path.join(published, `${code}.${extension}`), { force: true });
    }
  }

  async function select(code, id) {
    const bytes = await readAlternative(code, id);
    const extension = path.extname(id).slice(1);
    // Publish completely before removing the previous format. Originals stay private.
    await atomicWrite(path.join(published, `${code}.${extension}`), bytes);
    await removeRasters(code, extension);
    await atomicWrite(path.join(codeDirectory(code), 'selection.json'), JSON.stringify({ selected: id }));
  }

  async function reset(code) {
    await removeRasters(code);
    await atomicWrite(path.join(codeDirectory(code), 'selection.json'), JSON.stringify({ selected: null }));
  }

  async function deleteAlternative(code, id) {
    const file = alternativePath(code, id);
    if (!(await regularFile(file))) throw invalid('Alternative not found.', 404);
    if (await selectedID(code) === id) await reset(code);
    await rm(file);
  }

  async function active(code) {
    status(code);
    for (const extension of [...rasterExtensions, 'svg']) {
      const file = path.join(published, `${code}.${extension}`);
      if (await regularFile(file)) return { extension, bytes: await readFile(file) };
    }
    throw invalid('No published image found.', 404);
  }

  async function saveDescription(code, text) {
    const current = status(code);
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) {
      throw invalid('Enter a description between 1 and 20,000 characters.');
    }
    const description = text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).map(p => p.trim());
    const file = path.join(root, 'src/data/statuses.json');
    const latest = JSON.parse(await readFile(file, 'utf8'));
    const target = latest.find(entry => entry.code === current.code);
    if (!target) throw invalid('Unknown status code.', 404);
    target.description = description;
    await atomicWrite(file, JSON.stringify(latest, null, 2) + '\n');
    current.description = description;
  }

  return { statuses, status, list, upload, select, delete: deleteAlternative, reset, active, readAlternative, saveDescription };
}
