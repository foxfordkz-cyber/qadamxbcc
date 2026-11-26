"use client";

import { walletEntry } from "@/lib/wallet-warmup";
import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { LocaleProvider, useLocale } from "@/lib/i18n";
import release from "../../../../public/downloads/current.json";
import legacy from "../../../../public/downloads/legacy-website-2.9.json";
import "./installer.css";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Installer() {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const size = (release.bytes / 1048576).toFixed(1).replace(".", ",");
  const steps = [
    { art: "phone", title: kk ? "APK жүктеңіз" : "Скачайте APK",
      text: kk ? "QR-кодты телефон камерасымен ашыңыз немесе батырманы басыңыз." : "Отсканируйте QR-код камерой телефона или нажмите кнопку." },
    { art: "lock", title: kk ? "Орнату" : "Установка",
      text: kk ? "Телефоныңызда жүктелген APK файлын ашып, Android сұрауын растаңыз. Командалық нұсқа орнатылса, деректер сақталады." : "Откройте скачанный APK на телефоне и подтвердите установку в Android. Если установлен командный кошелёк, обновление сохранит его данные." },
    { art: "search", title: kk ? "Телефон және ноутбук — бір операция" : "Телефон и ноутбук — одна операция",
      text: kk ? "Бұл APK мен төмендегі кабинет бір оқу серверіне қосылған. Телефонда client_demo, ноутбукта admin_demo арқылы кіріңіз. SOC тізімінен телефондағы түбіртектің операция нөмірін іздеңіз." : "Этот APK и кабинет ниже подключены к одному учебному серверу. На телефоне войдите как client_demo, на ноутбуке — admin_demo. Найдите в ленте SOC номер операции из квитанции телефона." },
  ];
  return <main className="installer">
    <header className="installer-nav">
      <a href={base + "/"} className="installer-back"><ArrowLeft aria-hidden size={18} /><BrandMark size={30} /><strong>Saq Bol</strong></a>
      <LanguageSwitch />
    </header>
    <section className="installer-card">
      <div className="installer-main">
        <p className="installer-eyebrow">Android {release.minSdk === 24 ? "7.0+" : "API " + release.minSdk + "+"}</p>
        <h1>{kk ? <>Saq Bol <span>телефоныңызда</span></> : <>Saq Bol <span>в вашем телефоне</span></>}</h1>
        <p>{kk ? "Android жүйесіне арналған оқу әмияны. Кіру үшін команда берген сынақ тіркелгісін пайдаланыңыз." : "Учебный кошелёк для Android. Для входа используйте тестовую учётную запись от команды."}</p>
        <a className="installer-action" download href={base + release.url}><Download aria-hidden size={19} />
          {kk ? "APK жүктеу" : "Скачать APK"} {release.version}
        </a>
        <small>Android {release.minSdk === 24 ? "7.0+" : "API " + release.minSdk + "+"} · {size} MiB · {kk ? "Жинақ" : "Сборка"} {release.versionCode}</small>
      </div>
      <div className="installer-visual">
        <div className="installer-device" aria-hidden="true">
          <div className="installer-screen">
            <div className="installer-hello"><span>СА</span><b>{kk ? "Қайырлы күн, Сәуле" : "Добрый день, Сәуле"}</b></div>
            <div className="installer-account">
              <small>{kk ? "Менің шоттарым" : "Мои счета"}</small>
              <b>850 000 ₸</b>
              <div className="installer-card"><span>Saq Bol</span><i /><em>•••• 4821</em></div>
            </div>
            <div className="installer-actions"><i className="on" /><i /><i /><i /></div>
            <div className="installer-ops">
              <span><span>Айгерім С.</span><b>−15 000 ₸</b></span>
              <span><span>{kk ? "Жалақы" : "Зарплата"}</span><b className="in">+420 000 ₸</b></span>
            </div>
          </div>
        </div>
        <figure className="installer-qr">
          <img src={base + "/downloads/android-qr.svg"} alt={kk ? "Жүктеу бетінің QR-коды" : "QR-код страницы загрузки"} width="152" height="152" />
          <figcaption>{kk ? "Телефон камерасымен ашыңыз" : "Откройте камерой телефона"}</figcaption>
        </figure>
      </div>
    </section>
    <ol className="installer-steps">{steps.map((step, index) => <li key={step.art}>
      <span className="installer-step-n">{index + 1}</span>
      <h2>{step.title}</h2>
      <p>{step.text}</p>
      {index === 2 && <a className="installer-browser" href={walletEntry("soc")}>{kk ? "Осы APK-ның SOC кабинетін ашу" : "Открыть SOC для этого APK"}<ArrowUpRight aria-hidden size={17} /></a>}
    </li>)}</ol>
    <section className="installer-help">
      <details><summary>{kk ? "Кіру экраны ашылмаса" : "Если не появился экран входа"}</summary>
        <p>{kk ? "Google Play арқылы Android System WebView мен Chrome қолданбаларын жаңартып, әмиянды қайта ашыңыз. Командалық тіркелгімен браузерден де кіруге болады." : "Обновите Android System WebView и Chrome через Google Play и снова откройте кошелёк. В командный аккаунт также можно войти из браузера."}</p>
        <a href={walletEntry("wallet")}>{kk ? "Командалық әмиянды ашу" : "Открыть командный кошелёк"}</a>
      </details>
      <details><summary>{kk ? "APK файлын тексеру" : "Проверить файл APK"}</summary><p>SHA-256</p><code>{release.apk_sha256}</code></details>
      <details><summary>{kk ? "Сайттың бұрынғы нұсқасы орнатылған ба?" : "Уже установлен прежний кошелёк с сайта?"}</summary>
        <p>{kk ? "Жаңа дизайн командалық қолданбада. Бұрынғы сайт нұсқасы бөлек орнатылған күйінде қалады." : "Новый дизайн доступен в командном приложении. Прежняя версия с сайта сохраняется отдельно."}</p>
        <a download href={base + legacy.url}>{kk ? "Бұрынғы APK" : "Прежний APK"} · {legacy.version} ({legacy.versionCode})</a>
      </details>
      <a className="installer-browser" href="https://saq-bol-jury.onrender.com/">{kk ? "Бөлек қазылар бөлмесі · деректері басқа" : "Отдельная комната жюри · другие данные"}<ArrowUpRight aria-hidden size={17} /></a>
    </section>
  </main>;
}

export default function AndroidInstaller() {
  return <LocaleProvider><Installer /></LocaleProvider>;
}
