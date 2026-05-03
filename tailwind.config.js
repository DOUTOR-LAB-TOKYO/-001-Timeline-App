/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#181818',
          1: '#1e1e1e',
          2: '#242424',
          3: '#2d2d2d',
          4: '#363636',
        },
        'border-subtle': '#2a2a2a',
        'border-default': '#3d3d3d',
        accent: '#4ade80',
        danger: '#ef4444',
      },
      fontSize: {
        '2xs': '10px',
        xs: '11px',
        sm: '12px',
      },
    },
  },
  plugins: [],
};
