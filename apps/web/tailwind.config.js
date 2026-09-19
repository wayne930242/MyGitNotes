// Plain classes resolve to the token itself; an opacity modifier (bg-fg/5) mixes it with transparent.
const token = name => ({ opacityValue }) => opacityValue === undefined ? `var(--color-${name})` : `color-mix(in srgb, var(--color-${name}) calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    // Every colour class resolves to a theme token; the default Tailwind palette is not available.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      canvas: token('bg'),
      surface: token('surface'),
      sidebar: token('sidebar'),
      line: token('border'),
      fg: token('text'),
      muted: token('muted'),
      primary: { DEFAULT: token('primary'), hover: token('primary-hover'), soft: token('primary-soft') },
      'on-primary': { DEFAULT: token('on-primary'), hover: token('on-primary-hover') },
      selection: token('selection'),
      code: token('code-bg'),
      danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
      'on-danger': token('on-danger'),
      warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
      'on-warning': token('on-warning'),
      success: { DEFAULT: token('success'), soft: token('success-soft') },
      'on-success': token('on-success'),
      info: { DEFAULT: token('info'), soft: token('info-soft') },
      'on-info': token('on-info'),
      scrim: token('scrim'),
      'on-scrim': token('on-scrim'),
      accent: Object.fromEntries([1, 2, 3, 4, 5, 6].map(index => [index, token(`accent-${index}`)])),
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-body)'],
        serif: ['var(--font-heading)'],
      },
      borderRadius: {
        sm: 'var(--radius-xs)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-control)',
        lg: 'var(--radius-control)',
        xl: 'var(--radius-panel)',
        '2xl': 'var(--radius-dialog)',
        '3xl': 'var(--radius-dialog)',
      },
    },
  },
  // Opacity utilities would route every plain colour class through color-mix(); modifiers cover them.
  corePlugins: { textOpacity: false, backgroundOpacity: false, borderOpacity: false, divideOpacity: false, placeholderOpacity: false, ringOpacity: false },
  plugins: [],
};
