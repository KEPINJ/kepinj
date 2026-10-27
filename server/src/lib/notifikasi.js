// Modul lain mendaftarkan sumber notifikasinya di sini: fn({ user, skpd, tahun, today }) -> item[]
export const sumberNotifikasi = [];
export const daftarNotifikasi = (fn) => sumberNotifikasi.push(fn);
