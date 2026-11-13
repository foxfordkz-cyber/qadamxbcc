import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "BCC Shield — Қауіпсіз аударымдар / Безопасные переводы",
  description: "BCC Shield: қазақша және орысша аударым қауіпсіздігі / защита переводов на казахском и русском языках.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="kk"><body>{children}</body></html>;
}
