import release from "../../public/downloads/current.json";

export function AndroidDownload({ kk }: { kk: boolean }) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return <section className="android-download" aria-label="Android">
    <img width="92" height="92" src={base + "/downloads/android-qr.svg"} alt={kk ? "Android жүктеу QR-коды" : "QR для загрузки Android"} />
    <div><a className="pitch-link" href={base + "/download/android/"}>{kk ? "Android қолданбасын жүктеу" : "Скачать Android-приложение"}</a>
      <small>{kk ? "Оқу нұсқасы" : "Учебная демонстрационная версия"} · {release.version} · {release.date} · {(release.bytes / 1048576).toFixed(1)} MiB</small>
      <small>{kk ? "APK файлын ашыңыз. Android сұраса, осы дереккөзден орнатуға рұқсат беріңіз." : "Откройте APK. Если Android запросит разрешение, подтвердите установку из выбранного источника."}</small>
    </div>
  </section>;
}

