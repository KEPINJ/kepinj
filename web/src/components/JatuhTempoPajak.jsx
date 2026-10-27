import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp, useLive } from '../lib/ctx.jsx';
import { Card, Skeleton, cx, useLoad } from './ui.jsx';
import { rp, tgl } from '../lib/format.js';

const TINGKAT = {
  lewat: ['bg-rose-50 text-rose-700 ring-rose-200', 'Terlambat'],
  segera: ['bg-amber-50 text-amber-800 ring-amber-200', 'Segera'],
  dekat: ['bg-brand-50 text-brand-700 ring-brand-200', 'Mendekati'],
  aman: ['bg-emerald-50 text-emerald-700 ring-emerald-200', 'Aman'],
};

function sisaText(j) {
  if (j.sisa_hari < 0) return `lewat ${-j.sisa_hari} hari`;
  if (j.sisa_hari === 0) return 'hari ini';
  return `${j.sisa_hari} hari lagi`;
}

/** Daftar kewajiban setor/lapor pajak per masa beserta hitung mundur jatuh tempo. */
export default function JatuhTempoPajak({ onPick, compact = false, className }) {
  const { skpdId, tahun } = useApp();
  const { data, reload } = useLoad(() => skpdId && api.get('/api/pajak/jatuh-tempo', { skpd_id: skpdId, tahun }), [skpdId, tahun]);
  useLive((e) => e.type.startsWith('pajak') && reload(), 800);
  const rows = (data?.rows || []).slice(0, compact ? 4 : 12);
  return (
    <Card className={className} title="Jatuh tempo pajak" subtitle="Setor paling lambat tgl 15, lapor tgl 20 bulan berikutnya (geser ke hari kerja)"
      actions={compact && <Link to="/pajak/register" className="text-xs font-medium text-brand-700 hover:underline">Register →</Link>} bodyClass="">
      {!data ? <div className="space-y-3 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : !rows.length ? (
        <div className="flex items-center gap-3 p-4 text-sm text-slate-600"><CheckCircle2 className="h-5 w-5 text-emerald-500" />Tidak ada pajak yang belum disetor atau dilaporkan.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((j) => {
            const [tone, label] = TINGKAT[j.tingkat];
            const Row = onPick ? 'button' : 'div';
            return (
              <li key={`${j.tahun}-${j.masa}`}>
                <Row type={onPick ? 'button' : undefined} onClick={onPick ? () => onPick(j) : undefined}
                  className={cx('flex w-full items-center gap-3 px-4 py-3 text-left', onPick && 'transition hover:bg-slate-50')}>
                  <div className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-center ring-1 ring-inset', tone)}>
                    <CalendarClock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {j.kewajiban === 'setor' ? 'Setor' : 'Lapor'} masa {j.nama_masa}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {j.kewajiban === 'setor' ? `${j.jumlah_belum_setor} bukti · ${j.rincian}` : `${j.jumlah_belum_lapor} bukti sudah disetor, belum dilaporkan`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num text-sm font-semibold text-slate-800">{rp(j.kewajiban === 'setor' ? j.belum_setor : j.belum_lapor)}</p>
                    <p className="text-[11px]"><span className={cx('rounded-full px-1.5 py-0.5 font-medium ring-1 ring-inset', tone)}>{label}</span> <span className="text-slate-500">{tgl(j.tenggat)} · {sisaText(j)}</span></p>
                  </div>
                </Row>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
