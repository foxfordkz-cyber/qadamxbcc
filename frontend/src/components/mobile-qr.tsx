"use client";

import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useLocale } from "@/lib/i18n";

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i;

/** The address a jury phone can open: this page's origin, or the laptop's Wi-Fi address when the SOC is opened on localhost. */
async function mobileUrl(): Promise<string | null> {
  const { protocol, hostname, port, origin } = window.location;
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (process.env.NEXT_PUBLIC_BCC_STATIC === "1") return `${origin}${base}/mobile/`;
  if (!LOOPBACK.test(hostname)) return `${origin}/mobile`;
  const response = await fetch("/mobile/link", { cache: "no-store" });
  if (!response.ok) return null;
  const value = await response.json() as { origins?: string[]; hosts?: string[] };
  if (value.origins?.[0]) return `${value.origins[0]}/mobile`;
  const host = value.hosts?.[0];
  return host ? `${protocol}//${host}${port ? `:${port}` : ""}/mobile` : null;
}

export function MobileQr({ tourEnabled }: { tourEnabled: boolean }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState(tourEnabled);
  const [state, setState] = useState<{ url: string; svg: string } | "loading" | "missing">("loading");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState("loading");
    mobileUrl()
      .then(async mobile => {
        if (!mobile) return "missing" as const;
        const url = tour ? `${mobile}?tour=1` : mobile;
        return { url, svg: await QRCode.toString(url, { type: "svg", margin: 4, errorCorrectionLevel: "M", color: { dark: "#1C1C1E", light: "#FFFFFF" } }) };
      })
      .catch(() => "missing" as const)
      .then(value => { if (!cancelled) setState(value); });
    return () => { cancelled = true; };
  }, [open, tour]);
  return <details className="mobile-qr" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="secondary icon-button" aria-label={t("mobileQr")} title={t("mobileQr")}><QrCode size={18} aria-hidden="true" /></summary>
    <div className="mobile-qr-card" role="group" aria-label={t("mobileQr")}>
      <strong>{t("mobileQr")}</strong>
      {tourEnabled && <div className="segmented" role="group" aria-label={t("mobileQr")}>{[true, false].map(value =>
        <button type="button" key={String(value)} aria-pressed={tour === value} onClick={() => {
          if (value !== tour) { setState("loading"); setTour(value); }
        }}>{t(value ? "tourQr" : "transfer")}</button>)}</div>}
      {state === "loading" ? <p className="muted">{t("mobileQrLoading")}</p>
        : state === "missing" ? <p className="mobile-qr-missing">{t("mobileQrUnavailable")}</p>
        : <>
          <div className="mobile-qr-code" role="img" aria-label={state.url} dangerouslySetInnerHTML={{ __html: state.svg }} />
          <a className="mobile-qr-url" href={state.url} target="_blank" rel="noreferrer">{state.url.replace(/^https?:\/\//, "")}</a>
        </>}
      <p className="muted">{t(tour ? "tourQrHint" : "mobileQrHint")}</p>
    </div>
  </details>;
}
