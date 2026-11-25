import json
from dataclasses import replace
from datetime import timedelta

from app.services.settlement_evidence import JURY_CLEARING, ClearingProof, Settlement, proof_state
from scripts.settlement_trial import AS_OF, OUTPUT, exhibit


def test_proof_is_as_of_and_binds_all_settlement_fields() -> None:
    before, after = AS_OF - timedelta(minutes=1), AS_OF + timedelta(minutes=1)
    item = Settlement("invoice-7", "fund", "shop", 500_000)
    proof = ClearingProof(JURY_CLEARING, item, before, AS_OF, after)
    assert proof_state(proof, item, AS_OF) == "valid"
    assert proof_state(None, item, AS_OF) == "missing"
    assert proof_state(replace(proof, issuer="customer"), item, AS_OF) == "untrusted"
    assert proof_state(proof, item, before) == "future"
    assert proof_state(proof, item, after) == "expired"
    assert proof_state(replace(proof, revoked_at=AS_OF), item, AS_OF) == "revoked"
    assert proof_state(replace(proof, revoked_at=after), item, AS_OF) == "valid"
    for other in (
        replace(item, reference="another"),
        replace(item, payer="other"),
        replace(item, payee="other"),
        replace(item, currency="USD"),
        replace(item, amount_tiyn=500_001),
    ):
        assert proof_state(proof, other, AS_OF) == "mismatch"


async def test_paired_published_trial_replays_both_policies_and_protects_flag() -> None:
    published = json.loads(OUTPUT.read_text(encoding="utf-8"))
    assert await exhibit() == published
    rows = published["examples"]
    assert rows["valid"]["contextual"]["decision"] == "approved"
    for key in ("expired", "revoked", "future", "mismatch", "flagged"):
        assert rows[key]["observed"] == rows[key]["contextual"]
    assert rows["flagged"]["contextual"]["decision"] == "blocked"
    before, after = published["cohort"]["observed"], published["cohort"]["contextual"]
    assert after["false_pauses"] < before["false_pauses"]
    assert before["caught"] == after["caught"] == after["fraud"]
