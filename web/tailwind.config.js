/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // gpui / Zed-style dark palette
        bg: '#16161d',
        'bg-alt': '#1b1b23',
        surface: '#1b1b23',
        'surface-2': '#21212b',
        'surface-3': '#2a2a36',
        border: '#2a2a36',
        'border-strong': '#3a3a46',
        accent: '#74ade8',
        'accent-hover': '#8fbef0',
        'accent-light': 'rgba(116,173,232,.12)',
        unread: '#e0af68',
        'text-primary': '#d6d6dd',
        'text-sub': '#8f8fa3',
        'text-muted': '#5c5c70',
        danger: '#e0616b',
        'danger-hover': '#eb7681',
        'icon-rail': '#1b1b23',
        'icon-rail-hover': '#21212b',
        'icon-rail-active': '#2a2a36',
      },
      fontFamily: {
        sans: [
          '"Zed Plex Sans"',
          '"IBM Plex Sans"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"Zed Plex Mono"',
          '"IBM Plex Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        'card': '0 1px 2px rgba(0, 0, 0, 0.35)',
        'card-hover': '0 4px 12px rgba(0, 0, 0, 0.45)',
        'panel': '1px 0 0 #2a2a36',
      },
    },
  },
  plugins: [],
};

export default config;
