# Visual review: 2.5 → 2.7

Actual Chrome renders of the application source, not design mockups. Both versions use the same isolated synthetic HTTP fixtures: Russian, 360 × 800 CSS pixels, client Алия, balance 50,000 ₸, recipient Арман, two outgoing operations of 12,500 ₸ (one approved, one cooling-off), seven-day posted outflow 12,500 ₸ and a 15-minute server-relative deadline. Desktop SOC uses 1440 × 900. Baseline source: 6b4a9e6; new visual composition: 20f7bac. The final APK uses source daea694, additionally preserving the typed login across language changes; that fix does not change these six compositions. Packaged/source asset equality is separately checked in CI.

These screenshots do **not** prove live backend delivery or public deployment. Fixed navigation may appear across a full-page screenshot; scrolling makes the underlying actions reachable. No actual account credentials or Telegram identifiers are in the fixture.

| Screen | 2.5 | 2.7 |
| --- | --- | --- |
| Home | [Before](2.5/home.png) | [After](2.7/home.png) |
| Transfer | [Before](2.5/transfer.png) | [After](2.7/transfer.png) |
| Cooling-Off | [Before](2.5/pause.png) | [After](2.7/pause.png) |
| Analytics | [Before](2.5/analytics.png) | [After](2.7/analytics.png) |
| SOC phone | [Before](2.5/soc.png) | [After](2.7/soc.png) |
| SOC desktop | [Before](2.5/soc-desktop.png) | [After](2.7/soc-desktop.png) |

Visible changes: a dedicated transfer action; recipients/activity earlier on a phone; separate desktop card/protection columns; transfer progress and balance; amount-focused review; pause clock/action grouping; wider analytics and SOC composition. The Saq Bol × BCC branding was already present in the team's current main and is retained.

## Physical Honor evidence

The [phone](phone/) subdirectory is separate from the synthetic browser fixtures: final 2.7 APK, Honor VNE-LX1 / Android 14, same signing identity. It contains viewport captures of login, the explicitly labelled offline overview and the real public server's invalid-password response, with a machine-readable list of eight completed checks. No successful cloud login/transfer or live Telegram delivery is implied. Full-page native capture produced repeated compositor content, so only newly captured viewport images are used for the home/login evidence.
