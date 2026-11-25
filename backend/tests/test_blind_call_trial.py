import pytest

from scripts.blind_call_trial import Case, digest, freeze, grade, read_csv

HEAD = (
    b"case_id,amount_kzt,usual_amount_kzt,recipient_characters,"
    b"typing_ms,hesitation_ms,hesitation_count\n"
)
ROWS = b"a,30000,25000,12,3000,0,0\nb,50000,25000,,,,0\n"


async def test_grade_checks_commitment_and_pairs_labels_by_id() -> None:
    frozen = await freeze(HEAD + ROWS)
    data = frozen.model_dump_json().encode()
    labels = b"case_id,outcome\nb,fraud\na,legitimate\n"
    counts = grade(data, digest(data), labels)
    for model in counts.values():
        assert model.caught + model.missed == 1
        assert model.false_pauses + model.honest_approved == 1
    with pytest.raises(ValueError, match="SHA-256"):
        grade(data + b" ", digest(data), labels)
    with pytest.raises(ValueError, match="match frozen"):
        grade(data, digest(data), b"case_id,outcome\na,legitimate\n")
    with pytest.raises(ValueError, match="Duplicate"):
        grade(data, digest(data), labels + b"a,legitimate\n")


def test_score_input_rejects_labels_and_duplicate_ids() -> None:
    with pytest.raises(ValueError, match="columns"):
        read_csv(HEAD.strip() + b",outcome\n" + ROWS, Case)
    with pytest.raises(ValueError, match="Duplicate"):
        read_csv(HEAD + ROWS + ROWS, Case)
