// Membangkitkan src/theme.css: node scripts/gen-theme.cjs > src/theme.css
const hex = (h) => { h = h.replace('#',''); return [0,2,4].map(i => parseInt(h.slice(i,i+2),16)).join(' '); };
const pal = {
  slate: {
    light: { 50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a',950:'#020617' },
    dark:  { 50:'#141f33',100:'#1a273e',200:'#253350',300:'#34445f',400:'#6f83a3',500:'#91a2bc',600:'#a9b7cc',700:'#c3cee0',800:'#d9e1ed',900:'#ebf0f7',950:'#f8fafc' } },
  brand: {
    light: { 50:'#eef6fb',100:'#d5e8f3',200:'#a9cfe6',300:'#73b0d4',400:'#3f8dbd',500:'#1f6fa1',600:'#155886',700:'#11476d',800:'#0f3d5e',900:'#0b2c44',950:'#071c2c' },
    dark:  { 50:'#10263a',100:'#14324c',200:'#1c4768',300:'#2d6994',400:'#4a95c7',500:'#3f8dbd',600:'#74b3de',700:'#93c6ea',800:'#2b80bb',900:'#0a1e30',950:'#06121e' } },
  emerald: {
    light: { 50:'#ecfdf5',100:'#d1fae5',200:'#a7f3d0',300:'#6ee7b7',400:'#34d399',500:'#10b981',600:'#059669',700:'#047857',800:'#065f46',900:'#064e3b' },
    dark:  { 50:'#0b2a22',100:'#0e382d',200:'#13503f',300:'#1f7a5f',400:'#2fb488',500:'#10b981',600:'#14b17f',700:'#3dd6a0',800:'#7ae7c0',900:'#b0f2d9' } },
  rose: {
    light: { 50:'#fff1f2',100:'#ffe4e6',200:'#fecdd3',300:'#fda4af',400:'#fb7185',500:'#f43f5e',600:'#e11d48',700:'#be123c',800:'#9f1239',900:'#881337' },
    dark:  { 50:'#2e1219',100:'#3c1620',200:'#5e1f2e',300:'#8a2a40',400:'#e0526e',500:'#f43f5e',600:'#f0506f',700:'#fb7f96',800:'#fdaab8',900:'#fecdd5' } },
  amber: {
    light: { 50:'#fffbeb',100:'#fef3c7',200:'#fde68a',300:'#fcd34d',400:'#fbbf24',500:'#f59e0b',600:'#d97706',700:'#b45309',800:'#92400e',900:'#78350f' },
    dark:  { 50:'#2b2008',100:'#3a2b0a',200:'#5c430f',300:'#8a6417',400:'#d99a1f',500:'#f59e0b',600:'#f0a52a',700:'#fbbf3c',800:'#fcd36a',900:'#fde69a' } },
  violet: {
    light: { 50:'#f5f3ff',100:'#ede9fe',200:'#ddd6fe',300:'#c4b5fd',400:'#a78bfa',500:'#8b5cf6',600:'#7c3aed',700:'#6d28d9',800:'#5b21b6',900:'#4c1d95' },
    dark:  { 50:'#1d1633',100:'#271d45',200:'#3d2d6b',300:'#5a43a0',400:'#8f6ef0',500:'#8b5cf6',600:'#a07ef8',700:'#b9a0fb',800:'#d0c0fd',900:'#e4dbfe' } },
};
const extra = {
  light: { surface:'#ffffff', page:'#f3f6fa', primary:'#0f3d5e', 'primary-hover':'#155886', ring:'#1f6fa1',
    'series-1':'#1f6fa1', 'series-2':'#e0a82e', 'series-3':'#8b5cf6', 'series-4':'#0f9488', 'series-5':'#d9534f' },
  // Seri grafik mode gelap divalidasi terhadap permukaan #0f192a (lightness band, CVD, kontras)
  dark:  { surface:'#0f192a', page:'#0a1220', primary:'#2577b0', 'primary-hover':'#2f88c7', ring:'#4a95c7',
    'series-1':'#3f8dbd', 'series-2':'#b8861f', 'series-3':'#8b5cf6', 'series-4':'#11a394', 'series-5':'#e5646b' },
};
const block = (mode) => Object.entries(pal).flatMap(([n, p]) => Object.entries(p[mode]).map(([s, h]) => `  --${n}-${s}: ${hex(h)};`))
  .concat(Object.entries(extra[mode]).map(([k, h]) => `  --${k}: ${hex(h)};`)).join('\n');
process.stdout.write(`/* Dibangkitkan dari palet tema (terang & gelap). Nilai berupa "R G B" agar mendukung opasitas Tailwind. */
:root, .theme-light {
${block('light')}
  color-scheme: light;
}
@media screen {
  html.dark {
${block('dark').replace(/^/gm, '  ')}
    color-scheme: dark;
  }
  html.dark .theme-light { color-scheme: light; }
}
`);
