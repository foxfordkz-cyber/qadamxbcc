import type { MetadataRoute } from "next";

// Lets /mobile be added to the home screen and open full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return {
    name: "Saq Bol — қауіпсіз аударым / безопасный перевод",
    short_name: "Saq Bol",
    description: "Демо-клиент Saq Bol: перевод с проверкой на мошенничество (ҚАЗ/РУС).",
    id: `${base}/mobile`,
    start_url: `${base}/mobile`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F5FA",
    theme_color: "#00644B",
    lang: "kk",
    icons: [
      { src: `${base}/saq-bol-mark.svg`, sizes: "any", type: "image/svg+xml" },
      { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${base}/icons/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
