import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0b0d0e',
        surface: '#141618',
        'surface-2': '#1e2124',
        'surface-3': '#272b2f',
        border: '#2a2e33',
        accent: '#2dd4bf',
        'accent-hover': '#14b8a6',
        'text-primary': '#e8eaec',
        'text-sub': '#8b949e',
        danger: '#f87171',
        'danger-hover': '#ef4444',
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          '"SF Mono"',
          'Menlo',
          '"Cascadia Code"',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
