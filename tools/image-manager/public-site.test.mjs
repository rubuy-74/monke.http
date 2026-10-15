import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

test('public image response follows selections and falls back to SVG', async () => {
  const originalDirectory = process.cwd();
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  const root = await mkdtemp(path.join(tmpdir(), 'monke-public-'));
  try {
    const { rawImageResponse } = await vite.ssrLoadModule('/src/lib/raw-image.ts');
    const { getVisibleStatuses } = await vite.ssrLoadModule('/src/lib/visible-statuses.ts');
    const images = path.join(root, 'public/images');
    await mkdir(images, { recursive: true });
    process.chdir(root);
    assert.equal((await getVisibleStatuses()).length, 63);

    await writeFile(path.join(images, '404.svg'), '<svg/>');
    let response = await rawImageResponse('404');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'image/svg+xml');
    assert.equal(await response.text(), '<svg/>');

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await writeFile(path.join(images, '404.jpg'), jpeg);
    response = await rawImageResponse('404');
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(response.headers.get('Cache-Control'), 'no-cache');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);

    await rm(path.join(images, '404.jpg'));
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await writeFile(path.join(images, '404.png'), png);
    response = await rawImageResponse('404');
    assert.equal(response.headers.get('Content-Type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);

    await rm(path.join(images, '404.png'));
    response = await rawImageResponse('404');
    assert.equal(response.headers.get('Content-Type'), 'image/svg+xml');
    assert.equal((await rawImageResponse('999')).status, 404);
    assert.equal((await rawImageResponse('../../secret')).status, 404);
    assert.equal((await rawImageResponse('200')).status, 404);
  } finally {
    process.chdir(originalDirectory);
    await vite.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('production hides placeholders from listings, raw responses, and random choices', async () => {
  const originalDirectory = process.cwd();
  const vite = await createServer({
    configFile: false,
    define: { 'import.meta.env.DEV': 'false' },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  const root = await mkdtemp(path.join(tmpdir(), 'monke-production-'));
  try {
    const { rawImageResponse } = await vite.ssrLoadModule('/src/lib/raw-image.ts');
    const { getVisibleStatuses } = await vite.ssrLoadModule('/src/lib/visible-statuses.ts');
    const { GET: random } = await vite.ssrLoadModule('/src/pages/random.ts');
    const images = path.join(root, 'public/images');
    await mkdir(images, { recursive: true });
    await writeFile(path.join(images, '404.svg'), '<svg/>');
    await writeFile(path.join(images, '200.svg'), '<svg/>');
    process.chdir(root);

    assert.deepEqual(await getVisibleStatuses(), []);
    assert.equal((await rawImageResponse('404')).status, 404);
    assert.equal((await rawImageResponse('200')).status, 404);
    const emptyRandom = await random({ url: new URL('https://monke.test/random') });
    assert.equal(emptyRandom.headers.get('Location'), 'https://monke.test/');

    await writeFile(path.join(images, '404.jpeg'), Buffer.from([0xff, 0xd8, 0xff]));
    assert.deepEqual((await getVisibleStatuses()).map(status => status.code), [404]);
    assert.equal((await rawImageResponse('404')).headers.get('Content-Type'), 'image/jpeg');
    for (let i = 0; i < 10; i++) {
      assert.equal((await random({ url: new URL('https://monke.test/random') })).headers.get('Location'), 'https://monke.test/description/404');
    }

    await writeFile(path.join(images, '200.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    await writeFile(path.join(images, '999.jpg'), 'unknown status');
    await mkdir(path.join(images, '201.jpg'));
    assert.deepEqual((await getVisibleStatuses()).map(status => status.code), [200, 404]);
    assert.equal((await rawImageResponse('200')).headers.get('Content-Type'), 'image/png');
    await rm(path.join(images, '404.jpeg'));
    assert.deepEqual((await getVisibleStatuses()).map(status => status.code), [200]);
    assert.equal((await rawImageResponse('404')).status, 404);
  } finally {
    process.chdir(originalDirectory);
    await vite.close();
    await rm(root, { recursive: true, force: true });
  }
});
