"use client";

import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { LocaleProvider, useLocale } from "@/lib/i18n";
import release from "../../../../public/downloads/current.json";
import team from "../../../../public/downloads/team.json";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Installer() {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const size = (release.bytes / 1048576).toFixed(1).replace(".", ",");
  return <main className="installer">
    <header className="installer-nav">
      <a href={base + "/"} className="installer-back"><ArrowLeft aria-hidden size={18} />{kk ? "Басты бет" : "На главную"}</a>
      <LanguageSwitch />
    </header>
    <section className="installer-card">
      <div className="installer-main">
        <BrandMark size={60} />
        <h1>Saq Bol × BCC</h1>
        <p>{kk ? "Android жүйесіне арналған оқу әмияны. Кіру үшін команда берген сынақ тіркелгісін пайдаланыңыз." : "Учебный кошелёк для Android. Для входа используйте тестовую учётную запись от команды."}</p>
        <a className="installer-action" download href={base + release.url}><Download aria-hidden size={19} />
          {kk ? "APK жүктеу" : "Скачать APK"} {release.version}
        </a>
        <small>Android {release.minSdk === 24 ? "7.0+" : "API " + release.minSdk + "+"} · {size} MiB · {kk ? "Жинақ" : "Сборка"} {release.versionCode}</small>
      </div>
      <figure className="installer-qr">
        <img src={base + "/downloads/android-qr.svg"} alt={kk ? "Жүктеу бетінің QR-коды" : "QR-код страницы загрузки"} width="152" height="152" />
        <figcaption>{kk ? "Телефон камерасымен ашыңыз" : "Откройте камерой телефона"}</figcaption>
      </figure>
    </section>
    <section className="installer-help">
      <h2>{kk ? "Орнату" : "Установка"}</h2>
      <p>{kk ? "Телефоныңызда жүктелген APK файлын ашып, Android сұрауын растаңыз. Сайттан бұрын орнатылған қолданба жаңартылады." : "Откройте скачанный APK на телефоне и подтвердите установку в Android. Если вы уже устанавливали кошелёк с сайта, он обновится поверх прежнего."}</p>
      <details><summary>{kk ? "Кіру экраны ашылмаса" : "Если не появился экран входа"}</summary>
        <p>{kk ? "Google Play арқылы Android System WebView мен Chrome қолданбаларын жаңартып, әмиянды қайта ашыңыз. Командалық тіркелгімен браузерден де кіруге болады." : "Обновите Android System WebView и Chrome через Google Play и снова откройте кошелёк. В командный аккаунт также можно войти из браузера."}</p>
        <a href="https://saq-bol-mobile.onrender.com/wallet/">{kk ? "Командалық әмиянды ашу" : "Открыть командный кошелёк"}</a>
      </details>
      <details><summary>{kk ? "APK файлын тексеру" : "Проверить файл APK"}</summary><p>SHA-256</p><code>{release.apk_sha256}</code></details>
      <details><summary>{kk ? "Honor телефонындағы командалық нұсқаны жаңарту" : "Обновить командную сборку для Honor"}</summary>
        <p>{kk ? "Командадан бұрын APK алған қатысушыларға арналған." : "Для участников, которые раньше установили APK от команды."}</p>
        <a download href={base + team.url}>{kk ? "Командалық APK жүктеу" : "Скачать командный APK"} {team.version} · {team.package}</a>
      </details>
      <a className="installer-browser" href="https://saq-bol-jury.onrender.com/">{kk ? "Қазылар әмиянын браузерде ашу" : "Открыть кошелёк жюри в браузере"}<ArrowUpRight aria-hidden size={17} /></a>
    </section>
  </main>;
}

export default function AndroidInstaller() {
  return <LocaleProvider><Installer /></LocaleProvider>;
}
