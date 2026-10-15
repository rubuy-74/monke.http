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
    const { GET: go } = await vite.ssrLoadModule('/src/pages/go.ts');
    const { GET: image404 } = await vite.ssrLoadModule('/src/pages/404.ts');
    const images = path.join(root, 'public/images');
    await mkdir(images, { recursive: true });
    process.chdir(root);
    assert.equal((await getVisibleStatuses()).length, 63);
    const goResponse = await go({ url: new URL('https://localhost/go?code=404') });
    assert.equal(goResponse.headers.get('Location'), '/404');
    assert.equal(goResponse.headers.get('Cache-Control'), 'no-store');
    for (const code of ['', '99', 'abc', '999', '0404', '//evil.test', '../404']) {
      assert.equal((await go({ url: new URL(`https://localhost/go?code=${encodeURIComponent(code)}`) })).status, 400);
    }
    assert.equal((await go({ url: new URL('https://localhost/go?code=499') })).status, 404);

    await writeFile(path.join(images, '404.svg'), '<svg/>');
    for (const pathname of ['/description/404', '/description/200', '/random', '/unknown']) {
      const missing = await image404({ url: new URL(pathname, 'https://monke.test') });
      assert.equal(missing.status, 404);
      assert.match(missing.headers.get('Content-Type'), /^text\/html/);
      const html = await missing.text();
      assert.match(html, /no monkey found for that status code/);
      assert.match(html, /\/images\/banana-peel\.svg/);
    }
    assert.equal((await image404({ url: new URL('https://monke.test/404') })).status, 200);
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
    const unknown = await rawImageResponse('999');
    assert.equal(unknown.status, 404);
    assert.match(await unknown.text(), /no monkey found for that status code/);
    assert.equal((await rawImageResponse('../../secret')).status, 404);
    const missingPicture = await rawImageResponse('200');
    assert.equal(missingPicture.status, 404);
    assert.match(await missingPicture.text(), /no monkey found for that status code/);
  } finally {
    process.chdir(originalDirectory);
    await vite.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('production only exposes published images and codes for the gallery and dialog', async () => {
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
    const { GET: go } = await vite.ssrLoadModule('/src/pages/go.ts');
    const images = path.join(root, 'public/images');
    await mkdir(images, { recursive: true });
    await writeFile(path.join(images, '404.svg'), '<svg/>');
    await writeFile(path.join(images, '200.svg'), '<svg/>');
    process.chdir(root);

    assert.deepEqual(await getVisibleStatuses(), []);
    assert.equal((await rawImageResponse('404')).status, 404);
    assert.equal((await rawImageResponse('200')).status, 404);
    assert.equal((await go({ url: new URL('https://localhost/go?code=404') })).status, 404);

    await writeFile(path.join(images, '404.jpeg'), Buffer.from([0xff, 0xd8, 0xff]));
    assert.deepEqual((await getVisibleStatuses()).map(status => status.code), [404]);
    assert.equal((await rawImageResponse('404')).headers.get('Content-Type'), 'image/jpeg');
    assert.equal((await go({ url: new URL('https://localhost/go?code=404') })).headers.get('Location'), '/404');

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
