/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/*.html', './src/app.js', './demo/**/*.{html,js}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raise: 'rgb(var(--c-raise) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--c-brand) / <alpha-value>)',
          strong: 'rgb(var(--c-brand-strong) / <alpha-value>)',
          soft: 'rgb(var(--c-brand-soft) / <alpha-value>)',
          line: 'rgb(var(--c-brand-line) / <alpha-value>)'
        },
        ok: {
          DEFAULT: 'rgb(var(--c-ok) / <alpha-value>)',
          soft: 'rgb(var(--c-ok-soft) / <alpha-value>)'
        },
        bad: {
          DEFAULT: 'rgb(var(--c-bad) / <alpha-value>)',
          soft: 'rgb(var(--c-bad-soft) / <alpha-value>)'
        },
        warn: {
          DEFAULT: 'rgb(var(--c-warn) / <alpha-value>)',
          soft: 'rgb(var(--c-warn-soft) / <alpha-value>)'
        },
        info: {
          DEFAULT: 'rgb(var(--c-info) / <alpha-value>)',
          soft: 'rgb(var(--c-info-soft) / <alpha-value>)'
        },
        'on-brand': 'rgb(var(--c-on-brand) / <alpha-value>)',
        'on-ok': 'rgb(var(--c-on-ok) / <alpha-value>)',
        'on-bad': 'rgb(var(--c-on-bad) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC',
          'Microsoft YaHei', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        soft: '0 .6rem 1.6rem -1.3rem rgba(9, 16, 12, .32)',
        lift: '0 1rem 2.4rem -1.2rem rgba(9, 16, 12, .42)'
      },
      keyframes: {
        'view-in': {
          from: { opacity: '.6', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'none' }
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' }
        }
      },
      animation: {
        'view-in': 'view-in .1s cubic-bezier(.2,.8,.2,1) both',
        rise: 'rise .3s ease-out both'
      }
    }
  },
  plugins: []
};
