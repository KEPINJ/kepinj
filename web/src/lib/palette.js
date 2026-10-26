// Palet kategorikal tervalidasi (lightness, chroma, CVD) untuk mode terang & gelap; nilainya di src/theme.css.
// Urutan tetap, jangan diputar.
export const SERIES = [1, 2, 3, 4, 5].map((i) => `rgb(var(--series-${i}))`);
export const PAJAK_COLOR = { PPH21: SERIES[0], PPH22: SERIES[1], PPH23: SERIES[2], PPH4A2: SERIES[3], PPN: SERIES[4] };
