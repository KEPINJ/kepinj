import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api.js';

/**
 * QR verifikasi keaslian dokumen cetak. Mendaftarkan sidik dokumen ke server lalu menampilkan QR
 * yang mengarah ke halaman publik /v/:kode. Bila data sumber berubah, hasil pindai menyatakan tidak cocok.
 */
export default function DocQr({ jenis, skpdId, parameter, className = '' }) {
  const [doc, setDoc] = useState(null);
  const key = JSON.stringify(parameter);
  useEffect(() => {
    if (!skpdId) return undefined;
    let alive = true;
    api.post('/api/dokumen', { jenis, skpd_id: skpdId, parameter })
      .then(async (d) => {
        const url = `${window.location.origin}/v/${d.kode}`;
        const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
        if (alive) setDoc({ ...d, url, svg });
      })
      .catch(() => alive && setDoc(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jenis, skpdId, key]);
  if (!doc) return null;
  return (
    <div className={`flex items-center gap-2.5 ${className}`} style={{ breakInside: 'avoid' }}>
      <div className="h-[72px] w-[72px] shrink-0 bg-white" dangerouslySetInnerHTML={{ __html: doc.svg }} />
      <div className="text-[9px] leading-snug text-black">
        <p className="font-bold">Verifikasi keaslian dokumen</p>
        <p>Pindai QR atau buka {window.location.host}/v/</p>
        <p className="font-mono text-[11px] font-bold tracking-wider">{doc.kode}</p>
      </div>
    </div>
  );
}
