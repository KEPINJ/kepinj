export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Permintaan gagal (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, body, { raw, latar } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  // Permintaan latar (polling) tidak dihitung sebagai aktivitas pengguna untuk batas waktu sesi
  if (latar) opts.headers['X-Background'] = '1';
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  if (raw && res.ok) return res;
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/login')) window.dispatchEvent(new CustomEvent('bku:unauthorized', { detail: isJson ? data : null }));
    if (res.status === 403 && isJson && data?.alasan === 'ganti_password') window.dispatchEvent(new Event('bku:ganti-password'));
    throw new ApiError(res.status, isJson ? data : { error: data });
  }
  return data;
}

export const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  latar: (url, params) => request('GET', url + qs(params), undefined, { latar: true }),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file) => { const fd = new FormData(); fd.append('file', file); return request('POST', url, fd); },
};

function filenameFrom(res, fallback) {
  const cd = res.headers.get('content-disposition') || '';
  return cd.match(/filename="?([^"]+)"?/)?.[1] || fallback;
}

/** Unduh file dari endpoint GET atau POST. */
export async function download(url, { params, body, fallback = 'unduhan' } = {}) {
  const res = body ? await request('POST', url, body, { raw: true }) : await request('GET', url + qs(params), undefined, { raw: true });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filenameFrom(res, fallback);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
