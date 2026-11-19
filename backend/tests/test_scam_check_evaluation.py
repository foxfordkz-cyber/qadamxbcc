import json
from pathlib import Path

import pytest

from scripts.evaluate_scam_check import evaluate, load_cases, metrics


def test_metrics_count_false_positives_misses_and_abstentions() -> None:
    cases = load_cases()
    result = metrics(cases, contextual=True)
    assert result.tp + result.fp + result.fn + result.tn == len(cases)
    assert result.fp > 0  # Legitimate contract fees are a documented limitation.
    assert result.fn > 0  # Implicit threats and investment promises are out of ruleset scope.
    assert result.insufficient_context > 0
    assert result.false_positive_rate == result.fp / (result.fp + result.tn)
    assert result.recall == result.tp / (result.tp + result.fn)


def test_corpus_is_reproducible_bilingual_and_report_does_not_include_text() -> None:
    cases = load_cases()
    assert len(cases) == 40
    assert {c.language for c in cases} == {"ru", "kk"}
    assert sum(c.suspicious for c in cases) == 20
    report = evaluate()
    assert report == evaluate()
    encoded = json.dumps(report, ensure_ascii=False)
    assert all(c.text not in encoded for c in cases)


def test_duplicate_samples_are_rejected(tmp_path: Path) -> None:
    case = load_cases()[0].model_dump()
    target = tmp_path / "duplicates.json"
    target.write_text(json.dumps([case, case]), encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate"):
        load_cases(target)


def test_published_metrics_match_current_rules_and_corpus() -> None:
    artifact = Path(__file__).resolve().parents[2] / "docs/qa/scam-check-evaluation.json"
    published = json.loads(artifact.read_text(encoding="utf-8"))
    published.pop("latency", None)  # Timing is evidence of one run, not a deterministic fixture.
    assert published == evaluate()
