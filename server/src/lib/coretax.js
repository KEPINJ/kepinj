// =====================================================================
//  Ekspor bukti potong ke format impor massal (bulk) Coretax DJP.
//  Struktur elemen mengikuti template XML Coretax (BPPU, BP21, BPMP).
//  DJP dapat memperbarui template sewaktu-waktu: seluruh nama elemen
//  dikumpulkan di TEMPLATES di bawah agar mudah disesuaikan tanpa
//  mengubah logika lain. Selalu cocokkan dengan template terbaru di
//  https://pajak.go.id sebelum unggah produksi.
// =====================================================================

const esc = (v) => String(v ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const digits = (v) => String(v ?? '').replace(/\D/g, '');

/** NPWP 15 digit lama -> 16 digit (prefix 0); NIK sudah 16 digit. */
export function tin16(npwpOrNik) {
  const d = digits(npwpOrNik);
  if (d.length === 15) return `0${d}`;
  return d;
}

/** NITKU = NPWP 16 digit + 6 digit kode tempat kegiatan usaha (pusat = 000000). */
export function nitku(npwp, explicit) {
  const e = digits(explicit);
  if (e.length === 22) return e;
  const t = tin16(npwp);
  return t ? `${t}000000` : '';
}

const amount = (v) => Math.round(Number(v || 0));
const rate = (v) => Number(Number(v || 0).toFixed(4)).toString();

export const TEMPLATES = {
  BPPU: {
    root: 'BpuBulk', list: 'ListOfBpu', item: 'Bpu',
    fields: (r, ctx) => ({
      TaxPeriodMonth: r.masa,
      TaxPeriodYear: r.tahun,
      CounterpartTin: tin16(r.penerima_npwp || r.penerima_nik),
      IDPlaceOfBusinessActivityOfIncomeRecipient: nitku(r.penerima_npwp || r.penerima_nik, r.penerima_nitku).slice(-6) || '000000',
      TaxCertificate: r.detail?.fasilitas || 'N/A',
      TaxObjectCode: r.kode_objek,
      TaxBase: amount(r.dpp),
      Rate: rate(r.tarif),
      Document: r.dokumen_jenis || 'CommercialInvoice',
      DocumentNumber: r.dokumen_nomor || r.no_bukti_potong || `BKU-${r.id}`,
      DocumentDate: r.dokumen_tanggal || ctx.withholdingDate(r),
      IDPlaceOfBusinessActivity: ctx.nitkuPemotong,
      GovTreasurerOpt: r.detail?.sp2d ? 'SP2D' : 'N/A',
      SP2DNumber: r.detail?.sp2d || '',
      WithholdingDate: ctx.withholdingDate(r),
    }),
  },
  BP21: {
    root: 'Bp21Bulk', list: 'ListOfBp21', item: 'Bp21',
    fields: (r, ctx) => ({
      TaxPeriodMonth: r.masa,
      TaxPeriodYear: r.tahun,
      CounterpartOpt: 'Resident',
      CounterpartPassport: '',
      CounterpartTin: tin16(r.penerima_npwp || r.penerima_nik),
      StatusTaxExemption: r.status_ptkp || 'TK/0',
      Position: r.detail?.jabatan || '',
      TaxCertificate: r.detail?.fasilitas || 'N/A',
      TaxObjectCode: r.kode_objek,
      Gross: amount(r.detail?.bruto ?? r.dpp),
      Deemed: r.detail?.deemed ?? 100,
      Rate: rate(r.tarif),
      Document: r.dokumen_jenis || 'Other',
      DocumentNumber: r.dokumen_nomor || `BKU-${r.id}`,
      DocumentDate: r.dokumen_tanggal || ctx.withholdingDate(r),
      IDPlaceOfBusinessActivity: ctx.nitkuPemotong,
      WithholdingDate: ctx.withholdingDate(r),
    }),
  },
  BPMP: {
    root: 'MmPayrollBulk', list: 'ListOfMmPayroll', item: 'MmPayroll',
    fields: (r, ctx) => ({
      TaxPeriodMonth: r.masa,
      TaxPeriodYear: r.tahun,
      CounterpartOpt: 'Resident',
      CounterpartPassport: '',
      CounterpartTin: tin16(r.penerima_npwp || r.penerima_nik),
      StatusTaxExemption: r.status_ptkp || 'TK/0',
      Position: r.detail?.jabatan || '',
      TaxCertificate: r.ditanggung_pemerintah ? 'DTP' : 'N/A',
      TaxObjectCode: r.kode_objek || '21-100-01',
      Gross: amount(r.detail?.bruto ?? r.dpp),
      Rate: rate(r.tarif),
      IDPlaceOfBusinessActivity: ctx.nitkuPemotong,
      WithholdingDate: ctx.withholdingDate(r),
    }),
  },
};

function lastDayOfMasa(r) {
  const d = new Date(Date.UTC(r.tahun, r.masa, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Membangun XML bulk Coretax.
 * @param {'BPPU'|'BP21'|'BPMP'} form
 * @param {object} skpd  data pemotong (npwp, nitku)
 * @param {object[]} records baris tabel pajak
 */
export function buildCoretaxXml(form, skpd, records) {
  const tpl = TEMPLATES[form];
  if (!tpl) throw new Error(`Form Coretax tidak dikenal: ${form}`);
  const ctx = {
    nitkuPemotong: nitku(skpd.npwp, skpd.nitku),
    withholdingDate: (r) => r.detail?.tanggal_potong || r.dokumen_tanggal || lastDayOfMasa(r),
  };
  const items = records.map((r) => {
    const f = tpl.fields(r, ctx);
    const inner = Object.entries(f).map(([k, v]) => `      <${k}>${esc(v)}</${k}>`).join('\n');
    return `    <${tpl.item}>\n${inner}\n    </${tpl.item}>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<${tpl.root} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <TIN>${esc(tin16(skpd.npwp))}</TIN>\n  <${tpl.list}>\n${items}\n  </${tpl.list}>\n</${tpl.root}>\n`;
}

/** Validasi sebelum ekspor: mengembalikan daftar masalah per baris. */
export function validateForCoretax(form, records) {
  const issues = [];
  for (const r of records) {
    const tin = tin16(r.penerima_npwp || r.penerima_nik);
    if (tin.length !== 16) issues.push({ id: r.id, nama: r.penerima_nama, pesan: 'NPWP/NIK penerima harus 16 digit (atau NPWP 15 digit lama)' });
    if (!r.kode_objek) issues.push({ id: r.id, nama: r.penerima_nama, pesan: 'Kode objek pajak kosong' });
    if (Number(r.dpp) <= 0) issues.push({ id: r.id, nama: r.penerima_nama, pesan: 'DPP/penghasilan bruto harus lebih dari 0' });
    if ((form === 'BP21' || form === 'BPMP') && !/^(TK|K)\/[0-3]$/.test(r.status_ptkp || 'TK/0')) issues.push({ id: r.id, nama: r.penerima_nama, pesan: 'Status PTKP tidak valid' });
  }
  return issues;
}

export function formForRecord(r, objekMap) {
  if (r.jenis_pajak === 'PPN') return 'PPN';
  return objekMap[r.kode_objek]?.coretax_form || (r.jenis_pajak === 'PPH21' ? 'BP21' : 'BPPU');
}
