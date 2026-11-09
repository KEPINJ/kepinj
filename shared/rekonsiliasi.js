// Mesin rekonsiliasi bank otomatis/semiotomatis: mencocokkan mutasi rekening koran dengan BKU kas bank.
// Fungsi murni (tanpa basis data) agar dapat diuji dan dijelaskan langkah demi langkah di laporan.
//
// Kategori hasil setiap baris:
//   cocok          nilai sama, arah sama, tanggal dalam toleransi
//   selisih        pasangan paling mungkin tetapi nilainya berbeda (dalam batas persentase toleransi)
//   periksa        perlu diperiksa manual: kandidat lebih dari satu yang sama kuat, atau gabungan beberapa transaksi
//   belum_bku      ada di rekening koran tetapi belum tercatat di BKU (mis. biaya administrasi, bunga)
//   belum_bank     ada di BKU tetapi belum muncul di rekening koran (cek beredar / setoran dalam perjalanan)
//   duplikat       baris mutasi kembar (tanggal, nilai, keterangan sama) yang kemungkinan terunggah dua kali

const HARI = 86400000;
export const selisihHari = (a, b) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / HARI);
const normKet = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const sama = (a, b) => Math.abs(a - b) < 0.005;
const bulat = (n) => Math.round(n * 100) / 100;

/** Tebak pemetaan kolom rekening koran dari judul kolom. */
export function tebakKolom(cols) {
  const cari = (...k) => cols.find((c) => k.some((x) => c.toLowerCase().replace(/[^a-z]/g, '').includes(x))) || '';
  const m = {
    tanggal: cari('tanggal', 'tgl', 'date', 'posting'),
    keterangan: cari('keterangan', 'uraian', 'deskripsi', 'description', 'remark', 'berita'),
    debet: cari('debet', 'debit', 'keluar', 'withdrawal', 'mutasidb'),
    kredit: cari('kredit', 'credit', 'masuk', 'deposit', 'mutasicr'),
    saldo: cari('saldo', 'balance'),
    nilai: '',
  };
  if (!m.debet && !m.kredit) m.nilai = cari('nilai', 'jumlah', 'amount', 'nominal', 'mutasi');
  return m;
}

/** Kandidat BKU untuk satu mutasi, dengan nilai yang dibandingkan (BKU keluar dibandingkan bruto dan netto setelah pajak). */
function nilaiBku(e, masuk) { return masuk ? [e.masuk] : [e.keluar, e.netto].filter((v, i, a) => v > 0 && a.indexOf(v) === i); }

/** Saran untuk mutasi yang belum berpasangan: catat sebagai biaya bank / bunga. */
export function saranCatat(mt) {
  const ket = normKet(mt.keterangan);
  const masuk = mt.masuk > 0;
  if (masuk && /BUNGA|JASA GIRO|JS GIRO|INTEREST/.test(ket)) return { jenis: 'PENERIMAAN', arah: 'penerimaan', uraian: `Penerimaan bunga/jasa giro rekening bendahara (${mt.keterangan})`, alasan: 'Bunga/jasa giro belum dicatat di BKU' };
  if (!masuk && /ADM|BIAYA|CHARGE|FEE|PAJAK BUNGA|PROVISI/.test(ket)) return { jenis: 'LAINNYA', arah: 'pengeluaran', uraian: `Biaya administrasi bank (${mt.keterangan})`, alasan: 'Biaya bank belum dicatat di BKU' };
  return null;
}

/**
 * Jalankan pencocokan.
 * @param mutasi [{ baris, tanggal, keterangan, masuk, keluar, saldo? }]
 * @param bku    [{ id, no_urut, tanggal, no_bukti, jenis, uraian, masuk, keluar, netto }]
 * @param opsi   { toleransi_hari, toleransi_persen, dari, sampai }
 */
export function rekonsiliasi(mutasi, bku, opsi = {}) {
  const tol = Number.isFinite(Number(opsi.toleransi_hari)) ? Number(opsi.toleransi_hari) : 3;
  const tolPersen = Number.isFinite(Number(opsi.toleransi_persen)) ? Number(opsi.toleransi_persen) : 5;
  const dari = opsi.dari || mutasi.map((m) => m.tanggal).sort()[0];
  const sampai = opsi.sampai || mutasi.map((m) => m.tanggal).sort().at(-1);
  const items = [];
  const pakai = new Set();
  const urut = [...mutasi].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.baris - b.baris);

  // 1. Duplikat dalam rekening koran
  const kunciDup = new Map();
  const sisa = [];
  for (const m of urut) {
    const k = `${m.tanggal}|${m.masuk}|${m.keluar}|${normKet(m.keterangan)}`;
    if (kunciDup.has(k)) items.push({ kategori: 'duplikat', mutasi: m, bku: [], alasan: `Kembar dengan baris ${kunciDup.get(k)} (tanggal, nilai dan keterangan sama)` });
    else { kunciDup.set(k, m.baris); sisa.push(m); }
  }

  // 2. Cocok persis (nilai & arah sama, tanggal dalam toleransi); rujukan no. bukti di keterangan menambah keyakinan
  const belum = [];
  for (const m of sisa) {
    const masuk = m.masuk > 0; const nilai = masuk ? m.masuk : m.keluar;
    const ket = normKet(m.keterangan);
    const calon = [];
    for (const e of bku) {
      if (pakai.has(e.id)) continue;
      if (!nilaiBku(e, masuk).some((v) => sama(v, nilai))) continue;
      const d = selisihHari(e.tanggal, m.tanggal);
      if (d > tol) continue;
      const ref = e.no_bukti && e.no_bukti !== '-' && ket.includes(normKet(e.no_bukti));
      calon.push({ e, d, skor: d - (ref ? 10 : 0), ref });
    }
    if (!calon.length) { belum.push(m); continue; }
    calon.sort((a, b) => a.skor - b.skor || a.e.no_urut - b.e.no_urut);
    const terbaik = calon[0];
    const setara = calon.filter((c) => c.skor === terbaik.skor && c.e.tanggal !== terbaik.e.tanggal);
    if (setara.length && !terbaik.ref) {
      items.push({ kategori: 'periksa', mutasi: m, bku: [], kandidat: [terbaik, ...setara].map((c) => c.e),
        alasan: `${setara.length + 1} transaksi BKU bernilai sama dan berjarak sama dari tanggal mutasi` });
      continue;
    }
    pakai.add(terbaik.e.id);
    items.push({ kategori: 'cocok', mutasi: m, bku: [terbaik.e], selisih_hari: terbaik.d,
      alasan: terbaik.ref ? 'Nilai sama dan nomor bukti tercantum di keterangan bank' : terbaik.d ? `Nilai sama, tanggal berbeda ${terbaik.d} hari` : 'Nilai dan tanggal sama' });
  }

  // 3. Selisih nilai: pasangan terdekat dengan beda nilai dalam toleransi persentase
  const belum2 = [];
  for (const m of belum) {
    const masuk = m.masuk > 0; const nilai = masuk ? m.masuk : m.keluar;
    let best = null;
    for (const e of bku) {
      if (pakai.has(e.id)) continue;
      const d = selisihHari(e.tanggal, m.tanggal);
      if (d > tol) continue;
      for (const v of nilaiBku(e, masuk)) {
        const beda = Math.abs(v - nilai);
        const persen = (beda / nilai) * 100;
        if (beda < 0.005 || persen > tolPersen) continue;
        const skor = persen + d * 0.5;
        if (!best || skor < best.skor) best = { e, d, v, beda, persen, skor };
      }
    }
    if (best) {
      pakai.add(best.e.id);
      items.push({ kategori: 'selisih', mutasi: m, bku: [best.e], selisih_hari: best.d, selisih: bulat(nilai - best.v),
        alasan: `Selisih ${best.persen.toLocaleString('id-ID', { maximumFractionDigits: 2 })}% (bank ${nilai.toLocaleString('id-ID')} vs BKU ${best.v.toLocaleString('id-ID')})` });
    } else belum2.push(m);
  }

  // 4. Gabungan dua transaksi BKU = satu mutasi (mis. dua pembayaran ditransfer sekaligus): perlu konfirmasi manual
  const belum3 = [];
  for (const m of belum2) {
    const masuk = m.masuk > 0; const nilai = masuk ? m.masuk : m.keluar;
    const dekat = bku.filter((e) => !pakai.has(e.id) && (masuk ? e.masuk > 0 : e.keluar > 0) && selisihHari(e.tanggal, m.tanggal) <= tol).slice(0, 80);
    let pasangan = null;
    for (let i = 0; i < dekat.length && !pasangan; i++) {
      for (let j = i + 1; j < dekat.length; j++) {
        const a = masuk ? dekat[i].masuk : dekat[i].netto; const b = masuk ? dekat[j].masuk : dekat[j].netto;
        if (sama(a + b, nilai)) { pasangan = [dekat[i], dekat[j]]; break; }
      }
    }
    if (pasangan) {
      pasangan.forEach((e) => pakai.add(e.id));
      items.push({ kategori: 'periksa', mutasi: m, bku: pasangan, gabungan: true, alasan: 'Nilai mutasi sama dengan gabungan dua transaksi BKU' });
    } else belum3.push(m);
  }

  // 5. Mutasi tersisa: belum tercatat di BKU (dengan saran pencatatan bila dikenali)
  for (const m of belum3) {
    const kandidat = bku.filter((e) => !pakai.has(e.id) && nilaiBku(e, m.masuk > 0).some((v) => sama(v, m.masuk || m.keluar)) && selisihHari(e.tanggal, m.tanggal) <= 31);
    items.push({ kategori: 'belum_bku', mutasi: m, bku: [], saran: saranCatat(m), kandidat: kandidat.slice(0, 3),
      alasan: kandidat.length ? `Belum tercatat di BKU dalam toleransi; ada ${kandidat.length} transaksi bernilai sama di luar toleransi tanggal` : 'Tidak ditemukan transaksi BKU yang sesuai' });
  }

  // 6. BKU periode ini yang tidak muncul di rekening koran
  for (const e of bku) {
    if (pakai.has(e.id) || e.tanggal < dari || e.tanggal > sampai) continue;
    items.push({ kategori: 'belum_bank', mutasi: null, bku: [e], alasan: e.keluar > 0 ? 'Pengeluaran BKU belum didebet bank (cek/transfer beredar)' : 'Penerimaan BKU belum dikredit bank (dalam perjalanan)' });
  }

  // Duplikat di sisi BKU: dua entri bank bernilai, tanggal dan uraian sama
  const lihat = new Map(); const duplikatBku = [];
  for (const e of bku) {
    const k = `${e.tanggal}|${e.masuk}|${e.keluar}|${normKet(e.uraian)}`;
    if (lihat.has(k)) duplikatBku.push({ a: lihat.get(k), b: e }); else lihat.set(k, e);
  }

  return { periode: { dari, sampai, toleransi_hari: tol, toleransi_persen: tolPersen }, items, duplikat_bku: duplikatBku, ringkasan: ringkas(items, mutasi, bku, dari, sampai, duplikatBku.length) };
}

/** Indikator rekonsiliasi; dipanggil ulang setelah bendahara mengonfirmasi atau memasangkan manual. */
export function ringkas(items, mutasi, bku, dari, sampai, duplikatBku = 0) {
  const n = (k) => items.filter((i) => i.kategori === k).length;
  const jumlah = (k, f) => bulat(items.filter((i) => i.kategori === k).reduce((s, i) => s + f(i), 0));
  const nilaiMt = (i) => (i.mutasi ? (i.mutasi.masuk || -i.mutasi.keluar) : 0);
  const nilaiBkuItem = (i) => i.bku.reduce((s, e) => s + (e.masuk || -(e.netto ?? e.keluar)), 0);
  const dinilai = mutasi.length - n('duplikat');
  const dalam = bku.filter((e) => e.tanggal >= dari && e.tanggal <= sampai);
  return {
    mutasi: mutasi.length, cocok: n('cocok'), selisih: n('selisih'), periksa: n('periksa'), belum_bku: n('belum_bku'), belum_bank: n('belum_bank'), duplikat: n('duplikat'),
    duplikat_bku: duplikatBku,
    belum_cocok: n('selisih') + n('periksa') + n('belum_bku') + n('belum_bank'),
    persen_cocok: dinilai ? Math.round((n('cocok') / dinilai) * 1000) / 10 : 0,
    total_selisih: jumlah('selisih', (i) => Math.abs(i.selisih || 0)),
    selisih_bersih: jumlah('selisih', (i) => (i.mutasi.masuk > 0 ? 1 : -1) * (i.selisih || 0)),
    bank_masuk: bulat(mutasi.reduce((s, m) => s + m.masuk, 0)), bank_keluar: bulat(mutasi.reduce((s, m) => s + m.keluar, 0)),
    bku_masuk: bulat(dalam.reduce((s, e) => s + e.masuk, 0)), bku_keluar: bulat(dalam.reduce((s, e) => s + (e.netto ?? e.keluar), 0)),
    belum_bku_masuk: jumlah('belum_bku', (i) => Math.max(0, nilaiMt(i))), belum_bku_keluar: jumlah('belum_bku', (i) => Math.max(0, -nilaiMt(i))),
    belum_bank_masuk: jumlah('belum_bank', (i) => Math.max(0, nilaiBkuItem(i))), belum_bank_keluar: jumlah('belum_bank', (i) => Math.max(0, -nilaiBkuItem(i))),
  };
}

/**
 * Laporan rekonsiliasi (bentuk dua sisi):
 *   saldo BKU + penerimaan bank belum di BKU − pengeluaran bank belum di BKU ± selisih nilai
 *   = saldo bank − penerimaan BKU belum di bank + pengeluaran BKU belum di bank
 */
export function laporanSaldo(r, saldoBku, saldoBank) {
  const kiri = bulat(saldoBku + r.belum_bku_masuk - r.belum_bku_keluar + r.selisih_bersih);
  const kanan = bulat(saldoBank - r.belum_bank_masuk + r.belum_bank_keluar);
  return { saldo_bku: saldoBku, saldo_bank: saldoBank, saldo_bku_disesuaikan: kiri, saldo_bank_disesuaikan: kanan, tak_terjelaskan: bulat(kanan - kiri) };
}
