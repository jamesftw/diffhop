import * as esbuild from 'esbuild';
import { cp, rm, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

async function copyStatic() {
  await mkdir('dist', { recursive: true });
  await cp('extension/manifest.json', 'dist/manifest.json');
  await cp('extension/popup.html', 'dist/popup.html');
  await cp('extension/popup.css', 'dist/popup.css');
  await cp('extension/icons', 'dist/icons', { recursive: true });
}

const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(() => copyStatic());
  },
};

await rm('dist', { recursive: true, force: true });
await rm('proxy/dist', { recursive: true, force: true });

// Extension scripts: bundled as classic IIFE so they load as a classic service
// worker / content script / popup script.
const extensionCtx = await esbuild.context({
  entryPoints: {
    background: 'extension/src/background.ts',
    content: 'extension/src/content.ts',
    diffshub: 'extension/src/diffshub.ts',
    popup: 'extension/src/popup.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  platform: 'browser',
  logLevel: 'info',
  plugins: [copyStaticPlugin],
});

// Proxy: a single Node ESM bundle.
const proxyCtx = await esbuild.context({
  entryPoints: {
    server: 'proxy/src/server.ts',
    login: 'proxy/src/login.ts',
  },
  outdir: 'proxy/dist',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});

if (watch) {
  await Promise.all([extensionCtx.watch(), proxyCtx.watch()]);
  console.log('Watching for changes… (restart to pick up static asset changes)');
} else {
  await Promise.all([extensionCtx.rebuild(), proxyCtx.rebuild()]);
  await Promise.all([extensionCtx.dispose(), proxyCtx.dispose()]);
  console.log('Build complete → dist/ (extension), proxy/dist/server.js (proxy)');
}
