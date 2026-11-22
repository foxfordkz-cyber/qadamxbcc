"use client";

import { ArrowLeft, ArrowUpRight, Download } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitch } from "@/components/language-switch";
import { LocaleProvider, useLocale } from "@/lib/i18n";
import release from "../../../../public/downloads/current.json";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function Installer() {
  const { lang } = useLocale();
  const kk = lang === "kk";
  const size = (release.bytes / 1048576).toFixed(1).replace(".", ",");
  return <main className="installer">
    <header className="installer-nav">
      <a href={base + "/"} className="installer-back"><ArrowLeft aria-hidden size={18} />{kk ? "Р‘Р°СЃС‚С‹ Р±РµС‚" : "РќР° РіР»Р°РІРЅСѓСЋ"}</a>
      <LanguageSwitch />
    </header>
    <section className="installer-card">
      <div className="installer-main">
        <BrandMark size={60} />
        <h1>Saq Bol Г— BCC</h1>
        <p>{kk ? "Android Р¶ТЇР№РµСЃС–РЅРµ Р°СЂРЅР°Р»Т“Р°РЅ РѕТ›Сѓ У™РјРёСЏРЅС‹. РљС–СЂСѓ ТЇС€С–РЅ РєРѕРјР°РЅРґР° Р±РµСЂРіРµРЅ СЃС‹РЅР°Т› С‚С–СЂРєРµР»РіС–СЃС–РЅ РїР°Р№РґР°Р»Р°РЅС‹ТЈС‹Р·." : "РЈС‡РµР±РЅС‹Р№ РєРѕС€РµР»С‘Рє РґР»СЏ Android. Р”Р»СЏ РІС…РѕРґР° РёСЃРїРѕР»СЊР·СѓР№С‚Рµ С‚РµСЃС‚РѕРІСѓСЋ СѓС‡С‘С‚РЅСѓСЋ Р·Р°РїРёСЃСЊ РѕС‚ РєРѕРјР°РЅРґС‹."}</p>
        <a className="installer-action" download href={base + release.url}><Download aria-hidden size={19} />
          {kk ? "APK Р¶ТЇРєС‚РµСѓ" : "РЎРєР°С‡Р°С‚СЊ APK"} {release.version}
        </a>
        <small>Android {release.minSdk === 24 ? "7.0+" : "API " + release.minSdk + "+"} В· {size} MiB В· {kk ? "Р–РёРЅР°Т›" : "РЎР±РѕСЂРєР°"} {release.versionCode}</small>
      </div>
      <figure className="installer-qr">
        <img src={base + "/downloads/android-qr.svg"} alt={kk ? "Р–ТЇРєС‚РµСѓ Р±РµС‚С–РЅС–ТЈ QR-РєРѕРґС‹" : "QR-РєРѕРґ СЃС‚СЂР°РЅРёС†С‹ Р·Р°РіСЂСѓР·РєРё"} width="152" height="152" />
        <figcaption>{kk ? "РўРµР»РµС„РѕРЅ РєР°РјРµСЂР°СЃС‹РјРµРЅ Р°С€С‹ТЈС‹Р·" : "РћС‚РєСЂРѕР№С‚Рµ РєР°РјРµСЂРѕР№ С‚РµР»РµС„РѕРЅР°"}</figcaption>
      </figure>
    </section>
    <section className="installer-help">
      <h2>{kk ? "РћСЂРЅР°С‚Сѓ" : "РЈСЃС‚Р°РЅРѕРІРєР°"}</h2>
      <p>{kk ? "РўРµР»РµС„РѕРЅС‹ТЈС‹Р·РґР° Р¶ТЇРєС‚РµР»РіРµРЅ APK С„Р°Р№Р»С‹РЅ Р°С€С‹Рї, Android СЃТ±СЂР°СѓС‹РЅ СЂР°СЃС‚Р°ТЈС‹Р·. РЎР°Р№С‚С‚Р°РЅ Р±Т±СЂС‹РЅ РѕСЂРЅР°С‚С‹Р»Т“Р°РЅ Т›РѕР»РґР°РЅР±Р° Р¶Р°ТЈР°СЂС‚С‹Р»Р°РґС‹." : "РћС‚РєСЂРѕР№С‚Рµ СЃРєР°С‡Р°РЅРЅС‹Р№ APK РЅР° С‚РµР»РµС„РѕРЅРµ Рё РїРѕРґС‚РІРµСЂРґРёС‚Рµ СѓСЃС‚Р°РЅРѕРІРєСѓ РІ Android. Р•СЃР»Рё РІС‹ СѓР¶Рµ СѓСЃС‚Р°РЅР°РІР»РёРІР°Р»Рё РєРѕС€РµР»С‘Рє СЃ СЃР°Р№С‚Р°, РѕРЅ РѕР±РЅРѕРІРёС‚СЃСЏ РїРѕРІРµСЂС… РїСЂРµР¶РЅРµРіРѕ."}</p>
      <details><summary>{kk ? "РљС–СЂСѓ СЌРєСЂР°РЅС‹ Р°С€С‹Р»РјР°СЃР°" : "Р•СЃР»Рё РЅРµ РїРѕСЏРІРёР»СЃСЏ СЌРєСЂР°РЅ РІС…РѕРґР°"}</summary>
        <p>{kk ? "Google Play Р°СЂТ›С‹Р»С‹ Android System WebView РјРµРЅ Chrome Т›РѕР»РґР°РЅР±Р°Р»Р°СЂС‹РЅ Р¶Р°ТЈР°СЂС‚С‹Рї, У™РјРёСЏРЅРґС‹ Т›Р°Р№С‚Р° Р°С€С‹ТЈС‹Р·. РљРѕРјР°РЅРґР°Р»С‹Т› С‚С–СЂРєРµР»РіС–РјРµРЅ Р±СЂР°СѓР·РµСЂРґРµРЅ РґРµ РєС–СЂСѓРіРµ Р±РѕР»Р°РґС‹." : "РћР±РЅРѕРІРёС‚Рµ Android System WebView Рё Chrome С‡РµСЂРµР· Google Play Рё СЃРЅРѕРІР° РѕС‚РєСЂРѕР№С‚Рµ РєРѕС€РµР»С‘Рє. Р’ РєРѕРјР°РЅРґРЅС‹Р№ Р°РєРєР°СѓРЅС‚ С‚Р°РєР¶Рµ РјРѕР¶РЅРѕ РІРѕР№С‚Рё РёР· Р±СЂР°СѓР·РµСЂР°."}</p>
        <a href="https://saq-bol-mobile.onrender.com/wallet/">{kk ? "РљРѕРјР°РЅРґР°Р»С‹Т› У™РјРёСЏРЅРґС‹ Р°С€Сѓ" : "РћС‚РєСЂС‹С‚СЊ РєРѕРјР°РЅРґРЅС‹Р№ РєРѕС€РµР»С‘Рє"}</a>
      </details>
      <details><summary>{kk ? "APK С„Р°Р№Р»С‹РЅ С‚РµРєСЃРµСЂСѓ" : "РџСЂРѕРІРµСЂРёС‚СЊ С„Р°Р№Р» APK"}</summary><p>SHA-256</p><code>{release.apk_sha256}</code></details>
      <details><summary>{kk ? "Бұрын сайттан орнатқан болсаңыз" : "Если раньше устанавливали APK с сайта"}</summary>
        <p>{kk ? "Бұрынғы .website нұсқасы бөлек сақталады. Жаңа әмиянға сол тіркелгімен кіріп, тарихты тексеріңіз. Жергілікті нобайлар мен сессия көшірілмейді." : "Прежний пакет .website останется на телефоне. Войдите в новый кошелёк с прежним аккаунтом и проверьте историю. Локальные черновики и сессия хранятся в старом приложении."}</p>
      </details>
      <a className="installer-browser" href="https://saq-bol-jury.onrender.com/">{kk ? "ТљР°Р·С‹Р»Р°СЂ У™РјРёСЏРЅС‹РЅ Р±СЂР°СѓР·РµСЂРґРµ Р°С€Сѓ" : "РћС‚РєСЂС‹С‚СЊ РєРѕС€РµР»С‘Рє Р¶СЋСЂРё РІ Р±СЂР°СѓР·РµСЂРµ"}<ArrowUpRight aria-hidden size={17} /></a>
    </section>
  </main>;
}

export default function AndroidInstaller() {
  return <LocaleProvider><Installer /></LocaleProvider>;
}
