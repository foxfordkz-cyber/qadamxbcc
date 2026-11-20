# Qadam Shield 2.3 · Android

The product entry point is `android-app/www/index.html`. Capacitor copies that directory into the signed Android APK. `entry.mjs` selects the connected product at startup. The offline demonstration remains an explicit action. The request is based on version 2.2 at commit `86b5df0` in PR #21.

## Visual references

| Screen | Reference | Implementation |
| --- | --- | --- |
| Entry | Attached reference 2, light surfaces and hierarchy | Direct sign-in, one brand mark, RU/KK and a single form. The former family portrait has been removed from the source and package. |
| Wallet | Attached reference 2 as the primary layout, with reference 1’s separate card | Single compact account header, original geometric green card, four actions, narrow protection status and a transaction list before recipients. |
| Analytics | Attached reference 3 and FinTech Widgets | Period control, two posted-money totals, one full-width comparison plot, an in-flow selection and a drill-down into matching ledger dates. |
| Protection | Attached reference 2 | Telegram identity, verified contact counter, two explicit actions, compact rows for the other protection tools. |
| SOC | Finvo | The period precedes the financial outcome, the review queue and case workload. Filters and actual server activity follow. |

The QBank and Banking Cash Manage product pages were consulted. The UI8 artwork could not be retrieved for visual inspection. Finvo and FinTech Widgets public previews and all three user screenshots were inspected. No purchased assets were used. The source sites are [QBank](https://ui8.net/meetmighty/products/qbank---banking--e-money-management-app-ui-kit), [Banking Cash Manage](https://ui8.net/kitstack/products/banking-cash-manage--mobile-app-ui-kit), [Finvo](https://www.uxsculpt.com/finvo) and [FinTech Widgets](https://www.uxsculpt.com/fintechwidgets).

## Layout and data

Green #164D36, white surfaces, ink #152820 and a neutral #F5F7F4 background form the palette. Emerald and blue distinguish incoming and outgoing series. Icons and text accompany transaction states. The spacing scale is 4/8/12/16/24 px, with 16–24 px page gutters, 12–22 px radii, and primary controls of at least 44 px. System sans-serif typography preserves Kazakh characters. Money is rendered as text. The privacy toggle masks the balance and the visible account suffix.

Previously a shared Guardian stylesheet supplied the family image as a CSS background on two screens. Earlier generic welcome and insight classes also inherited layout from the offline demonstration. The 2.2 period chart scrolled an increasing number of daily columns under static period endpoints. The selected date and the portion of the plot visible on the phone could differ.

The replacement chart has a fixed zero baseline, a shared positive money axis, a bounded number of ticks and an in-flow detail row. Seven days use daily bars, thirty days use five-day sums, and ninety days use ten-day sums. Each selected bucket opens its inclusive date range in history. Posted amounts are added in integer minor units. The server supplies UTC+5 dates created by the same wallet read model for all periods. Pending and blocked attempts count as operations and contribute zero to settled money. A load failure, an empty period and a period with only unsettled attempts have separate states. The source does not supply expense categories.

## Review

The package name remains `kz.qadamx.bccshield.demo`. Version 2.3 uses versionCode 6 and the existing local demo signing certificate. Test with client_demo and admin_demo on the synthetic gateway. Credentials stay in the protected demo account store. Opening the configured Telegram bot does not register contact consent. This mobile stand uses the fake delivery adapter.
