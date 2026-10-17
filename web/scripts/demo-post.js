// Pasca-build demo: fallback SPA untuk GitHub Pages dan salin file contoh untuk dicoba di Olah Data.
import { copyFile, cp, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
await copyFile(new URL('index.html', dist), new URL('404.html', dist));
await cp(new URL('../../samples/', import.meta.url), new URL('demo/contoh/', dist), { recursive: true });
await writeFile(new URL('.nojekyll', dist), '');
console.log('[demo] 404.html, .nojekyll dan file contoh disiapkan');
