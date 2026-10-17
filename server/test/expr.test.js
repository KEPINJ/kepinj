import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, toNum } from '../../shared/expr.js';
import { runPipeline } from '../../shared/pipeline.js';

test('angka format Indonesia', () => {
  assert.equal(toNum('Rp 1.250.000,50'), 1250000.5);
  assert.equal(toNum('2359064,00'), 2359064);
  assert.equal(toNum('(5.000)'), -5000);
});

test('rumus dan fungsi pajak', () => {
  const row = { Honor: '1.000.000', Gol: 'IV', Bruto: 10_000_000, PTKP: 'TK/0' };
  assert.equal(compile('IF([Gol] = "IV", [Honor] * 15%, [Honor] * 5%)')(row), 150000);
  assert.equal(compile('PPH21([Bruto], [PTKP])')(row), 200000);
  assert.equal(compile('ROUND(10 / 3, 2)')(row), 3.33);
  assert.equal(compile('[Bruto] > 5000000 AND NOT [Gol] = "III"')(row), true);
});

test('rumus salah ditolak tanpa eval', () => {
  assert.throws(() => compile('process.exit()'));
  assert.throws(() => compile('[Kolom'));
});

test('pipeline: hitung, saring, kelompokkan', () => {
  const rows = [{ Rek: 'A', Nilai: 100 }, { Rek: 'B', Nilai: 50 }, { Rek: 'A', Nilai: 25 }];
  const r = runPipeline(['Rek', 'Nilai'], rows, [
    { type: 'compute', name: 'Pajak', expr: '[Nilai] * 2%' },
    { type: 'filter', expr: '[Nilai] >= 50' },
    { type: 'group', by: ['Rek'], aggs: [{ column: 'Nilai', fn: 'sum', as: 'Total' }] },
  ]);
  assert.deepEqual(r.rows, [{ Rek: 'A', Total: 100 }, { Rek: 'B', Total: 50 }]);
});
