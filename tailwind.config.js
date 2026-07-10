/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        hand: ['"LXGW WenKai"', '"Kaiti SC"', '"STKaiti"', '"楷体"', 'cursive'],
        serif: ['"ZCOOL XiaoWei"', '"Songti SC"', '"SimSun"', 'serif'],
        art: ['"ZCOOL XiaoWei"', '"LXGW WenKai"', '"STKaiti"', 'serif'],
      },
      colors: {
        warm: {
          50: '#fdf8f0',
          100: '#f5ead4',
          200: '#e8cf9e',
          300: '#d4b878',
          400: '#b89a5a',
          500: '#9a7a3a',
          600: '#7a5f2e',
          700: '#5a4422',
          800: '#3a2f18',
          900: '#1c1408',
        },
        ocean: {
          50: '#e8f0f2',
          100: '#cfe0e8',
          200: '#9ec3d6',
          300: '#6fa9c4',
          400: '#5a8a9a',
          500: '#4a7a8a',
          600: '#3a6a7a',
          700: '#2a5a6a',
          800: '#1a4a5a',
          900: '#0a3a4a',
        },
        leaf: {
          50: '#eaf1e8',
          100: '#d4e6d0',
          200: '#a8cc9e',
          300: '#7ab36a',
          400: '#6a8a5e',
          500: '#5a7a4e',
          600: '#4a6a3e',
          700: '#3a5a2e',
          800: '#2a4a1e',
          900: '#1a3a0e',
        },
      },
      animation: {
        'breathe': 'breathe 4s ease-in-out infinite',
        'float': 'float 4s ease-in-out infinite',
        'shimmer': 'shimmer 2.6s linear infinite',
        'pulse-glow': 'pulse-glow 2.6s ease-in-out infinite',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(-1.5deg)' },
          '50%': { transform: 'translateY(-5px) rotate(1.5deg)' },
        },
        shimmer: {
          to: { backgroundPositionY: '9px' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 12px 1px #ffd98a66' },
          '50%': { boxShadow: '0 0 20px 4px #ffd98aaa' },
        },
      },
    },
  },
  plugins: [],
}