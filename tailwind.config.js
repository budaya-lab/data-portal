/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Budaya Lab palette: paper, soga brown, and indigo. Colours carry the
      // `<alpha-value>` placeholder so opacity modifiers remain available.
      colors: {
        cream: 'rgb(250 250 248 / <alpha-value>)',
        'cream-panel': 'rgb(255 255 255 / <alpha-value>)',
        'cream-code': 'rgb(255 255 255 / <alpha-value>)',
        ink: 'rgb(29 26 22 / <alpha-value>)',
        accent: 'rgb(138 75 34 / <alpha-value>)',
        'accent-soft': 'rgb(241 227 212 / <alpha-value>)',
        indigo: 'rgb(45 63 99 / <alpha-value>)',
        'indigo-soft': 'rgb(227 232 242 / <alpha-value>)',
      },
      // Budaya Lab's source-serif and sans-serif families are loaded in
      // pages/_document.tsx. The portal uses the system monospace stack for code.
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
