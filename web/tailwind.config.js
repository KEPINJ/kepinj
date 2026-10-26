/** @type {import('tailwindcss').Config} */
// Warna dibaca dari CSS variable (src/theme.css) sehingga mode terang/gelap cukup mengganti nilai variabel.
const v = (name, shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) =>
  Object.fromEntries(shades.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
const tone = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'] },
      colors: {
        slate: v('slate'),
        brand: v('brand'),
        emerald: v('emerald', tone),
        rose: v('rose', tone),
        amber: v('amber', tone),
        violet: v('violet', tone),
        gold: { 300: '#f7d77f', 400: '#f2c14e', 500: '#e0a82e' },
        surface: 'rgb(var(--surface) / <alpha-value>)',
        page: 'rgb(var(--page) / <alpha-value>)',
        primary: { DEFAULT: 'rgb(var(--primary) / <alpha-value>)', hover: 'rgb(var(--primary-hover) / <alpha-value>)' },
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 40 70 / .04), 0 2px 8px -2px rgb(15 40 70 / .06)',
        lift: '0 10px 30px -10px rgb(15 40 70 / .25)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: { 'fade-in': 'fade-in .25s ease-out both' },
    },
  },
  plugins: [],
};
