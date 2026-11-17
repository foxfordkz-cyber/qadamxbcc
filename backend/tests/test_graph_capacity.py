"""Large graph histories fail explicitly instead of silently omitting risk evidence."""

import pytest

from app.services.graph import MAX_GRAPH_NEIGHBOURS, GraphCapacityError, GraphStore


def test_oversized_account_is_rejected_before_metric_sums_or_subgraph_sort() -> None:
    graph = GraphStore()
    for i in range(MAX_GRAPH_NEIGHBOURS + 1):
        graph.add_transfer(f"sender-{i}", "hub", 1000)
    with pytest.raises(GraphCapacityError, match="Account degree"):
        graph.metrics("hub")
    with pytest.raises(GraphCapacityError, match="Account degree"):
        graph.subgraph("hub", max_nodes=60)


def test_oversized_device_cluster_is_not_copied_or_silently_truncated() -> None:
    graph = GraphStore()
    for i in range(MAX_GRAPH_NEIGHBOURS + 1):
        graph.add_account(f"account-{i}", device_id="shared")
    with pytest.raises(GraphCapacityError, match="Device cluster"):
        graph.accounts_on_device("shared")
    with pytest.raises(GraphCapacityError, match="Device associations"):
        graph.device_peers("account-0")
    with pytest.raises(GraphCapacityError):
        graph.metrics("account-0")
    with pytest.raises(GraphCapacityError):
        graph.subgraph("account-0")
