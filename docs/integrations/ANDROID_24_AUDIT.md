# Android 2.4 audit follow-up

The audited 2.3 APK matches SHA-256 `099acfe6d6dfd6e960cec706ea350f09d885d366118d8de9d10517de118ce862` and source commit `3f240f9`. Version 2.4 keeps the package and increments the Android version code to 7. Review this branch against PR #22.

| Area | Behavior to review |
| --- | --- |
| Home | Account, recent activity and weekly summary settle independently. A failed summary has its own retry. Authentication failures still end the session. |
| Transfer | Edit and both Back controls restore the same payee, amount and call flags before submission. |
| Scam Check | Typed and OCR-corrected text stays in the current session through errors and language changes. Clear removes it; logout clears account state. |
| Reports | Encrypted account-scoped storage indexes drafts by transfer or general inquiry. An existing 2.3 draft is read on upgrade. Switching context offers a choice, shows the target ID and keeps unsent drafts. |
| Offline | An explicit local practice ledger supplies the product wallet, rows and chart. Online authentication and permissions stay server-side. Developer LAN/role-code HTML lives outside the APK under `android-app/dev`, served on the loopback preview at `/dev/`. |
| Analytics | Monetary buckets and integer minor-unit arithmetic are unchanged. The taller plot uses larger labels, locally scrollable tap targets and a fixed scale. SOC displays the count by creation date and nearest-rank engine p95 from up to 500 most recent positive measurements in the selected period. |
| Network | Fit uses actual circle bounds. Concentric rings keep numbered nodes apart. Zoom, drag, arrow keys and the node picker support exploration; the picker also brings a selected node into view while zoomed. |

The second attached banking screen supplies the primary light composition. Reference 1 informs the card. Reference 3 and FinTech Widgets inform chart hierarchy. Finvo informs SOC metric grouping. See the [2.3 design notes](ANDROID_23_DESIGN.md) for the original previews. No artwork purchase or family-image replacement is required.

The public bot username and the invitation channel have separate purposes. On the mobile fake-delivery stand, the former opens Telegram and the latter can be null. Reviewers should record private live consent independently. The public trial tunnel must continue serving the HTTPS origin embedded in the APK.
