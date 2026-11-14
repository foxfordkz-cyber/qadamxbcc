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
router. Draft preparation does not submit an incident; general incident workflow and
SOC summary remain separate pending P1 work. Do not present those as delivered APIs yet.
Existing Timeline/Health can be used as documented in the integration handoff.

Team acceptance must check owner-session provisioning, explicit consent, quota errors,
opt-out/revoke, language labels, keyboard navigation and stale replies. Shared migration
review and joint UI sign-off remain external approvals; no main merge is authorized.
