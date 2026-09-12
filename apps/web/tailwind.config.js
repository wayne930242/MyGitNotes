/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)'],
        serif: ['var(--font-heading)'],
      },
      colors: {
        primary: {
          50: 'var(--color-primary-light)',
          100: 'var(--color-primary-light)',
          200: 'var(--color-primary-light)',
          300: 'var(--color-primary)',
          400: 'var(--color-primary)',
          500: 'var(--color-primary)',
          600: 'var(--color-primary)',
          700: 'var(--color-primary-hover)',
          800: 'var(--color-primary-hover)',
          900: 'var(--color-primary-hover)',
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          light: 'var(--color-primary-light)',
        },
        indigo: {
          50: 'var(--color-primary-light)',
          100: 'var(--color-primary-light)',
          200: 'var(--color-primary-light)',
          300: 'var(--color-primary)',
          400: 'var(--color-primary)',
          500: 'var(--color-primary)',
          600: 'var(--color-primary)',
          700: 'var(--color-primary-hover)',
          800: 'var(--color-primary-hover)',
          900: 'var(--color-primary-hover)',
          950: 'var(--color-primary-light)',
        },
        palette: {
          bg: 'var(--color-bg)',
          surface: 'var(--color-surface)',
          sidebar: 'var(--color-sidebar)',
          border: 'var(--color-border)',
          text: 'var(--color-text)',
          muted: 'var(--color-muted)',
        },
        brand: {
          50: 'var(--color-primary-light)',
          100: 'var(--color-primary-light)',
          500: 'var(--color-primary)',
          600: 'var(--color-primary)',
          700: 'var(--color-primary-hover)',
        },
      },
    },
  },
  plugins: [],
};
