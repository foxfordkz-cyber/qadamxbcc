"""Small authored synthetic challenge panel, not independent production accuracy."""

import argparse
import hashlib
import json
import math
import platform
import time
from collections.abc import Sequence
from pathlib import Path

from pydantic import BaseModel, ConfigDict, TypeAdapter

from app.integrations.scam_check import (
    COMPILED,
    RULESET_VERSION,
    Language,
    ScamCheckRequest,
    analyze,
    mask,
)

CORPUS = Path(__file__).resolve().parents[1] / "qa" / "scam_check_v1.json"


class Case(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    language: Language
    scenario: str
    suspicious: bool
    text: str


class Metrics(BaseModel):
    samples: int
    tp: int
    fp: int
    fn: int
    tn: int
    precision: float | None
    recall: float | None
    false_positive_rate: float | None
    insufficient_context: int
    mismatched_ids: list[str]


def load_cases(path: Path = CORPUS) -> list[Case]:
    cases = TypeAdapter(list[Case]).validate_json(path.read_bytes())
    if not cases or len({c.id for c in cases}) != len(cases):
        raise ValueError("empty corpus or duplicate IDs")
    if len({c.text for c in cases}) != len(cases):
        raise ValueError("duplicate texts would inflate sample count")
    for case in cases:
        ScamCheckRequest(text=case.text, language=case.language)
    return cases


def rate(n: int, d: int) -> float | None:
    return n / d if d else None


def metrics(cases: Sequence[Case], *, contextual: bool) -> Metrics:
    tp = fp = fn = tn = uncertain = 0
    mismatched = []
    for case in cases:
        result = analyze(ScamCheckRequest(text=case.text, language=case.language))
        if contextual:
            detected = bool(result.signals)
            uncertain += result.status == "insufficient_context"
        else:
            # Same masked text and subject lexicon; ablate action/clause/negation checks.
            working, _ = mask(case.text)
            detected = any(subject.search(working) for subject, _ in COMPILED.values())
        tp += detected and case.suspicious
        fp += detected and not case.suspicious
        fn += not detected and case.suspicious
        tn += not detected and not case.suspicious
        if detected != case.suspicious:
            mismatched.append(case.id)
    return Metrics(
        samples=len(cases),
        tp=tp,
        fp=fp,
        fn=fn,
        tn=tn,
        precision=rate(tp, tp + fp),
        recall=rate(tp, tp + fn),
        false_positive_rate=rate(fp, fp + tn),
        insufficient_context=uncertain,
        mismatched_ids=mismatched,
    )


def evaluate(path: Path = CORPUS) -> dict[str, object]:
    cases = load_cases(path)
    return {
        "ruleset_version": RULESET_VERSION,
        "corpus_sha256": hashlib.sha256(
            json.dumps([c.model_dump() for c in cases], sort_keys=True).encode()
        ).hexdigest(),
        "scope": "40 authored synthetic challenge cases; paired RU/KK scenarios are correlated",
        "limitations": (
            "No training/tuning split, prevalence estimate, independent holdout or bank data. "
            "Ablation reuses the same lexicon. Insufficient context counts as not detected. "
            "Known misses and false positives remain visible; no production accuracy claim."
        ),
        "contextual": {
            "all": metrics(cases, contextual=True).model_dump(),
            **{
                lang: metrics(
                    [c for c in cases if c.language == lang], contextual=True
                ).model_dump()
                for lang in ("ru", "kk")
            },
        },
        "keyword_baseline": metrics(cases, contextual=False).model_dump(),
        "scenarios": {
            name: metrics([c for c in cases if c.scenario == name], contextual=True).model_dump()
            for name in sorted({c.scenario for c in cases})
        },
    }


def benchmark(iterations: int = 1000) -> dict[str, object]:
    if not 100 <= iterations <= 100_000:
        raise ValueError("benchmark requires 100..100000 iterations")
    bodies = [ScamCheckRequest(text=c.text, language=c.language) for c in load_cases()]
    for body in bodies:
        analyze(body)
    samples = []
    for index in range(iterations):
        start = time.perf_counter_ns()
        analyze(bodies[index % len(bodies)])
        samples.append((time.perf_counter_ns() - start) / 1_000_000)
    samples.sort()
    return {
        "scope": "offline rules only; excludes HTTP, Redis, DB, Telegram and antifraud engine",
        "python": platform.python_version(),
        "platform": platform.system(),
        "iterations": iterations,
        "errors": 0,
        "error_rate": 0,
        **{f"p{p}_ms": samples[math.ceil(iterations * p / 100) - 1] for p in (50, 95, 99)},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()
    result = evaluate()
    if args.benchmark:
        result["latency"] = benchmark()
    serialized = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized)


if __name__ == "__main__":
    main()
