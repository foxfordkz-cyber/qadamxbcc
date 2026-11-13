import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { bcc: "#00A859" } } },
  plugins: [],
} satisfies Config;
