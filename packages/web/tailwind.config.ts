import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        surface: "#111519",
        graphite: "#22282C",
        steel: "#5F6B72",
        gold: "#D08D2E",
        goldsoft: "#E4B36A",
        sand: "#DCC6AC",
        canvas: "#FAF7F2",
        parchment: "#F3EDE2",
        line: "rgba(220, 198, 172, 0.72)",
        "line-muted": "rgba(95, 107, 114, 0.24)",
      },
      fontFamily: {
        brand: [
          "var(--font-brand)",
          "Oxanium",
          "Space Grotesk",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "var(--font-brand)",
          "Oxanium",
          "Space Grotesk",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          "var(--font-display)",
          "Space Grotesk",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "IBM Plex Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      letterSpacing: {
        brand: "0.42em",
        wide2: "0.24em",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        dash: {
          "0%": { strokeDashoffset: "220" },
          "100%": { strokeDashoffset: "0" },
        },
        pulseNode: {
          "0%,100%": { opacity: "0.35", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.35)" },
        },
        floatSlow: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        fadeUp: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) both",
        fadeIn: "fadeIn 0.9s ease both",
        dash: "dash 2.4s ease forwards",
        pulseNode: "pulseNode 3.2s ease-in-out infinite",
        floatSlow: "floatSlow 7s ease-in-out infinite",
      },
      maxWidth: {
        shell: "88rem",
      },
      borderRadius: {
        edge: "2px",
        module: "3px",
      },
      transitionDuration: {
        DEFAULT: "180ms",
      },
    },
  },
  plugins: [],
};

export default config;
