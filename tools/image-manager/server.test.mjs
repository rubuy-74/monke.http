import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import { createManagerServer, MAX_BODY } from './server.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-manager-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/data'), { recursive: true });
  await mkdir(path.join(root, 'public/images'), { recursive: true });
  await writeFile(path.join(root, 'src/data/statuses.json'), JSON.stringify([{ code: 404, phrase: '<Lost> & "Found"', group: 'Client errors' }]));
  await writeFile(path.join(root, 'public/images/404.svg'), '<svg/>');
  const server = await createManagerServer({ root, port: 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(`${origin}/action`, { method: 'POST', headers: { Origin: origin }, body, redirect: 'manual' });
  return { server, origin, post, root };
}

test('HTTP UI, upload/select/delete/reset, escaped flash, and whitelisted image routes', async t => {
  const { origin, post } = await fixture(t);
  const overview = await fetch(origin);
  assert.equal(overview.status, 200);
  assert.match(await overview.text(), /1 statuses/);
  const page = await fetch(`${origin}/?code=404&flash=${encodeURIComponent('<script>alert("x")</script>')}`);
  const html = await page.text();
  assert.match(html, /&lt;Lost&gt; &amp; &quot;Found&quot;/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<script>'));
  const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const form = new FormData();
  form.set('code', '404');
  form.set('action', 'upload');
  form.set('image', new Blob([bytes], { type: 'text/html' }), '../../wrong.jpg');
  const uploaded = await post(form);
  assert.equal(uploaded.status, 303);
  const collection = await (await fetch(`${origin}/?code=404`)).text();
  const id = /\/library\/404\/([a-f0-9-]+\.png)/.exec(collection)[1];
  const privateImage = await fetch(`${origin}/library/404/${id}`);
  assert.equal(privateImage.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await privateImage.arrayBuffer()), bytes);
  assert.equal((await fetch(`${origin}/image/404`)).headers.get('content-type'), 'image/svg+xml');
  assert.equal((await post(new URLSearchParams({ code: '404', action: 'select', id }))).status, 303);
  assert.equal((await fetch(`${origin}/image/404`)).headers.get('content-type'), 'image/png');
  assert.match(await (await fetch(`${origin}/?code=404`)).text(), /card selected/);
  assert.equal((await post(new URLSearchParams({ code: '404', action: 'reset' }))).status, 303);
  assert.equal((await fetch(`${origin}/image/404`)).headers.get('content-type'), 'image/svg+xml');
  await post(new URLSearchParams({ code: '404', action: 'select', id }));
  assert.equal((await post(new URLSearchParams({ code: '404', action: 'delete', id }))).status, 303);
  assert.equal((await fetch(`${origin}/image/404`)).headers.get('content-type'), 'image/svg+xml');
  assert.equal((await fetch(`${origin}/library/404/${id}`)).status, 404);
  for (const route of ['/library/404/selection.json', '/src/data/statuses.json', '/library/404/%2e%2e%2fselection.json', '/image/999', '/?code=999']) {
    assert.ok([400, 404].includes((await fetch(`${origin}${route}`)).status));
  }
  const invalid = await post(new URLSearchParams({ code: '404', action: 'select', id: '<bad>' }));
  assert.equal(invalid.status, 303);
  assert.match(invalid.headers.get('location'), /Invalid/);
});

test('rejects foreign Hosts and missing/foreign/mismatched Origins before parsing', async t => {
  const { origin } = await fixture(t);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = http.get(origin, { headers: { Host: 'evil.example' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(foreignHost, 403);
  for (const value of [undefined, 'null', 'https://evil.example', origin.replace('127.0.0.1', 'localhost'), `${origin}/`]) {
    const response = await fetch(`${origin}/action`, {
      method: 'POST', headers: value ? { Origin: value } : {}, body: 'not a valid form',
    });
    assert.equal(response.status, 403);
  }
  const localhost = origin.replace('127.0.0.1', 'localhost');
  const allowed = await new Promise((resolve, reject) => {
    const req = http.request(`${origin}/action`, {
      method: 'POST', headers: {
        Host: new URL(localhost).host, Origin: localhost,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(new URLSearchParams({ code: '404', action: 'reset' }).toString());
  });
  assert.equal(allowed, 303);
});

test('manager form pages preserve same-origin POST headers for browser submissions', async t => {
  const { origin, post } = await fixture(t);
  const page = await fetch(`${origin}/?code=404`);
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  assert.match(await page.text(), /method="post" action="\/action" data-crop-form/);
  const saved = await post(new URLSearchParams({ code: '404', action: 'crop', x: '30', y: '70' }));
  assert.equal(saved.status, 303);
  const updated = await (await fetch(`${origin}/?code=404`)).text();
  assert.match(updated, /object-position:30% 70%/);
});

test('description dialog saves paragraphs and safely escapes edited text', async t => {
  const { origin, post } = await fixture(t);
  const description = 'New first paragraph.\n\n</textarea><script>alert(1)</script>';
  const saved = await post(new URLSearchParams({ code: '404', action: 'description', description }));
  assert.equal(saved.status, 303);
  assert.match(saved.headers.get('location'), /Description\+saved/);
  const page = await (await fetch(`${origin}/?code=404`)).text();
  assert.match(page, /<dialog id="description-editor"/);
  assert.match(page, /New first paragraph\./);
  assert.match(page, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.ok(!page.includes('<script>alert(1)</script>'));
  const invalid = await post(new URLSearchParams({ code: '404', action: 'description', description: '' }));
  assert.match(invalid.headers.get('location'), /Enter\+a\+description/);
});

test('concurrent format selections leave one published raster matching persisted selection', async t => {
  const { origin, post } = await fixture(t);
  for (const hex of ['ffd8ffe000104a464946', '89504e470d0a1a0a00000000']) {
    const form = new FormData();
    form.set('code', '404');
    form.set('action', 'upload');
    form.set('image', new Blob([Buffer.from(hex, 'hex')]), 'image');
    assert.equal((await post(form)).status, 303);
  }
  const page = await (await fetch(`${origin}/?code=404`)).text();
  const ids = [...page.matchAll(/\/library\/404\/([a-f0-9-]+\.(?:jpg|png))/g)].map(match => match[1]);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    post(new URLSearchParams({ code: '404', action: 'select', id: ids[index % 2] }))));
  assert.ok(responses.every(response => response.status === 303));
  const selectedPage = await (await fetch(`${origin}/?code=404`)).text();
  const selected = /class="card selected"><img src="\/library\/404\/([a-f0-9-]+\.(?:jpg|png))/.exec(selectedPage)[1];
  const active = await fetch(`${origin}/image/404`);
  const alternative = await fetch(`${origin}/library/404/${selected}`);
  assert.equal(active.headers.get('content-type'), alternative.headers.get('content-type'));
  assert.deepEqual(Buffer.from(await active.arrayBuffer()), Buffer.from(await alternative.arrayBuffer()));
});

test('bounds declared and streamed bodies, rejects malformed forms, and survives errors', async t => {
  const { origin, post } = await fixture(t);
  const malformed = await fetch(`${origin}/action`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'multipart/form-data; boundary=missing' }, body: 'broken',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await post(Buffer.alloc(MAX_BODY + 1))).status, 413);
  const streamedStatus = await new Promise((resolve, reject) => {
    const req = http.request(`${origin}/action`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    for (let i = 0; i < 12; i++) req.write(Buffer.alloc(1024 * 1024));
    req.end();
  });
  assert.equal(streamedStatus, 413);
  const invalidImage = new FormData();
  invalidImage.set('code', '404');
  invalidImage.set('action', 'upload');
  invalidImage.set('image', new Blob(['not a PNG']), 'fake.png');
  assert.equal((await post(invalidImage)).status, 303);
  assert.equal((await post(new URLSearchParams({ code: '404', action: 'reset' }))).status, 303);
  assert.equal((await fetch(origin)).status, 200);
});

test('crop editor saves active and alternative framing with validated HTTP forms', async t => {
  const { origin, post, root } = await fixture(t);
  const initial = await (await fetch(`${origin}/?code=404`)).text();
  assert.match(initial, /data-crop-form/);
  assert.match(initial, /aspect-ratio:4\/3/);
  assert.match(initial, /object-position:50% 50%/);
  const saved = await post(new URLSearchParams({ code: '404', action: 'crop', x: '20', y: '80' }));
  assert.equal(saved.status, 303);
  assert.match(await (await fetch(`${origin}/?code=404`)).text(), /object-position:20% 80%/);

  const upload = new FormData();
  upload.set('code', '404');
  upload.set('action', 'upload');
  upload.set('image', new Blob([Buffer.from('ffd8ffe000104a464946', 'hex')]), 'monkey.jpg');
  await post(upload);
  const collection = await (await fetch(`${origin}/?code=404`)).text();
  const id = /\/library\/404\/([a-f0-9-]+\.jpg)/.exec(collection)[1];
  const editor = await fetch(`${origin}/?code=404&crop=${id}`);
  assert.equal(editor.status, 200);
  assert.match(await editor.text(), /Editing this private alternative/);
  const alternate = await post(new URLSearchParams({ code: '404', action: 'crop', id, x: '60', y: '10' }));
  assert.match(alternate.headers.get('location'), /crop=/);
  assert.match(await (await fetch(`${origin}/?code=404`)).text(), /object-position:20% 80%/);
  await post(new URLSearchParams({ code: '404', action: 'select', id }));
  assert.match(await (await fetch(`${origin}/?code=404`)).text(), /object-position:60% 10%/);
  const metadata = JSON.parse(await readFile(path.join(root, 'src/data/statuses.json'), 'utf8'));
  assert.deepEqual(metadata[0].imagePosition, { x: 60, y: 10 });
  const invalid = await post(new URLSearchParams({ code: '404', action: 'crop', x: '101', y: '50' }));
  assert.match(invalid.headers.get('location'), /between\+0\+and\+100/);
  assert.equal((await fetch(`${origin}/?code=404&crop=../../secret`)).status, 400);
  const missing = '00000000-0000-4000-8000-000000000000.jpg';
  assert.equal((await fetch(`${origin}/?code=404&crop=${missing}`)).status, 404);
  assert.equal((await fetch(`${origin}/library/404/${id}.crop.json`)).status, 400);
});

test('crop sliders update preview immediately and Center restores both positions', async t => {
  const { origin } = await fixture(t);
  const script = await (await fetch(`${origin}/manager.js`)).text();
  const preview = { style: {} };
  const outputs = {};
  const listeners = {};
  const center = {};
  const form = {
    elements: { x: { id: 'crop-x', value: '15' }, y: { id: 'crop-y', value: '85' } },
    addEventListener: (event, listener) => { listeners[event] = listener; },
    querySelector: selector => {
      if (selector === '[data-center-crop]') return {
        addEventListener: (event, listener) => { center[event] = listener; },
      };
      outputs[selector] ??= {};
      return outputs[selector];
    },
  };
  vm.runInNewContext(script, {
    document: { querySelector: selector => selector === '[data-crop-form]' ? form : selector === '[data-crop-preview]' ? preview : null },
  });
  assert.equal(preview.style.objectPosition, '15% 85%');
  form.elements.x.value = '30';
  listeners.input();
  assert.equal(preview.style.objectPosition, '30% 85%');
  assert.equal(outputs['output[for="crop-x"]'].value, '30%');
  center.click();
  assert.equal(preview.style.objectPosition, '50% 50%');
  assert.equal(form.elements.x.value, '50');
  assert.equal(form.elements.y.value, '50');
});
