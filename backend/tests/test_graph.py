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


def test_birthday_host_is_not_a_hub_but_forwarding_hub_is() -> None:
    """SOC roles mirror the engine's corroboration rule: fan-in alone is a collection."""
    from app.services.graph import NodeView
    from app.services.soc import _role

    g = GraphStore()
    g.add_account("host", device_id="host-phone")
    g.add_account("hub", device_id="ring-phone")
    for i in range(15):
        g.add_transfer(f"guest{i}", "host", 10_000)
        g.add_transfer(f"victim{i}", "hub", 100_000)
    g.add_transfer("hub", "cashout", 1_300_000)

    host, hub = g.metrics("host"), g.metrics("hub")
    assert host.in_degree == 15
    assert not host.suspected_mule
    assert not host.is_hub
    assert hub.is_transit
    assert hub.is_hub

    def role(node_id: str) -> str:
        return _role(NodeView(node_id, node_id, "", 1, g.metrics(node_id)))

    assert role("host") == "normal"
    assert role("hub") == "hub"

    # One shared phone is not enough; a device cluster (2+ peers) corroborates.
    g.add_account("twin1", device_id="host-phone")
    assert not g.metrics("host").suspected_mule
    g.add_account("twin2", device_id="host-phone")
    assert g.metrics("host").suspected_mule
    assert role("host") == "hub"
