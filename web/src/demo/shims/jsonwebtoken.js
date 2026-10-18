// Token sesi untuk mode demo. Tidak ditandatangani karena semua data hanya ada di browser pengguna sendiri.
const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));

export function sign(payload, _secret, { expiresIn } = {}) {
  const hours = Number(String(expiresIn || '12h').replace('h', '')) || 12;
  return `demo.${enc({ ...payload, exp: Math.floor(Date.now() / 1000) + hours * 3600 })}`;
}

export function verify(token) {
  const p = dec(String(token).replace(/^demo\./, ''));
  if (p.exp && p.exp * 1000 < Date.now()) throw new Error('Token kedaluwarsa');
  return p;
}

export default { sign, verify };
