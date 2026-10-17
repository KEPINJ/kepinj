import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';

function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return v.text;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('hyperlink' in v) return v.text ?? v.hyperlink;
    return String(v);
  }
  return v;
}

function uniqueHeaders(raw) {
  const seen = {};
  return raw.map((h, i) => {
    let name = String(h ?? '').trim() || `Kolom ${i + 1}`;
    if (seen[name]) name = `${name} (${++seen[name]})`; else seen[name] = 1;
    return name;
  });
}

/** Deteksi baris header: baris pertama (dari 15 teratas) yang paling banyak sel teksnya. */
function findHeaderRow(matrix) {
  let best = 0; let bestScore = -1;
  matrix.slice(0, 15).forEach((row, i) => {
    const filled = row.filter((v) => v !== '' && v != null);
    const texty = filled.filter((v) => typeof v === 'string' && !/^[\d.,-]+$/.test(v)).length;
    const score = texty * 2 + filled.length;
    if (filled.length >= 2 && score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

function matrixToTable(matrix, sheetName) {
  const clean = matrix.filter((r) => r.some((v) => v !== '' && v != null));
  if (!clean.length) return { sheet: sheetName, columns: [], rows: [] };
  const h = findHeaderRow(clean);
  const width = Math.max(...clean.map((r) => r.length));
  const header = uniqueHeaders(Array.from({ length: width }, (_, i) => clean[h][i]));
  const rows = clean.slice(h + 1).map((r) => Object.fromEntries(header.map((c, i) => [c, r[i] ?? ''])));
  // buang kolom yang seluruhnya kosong
  const columns = header.filter((c) => !/^Kolom \d+$/.test(c) || rows.some((r) => r[c] !== ''));
  return { sheet: sheetName, columns, rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))) };
}

/** Membaca .xlsx atau .csv menjadi daftar sheet {columns, rows}. */
export async function parseSpreadsheet(buffer, fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buffer.toString('utf8').replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delimiter = [';', ',', '\t', '|'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
    const matrix = parseCsv(text, { delimiter, relax_column_count: true, skip_empty_lines: true });
    return [matrixToTable(matrix, 'CSV')];
  }
  if (!lower.endsWith('.xlsx')) throw Object.assign(new Error('Format file harus .xlsx atau .csv'), { statusCode: 400 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const matrix = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = cellValue(cell.value); });
      matrix.push(Array.from(vals, (v) => (v === undefined ? '' : v)));
    });
    sheets.push(matrixToTable(matrix, ws.name));
  });
  return sheets;
}

/**
 * Membuat workbook rapi (header tebal, format rupiah, freeze pane, total).
 * columns: [{ key, header, width?, type?: 'money'|'number'|'date'|'text' }]
 */
export async function buildWorkbook({ title, subtitle, sheetName = 'Data', columns, rows, totals }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BKU BKAD';
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  let r = 1;
  if (title) {
    ws.mergeCells(r, 1, r, columns.length);
    Object.assign(ws.getCell(r, 1), { value: title, font: { bold: true, size: 14 }, alignment: { horizontal: 'center' } });
    r++;
  }
  if (subtitle) {
    ws.mergeCells(r, 1, r, columns.length);
    Object.assign(ws.getCell(r, 1), { value: subtitle, alignment: { horizontal: 'center' } });
    r++;
  }
  if (title || subtitle) r++;
  const headerRow = ws.getRow(r);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D5E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin' } };
    ws.getColumn(i + 1).width = c.width || Math.min(40, Math.max(12, String(c.header).length + 4));
  });
  ws.views = [{ state: 'frozen', ySplit: r }];
  const fmt = { money: '#,##0.00;[Red]-#,##0.00', number: '#,##0.####' };
  for (const row of rows) {
    r++;
    const xr = ws.getRow(r);
    columns.forEach((c, i) => {
      let v = row[c.key];
      if ((c.type === 'money' || c.type === 'number') && v !== '' && v != null) v = Number(v);
      const cell = xr.getCell(i + 1);
      cell.value = v ?? '';
      if (fmt[c.type]) cell.numFmt = fmt[c.type];
    });
  }
  if (totals) {
    r++;
    const xr = ws.getRow(r);
    columns.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      if (i === 0) cell.value = 'JUMLAH';
      if (totals[c.key] != null) { cell.value = Number(totals[c.key]); cell.numFmt = fmt.money; }
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin' } };
    });
  }
  return wb.xlsx.writeBuffer();
}
