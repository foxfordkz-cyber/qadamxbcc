# Transfer evidence in the synthetic wallet

The SOC compares the original decision with extra hold thresholds on the same transfers. KZT exposure includes only eligible, unambiguously labelled KZT cases. The public replay uses the exact amounts supplied to the scorer and both fraud and legitimate labels. Neither measure estimates realised bank losses.

Evidence on a payment edge uses the recipient of the selected decision, the direction of flow and a 24-hour settlement window ending just before the decision. The current graph can contain links that appeared later.

Device keys are opt-in within one private jury room. A trusted HTTPS origin or local `http://localhost:18003` is fixed at startup. A signed challenge binds the resolved account, amount in tiyn, currency, request ID and scoring context. Enrollment is stored in SQL so losing Redis challenges cannot silently turn off verification. Fresh requests require a fresh authorization. The bank would own device enrollment, recovery and identity in a pilot.

Each jury room hosts a simulated issuer and verifier. The receiving institution requests a fresh signed advisory for a single linked case. It gets an opaque case reference, a reason to review, a version and a short validity period. The source withdraws the warning when the confirmed finding changes. No customer identifiers or claims about other cases leave the issuer in this exchange. Both participants run in the same process.

An open redirect dispute reserves only its original approved KZT credit. The synthetic wallet computes availability from posted debits and credits and the existing virtual opening balance. The sender lock serializes spending, final release and review. A legacy dispute is picked up during migration. Ed25519 statements describe the status at issuance, and verification separately reports whether that state is still current. The signing key lasts for the jury room's lease.

The officer queue measures its one-hour training target from the original report. For legacy cases without a retained report it starts at case creation. The first audited SOC action ends the wait. Automatic Guardian events and client replies leave the case in the waiting queue. The read-only filter orders pending cases by oldest report across pages.

### Familiar-payee call trial, 25 November 2026

The incumbent is the v3 call-aware forest. Train a regularized logistic specialist on independent synthetic sessions (seed 63119). Choose its review threshold on development calls (14803, 256 sessions per family, ambiguous sessions labelled both ways) by minimizing false pauses while catching at least the incumbent count plus two percentage points of all labelled scams, if feasible. Freeze the threshold before scoring either new test population. Use paired full-engine decisions on the historical 640 observations (20261217), a fresh 1,280 (92071), and 640 with extra telemetry loss (34307). Each ambiguous pair stays in the same population. Promote in the demo only if the fresh and missing-data populations each have fewer false pauses, at least as many intercepted scams, zero added hard blocks, unchanged out-of-scope decisions and warmed scoring p95 below 2 ms. Historical scores are descriptive. Bank activation requires independent labelled bank data and policy approval. The synthetic proportions are experimental choices.

The first specialist missed three additional labelled scams in the sensor-loss cohort. The browser also sums all gaps of at least 1.5 seconds, while both legacy generators used the longest gap. Preserve that trial in `docs/evidence/familiar-call-first-trial.json`. Before recalculating any results, give the sensor-aligned revision a new version and independent seeds (training 204113, development 37013, test 72491, extra loss 78157). Keep the historical 640 unchanged for continuity. Retain the development objective and gates above. Both specialists remain observational for this release because the legacy-sensor stress test already found an additional miss. Publish the revision's benchmark verdict separately from its actual activation status.

### Frozen model calibration cohort

Bind seed 78114239, 20,000 generated rows and the feature order to a versioned SHA-256 before inspecting predictions or modifying the decision rules. At the fixed 0.50 cutoff, report the original simulation and a prior-shift sensitivity with prevalence 0.0005. Reliability, Brier and precision use the same class weights. Retain the trained forests and threshold unchanged.

### Jury CSV trial, 25 November 2026

Run the existing blind-call scorer on accepted rows of anonymous UTF-8 CSVs, with at most 32 rows per jury run. Store only the latest frozen forecast in its private ephemeral room. Reject repeated identifiers on all affected rows. Bind the downloadable forecast and subsequent grade to the same SHA-256, and keep labels out of scoring. The room and its examples use synthetic transfers.

### Clearing evidence in the collection exhibit

Only the synthetic clearing register supplies settlement evidence. Match the posting reference, debtor, beneficiary, currency and integer amount, and require receipt before scoring, a current validity window and no effective revocation. Re-evaluate collection-only pressure with the matched payout attributed to clearing in an isolated projection. Preserve the observed ledger and all decisions with independent warnings. The paired trial is read-only and never changes a customer payment decision.

### Officer outcome denominators

The cohort follows transfer creation dates in Kazakhstan time. A cancellation and a referral can describe the same original hold. Confirmed share divides unambiguous retained fraud findings by all original holds. Reopened and conflicting findings do not label a payment. Rule counts deduplicate each transfer per code. Reaction time starts at the report and ends at the first staff event for a linked case. Unanswered cases do not contribute to response percentiles.

### Local message checks and case consent

Run the same phrase matcher in the browser client and connected wallet. Keep the original message and matched fragments on the device. An authenticated owner may share one of four fixed categories with one eligible report after explicit consent. The server checks ownership, status and retention time, then records at most one event per report and category using the existing audit table. SOC receives the category and timestamp. A category alone has no effect on a transfer decision.

### Public homepage follows bcc.kz, 26 November 2026

The homepage takes its palette, heading face and shapes from bcc.kz as measured on 26 November 2026: canvas `#F5F5FA`, ink `#1D1D1E`, green `#00AB75`, Roboto Flex 700 headings, 12 px buttons, 16–24 px cards and 32 px banners without shadows. Suisse Intl, the bank's text face, is commercial, so Onest stays for body text. White text on `#00AB75` reaches only 3:1, so buttons and small green text use `#00875C` and `#007A53`, the same hue at 4.5:1. The tokens are scoped to `.public-home` and leave `/mobile`, `/soc` and `/pitch` unchanged. The 3D objects come from the Android wallet. The drop-network scene uses three.js only after `lib/fx-tier.ts` approves the device and falls back to a drawn SVG of the same layout otherwise. The threshold, collection and model exhibits move into a collapsed panel that opens itself for README deep links. The scene does not claim cash-machine blocking: stage four shows only that new transfers into the flagged hub are held.

### Homepage shows the product, not decoration, 26 November 2026

The team rejected the glossy clay icons, tinted backgrounds and floating objects as generated-looking. The homepage now presents the product the way Freedom Bank presents cards: large white product panels with a title, checked benefits and one green button beside a real-time render. The hero renders the Saq Bol card in three.js as deep-green plastic under the glass shield, which frosts while a transfer is held. Below, a features section shows eight working functions with small interface excerpts: call pause, call check, trusted person, message and link checks, payee name, mistaken-transfer return, prepayment warning and police report. Amber appears only in status dots and pills, never as a background. The ULB/Worldline Kaggle benchmark moves from the ignored `.local-checks` folder into `backend/scripts/ulb_card_benchmark.py` with its result in `docs/evidence`. The page reports it with its limits: European card data without call features, so it is not presented as evidence about BCC customers.

## Preflight on the website origin

Render may return HTML before it can serve the wallet. The independent website polls an allowlisted credential-free readiness endpoint and redirects only after a positive database/Redis check. GitHub Pages has no server route, so the static export keeps direct configured wallet links and can be warmed before a demonstration.

## Multiworker graph authority

BCC_SHARED_GRAPH_READS selects committed SQL aggregates for each evaluation and release and a repeatable PostgreSQL snapshot for the SOC graph. Each transfer receives its own graph view. Redis continues to deduplicate settled velocity by transfer UUID.

## Offline scoring parity

Both test suites independently execute five shared cases and compare the complete rule-code set, numeric score and outcome. The model and Redis engine run in the Python test. Offline examples only have the scenario coverage exercised here.

## Bank-side session evidence

Only an authenticated bank-side source can submit a tenant-keyed HMAC of the IP and coarse region. At most 30 days of observations are eligible and the next ingest purges expired rows. The P2P browser cannot supply these fields. Workplace NAT, shared Wi-Fi and travel alone add no risk. Either new region needs established history across two days.

## ATM simulation scope

The authenticated client chooses whether the caller requested the cash. The server owns the deadline and serializes one open synthetic instruction per owner in Redis. A separate instruction cannot bypass the hold. No dispenser or banking ledger is connected.

## Passive brand reports

Only authenticated officers add observations from received reports. The application excludes known official channels, strips identifiers to a host or handle, and never opens a target or sends a takedown. Drafts identify an allegation for human verification. Inventory is bounded to 100 observations over 30 days. BCC lists its official support bot at https://www.bcc.kz/.

## Statements are separate from the score

Only the authenticated sender or recipient can submit their own categorical account for a reported payment. An immutable private audit record per party supports retries. The officer sees both versions. In isolated jury rooms only, the officer can issue a ten-minute link for the other synthetic participant, restricted to one dispute, with its source marked. The link has no wallet or payment rights. The entry is excluded from shared receipts and scoring explanations. A separate browser can submit the reply without joining the room. A non-authorizing room selector is accepted only on the reply endpoint, together with the expiring per-transfer invitation.

## Ledger and privacy handoff

The adapter contract is a proposed bank interface. Decision state is distinct from a ledger receipt. Bank identity, lawful basis, residency and retention require agreement before receiving identifiable client records.

## Pitch as one scrolling page (26 Nov 2026)

`/pitch` is now the five-minute pitch laid out as a page, not a slide console: a deep-green opening with the live phone, the 3D card freezing, the client story told by a sticky phone, the 3D drop network, a bento of what BCC gets, SOC, architecture, evidence, the case requirements, competitors and the shadow pilot. Arrow keys and Space move between 15 anchors whose timings add up to 300 seconds; T starts the clock and N shows speaker notes. It opens in Kazakh (`?lang=ru` for Russian) because the defence is given in Kazakh. The previous console with pilot economics and jury questions stays at `/pitch/console`. Figures are the ones already measured in the repository; each links to its file on the `codex/final-nov26` branch.

## Large text (26 Nov 2026)

Older clients asked for bigger type. Rather than a second set of font sizes, the "Aa" switch on the site scales the whole document (`zoom`), so layouts keep their proportions. The choice is a per-device preference in localStorage. The team decided against the switch in Android; it was removed before any APK build.

## Public wallet readiness (26 Nov 2026)

The Cloudflare Worker probes each configured Render health endpoint with manual redirect handling. A redirect or a response without the expected JSON leaves the stand pending. In workerd, passing `redirect: "error"` throws before the network request. The compiled Worker test exercises the real fetch path for both origins. Visitors can open the same configured stand directly during the bounded 90-second wait.

## Pitch as a slide deck (26 Nov 2026, later)

A scrolling page read as a website, not a pitch. `/pitch` is now a 1920×1080 deck scaled to the screen: 14 slides, 300 seconds, one idea per slide and one moving explanation each (the scam call, the antifraud blind spot, a 3D stack of the four layers, the live phone, the freezing card, the Telegram link, the 3D drop network, the tilted SOC screen, the decision gauge). Animations replay on every entry; heavy 3D mounts only for the current and adjacent slides. Controls hide while the mouse rests. The scrolling page moved to `/pitch/web`. PDFs in `docs/pitch/` are full-HD screenshots of each slide with the 3D rendered, because a print of the page would lose the WebGL scenes.

The competitor comparison slide was dropped from the deck and the web pitch: naming other banks invites questions the prototype cannot answer from public data alone. Slide 13 is now the pilot plan (what BCC provides, what the team delivers) and slide 14 the close with QR codes and the full team, presented by Almaz.
