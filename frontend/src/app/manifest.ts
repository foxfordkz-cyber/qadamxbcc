import type { MetadataRoute } from "next";

// Lets /mobile be added to the home screen and open full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Saq Bol — қауіпсіз аударым / безопасный перевод",
    short_name: "Saq Bol",
    description: "Демо-клиент Saq Bol: перевод с проверкой на мошенничество (ҚАЗ/РУС).",
    id: "/mobile",
    start_url: "/mobile",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F5FA",
    theme_color: "#00AB75",
    lang: "kk",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
