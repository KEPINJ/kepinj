export class HttpError extends Error {
  constructor(statusCode, message, extra) {
    super(message);
    this.statusCode = statusCode;
    Object.assign(this, extra);
  }
}
/** Petakan error (HttpError / kode error PostgreSQL) menjadi status & isi respons API. */
export function errorResponse(err) {
  const status = err.statusCode || (err.code === 'P0001' ? 409 : err.code === '23505' ? 409 : err.code === '23503' ? 400 : 500);
  const error = err.code === '23505' ? 'Data dengan kunci yang sama sudah ada'
    : err.code === '23503' ? 'Referensi data tidak ditemukan (periksa kode/ID yang dipilih)'
      : status >= 500 ? 'Terjadi kesalahan pada server' : err.message;
  return { status, body: { error, masalah: err.masalah, log: err.log } };
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Data tidak ditemukan') => new HttpError(404, msg);
export const forbidden = (msg = 'Anda tidak memiliki akses') => new HttpError(403, msg);

export function required(obj, fields) {
  const missing = fields.filter((f) => obj?.[f] === undefined || obj?.[f] === null || obj?.[f] === '');
  if (missing.length) throw bad(`Field wajib diisi: ${missing.join(', ')}`);
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s));
export const int = (v, d) => (v === undefined || v === null || v === '' ? d : Number.parseInt(v, 10));
export const money = (v) => Math.round(Number(v || 0) * 100) / 100;

/** Admin & pimpinan dapat melihat semua SKPD; peran lain hanya SKPD-nya sendiri. */
export function scopeSkpd(user, requested) {
  const r = int(requested);
  if (user.role === 'admin' || user.role === 'pimpinan') return r || user.skpd_id || null;
  if (r && r !== user.skpd_id) throw forbidden('Anda hanya dapat mengakses data SKPD Anda');
  return user.skpd_id;
}

export function canWrite(user, skpdId) {
  if (user.role === 'admin') return true;
  if (user.role === 'bendahara' && user.skpd_id === skpdId) return true;
  throw forbidden('Hanya bendahara SKPD terkait atau admin yang dapat mencatat transaksi');
}

export function sendFile(reply, buffer, fileName, type) {
  return reply
    .header('Content-Type', type)
    .header('Content-Disposition', `attachment; filename="${fileName}"`)
    .send(Buffer.from(buffer));
}
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
