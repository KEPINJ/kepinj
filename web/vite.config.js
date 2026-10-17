import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Build demo (GitHub Pages): modul server diganti versi browser
const DEMO_SHIMS = {
  'server/src/config.js': here('./src/demo/shims/config.js'),
  'server/src/events/bus.js': here('./src/demo/shims/bus.js'),
};
const DEMO_BARE = {
  pg: here('./src/demo/shims/pg.js'),
  jsonwebtoken: here('./src/demo/shims/jsonwebtoken.js'),
  'node:crypto': here('./src/demo/shims/crypto.js'),
};

function demoShims() {
  return {
    name: 'bku-demo-shims',
    enforce: 'pre',
    async resolveId(source, importer, opts) {
      if (DEMO_BARE[source]) return DEMO_BARE[source];
      if (!source.startsWith('.') || !importer) return null;
      const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
      const hit = r && Object.keys(DEMO_SHIMS).find((k) => r.id.endsWith(k));
      // bus.js versi demo sendiri mengimpor modul server lain, jangan dialihkan ke dirinya
      if (hit && !importer.includes('/src/demo/shims/')) return DEMO_SHIMS[hit];
      return null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: process.env.BASE_PATH || '/',
    plugins: [react(), demo && demoShims()].filter(Boolean),
    resolve: { alias: { '@shared': here('../shared') }, dedupe: ['@electric-sql/pglite'] },
    define: { __DEMO__: JSON.stringify(demo), __DEMO_BUILD__: JSON.stringify(demo ? new Date().toISOString() : '') },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } } },
    build: { chunkSizeWarningLimit: 1500, target: demo ? 'es2022' : undefined },
  };
});
