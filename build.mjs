// Bundles the renderer (ES modules + three.js) into renderer/dist/app.js and vendors MapLibre.
//   node build.mjs           production bundle
//   node build.mjs --watch   rebuild on change
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const vendor = path.join(root, 'renderer', 'vendor');
fs.mkdirSync(vendor, { recursive: true });
for (const f of ['maplibre-gl.js', 'maplibre-gl.css']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'maplibre-gl', 'dist', f), path.join(vendor, f));
}

const opts = {
  entryPoints: [path.join(root, 'renderer', 'src', 'main.js')],
  outfile: path.join(root, 'renderer', 'dist', 'app.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome130'],
  sourcemap: process.argv.includes('--dev') ? 'inline' : false,
  minify: !process.argv.includes('--dev'),
  legalComments: 'eof',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' }
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context({ ...opts, sourcemap: 'inline', minify: false });
  await ctx.watch();
  console.log('watching renderer/src …');
} else {
  const r = await esbuild.build({ ...opts, metafile: true });
  const out = Object.values(r.metafile.outputs)[0];
  console.log(`renderer bundle: ${(out.bytes / 1024).toFixed(0)} KB`);
}
