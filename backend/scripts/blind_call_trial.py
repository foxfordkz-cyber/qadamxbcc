"""Score anonymous known-payee call cases, then grade frozen decisions against separate labels."""

import argparse
import asyncio
import csv
import hashlib
import json
from dataclasses import asdict, replace
from io import StringIO
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.ml.familiar import ARTIFACT, VERSION, familiar_router
from app.ml.model import MODEL_PATH, MODEL_VERSION, get_model
from scripts.evaluate_familiar_call import Counts
from scripts.evaluate_fraud_model import evaluate_scenario, scenarios

CaseId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,48}$")]
Decision = Literal["approved", "cooling_off", "blocked"]


class Case(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    case_id: CaseId
    amount_kzt: float = Field(gt=0)
    usual_amount_kzt: float = Field(gt=0)
    recipient_characters: int | None = Field(default=None, ge=0, le=128)
    typing_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    hesitation_ms: int | None = Field(default=None, ge=0, le=300_000)
    hesitation_count: int = Field(ge=0, le=100)


class Label(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: CaseId
    outcome: Literal["fraud", "legitimate"]


class Compared(BaseModel):
    case_id: CaseId
    incumbent: Decision
    candidate: Decision


class FrozenRun(BaseModel):
    incumbent_version: str
    candidate_version: str
    input_sha256: str
    incumbent_sha256: str
    candidate_sha256: str
    decisions: list[Compared] = Field(min_length=1)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_csv[M: BaseModel](data: bytes, schema: type[M]) -> dict[str, M]:
    reader = csv.DictReader(StringIO(data.decode("utf-8-sig"), newline=""))
    headers = reader.fieldnames or []
    if sorted(headers) != sorted(schema.model_fields):
        raise ValueError(f"Expected CSV columns: {', '.join(schema.model_fields)}")
    result: dict[str, M] = {}
    for row in reader:
        if None in row:
            raise ValueError(f"Unexpected extra columns on line {reader.line_num}")
        item = schema.model_validate({k: None if v == "" else v for k, v in row.items()})
        key = row["case_id"]
        if key in result:
            raise ValueError(f"Duplicate case_id on line {reader.line_num}")
        result[key] = item
    if not result:
        raise ValueError("Empty CSV")
    return result


async def freeze(data: bytes) -> FrozenRun:
    cases = read_csv(data, Case)
    incumbent = get_model()
    candidate = familiar_router(incumbent)
    base = scenarios()[0]
    decisions = []
    for item in cases.values():
        case = replace(
            base,
            context=replace(
                base.context,
                active_call=True,
                amount=item.amount_kzt,
                sender_avg_amount=item.usual_amount_kzt,
                typing_duration_ms=item.typing_ms,
                recipient_input_length=item.recipient_characters,
                hesitation_ms=item.hesitation_ms,
                hesitation_count=item.hesitation_count,
            ),
        )
        old = await evaluate_scenario(case, "full_hybrid", incumbent)
        new = await evaluate_scenario(case, "full_hybrid", candidate)
        decisions.append(
            Compared(case_id=item.case_id, incumbent=old["status"], candidate=new["status"])
        )
    return FrozenRun(
        incumbent_version=MODEL_VERSION,
        candidate_version=VERSION,
        input_sha256=digest(data),
        incumbent_sha256=digest(await asyncio.to_thread(MODEL_PATH.read_bytes)),
        candidate_sha256=digest(await asyncio.to_thread(ARTIFACT.read_bytes)),
        decisions=decisions,
    )


def grade(predictions: bytes, expected_sha256: str, labels: bytes) -> dict[str, Counts]:
    if digest(predictions) != expected_sha256.lower():
        raise ValueError("Forecast file differs from the published SHA-256")
    frozen = FrozenRun.model_validate_json(predictions)
    outcomes = read_csv(labels, Label)
    ids = {row.case_id for row in frozen.decisions}
    if len(frozen.decisions) != len(ids) or ids != outcomes.keys():
        raise ValueError("Labels must match frozen case IDs exactly once")
    result = {"incumbent": Counts(), "candidate": Counts()}
    for row in frozen.decisions:
        fraud = outcomes[row.case_id].outcome == "fraud"
        result["incumbent"].add(fraud, row.incumbent != "approved")
        result["candidate"].add(fraud, row.candidate != "approved")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    score = commands.add_parser("score")
    score.add_argument("cases", type=Path)
    score.add_argument("predictions", type=Path)
    evaluate = commands.add_parser("grade")
    evaluate.add_argument("predictions", type=Path)
    evaluate.add_argument("labels", type=Path)
    evaluate.add_argument("--sha256", required=True)
    args = parser.parse_args()
    try:
        if args.command == "score":
            frozen = asyncio.run(freeze(args.cases.read_bytes()))
            data = (frozen.model_dump_json(indent=2) + "\n").encode()
            with args.predictions.open("xb") as output:
                output.write(data)
            print(f"{len(frozen.decisions)} cases, SHA-256 {digest(data)}")
        else:
            results = grade(args.predictions.read_bytes(), args.sha256, args.labels.read_bytes())
            print(json.dumps({name: asdict(counts) for name, counts in results.items()}, indent=2))
    except (ValueError, OSError) as exc:
        parser.exit(2, f"{exc}\n")


if __name__ == "__main__":
    main()
