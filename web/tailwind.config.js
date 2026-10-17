/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef6fb', 100: '#d5e8f3', 200: '#a9cfe6', 300: '#73b0d4', 400: '#3f8dbd', 500: '#1f6fa1', 600: '#155886', 700: '#11476d', 800: '#0f3d5e', 900: '#0b2c44', 950: '#071c2c' },
        gold: { 400: '#f2c14e', 500: '#e0a82e' },
      },
      boxShadow: { card: '0 1px 2px rgba(15,61,94,.06), 0 1px 3px rgba(15,61,94,.08)' },
    },
  },
  plugins: [],
};
