from scripts.export_api_contracts import DOC, render


def test_api_contracts_doc_matches_the_application() -> None:
    assert DOC.read_text(encoding="utf-8") == render(), (
        "docs/API_CONTRACTS.md is stale: uv run python -m scripts.export_api_contracts"
    )
