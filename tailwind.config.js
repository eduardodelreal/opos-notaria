/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Lienzo cálido, muy claro. Nada de grises azulados fríos.
        canvas: '#FBFAF7',
        surface: '#FFFFFF',
        ink: {
          900: '#1C1B18',
          700: '#3C3A34',
          500: '#6B6862',
          400: '#8E8A82',
          300: '#B5B1A8',
          200: '#DDD9D0',
          100: '#EFECE5',
        },
        // Acento principal: verde salvia profundo. Sobrio, adulto, jurídico.
        sage: {
          50: '#F1F5F2',
          100: '#DFE8E1',
          200: '#C0D3C5',
          300: '#98B7A0',
          400: '#6F9A7B',
          500: '#517C5E',
          600: '#3E6349',
          700: '#324F3B',
          800: '#293F30',
        },
        // Secundario: terracota apagada para alertas cálidas.
        clay: {
          50: '#FBF2EE',
          100: '#F6E2D9',
          200: '#EDC4B4',
          300: '#DFA189',
          400: '#CC7C60',
          500: '#B45F42',
          600: '#934A32',
        },
        gold: {
          50: '#FBF6E9',
          100: '#F5EACB',
          200: '#EBD79C',
          300: '#DCBD63',
          400: '#C6A03A',
          500: '#A6832B',
        },
        indigoish: {
          50: '#F0F2F8',
          100: '#DFE3F1',
          200: '#C0C8E2',
          300: '#98A4CE',
          400: '#7180B4',
          500: '#556296',
          600: '#434D77',
        },
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(28,27,24,0.04), 0 4px 16px -6px rgba(28,27,24,0.08)',
        lift: '0 2px 4px rgba(28,27,24,0.04), 0 14px 34px -12px rgba(28,27,24,0.16)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.7)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'bombo-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(1440deg)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.4)', opacity: '0' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms ease-out both',
        'slide-up': 'slide-up 280ms cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.16,1,0.3,1) both',
        'bombo-spin': 'bombo-spin 2.4s cubic-bezier(0.3,0,0.2,1) both',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.2,0.6,0.3,1) infinite',
      },
    },
  },
  plugins: [],
}
