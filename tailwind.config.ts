import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        clipper: {
          primary: "#1d4ed8",   // blue-700 — primary brand
          secondary: "#3b82f6", // blue-500 — secondary
          dark: "#0f172a",      // slate-900 — backgrounds
          accent: "#60a5fa",    // blue-400 — highlights
          muted: "#94a3b8",     // slate-400 — muted text
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
