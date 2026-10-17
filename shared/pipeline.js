// Mesin pengolah data: menjalankan rangkaian langkah atas baris hasil upload.
import { compile, toNum } from './expr.js';

export const STEP_TYPES = {
  filter: 'Saring baris',
  compute: 'Kolom hitung (rumus)',
  rename: 'Ganti nama kolom',
  select: 'Pilih kolom',
  group: 'Kelompokkan & rekap',
  sort: 'Urutkan',
  dedupe: 'Hapus duplikat',
  limit: 'Batasi jumlah baris',
};

const AGG = {
  sum: (vals) => vals.reduce((s, v) => s + toNum(v), 0),
  count: (vals) => vals.length,
  avg: (vals) => (vals.length ? vals.reduce((s, v) => s + toNum(v), 0) / vals.length : 0),
  min: (vals) => (vals.length ? Math.min(...vals.map(toNum)) : 0),
  max: (vals) => (vals.length ? Math.max(...vals.map(toNum)) : 0),
  countDistinct: (vals) => new Set(vals.map((v) => String(v ?? ''))).size,
  first: (vals) => vals[0] ?? '',
};
export const AGG_LABELS = { sum: 'Jumlah', count: 'Banyak baris', avg: 'Rata-rata', min: 'Minimum', max: 'Maksimum', countDistinct: 'Banyak unik', first: 'Nilai pertama' };

export function runPipeline(columns, rows, steps = []) {
  let cols = [...columns];
  let data = rows;
  const log = [];
  steps.forEach((step, i) => {
    const before = data.length;
    try {
      switch (step.type) {
        case 'filter': {
          const f = compile(step.expr);
          data = data.filter((r) => { const v = f(r); return typeof v === 'string' ? !v.startsWith('#ERROR') && v !== '' : Boolean(v); });
          break;
        }
        case 'compute': {
          if (!step.name) throw new Error('Nama kolom hasil wajib diisi');
          const f = compile(step.expr);
          data = data.map((r) => ({ ...r, [step.name]: f(r) }));
          if (!cols.includes(step.name)) cols.push(step.name);
          break;
        }
        case 'rename': {
          data = data.map((r) => { const o = { ...r, [step.to]: r[step.from] }; delete o[step.from]; return o; });
          cols = cols.map((c) => (c === step.from ? step.to : c));
          break;
        }
        case 'select': {
          const keep = step.columns?.length ? step.columns : cols;
          data = data.map((r) => Object.fromEntries(keep.map((c) => [c, r[c]])));
          cols = [...keep];
          break;
        }
        case 'group': {
          const by = step.by || [];
          const aggs = step.aggs?.length ? step.aggs : [{ column: by[0], fn: 'count', as: 'Jumlah Baris' }];
          const groups = new Map();
          for (const r of data) {
            const key = JSON.stringify(by.map((c) => r[c] ?? ''));
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(r);
          }
          data = [...groups.entries()].map(([key, items]) => {
            const o = Object.fromEntries(by.map((c, k) => [c, JSON.parse(key)[k]]));
            for (const a of aggs) o[a.as || `${AGG_LABELS[a.fn]} ${a.column}`] = AGG[a.fn](items.map((r) => r[a.column]));
            return o;
          });
          cols = [...by, ...aggs.map((a) => a.as || `${AGG_LABELS[a.fn]} ${a.column}`)];
          break;
        }
        case 'sort': {
          const c = step.column; const dir = step.dir === 'desc' ? -1 : 1;
          data = [...data].sort((a, b) => {
            const x = a[c]; const y = b[c];
            const nx = toNum(x); const ny = toNum(y);
            const numeric = (typeof x === 'number' || /^[\d.,\s-]+$/.test(String(x ?? ''))) && (typeof y === 'number' || /^[\d.,\s-]+$/.test(String(y ?? '')));
            return (numeric ? nx - ny : String(x ?? '').localeCompare(String(y ?? ''), 'id')) * dir;
          });
          break;
        }
        case 'dedupe': {
          const keys = step.columns?.length ? step.columns : cols;
          const seen = new Set();
          data = data.filter((r) => { const k = JSON.stringify(keys.map((c) => r[c])); if (seen.has(k)) return false; seen.add(k); return true; });
          break;
        }
        case 'limit':
          data = data.slice(0, Number(step.n) || 100);
          break;
        default:
          throw new Error(`Jenis langkah tidak dikenal: ${step.type}`);
      }
      log.push({ step: i + 1, type: step.type, ok: true, rowsBefore: before, rowsAfter: data.length });
    } catch (e) {
      log.push({ step: i + 1, type: step.type, ok: false, error: e.message });
      throw Object.assign(new Error(`Langkah ${i + 1} (${STEP_TYPES[step.type] || step.type}): ${e.message}`), { log });
    }
  });
  return { columns: cols, rows: data, log };
}

/** Total per kolom numerik untuk baris ringkasan. */
export function columnTotals(columns, rows) {
  const totals = {};
  for (const c of columns) {
    let numeric = 0; let sum = 0;
    for (const r of rows) {
      const v = r[c];
      if (typeof v === 'number') { numeric++; sum += v; } else if (v != null && v !== '' && /^-?(rp\.?\s*)?[\d.,]+$/i.test(String(v).trim())) { numeric++; sum += toNum(v); }
    }
    if (rows.length && numeric / rows.length >= 0.8) totals[c] = sum;
  }
  return totals;
}
