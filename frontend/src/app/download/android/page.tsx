import release from "../../../../public/downloads/current.json";

export default function AndroidInstaller() {
  return <main className="install-sheet"><h1>Qadam Shield · Android {release.version}</h1>
    <p>Оқу нұсқасы · Учебная демонстрационная версия</p>
    <p>{release.date} · {(release.bytes / 1048576).toFixed(1)} MiB · Android API {release.minSdk}+</p>
    <a className="pitch-link" download href={(process.env.NEXT_PUBLIC_BASE_PATH ?? "") + release.url}>APK жүктеу / Скачать APK</a>
    <p>Файлды ашып, Android сұрауын растаңыз. Откройте файл и подтвердите системный запрос на установку.</p>
    <details><summary>SHA-256</summary><code>{release.apk_sha256}</code></details>
  </main>;
}

