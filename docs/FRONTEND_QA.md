# Frontend QA and bilingual review

The QA/localization role in the five-person team split is implemented through the shared KK/RU catalog, mobile copy review, automated regressions, and a browser harness. The role split does not identify the participant by name.

## What the browser harness checks

`frontend/scripts/qa-mobile-soc.cjs` exercises all three presets, in-phone receipts, browser paste/typing/hesitation events, the guided questionnaire, missing answers, live language changes, editing answers, closing/reopening, saved answers after reload, explicit cancellation, API failure/retry, and a missing hold deadline. It checks that clean answers remain held before the deadline and that reaching the deadline never submits a release automatically. A simulated expired deadline verifies the separate confirmation action.

Two concurrent holds verify that recovery of the latest attempt does not replace an explicitly opened earlier transfer. Adversarial mocked answer snapshots verify that server-saved answers refresh while actual unsent edits survive. These snapshots test UI reconciliation; they do not claim that the real backend would keep a transfer held after receiving a fraud-indicating answer.

The SOC checks cover a blocked hub and graph, stage mode, selection retention, collapsible feed, Escape behavior, measured p95 labeling, live-stream start/stop, and graph refitting through ResizeObserver. The graph must request depth 1 explicitly by default; expanding to depth 2 must retain the selected case and show every returned node and edge with accurate counts. Changing depth intentionally fits the new graph. Polling and language changes preserve its selected center, pan, zoom, and dragged node position. The form, security sheet, and SOC stage are checked at 320, 390, 768, and 1280 CSS pixels, with reduced-motion enabled.

Every `/api/v1/...` request is intercepted in the isolated browser context. POSTs go only to the harness's synthetic in-memory store. The harness neither resets preview data nor creates real backend transfers. Service workers are blocked. This is a browser integration check, not proof of actual backend decisions, bank settlement, or production latency. Existing backend integration and concurrency tests remain necessary.

## Running it

Use a running production preview that includes the current source, a local Chromium/Chrome executable, and an installed `playwright-core` package. Both paths below can be changed to suit the machine. No server is started or stopped by the harness.

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/gp-unified/tools/e2e/node_modules/playwright-core'
$env:CHROMIUM_EXECUTABLE = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node frontend/scripts/qa-mobile-soc.cjs http://127.0.0.1:3105
```

An explicit localhost URL is required. The result JSON and screenshots are written to `.local-checks/mobile-soc-<timestamp>/`; `QA_OUTPUT` can override the directory. A failed assertion exits nonzero and saves the failure screenshot. Browser runtime errors are recorded separately from intentional HTTP failures.

## Localization review

The common catalog has 273 nonempty KK/RU pairs; the mobile catalog has 61. All stage controls, graph depth controls, and p95 scope text use the same live locale provider. The mobile questionnaire uses explicit yes/no answers in both languages, without default answers. Server-provided reasons and feature labels remain bilingual.

The copy distinguishes a scoring target from measured p95, held transfers from prevented losses, model scores from proof of fraud, and a simulated decision from an actual bank payment. Cancellation is separate from leaving the transfer held. The security sheet explains that unsent answers can be restored on this device and that a timer never sends money by itself. Receipt cancellation and independent-recipient-check wording were aligned in both languages.

This review checks meaning, consistency, and interaction behavior. It does not replace a bank-approved native-language terminology review before a client pilot.

## Recorded evidence

On 2026-11-18, after the BCC visual redesign (see `docs/DESIGN_SYSTEM.md`), a production build passed **82 browser assertions with zero runtime errors** (`node frontend/scripts/qa-mobile-soc.cjs http://localhost:3105`, reduced motion, mocked API). The added assertion checks that the confirmation step shows amount and recipient and sends no evaluation before the explicit confirm. The redesign also fixed the 320px horizontal overflow of the phone form. Separately, a live production instance against `backend/scripts/run_local_demo.py` (real rules/graph/ML on seeded SQLite: 44 accounts, 134 transfers) was checked at 320, 390, 768, 1280 and 1920 px in both languages with no horizontal overflow; the hub graph (16 accounts / 22 links), ML contributors, measured p95 with sample size and the live stream were reviewed. Screenshots: `deliverables/ui/`.


On 2026-11-17, the final production preview at `http://127.0.0.1:3105` passed **81 browser assertions with zero browser runtime errors**. The run used only intercepted API responses; a separate catch-all route blocked any mutation outside that API surface. The local report is `.local-checks/mobile-soc-1794940086474/report.json`. The added graph-depth, visible-count, deliberate-refit, pan, and selected-center checks all passed. Desktop and 320px SOC screenshots with the bilingual depth controls were visually reviewed. At 320px, KPI cards use a single column to preserve readable Kazakh labels.

The earlier 71-assertion baseline is retained at `.local-checks/mobile-soc-1794938880274/report.json`; its reviewed screenshots also cover the Russian questionnaire and the 320px Kazakh phone form and security sheet. The external-answer and A/B recovery regressions passed in both runs.

Graph geometry checks allow 250ms for the existing 100ms resize debounce. Initial entry, re-entry, depth changes, and responsive resizing must fit every fixture node without a manual fit-button action.
