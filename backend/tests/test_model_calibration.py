import pytest

from scripts.model_calibration import assess


def test_class_weighting_and_boundary_bins() -> None:
    metrics = assess([0, 0, 1, 1], [0.0, 0.5, 0.5, 1.0], 0.0005)
    assert metrics["recall_at_50"] == 1
    assert metrics["fpr_at_50"] == pytest.approx(0.5)
    assert metrics["precision_at_50"] == pytest.approx(0.0005 / (0.0005 + 0.9995 / 2))
    assert sum(b["weight"] for b in metrics["reliability"]) == pytest.approx(1)
    assert metrics["reliability"][-1]["observed_rate"] == 1
    assert metrics["reliability"][1]["observed_rate"] is None
    assert metrics["brier"] == pytest.approx(0.125)
    assert assess([0, 1], [0.0, 0.0], 0.0005)["precision_at_50"] is None
