import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Inoreader-style light palette
        bg: '#ffffff',
        'bg-alt': '#f7f8fa',
        surface: '#f3f4f6',
        'surface-2': '#e5e7eb',
        'surface-3': '#d1d5db',
        border: '#e5e7eb',
        'border-strong': '#d1d5db',
        accent: '#2563eb',
        'accent-hover': '#1d4ed8',
        'accent-light': '#dbeafe',
        'text-primary': '#1f2937',
        'text-sub': '#6b7280',
        'text-muted': '#9ca3af',
        danger: '#ef4444',
        'danger-hover': '#dc2626',
        'icon-rail': '#1e2a4a',
        'icon-rail-hover': '#2a3a5c',
        'icon-rail-active': '#3b4f73',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.04)',
        'panel': '1px 0 3px rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [],
};

export default config;
