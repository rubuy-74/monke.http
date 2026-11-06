import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createLibrary, invalid } from './library.mjs';

export const MAX_BODY = 11 * 1024 * 1024;
const html = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml' };

const css = `
:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;background:#191712;color:#f5edda}
*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:32px 24px 64px}
a{color:#f1cc65;text-underline-offset:4px}header{border-bottom:1px solid #4a4130;padding-bottom:24px;margin-bottom:28px}
.eyebrow{color:#dbc072;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem}h1,h2,p{margin:0 0 16px}h1{font-size:clamp(2rem,5vw,3.8rem);line-height:1.15;letter-spacing:-.04em}h2{font-size:1.35rem}
.muted,small{color:#c1b59e}.toolbar,.actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.toolbar{margin-top:24px}
label{display:block;font-weight:600}select,input,button{font:inherit;max-width:100%}select,input{padding:10px;border:1px solid #796a49;background:#242017;color:inherit;border-radius:8px}
button,.button{cursor:pointer;background:#f1cc65;color:#221d11;border:1px solid transparent;border-radius:8px;padding:9px 16px;font-weight:650;text-decoration:none;display:inline-block}button.secondary{background:#30291d;border-color:#796a49;color:#f5edda}button.danger{background:transparent;border-color:#b08776;color:#f0bda4}
:focus-visible{outline:3px solid #ffe5a0;outline-offset:4px}.hero{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:32px}.panel,.card{background:#242017;border:1px solid #4a4130;border-radius:16px;padding:22px}.preview{width:100%;height:320px;object-fit:contain;background:#15130f;border-radius:10px;display:block}.panel form{margin-top:20px}.panel input{width:100%;margin:8px 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}.card img{width:100%;height:180px;object-fit:contain;background:#15130f;border-radius:8px}.card.selected{border-color:#f1cc65}.card .actions{margin-top:16px}.badge{color:#f1cc65;font-size:.85rem;margin-top:12px}.flash{padding:14px 18px;border-left:3px solid #f1cc65;background:#30291d;margin-bottom:24px;overflow-wrap:anywhere}.status-link{display:block;text-decoration:none;color:inherit}.status-link strong{color:#f1cc65;font-size:1.6rem}.status-link:hover{border-color:#f1cc65}footer{margin-top:36px;color:#c1b59e;font-size:.85rem}@media(max-width:650px){main{padding:24px 16px}.hero{grid-template-columns:1fr}.preview{height:250px}.toolbar select{width:100%}.panel,.card{padding:18px}}
textarea{width:100%;padding:12px;background:#191712;color:#f5edda;border:1px solid #796a49;font:inherit;line-height:1.6;resize:vertical}dialog{width:min(640px,calc(100% - 32px));max-height:85vh;overflow:auto;background:#242017;color:#f5edda;border:1px solid #796a49;padding:24px}dialog::backdrop{background:#000a}
.framing{margin-bottom:28px}.crop-frame{aspect-ratio:4/3;max-width:600px;overflow:hidden;background:#15130f;border-radius:10px}.crop-frame img{display:block;width:100%;height:100%;object-fit:cover}.crop-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;max-width:600px}.crop-controls input{accent-color:#f1cc65;padding:0}.crop-controls output{font-variant-numeric:tabular-nums;font-weight:400}@media(max-width:650px){.crop-controls{grid-template-columns:1fr;gap:0}}
`;

const managerScript = String.raw`
document.querySelector('[data-edit-description]')?.addEventListener('click', () => document.querySelector('#description-editor').showModal());
const cropForm = document.querySelector('[data-crop-form]');
if (cropForm) {
  const preview = document.querySelector('[data-crop-preview]');
  const update = () => {
    const { x, y } = cropForm.elements;
    preview.style.objectPosition = x.value + '% ' + y.value + '%';
    for (const input of [x, y]) cropForm.querySelector('output[for="' + input.id + '"]').value = input.value + '%';
  };
  cropForm.addEventListener('input', update);
  cropForm.querySelector('[data-center-crop]').addEventListener('click', () => {
    cropForm.elements.x.value = cropForm.elements.y.value = '50';
    update();
  });
  update();
}
`;

function actionForm(code, action, label, id, style = 'secondary') {
  return `<form method="post" action="/action"><input type="hidden" name="code" value="${html(code)}"><input type="hidden" name="action" value="${html(action)}">${id ? `<input type="hidden" name="id" value="${html(id)}">` : ''}<button class="${html(style)}" type="submit">${html(label)}</button></form>`;
}

async function render(library, url) {
  const code = url.searchParams.get('code');
  const current = code === null ? null : library.status(code);
  const options = library.statuses.map(status => `<option value="${html(status.code)}"${String(status.code) === code ? ' selected' : ''}>${html(status.code)} ${html(status.phrase)}</option>`).join('');
  let content;
  let framing = '';
  if (current) {
    const alternatives = await library.list(code);
    const cropID = url.searchParams.get('crop');
    const crop = await library.crop(code, cropID);
    const cropSource = cropID === null ? `/image/${code}` : `/library/${code}/${cropID}`;
    framing = `<section class="panel framing"><h2>Gallery framing</h2><p class="muted">${cropID === null ? 'Editing the published image framing.' : 'Editing this private alternative\'s framing. If selected, saving also updates its published framing.'}</p>${cropID === null ? '' : `<p><a href="/?code=${html(code)}">Edit published image framing</a></p>`}<div class="crop-frame"><img data-crop-preview src="${html(cropSource)}" alt="Gallery framing preview for status ${html(code)}" style="object-position:${html(crop.x)}% ${html(crop.y)}%"></div><form method="post" action="/action" data-crop-form><input type="hidden" name="code" value="${html(code)}"><input type="hidden" name="action" value="crop">${cropID === null ? '' : `<input type="hidden" name="id" value="${html(cropID)}">`}<div class="crop-controls"><div><label for="crop-x">Horizontal position <output for="crop-x">${html(crop.x)}%</output></label><input id="crop-x" name="x" type="range" min="0" max="100" step="any" value="${html(crop.x)}"></div><div><label for="crop-y">Vertical position <output for="crop-y">${html(crop.y)}%</output></label><input id="crop-y" name="y" type="range" min="0" max="100" step="any" value="${html(crop.y)}"></div></div><div class="actions"><button class="secondary" type="button" data-center-crop>Center</button><button type="submit">Save framing</button></div></form></section>`;
    content = `<section class="hero"><div><p class="eyebrow">${html(current.group)}</p><h1>${html(code)}<br>${html(current.phrase)}</h1><p class="muted">Published image</p><img class="preview" src="/image/${html(code)}" alt="Current image for ${html(code)} ${html(current.phrase)}"></div><div class="panel"><h2>Find this status a face</h2><p class="muted">Keep a private collection, then choose one image to publish. Your SVG original always stays safe.</p><form method="post" action="/action" enctype="multipart/form-data"><input type="hidden" name="code" value="${html(code)}"><input type="hidden" name="action" value="upload"><label for="image">Add a JPEG or PNG</label><input id="image" type="file" name="image" accept="image/jpeg,image/png" required aria-describedby="upload-help"><small id="upload-help">Maximum 10 MB. Uploading does not select the image.</small><p><button type="submit">Add to collection</button></p></form>${actionForm(code, 'reset', 'Reset to SVG')}<p class="muted">Reset keeps your alternatives.</p></div></section><h2>Alternatives <span class="muted">(${alternatives.length})</span></h2><div class="grid">${alternatives.map((image, index) => `<article class="card${image.selected ? ' selected' : ''}"><img src="/library/${html(code)}/${html(image.id)}" alt="Alternative ${index + 1} for status ${html(code)}" loading="lazy"><p class="badge">${image.selected ? 'Selected' : 'Alternative'} &middot; ${html(image.id.split('.').pop().toUpperCase())}</p><div class="actions"><a href="/?${html(new URLSearchParams({ code, crop: image.id }))}">Edit framing</a>${actionForm(code, 'select', image.selected ? 'Select again' : 'Select', image.id)}${actionForm(code, 'delete', 'Delete', image.id, 'danger')}</div></article>`).join('')}</div>${alternatives.length ? '' : '<p class="muted">No alternatives yet. Add your first image above.</p>'}`;
  } else {
    const counts = await Promise.all(library.statuses.map(async status => ({ ...status, count: (await library.list(status.code)).length })));
    content = `<h1>A face for every status.</h1><p class="muted">${counts.length} statuses &middot; ${counts.reduce((sum, status) => sum + status.count, 0)} private alternatives</p><div class="grid">${counts.map(status => `<a class="card status-link" href="/?code=${html(status.code)}"><strong>${html(status.code)}</strong><br>${html(status.phrase)}<br><small>${status.count} alternatives</small></a>`).join('')}</div>`;
  }
  const editor = current ? `<section class="panel"><h2>Description</h2><p>${html((current.description ?? []).join('\n\n'))}</p><button type="button" data-edit-description>Edit description</button><dialog id="description-editor" aria-labelledby="editor-title"><h2 id="editor-title">${html(code)} description</h2><form method="post" action="/action"><input type="hidden" name="code" value="${html(code)}"><input type="hidden" name="action" value="description"><label for="description">Description</label><p class="muted">Separate paragraphs with a blank line.</p><textarea id="description" name="description" rows="10" maxlength="20000" required>${html((current.description ?? []).join('\n\n'))}</textarea><p><button type="submit">Save description</button></p></form><form method="dialog"><button class="secondary">Cancel</button></form></dialog></section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${current ? `${html(code)} ${html(current.phrase)} | ` : ''}Image manager</title><style>${css}</style><script src="/manager.js" defer></script></head><body><main><header><div class="eyebrow">http.monke / local workshop</div><a href="/">Image manager</a><form class="toolbar" method="get" action="/"><label for="code">Jump to status</label><select id="code" name="code">${options}</select><button type="submit">Open status</button></form></header>${url.searchParams.has('flash') ? `<p class="flash" role="status">${html(url.searchParams.get('flash'))}</p>` : ''}${framing}${editor}${content}<footer>Local only. Private alternatives stay outside the public site. JPEG and PNG bytes are copied, never converted.</footer></main></body></html>`;
}

async function parseForm(req, origin) {
  if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > MAX_BODY)) {
    throw invalid('Request body exceeds 11 MB.', 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw invalid('Request body exceeds 11 MB.', 413);
    chunks.push(chunk);
  }
  try {
    return await new Request(`${origin}/action`, {
      method: 'POST', headers: { 'Content-Type': req.headers['content-type'] ?? '' }, body: Buffer.concat(chunks, size),
    }).formData();
  } catch {
    throw invalid('Invalid form data.');
  }
}

export async function createManagerServer({ root, port = 4326 } = {}) {
  const library = await createLibrary({ root });
  let writes = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    // no-referrer can turn native form POST origins into "null".
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const host = req.headers.host;
      const effectivePort = server.address()?.port ?? port;
      if (host !== `127.0.0.1:${effectivePort}` && host !== `localhost:${effectivePort}`) throw invalid('Host not allowed.', 403);
      const origin = `http://${host}`;
      // Reject cross-origin writes before reading or parsing any request bytes.
      if (req.method === 'POST' && req.headers.origin !== origin) throw invalid('Same-host Origin required.', 403);
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw invalid('Invalid request target.');
      const url = new URL(req.url, origin);
      if (req.method === 'POST' && url.pathname === '/action') {
        const form = await parseForm(req, origin);
        let code = '';
        let cropID = null;
        let flash;
        const operation = writes.then(async () => {
          code = String(library.status(form.get('code')).code);
          const action = form.get('action');
          if (action === 'crop') {
            const id = form.get('id') || null;
            await library.saveCrop(code, id, form.get('x'), form.get('y'));
            cropID = id;
            return id === null ? 'Published image framing saved.' : 'Private alternative framing saved. If selected, its published framing was also updated.';
          }
          if (action === 'description') {
            await library.saveDescription(code, form.get('description'));
            return 'Description saved. Restart or rebuild the public site to load the updated text.';
          }
          if (action === 'upload') {
            const file = form.get('image');
            if (!file || typeof file.arrayBuffer !== 'function') throw invalid('Choose an image to upload.');
            await library.upload(code, Buffer.from(await file.arrayBuffer()));
            return 'Alternative added. Select it when you are ready to publish.';
          }
          if (action === 'select' || action === 'delete') {
            await library[action](code, form.get('id'));
            return action === 'select' ? 'Image selected and published.' : 'Alternative deleted. If selected, the SVG is now active.';
          }
          if (action === 'reset') {
            await library.reset(code);
            return 'Reset to the original SVG. Alternatives kept.';
          }
          throw invalid('Unknown action.');
        });
        writes = operation.catch(() => {});
        try {
          flash = await operation;
        } catch (error) {
          if (!error.status) throw error;
          flash = error.message;
        }
        const query = new URLSearchParams({ ...(code ? { code } : {}), ...(cropID === null ? {} : { crop: cropID }), flash });
        res.writeHead(303, { Location: `/?${query}` });
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw invalid('Method not allowed.', 405);
      await writes;
      let body;
      let type;
      if (url.pathname === '/manager.js') {
        body = managerScript;
        type = 'text/javascript; charset=utf-8';
      } else if (url.pathname === '/') {
        body = await render(library, url);
        type = 'text/html; charset=utf-8';
      } else {
        const active = /^\/image\/([0-9]{3})$/.exec(url.pathname);
        const alternative = /^\/library\/([0-9]{3})\/([^/]+)$/.exec(url.pathname);
        if (active) {
          const image = await library.active(active[1]);
          body = image.bytes;
          type = mime[image.extension];
        } else if (alternative) {
          body = await library.readAlternative(alternative[1], alternative[2]);
          type = mime[alternative[2].split('.').pop()];
        } else throw invalid('Not found.', 404);
      }
      res.writeHead(200, { 'Content-Type': type });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (!error.status) console.error(error);
      res.writeHead(error.status ?? 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : error.status ? error.message : 'Internal server error.');
    }
  });
  server.requestTimeout = 30_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4326);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = await createManagerServer({ port });
  server.listen(port, '127.0.0.1', () => console.log(`Image manager: http://127.0.0.1:${port}`));
}
