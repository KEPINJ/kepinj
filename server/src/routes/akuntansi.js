// Akuntansi & jurnal: bagan akun, jurnal otomatis dari BKU yang disetujui, jurnal umum/penyesuaian,
// jurnal balik, buku besar, neraca saldo, dan laporan jurnal per periode.
import { query, tx, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { bad, notFound, int, isDate, scopeSkpd, sendFile, XLSX, money } from '../lib/http.js';
import { buildWorkbook } from '../lib/excel.js';
import { daftarNotifikasi } from '../lib/notifikasi.js';
import { AKUN_DASAR, ATURAN, LABEL_PAJAK_JENIS, akunCermin, namaCermin, susunJurnal, cekSeimbang, balikBaris } from '../../../shared/jurnal.js';
import { JENIS_BKU } from '../lib/ledger.js';

const AKUNTAN = ['admin', 'verifikator'];          // PPK-SKPD menyelenggarakan akuntansi SKPD
const PREFIKS = { otomatis: 'JO', umum: 'JU', penyesuaian: 'JP', koreksi: 'JK', balik: 'JB' };
const KELOMPOK = (kode) => ({ 1: ['aset', 'D'], 2: ['kewajiban', 'K'], 3: ['ekuitas', 'K'], 4: ['pendapatan_lra', 'K'], 5: ['belanja', 'D'], 6: ['pembiayaan', 'K'], 7: ['pendapatan_lo', 'K'], 8: ['beban', 'D'] }[kode[0]]);

/** Pastikan akun dasar ada, dan buat akun cerminan untuk kode rekening yang dipakai (beban 8.x, aset 1.3.x, pendapatan 7.x, serta akun LRA 4.x/5.x). */
export async function pastikanAkun(c, kodeRekening = []) {
  for (const [kode, nama, kelompok, normal, basis, level, induk] of AKUN_DASAR) {
    await c.query('INSERT INTO akun (kode, nama, kelompok, saldo_normal, basis, level, induk) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (kode) DO NOTHING', [kode, nama, kelompok, normal, basis, level, induk]);
  }
  const kode = [...new Set(kodeRekening.filter((k) => /^[45]\./.test(k || '')))];
  if (!kode.length) return;
  const { rows } = await c.query('SELECT kode, nama FROM rekening WHERE kode = ANY($1)', [kode]);
  for (const r of rows) {
    const [kel, normal] = KELOMPOK(r.kode);
    await c.query("INSERT INTO akun (kode, nama, kelompok, saldo_normal, basis, level, induk) VALUES ($1,$2,$3,$4,'LRA',6,$5) ON CONFLICT (kode) DO NOTHING", [r.kode, r.nama, kel, normal, r.kode[0]]);
    const cer = akunCermin(r.kode);
    if (cer) {
      const [k2, n2] = KELOMPOK(cer.kode);
      await c.query("INSERT INTO akun (kode, nama, kelompok, saldo_normal, basis, level, induk, keterangan) VALUES ($1,$2,$3,$4,'LO',6,$5,$6) ON CONFLICT (kode) DO NOTHING",
        [cer.kode, namaCermin(r.nama, cer.kode), k2, n2, cer.kode.startsWith('1.3') ? '1.3' : cer.kode[0], `Cerminan otomatis dari kode rekening ${r.kode}`]);
    }
  }
}

async function nomorJurnal(c, skpd, tahun, jenis) {
  await c.query('SELECT pg_advisory_xact_lock($1)', [skpd * 10000 + tahun]);
  const pre = `${PREFIKS[jenis]}-${tahun}-`;
  const { rows: [r] } = await c.query('SELECT COALESCE(MAX(substring(nomor FROM $3)::int), 0) + 1 AS n FROM jurnal WHERE skpd_id = $1 AND tahun = $2 AND nomor LIKE $4',
    [skpd, tahun, `^${pre}(\\d+)$`, `${pre}%`]);
  return `${pre}${String(r.n).padStart(6, '0')}`;
}

/** Simpan satu jurnal beserta rinciannya (keseimbangan diperiksa aplikasi dan trigger basis data saat commit). */
export async function simpanJurnal(c, { skpd, tahun, tanggal, jenis, uraian, sumber, aturan, dasar, balikDari, user, baris }) {
  const cek = cekSeimbang(baris);
  if (!cek.seimbang) throw bad(`Jurnal tidak seimbang: ${cek.masalah.join('; ') || 'tidak ada baris'}`);
  const { rows: akun } = await c.query('SELECT kode FROM akun WHERE kode = ANY($1) AND aktif', [[...new Set(baris.map((b) => b.akun_kode))]]);
  const ada = new Set(akun.map((a) => a.kode));
  const hilang = baris.filter((b) => !ada.has(b.akun_kode)).map((b) => b.akun_kode);
  if (hilang.length) throw bad(`Akun tidak terdaftar/aktif: ${[...new Set(hilang)].join(', ')}`);
  const nomor = await nomorJurnal(c, skpd, tahun, jenis);
  const { rows: [j] } = await c.query(`INSERT INTO jurnal (skpd_id, tahun, nomor, tanggal, jenis, sumber_bku_id, aturan, uraian, dasar, balik_dari, dibuat_oleh)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [skpd, tahun, nomor, tanggal, jenis, sumber || null, aturan || null, String(uraian).slice(0, 500), dasar || null, balikDari || null, user?.id || null]);
  await c.query(`INSERT INTO jurnal_rinci (jurnal_id, urut, basis, akun_kode, debit, kredit, keterangan)
    SELECT $1, x.urut, x.basis, x.akun_kode, x.debit, x.kredit, x.keterangan FROM jsonb_to_recordset($2::jsonb) AS x(urut int, basis text, akun_kode text, debit numeric, kredit numeric, keterangan text)`,
  [j.id, JSON.stringify(baris.map((b, i) => ({ ...b, urut: i + 1, debit: money(b.debit), kredit: money(b.kredit), keterangan: b.keterangan || null })))]);
  return j;
}

/** Entri BKU disetujui yang belum dijurnal (untuk posting) beserta info pajak & pemetaan. */
async function entriSiapPosting(c, skpd, tahun, sampai) {
  const { rows } = await c.query(`SELECT e.id, e.no_urut, e.tanggal, e.no_bukti, e.jenis, e.metode, e.kode_rekening, e.uraian, e.penerimaan, e.pengeluaran, e.koreksi_of, s.status,
      (SELECT p.jenis_pajak FROM pajak p WHERE p.bku_entry_id = e.id LIMIT 1) AS pajak_jenis
    FROM bku_entries e JOIN bku_status s ON s.entry_id = e.id
    WHERE e.skpd_id = $1 AND e.tahun = $2 AND e.tanggal <= $3
      AND (s.status = 'disetujui' OR (s.status = 'dikoreksi' AND s.disetujui_at IS NULL AND EXISTS (SELECT 1 FROM persetujuan p WHERE p.objek = 'bku' AND p.objek_id = e.id::text AND p.status = 'setuju'
            AND NOT EXISTS (SELECT 1 FROM persetujuan q WHERE q.objek = 'bku' AND q.objek_id = p.objek_id AND q.putaran = p.putaran AND q.status <> 'setuju'))))
      AND NOT EXISTS (SELECT 1 FROM jurnal j WHERE j.sumber_bku_id = e.id)
    ORDER BY e.tanggal, e.no_urut`, [skpd, tahun, sampai]);
  for (const r of rows) {
    if (r.jenis === 'PAJAK_SETOR' && !r.pajak_jenis) {
      const label = Object.keys(LABEL_PAJAK_JENIS).find((l) => r.uraian.startsWith(`Disetor ${l} `));
      r.pajak_jenis = label ? LABEL_PAJAK_JENIS[label] : null;
    }
  }
  return rows;
}

/** Posting jurnal otomatis; hasil: jumlah jurnal dibuat, dibalik (koreksi), dan yang perlu telaah. */
export async function postingJurnal(c, user, skpd, tahun, sampai) {
  const entri = await entriSiapPosting(c, skpd, tahun, sampai);
  await pastikanAkun(c, entri.map((e) => e.kode_rekening));
  const { rows: pem } = await c.query('SELECT * FROM pemetaan_akun WHERE kode_rekening = ANY($1)', [[...new Set(entri.map((e) => e.kode_rekening).filter(Boolean))]]);
  const peta = Object.fromEntries(pem.map((p) => [p.kode_rekening, p]));
  const hasil = { dibuat: 0, dibalik: 0, telaah: 0, tanpa: 0, per_aturan: {} };
  for (const e of entri) {
    const r = susunJurnal(e, peta[e.kode_rekening]);
    if (r.status === 'telaah') { hasil.telaah++; continue; }
    if (r.status === 'balik') {
      const { rows: [asal] } = await c.query("SELECT * FROM jurnal WHERE sumber_bku_id = $1 AND jenis = 'otomatis' AND NOT dibalik", [e.koreksi_of]);
      if (!asal) { hasil.tanpa++; continue; }      // entri asal tidak pernah dijurnal (mis. ditolak): koreksi tidak menimbulkan jurnal
      const { rows: rinci } = await c.query('SELECT basis, akun_kode, debit, kredit FROM jurnal_rinci WHERE jurnal_id = $1 ORDER BY urut', [asal.id]);
      await simpanJurnal(c, { skpd, tahun, tanggal: e.tanggal, jenis: 'balik', uraian: `Jurnal balik atas ${asal.nomor} karena koreksi BKU No. ${e.no_urut}`, sumber: e.id, aturan: 'KOREKSI', dasar: r.dasar, balikDari: asal.id, user, baris: balikBaris(rinci) });
      hasil.dibalik++; hasil.per_aturan.KOREKSI = (hasil.per_aturan.KOREKSI || 0) + 1;
      continue;
    }
    await simpanJurnal(c, { skpd, tahun, tanggal: e.tanggal, jenis: 'otomatis', uraian: `BKU No. ${e.no_urut} · ${e.uraian}`, sumber: e.id, aturan: r.aturan, dasar: r.dasar, user, baris: r.baris });
    hasil.dibuat++; hasil.per_aturan[r.aturan] = (hasil.per_aturan[r.aturan] || 0) + 1;
  }
  return hasil;
}

async function daftarTelaah(skpd, tahun) {
  const c = { query: (...a) => query(...a) };
  const entri = await entriSiapPosting(c, skpd, tahun, `${tahun}-12-31`);
  const { rows: pem } = await query('SELECT * FROM pemetaan_akun');
  const peta = Object.fromEntries(pem.map((p) => [p.kode_rekening, p]));
  const siap = []; const telaah = [];
  for (const e of entri) {
    const r = susunJurnal(e, peta[e.kode_rekening]);
    (r.status === 'telaah' ? telaah : siap).push({ ...e, aturan: r.aturan, alasan: r.alasan, baris: r.baris });
  }
  return { siap, telaah };
}

daftarNotifikasi(async ({ user, skpd, tahun }) => {
  if (!AKUNTAN.includes(user.role)) return [];
  const { siap, telaah } = await daftarTelaah(skpd, tahun);
  const out = [];
  if (siap.length) out.push({ id: `jurnal-siap-${siap.length}`, tipe: 'akuntansi', kategori: 'akuntansi', tingkat: 'info', judul: `${siap.length.toLocaleString('id-ID')} transaksi disetujui siap diposting ke jurnal`, pesan: 'Buka Akuntansi lalu jalankan posting jurnal otomatis.', link: '/akuntansi', tanggal: null });
  if (telaah.length) out.push({ id: `jurnal-telaah-${telaah.length}`, tipe: 'akuntansi', kategori: 'akuntansi', tingkat: 'peringatan', judul: `${telaah.length} transaksi perlu telaah akuntansi`, pesan: 'Perlakuan akuntansinya tidak dapat ditentukan otomatis; buat jurnal umum yang ditautkan ke transaksi.', link: '/akuntansi?tab=telaah', tanggal: null });
  return out;
});

function periode(q) {
  const tahun = int(q.tahun, new Date().getFullYear());
  const dari = isDate(q.dari) ? q.dari : `${tahun}-01-01`;
  const sampai = isDate(q.sampai) ? q.sampai : `${tahun}-12-31`;
  return { tahun, dari, sampai };
}

/** Neraca saldo per akun s.d. tanggal, per basis. */
export async function neracaSaldo(skpd, tahun, dari, sampai, basis) {
  const { rows } = await query(`SELECT a.kode, a.nama, a.kelompok, a.saldo_normal, a.basis,
      COALESCE(SUM(r.debit) FILTER (WHERE j.tanggal < $3), 0)::float AS debit_awal, COALESCE(SUM(r.kredit) FILTER (WHERE j.tanggal < $3), 0)::float AS kredit_awal,
      COALESCE(SUM(r.debit) FILTER (WHERE j.tanggal >= $3), 0)::float AS debit, COALESCE(SUM(r.kredit) FILTER (WHERE j.tanggal >= $3), 0)::float AS kredit
    FROM jurnal_rinci r JOIN jurnal j ON j.id = r.jurnal_id JOIN akun a ON a.kode = r.akun_kode
    WHERE j.skpd_id = $1 AND j.tahun = $2 AND j.tanggal <= $4 ${basis ? 'AND r.basis = $5' : ''}
    GROUP BY a.kode ORDER BY a.kode`, [skpd, tahun, dari, sampai, ...(basis ? [basis] : [])]);
  const out = rows.map((r) => {
    const bersih = r.debit_awal + r.debit - r.kredit_awal - r.kredit;
    return { ...r, saldo_debit: bersih > 0 ? bersih : 0, saldo_kredit: bersih < 0 ? -bersih : 0 };
  });
  const t = (k) => Math.round(out.reduce((s, r) => s + r[k], 0) * 100) / 100;
  const total = { debit: t('debit') + t('debit_awal'), kredit: t('kredit') + t('kredit_awal'), saldo_debit: t('saldo_debit'), saldo_kredit: t('saldo_kredit') };
  return { rows: out, total, seimbang: Math.abs(total.saldo_debit - total.saldo_kredit) < 0.01 && Math.abs(total.debit - total.kredit) < 0.01 };
}

export default async function akuntansiRoutes(app) {
  app.get('/api/akuntansi/ringkasan', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    if (!skpd) throw bad('Pilih SKPD terlebih dahulu');
    const tahun = int(req.query.tahun, new Date().getFullYear());
    await tx((c) => pastikanAkun(c));
    const [{ rows: [j] }, { siap, telaah }, nsLo, nsLra, { rows: kas }] = await Promise.all([
      query(`SELECT COUNT(*)::int AS jurnal, COUNT(*) FILTER (WHERE jenis = 'otomatis')::int AS otomatis, COUNT(*) FILTER (WHERE jenis IN ('umum','penyesuaian'))::int AS manual,
          COUNT(*) FILTER (WHERE jenis = 'balik')::int AS balik, MAX(dibuat_at) AS terakhir FROM jurnal WHERE skpd_id = $1 AND tahun = $2`, [skpd, tahun]),
      daftarTelaah(skpd, tahun),
      neracaSaldo(skpd, tahun, `${tahun}-01-01`, `${tahun}-12-31`, 'LO'),
      neracaSaldo(skpd, tahun, `${tahun}-01-01`, `${tahun}-12-31`, 'LRA'),
      // Pembanding: saldo kas di jurnal vs saldo BKU (bank + tunai) untuk transaksi yang sudah dijurnal
      query(`SELECT COALESCE(SUM(r.debit - r.kredit) FILTER (WHERE r.akun_kode LIKE '1.1.01.03.01.%'), 0)::float AS kas_jurnal,
          COALESCE((SELECT SUM(e.penerimaan - e.pengeluaran) FROM bku_entries e WHERE e.skpd_id = $1 AND e.tahun = $2), 0)::float AS kas_bku
        FROM jurnal_rinci r JOIN jurnal j ON j.id = r.jurnal_id WHERE j.skpd_id = $1 AND j.tahun = $2`, [skpd, tahun]),
    ]);
    const perAturan = {};
    for (const s of siap) perAturan[s.aturan] = (perAturan[s.aturan] || 0) + 1;
    return { jurnal: j, siap_posting: siap.length, siap_per_aturan: perAturan, telaah: telaah.length, neraca_lo: { total: nsLo.total, seimbang: nsLo.seimbang }, neraca_lra: { total: nsLra.total, seimbang: nsLra.seimbang }, kas: kas[0] };
  });

  app.get('/api/akuntansi/aturan', { preHandler: requireAuth }, async () => ({ aturan: ATURAN, jenis: JENIS_BKU }));

  app.get('/api/akuntansi/akun', { preHandler: requireAuth }, async (req) => {
    await tx((c) => pastikanAkun(c));
    const p = []; const where = ['TRUE'];
    if (req.query.q) { p.push(`%${req.query.q}%`); where.push(`(kode ILIKE $${p.length} OR nama ILIKE $${p.length})`); }
    if (req.query.basis) { p.push(req.query.basis); where.push(`basis = $${p.length}`); }
    const { rows } = await query(`SELECT * FROM akun WHERE ${where.join(' AND ')} ORDER BY kode`, p);
    return { rows };
  });

  app.post('/api/akuntansi/akun', { preHandler: requireRole(...AKUNTAN) }, async (req) => {
    const b = req.body || {};
    if (!/^\d(\.\d+)*$/.test(String(b.kode || ''))) throw bad('Kode akun tidak valid (contoh 1.1.12.01.01.0002)');
    if (!String(b.nama || '').trim()) throw bad('Nama akun wajib diisi');
    const [kel, normal] = KELOMPOK(b.kode);
    const basis = ['4', '5', '6'].includes(b.kode[0]) || b.kode === '3.1.02.03.01.0001' ? 'LRA' : 'LO';
    return tx(async (c) => {
      const { rows: [r] } = await c.query(`INSERT INTO akun (kode, nama, kelompok, saldo_normal, basis, level, induk, keterangan, aktif) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (kode) DO UPDATE SET nama = EXCLUDED.nama, keterangan = EXCLUDED.keterangan, aktif = EXCLUDED.aktif RETURNING *`,
      [b.kode, b.nama.trim(), kel, normal, basis, b.kode.split('.').length, b.induk || null, b.keterangan || null, b.aktif !== false]);
      await audit(c, req.user, 'akun_simpan', 'akun', r.kode, { nama: r.nama }, req.ip);
      return { row: r };
    });
  });

  app.get('/api/akuntansi/pemetaan', { preHandler: requireAuth }, async () => {
    const { rows } = await query(`SELECT r.kode AS kode_rekening, r.nama, r.jenis, p.akun_lo, p.akun_lra, p.perlakuan, p.catatan, lo.nama AS akun_lo_nama
      FROM rekening r LEFT JOIN pemetaan_akun p ON p.kode_rekening = r.kode LEFT JOIN akun lo ON lo.kode = p.akun_lo
      WHERE r.jenis IN ('belanja','pendapatan') ORDER BY r.kode`);
    return { rows: rows.map((r) => ({ ...r, cermin: akunCermin(r.kode_rekening) })) };
  });

  app.put('/api/akuntansi/pemetaan/:kode', { preHandler: requireRole(...AKUNTAN) }, async (req) => {
    const b = req.body || {};
    if (b.perlakuan && !['beban', 'aset', 'persediaan', 'telaah'].includes(b.perlakuan)) throw bad('Perlakuan tidak dikenal');
    return tx(async (c) => {
      await pastikanAkun(c, [req.params.kode]);
      const { rows: [r] } = await c.query(`INSERT INTO pemetaan_akun (kode_rekening, akun_lo, akun_lra, perlakuan, catatan, diubah_oleh, diubah_at) VALUES ($1,$2,$3,$4,$5,$6,now())
        ON CONFLICT (kode_rekening) DO UPDATE SET akun_lo = EXCLUDED.akun_lo, akun_lra = EXCLUDED.akun_lra, perlakuan = EXCLUDED.perlakuan, catatan = EXCLUDED.catatan, diubah_oleh = EXCLUDED.diubah_oleh, diubah_at = now() RETURNING *`,
      [req.params.kode, b.akun_lo || null, b.akun_lra || null, b.perlakuan || null, b.catatan || null, req.user.id]);
      await audit(c, req.user, 'pemetaan_akun_simpan', 'pemetaan_akun', req.params.kode, b, req.ip);
      return { row: r };
    });
  });

  // Pratinjau jurnal satu transaksi BKU (dipakai detail transaksi)
  app.get('/api/akuntansi/pratinjau/:id', { preHandler: requireAuth }, async (req) => {
    const { rows: [e] } = await query(`SELECT e.*, (SELECT p.jenis_pajak FROM pajak p WHERE p.bku_entry_id = e.id LIMIT 1) AS pajak_jenis FROM bku_entries e WHERE e.id = $1`, [int(req.params.id)]);
    if (!e) throw notFound();
    scopeSkpd(req.user, e.skpd_id);
    const { rows: [pm] } = await query('SELECT * FROM pemetaan_akun WHERE kode_rekening = $1', [e.kode_rekening]);
    const { rows: jurnal } = await query(`SELECT j.*, json_agg(json_build_object('basis', r.basis, 'akun_kode', r.akun_kode, 'akun_nama', a.nama, 'debit', r.debit, 'kredit', r.kredit) ORDER BY r.urut) AS rinci
      FROM jurnal j JOIN jurnal_rinci r ON r.jurnal_id = j.id JOIN akun a ON a.kode = r.akun_kode WHERE j.sumber_bku_id = $1 GROUP BY j.id ORDER BY j.id`, [e.id]);
    const r = susunJurnal(e, pm);
    const { rows: nama } = await query('SELECT kode, nama FROM akun WHERE kode = ANY($1)', [(r.baris || []).map((b) => b.akun_kode)]);
    return { usulan: { ...r, baris: (r.baris || []).map((b) => ({ ...b, akun_nama: nama.find((n) => n.kode === b.akun_kode)?.nama })) }, jurnal };
  });

  app.post('/api/akuntansi/posting', { preHandler: requireRole(...AKUNTAN) }, async (req) => {
    const skpd = scopeSkpd(req.user, req.body?.skpd_id);
    const tahun = int(req.body?.tahun, new Date().getFullYear());
    const sampai = isDate(req.body?.sampai) ? req.body.sampai : `${tahun}-12-31`;
    return tx(async (c) => {
      const h = await postingJurnal(c, req.user, skpd, tahun, sampai);
      await audit(c, req.user, 'jurnal_posting', 'jurnal', `${skpd}/${tahun}`, { ...h, sampai }, req.ip);
      return h;
    });
  });

  app.get('/api/akuntansi/telaah', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { telaah } = await daftarTelaah(skpd, int(req.query.tahun, new Date().getFullYear()));
    return { rows: telaah };
  });

  // Jurnal umum / penyesuaian (manual), boleh ditautkan ke transaksi BKU yang perlu telaah
  app.post('/api/akuntansi/jurnal', { preHandler: requireRole(...AKUNTAN) }, async (req) => {
    const b = req.body || {};
    const skpd = scopeSkpd(req.user, b.skpd_id);
    if (!isDate(b.tanggal)) throw bad('Tanggal jurnal tidak valid');
    if (!['umum', 'penyesuaian'].includes(b.jenis || 'umum')) throw bad('Jenis jurnal manual: umum atau penyesuaian');
    if (!String(b.uraian || '').trim()) throw bad('Uraian jurnal wajib diisi');
    const baris = (Array.isArray(b.baris) ? b.baris : []).filter((r) => r.akun_kode && (Number(r.debit) > 0 || Number(r.kredit) > 0))
      .map((r) => ({ basis: r.basis === 'LRA' ? 'LRA' : 'LO', akun_kode: r.akun_kode, debit: money(r.debit), kredit: money(r.kredit), keterangan: r.keterangan || null }));
    if (baris.some((r) => r.debit > 0 && r.kredit > 0)) throw bad('Satu baris hanya boleh berisi debit atau kredit');
    if (baris.length < 2) throw bad('Jurnal minimal terdiri atas dua baris (debit dan kredit)');
    return tx(async (c) => {
      await pastikanAkun(c);
      if (b.sumber_bku_id) {
        const { rows: [e] } = await c.query('SELECT id, skpd_id FROM bku_entries WHERE id = $1', [int(b.sumber_bku_id)]);
        if (!e || e.skpd_id !== skpd) throw bad('Transaksi sumber tidak ditemukan pada SKPD ini');
        const { rows: ada } = await c.query('SELECT nomor FROM jurnal WHERE sumber_bku_id = $1 AND NOT dibalik', [e.id]);
        if (ada.length) throw bad(`Transaksi ini sudah dijurnal (${ada.map((x) => x.nomor).join(', ')})`);
      }
      const j = await simpanJurnal(c, { skpd, tahun: Number(b.tanggal.slice(0, 4)), tanggal: b.tanggal, jenis: b.jenis || 'umum', uraian: b.uraian, sumber: b.sumber_bku_id ? int(b.sumber_bku_id) : null, aturan: 'MANUAL', dasar: b.dasar || null, user: req.user, baris });
      await audit(c, req.user, 'jurnal_manual', 'jurnal', j.id, { nomor: j.nomor, jenis: j.jenis, sumber: b.sumber_bku_id || null }, req.ip);
      return { row: j };
    });
  });

  app.post('/api/akuntansi/jurnal/:id/balik', { preHandler: requireRole(...AKUNTAN) }, async (req) => {
    const alasan = String(req.body?.alasan || '').trim();
    if (!alasan) throw bad('Alasan jurnal balik wajib diisi');
    return tx(async (c) => {
      const { rows: [j] } = await c.query('SELECT * FROM jurnal WHERE id = $1 FOR UPDATE', [int(req.params.id)]);
      if (!j) throw notFound();
      scopeSkpd(req.user, j.skpd_id);
      if (j.dibalik) throw bad('Jurnal ini sudah dibalik');
      if (j.jenis === 'balik') throw bad('Jurnal balik tidak dapat dibalik lagi; buat jurnal baru');
      const tanggal = isDate(req.body?.tanggal) ? req.body.tanggal : j.tanggal;
      const { rows: rinci } = await c.query('SELECT basis, akun_kode, debit, kredit FROM jurnal_rinci WHERE jurnal_id = $1 ORDER BY urut', [j.id]);
      await c.query('UPDATE jurnal SET dibalik = true WHERE id = $1', [j.id]);
      const b = await simpanJurnal(c, { skpd: j.skpd_id, tahun: j.tahun, tanggal, jenis: 'balik', uraian: `Jurnal balik ${j.nomor}: ${alasan}`, sumber: null, aturan: 'BALIK', balikDari: j.id, user: req.user, baris: balikBaris(rinci) });
      await audit(c, req.user, 'jurnal_balik', 'jurnal', j.id, { nomor: j.nomor, balik: b.nomor, alasan }, req.ip);
      return { row: b };
    });
  });

  // Laporan jurnal per periode
  app.get('/api/akuntansi/jurnal', { preHandler: requireAuth }, async (req, reply) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { tahun, dari, sampai } = periode(req.query);
    const p = [skpd, tahun, dari, sampai]; const where = ['j.skpd_id = $1', 'j.tahun = $2', 'j.tanggal BETWEEN $3 AND $4'];
    if (req.query.jenis) { p.push(req.query.jenis); where.push(`j.jenis = $${p.length}`); }
    if (req.query.akun) { p.push(`${req.query.akun}%`); where.push(`EXISTS (SELECT 1 FROM jurnal_rinci x WHERE x.jurnal_id = j.id AND x.akun_kode LIKE $${p.length})`); }
    if (req.query.q) { p.push(`%${req.query.q}%`); where.push(`(j.uraian ILIKE $${p.length} OR j.nomor ILIKE $${p.length})`); }
    const xlsx = req.query.format === 'xlsx';
    const pageSize = Math.min(int(req.query.pageSize, 25), 200);
    const page = Math.max(int(req.query.page, 1), 1);
    const { rows } = await query(`SELECT j.*, u.full_name AS dibuat_oleh_nama, COUNT(*) OVER () AS total_rows,
        (SELECT json_agg(json_build_object('basis', r.basis, 'akun_kode', r.akun_kode, 'akun_nama', a.nama, 'debit', r.debit, 'kredit', r.kredit) ORDER BY r.urut)
           FROM jurnal_rinci r JOIN akun a ON a.kode = r.akun_kode WHERE r.jurnal_id = j.id) AS rinci
      FROM jurnal j LEFT JOIN users u ON u.id = j.dibuat_oleh WHERE ${where.join(' AND ')}
      ORDER BY j.tanggal, j.id ${xlsx ? '' : `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`}`, p);
    const { rows: [tot] } = await query(`SELECT COALESCE(SUM(r.debit) FILTER (WHERE r.basis = 'LO'),0)::float AS debit_lo, COALESCE(SUM(r.kredit) FILTER (WHERE r.basis = 'LO'),0)::float AS kredit_lo,
        COALESCE(SUM(r.debit) FILTER (WHERE r.basis = 'LRA'),0)::float AS debit_lra, COALESCE(SUM(r.kredit) FILTER (WHERE r.basis = 'LRA'),0)::float AS kredit_lra
      FROM jurnal_rinci r JOIN jurnal j ON j.id = r.jurnal_id WHERE ${where.join(' AND ')}`, p);
    if (!xlsx) return { rows: rows.map(({ total_rows: _, ...r }) => r), total: rows[0]?.total_rows ?? 0, page, pageSize, total_nilai: tot };
    const { rows: [s] } = await query('SELECT nama, kode FROM skpd WHERE id = $1', [skpd]);
    const flat = rows.flatMap((j) => (j.rinci || []).map((r, i) => ({ nomor: i ? '' : j.nomor, tanggal: i ? '' : j.tanggal, uraian: i ? '' : j.uraian, basis: r.basis, akun: r.akun_kode, nama: r.akun_nama, debit: Number(r.debit) || '', kredit: Number(r.kredit) || '' })));
    const buf = await buildWorkbook({
      title: `JURNAL - ${s.nama.toUpperCase()}`, subtitle: `Periode ${dari} s.d. ${sampai} · LO debit/kredit ${Math.round(tot.debit_lo).toLocaleString('id-ID')} · LRA ${Math.round(tot.debit_lra).toLocaleString('id-ID')}`,
      sheetName: 'Jurnal',
      columns: [{ key: 'nomor', header: 'No. jurnal', width: 18 }, { key: 'tanggal', header: 'Tanggal', width: 12 }, { key: 'uraian', header: 'Uraian', width: 50 }, { key: 'basis', header: 'Basis', width: 7 },
        { key: 'akun', header: 'Kode akun', width: 20 }, { key: 'nama', header: 'Nama akun', width: 45 }, { key: 'debit', header: 'Debit', type: 'money' }, { key: 'kredit', header: 'Kredit', type: 'money' }],
      rows: flat, totals: { debit: tot.debit_lo + tot.debit_lra, kredit: tot.kredit_lo + tot.kredit_lra },
    });
    return sendFile(reply, buf, `Jurnal_${s.kode}_${dari}_${sampai}.xlsx`, XLSX);
  });

  app.get('/api/akuntansi/buku-besar', { preHandler: requireAuth }, async (req) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { tahun, dari, sampai } = periode(req.query);
    if (!req.query.akun) {
      const { rows } = await query(`SELECT a.kode, a.nama, a.basis, a.saldo_normal, COUNT(r.id)::int AS mutasi, COALESCE(SUM(r.debit - r.kredit),0)::float AS bersih
        FROM akun a JOIN jurnal_rinci r ON r.akun_kode = a.kode JOIN jurnal j ON j.id = r.jurnal_id
        WHERE j.skpd_id = $1 AND j.tahun = $2 AND j.tanggal <= $3 GROUP BY a.kode ORDER BY a.kode`, [skpd, tahun, sampai]);
      return { akun: rows };
    }
    const { rows: [a] } = await query('SELECT * FROM akun WHERE kode = $1', [req.query.akun]);
    if (!a) throw notFound('Akun tidak ditemukan');
    const { rows: [aw] } = await query(`SELECT COALESCE(SUM(r.debit),0)::float AS d, COALESCE(SUM(r.kredit),0)::float AS k FROM jurnal_rinci r JOIN jurnal j ON j.id = r.jurnal_id
      WHERE j.skpd_id = $1 AND j.tahun = $2 AND j.tanggal < $3 AND r.akun_kode = $4`, [skpd, tahun, dari, a.kode]);
    const { rows } = await query(`SELECT j.id AS jurnal_id, j.nomor, j.tanggal, j.uraian, j.jenis, j.sumber_bku_id, r.debit::float, r.kredit::float, r.basis
      FROM jurnal_rinci r JOIN jurnal j ON j.id = r.jurnal_id WHERE j.skpd_id = $1 AND j.tahun = $2 AND j.tanggal BETWEEN $3 AND $4 AND r.akun_kode = $5
      ORDER BY j.tanggal, j.id, r.urut LIMIT 5000`, [skpd, tahun, dari, sampai, a.kode]);
    const tanda = a.saldo_normal === 'D' ? 1 : -1;
    let saldo = tanda * (aw.d - aw.k);
    const out = rows.map((r) => { saldo += tanda * (r.debit - r.kredit); return { ...r, saldo: Math.round(saldo * 100) / 100 }; });
    return { akun: a, saldo_awal: tanda * (aw.d - aw.k), rows: out, total: { debit: out.reduce((s, r) => s + r.debit, 0), kredit: out.reduce((s, r) => s + r.kredit, 0) }, saldo_akhir: saldo };
  });

  app.get('/api/akuntansi/neraca-saldo', { preHandler: requireAuth }, async (req, reply) => {
    const skpd = scopeSkpd(req.user, req.query.skpd_id);
    const { tahun, dari, sampai } = periode(req.query);
    const basis = ['LO', 'LRA'].includes(req.query.basis) ? req.query.basis : null;
    const ns = await neracaSaldo(skpd, tahun, dari, sampai, basis);
    if (req.query.format !== 'xlsx') return { ...ns, tahun, dari, sampai, basis };
    const { rows: [s] } = await query('SELECT nama, kode FROM skpd WHERE id = $1', [skpd]);
    const buf = await buildWorkbook({
      title: `NERACA SALDO${basis ? ` (${basis === 'LO' ? 'FINANSIAL/AKRUAL' : 'ANGGARAN/LRA'})` : ''} - ${s.nama.toUpperCase()}`, subtitle: `Per ${sampai} · ${ns.seimbang ? 'seimbang' : 'TIDAK SEIMBANG'}`,
      sheetName: 'Neraca Saldo',
      columns: [{ key: 'kode', header: 'Kode akun', width: 20 }, { key: 'nama', header: 'Nama akun', width: 50 }, { key: 'basis', header: 'Basis', width: 7 },
        { key: 'debit', header: 'Mutasi debit', type: 'money' }, { key: 'kredit', header: 'Mutasi kredit', type: 'money' }, { key: 'saldo_debit', header: 'Saldo debit', type: 'money' }, { key: 'saldo_kredit', header: 'Saldo kredit', type: 'money' }],
      rows: ns.rows.map((r) => ({ ...r, debit: r.debit + r.debit_awal, kredit: r.kredit + r.kredit_awal })), totals: ns.total,
    });
    return sendFile(reply, buf, `Neraca_Saldo_${s.kode}_${sampai}.xlsx`, XLSX);
  });
}
