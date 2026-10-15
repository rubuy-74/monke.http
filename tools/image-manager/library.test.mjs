import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLibrary, MAX_UPLOAD } from './library.mjs';

export const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
export const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

export async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/data'), { recursive: true });
  await mkdir(path.join(root, 'public/images'), { recursive: true });
  await writeFile(path.join(root, 'src/data/statuses.json'), JSON.stringify([
    { code: 404, phrase: 'Not <Found> & "lost"', group: 'Client errors' },
    { code: 200, phrase: 'OK', group: 'Success' },
  ]));
  for (const code of [404, 200]) await writeFile(path.join(root, `public/images/${code}.svg`), '<svg>original</svg>');
  return { root, library: await createLibrary({ root }) };
}

test('upload preserves bytes, derives extensions, and does not publish', async t => {
  const { root, library } = await fixture(t);
  assert.deepEqual(await library.list(404), []);
  const id = await library.upload(404, jpeg);
  assert.match(id, /^[0-9a-f-]{36}\.jpg$/);
  assert.deepEqual(await library.readAlternative(404, id), jpeg);
  assert.deepEqual(await readFile(path.join(root, `tools/image-manager/library/404/${id}`)), jpeg);
  assert.deepEqual(await library.list(404), [{ id, selected: false }]);
  assert.equal((await library.active(404)).extension, 'svg');
});

test('description edits persist paragraphs and preserve other statuses and fields', async t => {
  const { root, library } = await fixture(t);
  const file = path.join(root, 'src/data/statuses.json');
  const before = JSON.parse(await readFile(file, 'utf8'));
  await library.saveDescription(404, ' First paragraph.\r\n\r\n Second paragraph. ');
  const after = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(after[0], { ...before[0], description: ['First paragraph.', 'Second paragraph.'] });
  assert.deepEqual(after[1], before[1]);
  assert.deepEqual(library.status(404).description, after[0].description);
  assert.deepEqual((await createLibrary({ root })).status(404).description, after[0].description);
  for (const text of ['', '   ', null, 'x'.repeat(20001)]) {
    await assert.rejects(library.saveDescription(404, text), /description/);
  }
  await assert.rejects(library.saveDescription(999, 'Unknown'), /Unknown status/);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), after);
});

test('selection persists, switches formats, and keeps all private originals and SVGs', async t => {
  const { root, library } = await fixture(t);
  const jpg = await library.upload(404, jpeg);
  const pngID = await library.upload(404, png);
  await writeFile(path.join(root, 'public/images/404.jpeg'), 'legacy');
  await library.select(404, jpg);
  assert.deepEqual((await library.active(404)).bytes, jpeg);
  await library.select(404, pngID);
  assert.deepEqual((await library.active(404)).bytes, png);
  assert.deepEqual((await readdir(path.join(root, 'public/images'))).sort(), ['200.svg', '404.png', '404.svg']);
  const reopened = await createLibrary({ root });
  assert.equal((await reopened.list(404)).find(image => image.selected).id, pngID);
  await reopened.select(404, jpg);
  assert.equal((await reopened.active(404)).extension, 'jpg');
  assert.deepEqual(await reopened.readAlternative(404, jpg), jpeg);
  assert.deepEqual(await reopened.readAlternative(404, pngID), png);
  assert.equal(await readFile(path.join(root, 'public/images/404.svg'), 'utf8'), '<svg>original</svg>');
  assert.equal(await readFile(path.join(root, 'public/images/200.svg'), 'utf8'), '<svg>original</svg>');
  assert.ok(!(await readdir(path.join(root, 'public/images'))).some(name => name.endsWith('.tmp')));
});

test('deleting an unselected image preserves selection; deleting selected restores SVG', async t => {
  const { library } = await fixture(t);
  const selected = await library.upload(404, jpeg);
  const other = await library.upload(404, png);
  await library.select(404, selected);
  await library.delete(404, other);
  assert.equal((await library.list(404))[0].selected, true);
  assert.equal((await library.active(404)).extension, 'jpg');
  await library.delete(404, selected);
  assert.deepEqual(await library.list(404), []);
  assert.equal((await library.active(404)).extension, 'svg');
  await assert.rejects(library.readAlternative(404, selected), /not found/);
});

test('reset removes only status rasters and keeps alternatives', async t => {
  const { root, library } = await fixture(t);
  const id = await library.upload(404, png);
  await library.select(404, id);
  await writeFile(path.join(root, 'public/images/404.jpeg'), jpeg);
  await writeFile(path.join(root, 'public/images/404.jpg'), jpeg);
  await writeFile(path.join(root, 'public/images/200.jpg'), jpeg);
  await library.reset(404);
  await library.reset(404);
  assert.deepEqual(await library.list(404), [{ id, selected: false }]);
  assert.equal((await library.active(404)).extension, 'svg');
  assert.equal((await library.active(200)).extension, 'jpg');
  assert.deepEqual((await readdir(path.join(root, 'public/images'))).sort(), ['200.jpg', '200.svg', '404.svg']);
});

test('rejects invalid bytes, oversize uploads, unknown statuses, and invalid or missing IDs', async t => {
  const { library } = await fixture(t);
  for (const bytes of [Buffer.alloc(0), Buffer.from('<svg/>'), Buffer.from([0xff, 0xd8]), png.subarray(0, 7)]) {
    await assert.rejects(library.upload(404, bytes), /JPEG or PNG/);
  }
  await assert.rejects(library.upload(404, Buffer.alloc(MAX_UPLOAD + 1)), { status: 413 });
  const exactLimit = Buffer.alloc(MAX_UPLOAD);
  png.copy(exactLimit);
  assert.match(await library.upload(404, exactLimit), /\.png$/);
  for (const code of ['../404', '0404', 999, null, {}, '404/../../']) {
    for (const method of ['list', 'upload', 'select', 'delete', 'reset', 'active', 'readAlternative']) {
      await assert.rejects(library[method](code, jpeg), /Unknown status/);
    }
  }
  for (const id of ['../selection.json', 'selection.json', '/tmp/image.jpg', 'x.png', null, 'a'.repeat(36) + '.jpg']) {
    for (const method of ['select', 'delete', 'readAlternative']) {
      await assert.rejects(library[method](404, id), /Invalid alternative ID/);
    }
  }
  const missing = '00000000-0000-4000-8000-000000000000.jpg';
  await assert.rejects(library.select(404, missing), /not found/);
  const otherStatus = await library.upload(200, jpeg);
  await assert.rejects(library.select(404, otherStatus), /not found/);
});
