import type { Metadata } from "next";
import "@fontsource-variable/roboto-flex";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saq Bol — Қауіпсіз аударымдар / Безопасные переводы",
  description: "Saq Bol: қазақша және орысша аударым қауіпсіздігі / защита переводов на казахском и русском языках.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="kk"><body>{children}</body></html>;
}
