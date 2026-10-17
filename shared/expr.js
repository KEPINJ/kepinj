// =====================================================================
//  Evaluator rumus yang aman (tanpa eval) untuk modul Olah Data.
//  Contoh: IF([Golongan] = "IV", [Honor] * 15%, [Honor] * 5%)
//          ROUND(PPH21([Gaji Bruto], [Status PTKP]))
// =====================================================================
import {
  pph21Bulanan, pph21BukanPegawai, pph21HonorASN, ppn, pph22Bendahara, pph23, tarifTER,
} from './tax.js';
import { terbilang } from './terbilang.js';

/** Mengubah nilai sel menjadi angka; mendukung format Indonesia "Rp 1.234.567,50". */
export function toNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  let s = String(v).replace(/rp\.?/i, '').replace(/\s/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

const toStr = (v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const truthy = (v) => (typeof v === 'string' ? v !== '' : Boolean(v));
const eq = (a, b) => (typeof a === 'number' || typeof b === 'number' ? toNum(a) === toNum(b) : toStr(a).trim().toLowerCase() === toStr(b).trim().toLowerCase());
const toDate = (v) => (v instanceof Date ? v : new Date(toStr(v)));

const FUNCS = {
  ROUND: (x, d = 0) => { const f = 10 ** toNum(d); return Math.round(toNum(x) * f) / f; },
  FLOOR: (x) => Math.floor(toNum(x)),
  CEIL: (x) => Math.ceil(toNum(x)),
  ABS: (x) => Math.abs(toNum(x)),
  MIN: (...a) => Math.min(...a.map(toNum)),
  MAX: (...a) => Math.max(...a.map(toNum)),
  NUM: (x) => toNum(x),
  TEXT: (x) => toStr(x),
  UPPER: (x) => toStr(x).toUpperCase(),
  LOWER: (x) => toStr(x).toLowerCase(),
  TRIM: (x) => toStr(x).trim(),
  LEN: (x) => toStr(x).length,
  LEFT: (x, n = 1) => toStr(x).slice(0, toNum(n)),
  RIGHT: (x, n = 1) => toStr(x).slice(-toNum(n)),
  CONCAT: (...a) => a.map(toStr).join(''),
  CONTAINS: (x, y) => toStr(x).toLowerCase().includes(toStr(y).toLowerCase()),
  COALESCE: (...a) => a.find((v) => v != null && v !== '') ?? '',
  ISBLANK: (x) => x == null || toStr(x).trim() === '',
  YEAR: (x) => toDate(x).getFullYear(),
  MONTH: (x) => toDate(x).getMonth() + 1,
  DAY: (x) => toDate(x).getDate(),
  TERBILANG: (x) => terbilang(toNum(x)),
  // Fungsi pajak
  TARIF_TER: (bruto, status = 'TK/0') => tarifTER(toStr(status) || 'TK/0', toNum(bruto)).tarif,
  PPH21: (bruto, status = 'TK/0') => pph21Bulanan({ bruto: toNum(bruto), status: toStr(status) || 'TK/0' }).pph,
  PPH21_BP: (bruto, kumulatif = 0) => pph21BukanPegawai({ bruto: toNum(bruto), kumulatifSebelumnya: toNum(kumulatif) }).pph,
  HONOR_ASN: (bruto, gol = 'III') => pph21HonorASN({ bruto: toNum(bruto), golongan: toStr(gol) }).pph,
  PPN: (nilai, termasuk = 1) => ppn({ nilai: toNum(nilai), termasukPPN: truthy(termasuk) }).ppn,
  DPP: (nilai, termasuk = 1) => ppn({ nilai: toNum(nilai), termasukPPN: truthy(termasuk) }).dpp,
  PPH22: (dpp) => pph22Bendahara({ dpp: toNum(dpp) }).pph,
  PPH23: (dpp, npwp = 1) => pph23({ dpp: toNum(dpp), punyaNpwp: truthy(npwp) }).pph,
};
FUNCS.SUMROW = (...a) => a.reduce((s, x) => s + toNum(x), 0);
export const FUNCTION_NAMES = Object.keys(FUNCS).concat('IF');

function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('Kurung siku [ belum ditutup');
      t.push({ type: 'col', value: src.slice(i + 1, j).trim() }); i = j + 1; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; let s = '';
      while (j < src.length && src[j] !== c) s += src[j++];
      if (j >= src.length) throw new Error('Tanda kutip belum ditutup');
      t.push({ type: 'str', value: s }); i = j + 1; continue;
    }
    const num = src.slice(i).match(/^\d+(\.\d+)?%?/);
    if (num) {
      const raw = num[0];
      t.push({ type: 'num', value: raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw) });
      i += raw.length; continue;
    }
    const id = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (id) { t.push({ type: 'id', value: id[0] }); i += id[0].length; continue; }
    const op = src.slice(i).match(/^(<=|>=|<>|!=|==|&&|\|\||[-+*/%(),<>=!&])/);
    if (op) { t.push({ type: 'op', value: op[0] }); i += op[0].length; continue; }
    throw new Error(`Karakter tidak dikenal: "${c}"`);
  }
  return t;
}

/** Kompilasi rumus menjadi fungsi (row) => nilai. Melempar Error berbahasa Indonesia bila salah. */
export function compile(source) {
  const toks = tokenize(String(source ?? ''));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.type === 'op' && peek().value === v;
  const isKw = (v) => peek()?.type === 'id' && peek().value.toUpperCase() === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`Diharapkan "${v}"`); p++; };

  function primary() {
    const tk = toks[p++];
    if (!tk) throw new Error('Rumus tidak lengkap');
    if (tk.type === 'num' || tk.type === 'str') return () => tk.value;
    if (tk.type === 'col') { const k = tk.value; return (r) => r[k]; }
    if (tk.type === 'op' && tk.value === '(') { const e = or(); expect(')'); return e; }
    if (tk.type === 'id') {
      const name = tk.value.toUpperCase();
      if (name === 'TRUE') return () => true;
      if (name === 'FALSE') return () => false;
      if (isOp('(')) {
        p++;
        const args = [];
        if (!isOp(')')) { do { args.push(or()); } while (isOp(',') && ++p); }
        expect(')');
        if (name === 'IF') {
          if (args.length < 2) throw new Error('IF membutuhkan minimal 2 argumen');
          const [c, a, b = () => ''] = args;
          return (r) => (truthy(c(r)) ? a(r) : b(r));
        }
        const fn = FUNCS[name];
        if (!fn) throw new Error(`Fungsi tidak dikenal: ${tk.value}`);
        return (r) => fn(...args.map((a) => a(r)));
      }
      const k = tk.value; return (r) => r[k];
    }
    throw new Error(`Token tidak terduga: "${tk.value}"`);
  }
  function unary() {
    if (isOp('-')) { p++; const e = unary(); return (r) => -toNum(e(r)); }
    if (isOp('+')) { p++; const e = unary(); return (r) => toNum(e(r)); }
    if (isOp('!')) { p++; const e = unary(); return (r) => !truthy(e(r)); }
    return primary();
  }
  function mul() {
    let l = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const o = toks[p++].value; const a = l; const b = unary();
      l = o === '*' ? (r) => toNum(a(r)) * toNum(b(r))
        : o === '/' ? (r) => { const d = toNum(b(r)); return d === 0 ? 0 : toNum(a(r)) / d; }
        : (r) => toNum(a(r)) % toNum(b(r));
    }
    return l;
  }
  function add() {
    let l = mul();
    while (isOp('+') || isOp('-') || isOp('&')) {
      const o = toks[p++].value; const a = l; const b = mul();
      l = o === '+' ? (r) => toNum(a(r)) + toNum(b(r)) : o === '-' ? (r) => toNum(a(r)) - toNum(b(r)) : (r) => toStr(a(r)) + toStr(b(r));
    }
    return l;
  }
  function cmp() {
    const l = add();
    const tk = peek();
    if (tk?.type === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(tk.value)) {
      p++; const r2 = add(); const o = tk.value;
      if (o === '=' || o === '==') return (r) => eq(l(r), r2(r));
      if (o === '!=' || o === '<>') return (r) => !eq(l(r), r2(r));
      return (r) => {
        const a = l(r); const b = r2(r);
        const [x, y] = typeof a === 'string' && typeof b === 'string' && Number.isNaN(Number(a)) ? [a, b] : [toNum(a), toNum(b)];
        return o === '<' ? x < y : o === '<=' ? x <= y : o === '>' ? x > y : x >= y;
      };
    }
    return l;
  }
  // NOT berprioritas lebih rendah dari perbandingan: NOT [A] = "x" berarti NOT ([A] = "x")
  function not() {
    if (isKw('NOT')) { p++; const e = not(); return (r) => !truthy(e(r)); }
    return cmp();
  }
  function and() {
    let l = not();
    while (isOp('&&') || isKw('AND')) { p++; const a = l; const b = not(); l = (r) => truthy(a(r)) && truthy(b(r)); }
    return l;
  }
  function or() {
    let l = and();
    while (isOp('||') || isKw('OR')) { p++; const a = l; const b = and(); l = (r) => truthy(a(r)) || truthy(b(r)); }
    return l;
  }
  const fn = or();
  if (p < toks.length) throw new Error(`Sisa rumus tidak terbaca mulai "${toks[p].value}"`);
  return (row) => {
    try { return fn(row); } catch (e) { return `#ERROR ${e.message}`; }
  };
}

export function evaluate(source, row) {
  return compile(source)(row);
}
