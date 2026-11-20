import type { Metadata } from "next";
import "@fontsource-variable/roboto-flex";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saq Bol × BCC — Қауіпсіз аударымдар / Безопасные переводы",
  description: "Saq Bol × BCC · ITU Hackathon 2026. Қазақша және орысша аударым қорғауының прототипі / независимый прототип защиты переводов. Команда foxfordkz-cyber/qadamxbcc.",
  applicationName: "Saq Bol × BCC",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="kk"><body>{children}</body></html>;
}
