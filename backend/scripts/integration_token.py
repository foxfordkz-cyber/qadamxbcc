"""Operator-only CLI. Issue a local demo capability; never expose as an HTTP endpoint."""

import argparse
import uuid

from app.integrations.config import get_integration_settings
from app.integrations.security import Principal, issue_token


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=["owner", "soc", "simulator"])
    parser.add_argument("subject", type=uuid.UUID)
    parser.add_argument("--ttl", type=int, default=900)
    args = parser.parse_args()
    principal = Principal.model_validate({"role": args.role, "subject": args.subject})
    print(
        issue_token(
            principal, get_integration_settings().signing_key.get_secret_value(), ttl=args.ttl
        )
    )


if __name__ == "__main__":
    main()
