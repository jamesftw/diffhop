import * as esbuild from 'esbuild'
import { cp, rm, mkdir } from 'node:fs/promises'

const watch = process.argv.includes('--watch')

async function copyStatic() {
  await mkdir('dist', { recursive: true })
  await cp('extension/manifest.json', 'dist/manifest.json')
  await cp('extension/popup.html', 'dist/popup.html')
  await cp('extension/popup.css', 'dist/popup.css')
  await cp('extension/icons', 'dist/icons', { recursive: true })
}

const copyStaticPlugin = {
  name: 'copy-static',
  setup(build) {
    build.onEnd(() => copyStatic())
  },
}

await rm('dist', { recursive: true, force: true })

// Extension scripts: bundled as classic IIFE so they load as a classic service
// worker / content script / popup script.
const extensionCtx = await esbuild.context({
  entryPoints: {
    background: 'extension/src/background.ts',
    content: 'extension/src/content.ts',
    device: 'extension/src/device.ts',
    diffshub: 'extension/src/diffshub.ts',
    'diffshub-main': 'extension/src/diffshub-main.ts',
    popup: 'extension/src/popup.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  platform: 'browser',
  logLevel: 'info',
  plugins: [copyStaticPlugin],
})

if (watch) {
  await extensionCtx.watch()
  console.log('Watching for changes… (restart to pick up static asset changes)')
} else {
  await extensionCtx.rebuild()
  await extensionCtx.dispose()
  console.log('Build complete → dist/')
}
