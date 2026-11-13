"""Run: uv run python -m scripts.train_fraud_model [--output PATH]."""

import argparse
import json
from pathlib import Path

from app.ml.model import MODEL_PATH, train_artifact


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=MODEL_PATH)
    args = parser.parse_args()
    artifact = train_artifact(args.output)
    print(json.dumps({k: v for k, v in artifact.items() if k != "estimator"}, indent=2))


if __name__ == "__main__":
    main()
