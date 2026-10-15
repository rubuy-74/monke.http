import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { cp, mkdir, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { basename } from 'node:path';

const publicImages = new URL('./public/images/', import.meta.url);
const selectedImages = readdirSync(publicImages).filter(name => /^\d{3}\.(jpg|jpeg|png)$/.test(name));
const placeholders = readdirSync(publicImages).filter(name => /^\d{3}\.svg$/.test(name));

export default defineConfig({
  adapter: vercel({
    includeFiles: selectedImages.map(name => `public/images/${name}`),
    excludeFiles: placeholders.map(name => `public/images/${name}`),
  }),
  output: 'server',
  trailingSlash: 'never',
  integrations: [{
    name: 'published-images-only',
    hooks: {
      'astro:config:setup': async ({ command, config, updateConfig }) => {
        if (command === 'dev') return;
        const publicDir = new URL('./.astro/published-public/', config.root);
        await rm(publicDir, { recursive: true, force: true });
        await mkdir(publicDir, { recursive: true });
        await cp(config.publicDir, publicDir, {
          recursive: true,
          filter: source => !/^\d{3}\.svg$/.test(basename(source)),
        });
        updateConfig({ publicDir });
      },
    },
  }],
  vite: {
    plugins: [tailwindcss()],
  },
});
