import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class', // 🚀 THE UNLOCK: Tells Tailwind to look for the "dark" class on the <html> tag
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;