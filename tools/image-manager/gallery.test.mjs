import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const page = await readFile(new URL('../../src/pages/index.astro', import.meta.url), 'utf8');
const script = page.match(/<script is:inline define:vars=\{\{ statuses \}\}>([\s\S]*?)<\/script>/)[1];

function gallery(statuses) {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      listeners: {},
      attributes: {},
      classList: {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        contains(value) { return this.values.has(value); },
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(event, listener) { this.listeners[event] = listener; },
      replaceChildren(...children) { this.children = children; },
    });
    return nodes.get(selector);
  }
  const dialog = node('#status-dialog');
  dialog.open = false;
  dialog.shown = 0;
  dialog.showModal = function () { this.open = true; this.shown++; };
  dialog.close = function () { this.open = false; };
  dialog.getBoundingClientRect = () => ({ left: 100, right: 600, top: 100, bottom: 600 });
  const cards = statuses.map(status => {
    const card = node(`card-${status.code}`);
    card.dataset = { statusCode: String(status.code) };
    return card;
  });
  node('#usage-form').reportValidity = () => true;
  node('#status-code').value = '404';
  const copied = [];
  const timers = new Map();
  let timerId = 0;
  vm.runInNewContext(script, {
    statuses,
    document: { querySelector: node, querySelectorAll: () => cards, createElement: () => ({}) },
    navigator: { clipboard: { writeText: async text => copied.push(text) } },
    window: { location: { origin: 'http://localhost:4321' } },
    URL,
    Math: { random: () => 0.99, floor: Math.floor },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { node, cards, copied, dialog, timers };
}

test('random and gallery cards populate one dialog without navigating', () => {
  const statuses = [
    { code: 200, phrase: 'OK', description: ['First', 'Second'], source: 'https://example.test/200' },
    { code: 404, phrase: 'Not Found', description: ['<plain text>'], source: 'https://example.test/404' },
  ];
  const { node, cards, dialog } = gallery(statuses);
  node('#random-monkey').listeners.click();
  assert.equal(dialog.open, true);
  assert.equal(dialog.shown, 1);
  assert.equal(node('#dialog-title').textContent, '404 Not Found');
  assert.equal(node('#dialog-image').src, '/404');
  assert.equal(node('#dialog-description').children[0].textContent, '<plain text>');
  cards[0].listeners.click();
  assert.equal(dialog.shown, 1);
  assert.equal(node('#dialog-title').textContent, '200 OK');
  assert.equal(node('#dialog-description').children.length, 2);
  assert.equal(node('#dialog-source').href, 'https://example.test/200');
  dialog.open = false;
  node('#random-monkey').listeners.click();
  assert.equal(dialog.shown, 2);
});

test('empty gallery disables random and copying uses the edited status code', async () => {
  const { node, copied, dialog } = gallery([]);
  assert.equal(node('#random-monkey').disabled, true);
  node('#random-monkey').listeners.click();
  assert.equal(dialog.shown, 0);
  node('#status-code').value = '201';
  await node('#copy-url').listeners.click();
  assert.equal(copied[0], 'http://localhost:4321/201');
  node('#usage-form').reportValidity = () => false;
  await node('#copy-url').listeners.click();
  assert.equal(copied.length, 1);
});

test('copy feedback swaps to a check for two seconds and repeated clicks restart the timer', async () => {
  const { node, timers } = gallery([]);
  await node('#copy-url').listeners.click();
  assert.equal(node('#copy-icon').classList.contains('hidden'), true);
  assert.equal(node('#copied-icon').classList.contains('hidden'), false);
  assert.equal(node('#copy-url').attributes['aria-label'], 'URL copied');
  assert.equal(node('#copy-feedback').classList.contains('sr-only'), true);
  assert.equal([...timers.values()][0].delay, 2000);
  await node('#copy-url').listeners.click();
  assert.equal(timers.size, 1);
  [...timers.values()][0].callback();
  assert.equal(node('#copy-icon').classList.contains('hidden'), false);
  assert.equal(node('#copied-icon').classList.contains('hidden'), true);
  assert.equal(node('#copy-url').attributes['aria-label'], 'Copy selected image URL');
});

test('backdrop click closes dialog but clicks on content and inside padding do not', () => {
  const { dialog } = gallery([]);
  dialog.open = true;
  dialog.listeners.click({ target: {}, clientX: 50, clientY: 50 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: dialog, clientX: 200, clientY: 200 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: dialog, clientX: 50, clientY: 200 });
  assert.equal(dialog.open, false);
});
