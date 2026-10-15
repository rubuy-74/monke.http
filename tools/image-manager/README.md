# Local Image Manager

A standalone, dependency-free Node helper. It does not need Astro and does not
change the site's source or package configuration. Requires Node 22 or newer.

From the project root:

```sh
npm run images
```

Open <http://127.0.0.1:4326> or jump directly to
<http://127.0.0.1:4326/?code=404>. Optionally set `PORT` to use another port.
Paths resolve relative to this tool, not the current working directory.

## Workflow

- Browse the status overview or use the status selector.
- Use **Edit description** to open the description dialog. Blank lines separate
  paragraphs. Saving updates only that status's description in
  `src/data/statuses.json`; other fields and statuses are preserved. Restart the
  public site or rebuild/redeploy it to load updated descriptions in production.
- Upload JPEG or PNG alternatives, at most 10 MiB each. The server checks JPEG
  magic bytes or the PNG signature, not client filenames or MIME declarations.
  This is signature validation, not full image decoding or sanitization.
- Uploads do not automatically publish. Select an alternative to copy its bytes
  to `public/images/<code>.jpg` or `.png`. There is no conversion: JPEG uploads
  use `.jpg`, PNG uploads use `.png`, regardless of the original filename.
- Switching images atomically replaces the destination through a temporary file
  and rename, then removes other `.jpg`, `.jpeg`, and `.png` variants for that
  status. SVG originals are never changed. All HTTP mutations are serialized.
- Reset removes published rasters and restores the SVG fallback, keeping all
  alternatives. Deleting the selected alternative also resets to SVG.
- Selection IDs persist in `library/<code>/selection.json`; alternatives are
  immutable `library/<code>/<uuid>.jpg` or `.png` files. IDs include the extension.

The private `tools/image-manager/library/` directory is ignored by Git and lives
outside Astro's public assets and source tree, so it is excluded from the site
deployment. Only selected copies in `public/images/` are published. Do not add
this helper or its library to a deployment artifact; back up the library locally
if needed. Run only one manager process per project. Per-file replacements are
atomic, but publication and selection metadata are not a crash-safe transaction.

## Local Only

The server binds only to `127.0.0.1`, checks the Host header against
`127.0.0.1:<port>` or `localhost:<port>`, and requires every POST's Origin to
exactly match its HTTP host. Foreign or missing origins are rejected before body
parsing. Total form bodies are limited to 11 MiB, including multipart overhead.
Native HTML forms work without JavaScript. Image routes expose only validated
alternatives and each known status's active published image, not directory trees
or metadata. This is a trusted local editing tool, not an authenticated service.
Do not expose it through a proxy, tunnel, or public listener.

## Tests

```sh
npm run test:images
```

Tests use temporary projects and do not change real images or status data.

The public site reads the selected image at `/<code>` (for example `/404`),
preferring JPEG/PNG over the SVG placeholder. Both gallery cards and description
pages use that image URL. Refresh the site after making a selection. Rebuild and
deploy the site normally to publish selected pictures to your hosted website.
