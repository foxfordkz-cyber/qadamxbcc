# Guardian / Trusted Circle handoff

Dependencies: #4 observability → #5 Guardian UX → Trusted Circle. The bank UI is owned
by the frontend team and was not modified. Existing evaluate/resolve-cooling contracts
remain unchanged. Telegram chat identity is never a source of owner capabilities.

ContactOut adds alias and notifications_enabled. Use existing POST/GET/DELETE trusted
contacts for invitation/list/revocation, and PATCH contact preferences for rename,
language and opt-out. Choose one consenting contact explicitly when requesting a
notification; do not loop over all contacts. Show the cap of 3 and 409 contact_limit_reached.
Contact aliases are user content: escape in any HTML renderer and exclude from analytics.

The checked examples/OpenAPI in docs/integrations include the preference operation.
409 contact_notifications_disabled means offer preferences/reload, not retry send.
DELIVERY_FAILED with notifications_disabled is a suppressed send. SENT means provider
acceptance; ACK and suspicion are separate advisory states, never banking decisions.

RU/KK bot navigation and the educational questionnaire are available in the Guardian
router. Draft preparation does not submit an incident. New incident endpoints under
/api/v1/integrations/guardian provide POST/GET reports, GET report by id, POST acknowledge
(SOC only), and GET history. The response field is `state`: SUBMITTED or
DEMO_ACKNOWLEDGED. Only SOC may read contact-authored reports through HTTP; an owner's
list includes its own owner-authored reports only. Recipient access stays in the bot.
Report errors: 404 foreign/missing; 409 changed replay/duplicate body; 410 expired;
422 invalid content/missing explicit confirmation; 429 rolling-day quota. Preserve the
same idempotency key after an uncertain POST result; do not silently create a new report.

SOC GET /api/v1/integrations/soc/transactions/{id}/summary composes saved facts and
cached health. It has RU/KK descriptions and advisory manual-review reason codes, not
a new risk score. Latest windows are bounded; Timeline supplies paginated older events.
Do not display SENT as read, DEMO_ACKNOWLEDGED as bank investigation, or absence of
manual-review reasons as a safety guarantee. Render all text as escaped plain text.
The 22 checked JSON examples and matching OpenAPI include these six new operations.
Existing Timeline/Health remain available as documented in the integration handoff.

Team acceptance must check owner-session provisioning, explicit consent, quota errors,
opt-out/revoke, language labels, keyboard navigation and stale replies. Shared migration
review and joint UI sign-off remain external approvals; no main merge is authorized.
