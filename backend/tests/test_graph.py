from app.services.graph import GraphStore


def test_subgraph_includes_neighbours_and_shared_device_links() -> None:
    g = GraphStore()
    g.add_account("hub", label="Hub", device_id="burner")
    g.add_account("mule2", device_id="burner")
    for i in range(4):
        g.add_transfer(f"f{i}", "hub", 100_000)
    g.add_transfer("hub", "cash", 380_000)
    g.add_transfer("cash", "far", 1_000)

    view = g.subgraph("hub", depth=1)

    ids = {n.id for n in view.nodes}
    assert ids == {"hub", "f0", "f1", "f2", "f3", "cash", "mule2"}
    hub = next(n for n in view.nodes if n.id == "hub")
    assert hub.depth == 0
    assert hub.label == "Hub"
    assert hub.metrics.in_degree == 4
    assert hub.metrics.transit_ratio == 0.95
    assert hub.metrics.suspected_mule
    types = {(e.source, e.target, e.edge_type) for e in view.edges}
    assert ("hub", "cash", "transfer") in types
    assert ("hub", "mule2", "shared_device") in types
    assert all(e.target != "far" for e in view.edges)


def test_subgraph_respects_max_nodes_and_unknown_center() -> None:
    g = GraphStore()
    for i in range(30):
        g.add_transfer(f"s{i}", "c", float(i + 1))
    view = g.subgraph("c", depth=1, max_nodes=5)
    assert len(view.nodes) == 5
    # heaviest links are kept first
    assert {n.id for n in view.nodes} == {"c", "s29", "s28", "s27", "s26"}
    assert g.subgraph("missing").nodes == []
