# monke.http

```sh
npm install
npm run dev
```

Development shows all status codes, including the SVG placeholders. Gallery
cards open description dialogs; `/description/404` opens a full page, and `/404`
returns the image itself.

## Pictures

Run `npm run images` to open the separate local picture and description manager
at <http://127.0.0.1:4326>. Select an alternative to publish it as
`public/images/<code>.jpg` or `.png`. See `tools/image-manager/README.md`.

## Vercel

Import this repository into Vercel using its **Astro** framework preset. The
build command is `npm run build`; the Vercel adapter configures the output.
Use Node.js 22 for the deployment runtime.

Commit the selected JPEG/PNG files and status JSON, then deploy normally. The
local manager and private alternatives are not part of the public application.

Production only lists codes with a `.jpg`, `.jpeg`, or `.png` picture. Codes
without one are also excluded from random navigation and description pages;
their raw image endpoints return 404 instead of a placeholder. Numeric SVG
placeholders are excluded from deployed static assets and server functions.
The SVG logo and ICO favicon are retained. An empty collection shows a brief
message rather than placeholder cards.

The Vercel adapter targets serverless deployment; `astro preview` is not a
production Vercel emulator. Use `npm run dev` locally or a Vercel preview
deployment to test the deployed application.

## Tests

```sh
npm run test:images
npm run build
```
