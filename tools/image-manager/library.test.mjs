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

test('published framing works without private alternatives and never changes image bytes', async t => {
  const { root, library } = await fixture(t);
  await writeFile(path.join(root, 'public/images/404.jpg'), jpeg);
  assert.deepEqual(await library.crop(404), { x: 50, y: 50 });
  await library.saveCrop(404, null, '25', '80');
  assert.deepEqual(await library.crop(404), { x: 25, y: 80 });
  assert.deepEqual((await createLibrary({ root })).status(404).imagePosition, { x: 25, y: 80 });
  assert.deepEqual((await library.active(404)).bytes, jpeg);
  assert.deepEqual(await library.list(404), []);
  await library.saveDescription(404, 'Updated text.');
  assert.deepEqual(library.status(404).imagePosition, { x: 25, y: 80 });
  assert.deepEqual(library.status(404).description, ['Updated text.']);
});

test('alternatives remember individual crops and selecting restores their framing', async t => {
  const { root, library } = await fixture(t);
  const first = await library.upload(404, jpeg);
  const second = await library.upload(404, png);
  await library.saveCrop(404, first, 0, 100);
  assert.equal(library.status(404).imagePosition, undefined);
  await library.select(404, first);
  assert.deepEqual(library.status(404).imagePosition, { x: 0, y: 100 });
  await library.saveCrop(404, null, 10, 90);
  assert.deepEqual(await library.crop(404, first), { x: 10, y: 90 });
  await library.select(404, second);
  assert.deepEqual(library.status(404).imagePosition, { x: 50, y: 50 });
  await library.saveCrop(404, first, 20, 70);
  assert.deepEqual(library.status(404).imagePosition, { x: 50, y: 50 });
  await library.select(404, first);
  assert.deepEqual(library.status(404).imagePosition, { x: 20, y: 70 });
  await library.saveCrop(404, first, 30, 60);
  assert.deepEqual(library.status(404).imagePosition, { x: 30, y: 60 });
  assert.deepEqual(await library.readAlternative(404, first), jpeg);
  assert.deepEqual(await library.readAlternative(404, second), png);
  assert.deepEqual((await library.active(404)).bytes, jpeg);
  const reopened = await createLibrary({ root });
  assert.deepEqual(await reopened.crop(404, first), { x: 30, y: 60 });
  assert.deepEqual(await reopened.crop(404), { x: 30, y: 60 });
});

test('reset and deletion clear public framing but preserve other alternative crops', async t => {
  const { root, library } = await fixture(t);
  const first = await library.upload(404, jpeg);
  const second = await library.upload(404, png);
  await library.saveCrop(404, first, 5, 15);
  await library.saveCrop(404, second, 85, 95);
  await library.select(404, first);
  await library.reset(404);
  assert.deepEqual(await library.crop(404), { x: 50, y: 50 });
  assert.deepEqual(await library.crop(404, first), { x: 5, y: 15 });
  await library.select(404, first);
  await library.delete(404, first);
  assert.deepEqual(await library.crop(404), { x: 50, y: 50 });
  assert.deepEqual(await library.crop(404, second), { x: 85, y: 95 });
  const saved = JSON.parse(await readFile(path.join(root, 'src/data/statuses.json'), 'utf8'));
  assert.ok(!Object.hasOwn(saved[0], 'imagePosition'));
  const entries = await readdir(path.join(root, 'tools/image-manager/library/404'));
  assert.ok(!entries.includes(`${first}.crop.json`));
});

test('invalid crop input cannot change metadata, image bytes, or unrelated status edits', async t => {
  const { root, library } = await fixture(t);
  const id = await library.upload(404, jpeg);
  await library.select(404, id);
  const file = path.join(root, 'src/data/statuses.json');
  const external = JSON.parse(await readFile(file, 'utf8'));
  external[1].description = ['Keep this external edit.'];
  await writeFile(file, JSON.stringify(external));
  await library.saveCrop(404, null, 25.5, 60);
  const before = await readFile(file, 'utf8');
  for (const value of ['', ' ', null, false, {}, NaN, Infinity, -1, 101, '50%;color:red']) {
    await assert.rejects(library.saveCrop(404, id, value, 50), /between 0 and 100/);
    await assert.rejects(library.saveCrop(404, id, 50, value), /between 0 and 100/);
  }
  await assert.rejects(library.saveCrop(404, '../secret', 50, 50), /Invalid alternative/);
  await assert.rejects(library.saveCrop(999, null, 50, 50), /Unknown status/);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(JSON.parse(before)[1].description, ['Keep this external edit.']);
  assert.deepEqual((await library.active(404)).bytes, jpeg);
});
