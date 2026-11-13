# Mobile client handoff (role 3)

Branch: `feat/mobile-client-cooling-flow`
Base: `a02d20dcc857001de364e0b0f12a66ce72db0c12`

The mobile tab retains the existing evaluate/resolve API and browser biometric
sensor. Its banking frame, contact selection and amount controls now lead to a
receipt inside the phone for approved, held and blocked decisions. Manual demo
context switches are in a collapsed section. SOC components and backend policy
are unchanged.

Cooling verification has an introduction, five individual questions and an
editable review. A question requires an explicit yes/no answer before continuing.
Only the final confirmation submits the five booleans to resolve-cooling.
Closing the dialog or pressing Escape leaves the transfer held; reopening resumes
with answers retained in React state. Answers survive tab/language changes, but
not a page reload or starting another preset/transfer.

The countdown uses the API's absolute cooling_off_until timestamp. It does not
restart on reopening or release money at zero. A missing/invalid timestamp shows
an explanation instead of a fabricated timer. The existing backend can resolve a
clean questionnaire before 15 minutes; the UI explains that policy rather than
introducing a client-side lock. This is a simulator, not a real payment receipt.
Trusted-contact advice does not claim that a Telegram alert was sent.

## Run and check

From frontend:

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
```

Use the existing environment settings in .env.example for live API mode. No
environment contract or dependency versions changed in this branch.

## Validation performed

- TypeScript and production build passed.
- All 14 Node tests passed, including deadline and complete-answer regressions.
- Headless Edge: all three presets; clean answers release; a red flag blocks;
  partial answers survive close/reopen; language switches preserve progress.
- Simulated HTTP 503 during resolve keeps answers and allows retry.
- Expired deadline shows 00:00 without sending a resolve request; Escape dismisses.
- Desktop 1440px and mobile 390px/320px layouts checked for horizontal overflow.
  Native dialog provides focus containment; question headings receive focus.
  Motion respects prefers-reduced-motion.
- No browser page errors during these checks.

The browser checks used the application's demo API. Docker's daemon was not
running, so this branch has not been end-to-end tested against FastAPI/Postgres/
Redis. QA should repeat the same cases in live mode with the team's seeded stack.
