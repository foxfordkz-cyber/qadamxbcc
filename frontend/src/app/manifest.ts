import type { MetadataRoute } from "next";

// Lets /mobile be added to the home screen and open full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BCC Shield — қауіпсіз аударым / безопасный перевод",
    short_name: "BCC Shield",
    description: "Демо-клиент BCC Shield: перевод с проверкой на мошенничество (ҚАЗ/РУС).",
    id: "/mobile",
    start_url: "/mobile",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F4F6F8",
    theme_color: "#00A859",
    lang: "kk",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
