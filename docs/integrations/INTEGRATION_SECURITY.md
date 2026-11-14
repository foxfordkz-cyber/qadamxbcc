# Integration security boundary

Only synthetic local/test data is authorized. No bank credentials, real transfers,
real NBK endpoint, production deployment or production migration is part of this work.

## Authentication and isolation

Main `627fa88` has no authentication middleware. New integration routes therefore
fail closed behind short-lived HMAC capabilities provisioned by the local operator.
Roles are owner (one bound account), soc (read enrichment), and simulator (fake
Telegram ingress only). Signatures bind role, subject and expiration. Default TTL
is 900 seconds, maximum 3600. Signing keys require 32 characters and are SecretStr
settings. There is no HTTP token issuance route and no trusted X-Account-ID header.
Production requires integration with bank IAM, authorization review and key rotation.
The existing unauthenticated core API remains a demo limitation requiring core-owner work.

Redis enforces atomic per-principal limits. Limiter failure returns 503, never an
unlimited bypass. Foreign-owner resources are hidden. SQLAlchemy binds all user
parameters. Bodies forbid unknown fields. Public responses exclude delivery addresses.

## Telegram

Owner consent and separately authenticated contact consent are both required.
Invitation links contain a random 256-bit capability, expire after 10 minutes by
default, and are consumed under a row lock. Only their digest persists. Recipients
must be private Telegram users; real test mode additionally requires an operator
allowlist of consenting participants. Owners cannot submit fake sender identities.
Messages contain no amount, IIN, account number, recipient phone or person name.

Callbacks validate recipient, delivered message ID, notification and expiry.
Suspicions are monotonic advisory events. No callback imports TransferService or
calls resolve-cooling. Both parties can revoke. Pending sends observe revocation;
already delivered messages cannot be recalled. Ambiguous send failures are not retried.

## Operations and retention

Never log Authorization headers, request bodies containing invitations, provider
exceptions, bot tokens or Telegram IDs. Application audit events use fixed codes
and correlation UUIDs. Upstream reverse proxies must also redact headers and bodies.
No raw invitation is included in status/history. Integration tests use synthetic
signing keys explicitly named as test values; these are not deployment secrets.

Telegram addresses currently reside in the local database until revoked. Audit,
notification and consent history need a reviewed retention/deletion policy and
encrypted storage before real customer data is permitted. No production readiness
or Kazakhstan legal compliance claim is made by this MVP.
