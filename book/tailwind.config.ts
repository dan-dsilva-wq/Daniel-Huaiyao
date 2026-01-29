import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Pastel palette for the book
        pastel: {
          pink: "#FFE4E6",
          rose: "#FECDD3",
          peach: "#FED7AA",
          cream: "#FEF3C7",
          mint: "#D1FAE5",
          sky: "#E0F2FE",
          lavender: "#EDE9FE",
          blush: "#FDF2F8",
        },
        // Writer colors
        daniel: {
          light: "#DBEAFE",
          DEFAULT: "#3B82F6",
          dark: "#1E40AF",
        },
        huaiyao: {
          light: "#FFE4E8",
          DEFAULT: "#E11D48",
          dark: "#9F1239",
        },
        book: {
          cover: "#8B7355",
          spine: "#6B5344",
          page: "#FFFEF7",
          shadow: "#D4C5B5",
        },
      },
      fontFamily: {
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
        handwriting: ["Caveat", "cursive"],
      },
      boxShadow: {
        book: "0 10px 40px rgba(0, 0, 0, 0.2), 0 0 20px rgba(0, 0, 0, 0.1)",
        page: "inset 0 0 30px rgba(0, 0, 0, 0.05)",
      },
      animation: {
        "page-flip": "pageFlip 0.6s ease-in-out",
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        pageFlip: {
          "0%": { transform: "rotateY(0deg)" },
          "100%": { transform: "rotateY(-180deg)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
