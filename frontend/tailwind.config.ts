import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: 'rgb(var(--base) / <alpha-value>)',
          elevated: 'rgb(var(--base-elevated) / <alpha-value>)',
          soft: 'rgb(var(--base-soft) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          hover: 'rgb(var(--surface-hover) / <alpha-value>)',
          active: 'rgb(var(--surface-active) / <alpha-value>)',
          border: 'rgb(var(--surface-border) / <alpha-value>)',
          input: 'rgb(var(--surface-input) / <alpha-value>)',
          elevated: 'rgb(var(--surface-elevated) / <alpha-value>)',
        },
        overlay: 'rgb(var(--overlay) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent) / 0.12)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          border: 'rgb(var(--accent) / 0.25)',
        },
        warn: {
          DEFAULT: 'rgb(var(--warn) / <alpha-value>)',
          soft: 'rgb(var(--warn) / 0.12)',
        },
        crit: {
          DEFAULT: 'rgb(var(--crit) / <alpha-value>)',
          soft: 'rgb(var(--crit) / 0.12)',
        },
        info: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)',
          soft: 'rgb(var(--info) / 0.12)',
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          soft: 'rgb(var(--success) / 0.12)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '18px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.25)',
        'card-hover': '0 2px 4px rgba(0,0,0,0.4), 0 16px 40px rgba(0,0,0,0.45), 0 0 0 1px rgb(var(--accent) / 0.08)',
        glow: '0 0 24px rgb(var(--accent) / 0.18)',
        'glow-warn': '0 0 24px rgba(245,158,11,0.15)',
        'glow-crit': '0 0 24px rgba(239,68,68,0.15)',
      },
      keyframes: {
        'pulse-line': {
          '0%': { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'pulse-line': 'pulse-line 1.4s linear infinite',
        shimmer: 'shimmer 2s linear infinite',
        float: 'float 6s ease-in-out infinite',
        'fade-in': 'fade-in 0.5s ease-out both',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
