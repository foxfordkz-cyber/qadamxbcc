import type { Metadata } from "next";
import "@fontsource-variable/onest";
import "@fontsource-variable/geologica";
import "@xyflow/react/dist/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saq Bol × BCC — Қауіпсіз аударымдар / Безопасные переводы",
  description: "Saq Bol × BCC. Аударымды алаяқтардан қорғау / Защита перевода от мошенников.",
  applicationName: "Saq Bol × BCC",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="kk"><body>{children}</body></html>;
}
