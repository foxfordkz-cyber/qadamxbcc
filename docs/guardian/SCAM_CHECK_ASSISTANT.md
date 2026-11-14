# Educational Scam Check

Uses precisely the five existing CoolingQuestionnaire fields: caller_claims_bank_or_police,
asked_to_move_to_safe_account, asked_to_keep_secret_or_install_app, initiated_by_customer,
knows_recipient_personally. Field parity is executable in test_guardian_navigation.
The first three affirmative answers and the last two negative answers are displayed as
answers deserving attention. This is an explicit educational rule, not a numeric fraud
score, validated classifier, bank decision or second blocking engine.

Users may finish at any time. Results explain that no flagged answers cannot prove safety,
recommend independently using a familiar official banking channel, and can prepare a
fixed-text draft for the user. No PIN/CVV/OTP/password/account data or arbitrary text is
requested by this flow. Nothing is sent to SOC or an outside organization by the draft
action. The separate incident workflow must require explicit submission and ownership.

All questions, explanations, buttons and empty/stale states have RU/KK versions. Survey
answers live only in bounded Redis FSM data, with 15-minute TTL and an explicit expiry
check on each answer. No transfer ID is accepted and no financial API is invoked.
