import { Download } from "lucide-react";
import release from "../../public/downloads/current.json";

export function AndroidDownload({ kk }: { kk: boolean }) {
  return <a className="pitch-link" href={(process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/download/android/"}>
    <Download aria-hidden size={17} />
    {kk ? "Android жүктеу" : "Скачать для Android"} · {release.version}
  </a>;
}
