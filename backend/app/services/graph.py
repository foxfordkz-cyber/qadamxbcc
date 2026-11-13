"""In-memory NetworkX money-flow graph (hydrated from ``graph_edges``, updated per transfer).

Keeping the graph resident makes recipient metrics O(degree) instead of a DB round trip,
which is what lets Layer 2 stay inside its ~25 ms budget.
"""

from dataclasses import dataclass, field

import networkx as nx

HUB_MIN_SENDERS = 10
TRANSIT_MIN_SENDERS = 3
TRANSIT_RATIO = 0.7
SHARED_DEVICE_MIN = 2


@dataclass(frozen=True, slots=True)
class GraphMetrics:
    in_degree: int
    out_degree: int
    in_weight: float
    out_weight: float
    shared_device_accounts: int
    flagged: bool

    @property
    def transit_ratio(self) -> float:
        return self.out_weight / self.in_weight if self.in_weight > 0 else 0.0

    @property
    def is_transit(self) -> bool:
        """Forwards most of what it receives from several senders."""
        return self.in_degree >= TRANSIT_MIN_SENDERS and self.transit_ratio >= TRANSIT_RATIO

    @property
    def suspected_mule(self) -> bool:
        """Mule evidence, mirroring the engine's corroboration rule.

        Fan-in alone (many senders) is a collection, not a mule: a birthday host who
        keeps the money and shares no device is never marked.
        """
        return self.flagged or self.is_transit or self.shared_device_accounts >= SHARED_DEVICE_MIN

    @property
    def is_hub(self) -> bool:
        """A corroborated mule that also collects from many distinct senders."""
        return self.suspected_mule and self.in_degree >= HUB_MIN_SENDERS


@dataclass(frozen=True, slots=True)
class NodeView:
    id: str
    label: str
    device_id: str
    depth: int
    metrics: GraphMetrics


@dataclass(frozen=True, slots=True)
class EdgeView:
    source: str
    target: str
    edge_type: str
    weight: float
    tx_count: int


@dataclass(frozen=True, slots=True)
class SubgraphView:
    center: str
    nodes: list[NodeView] = field(default_factory=list)
    edges: list[EdgeView] = field(default_factory=list)


class GraphStore:
    def __init__(self) -> None:
        self._g: nx.DiGraph[str] = nx.DiGraph()
        self._device_accounts: dict[str, set[str]] = {}
        self._account_devices: dict[str, set[str]] = {}

    # ---------------------------------------------------------------- mutation
    def add_account(
        self, account_id: str, *, label: str = "", device_id: str = "", flagged: bool = False
    ) -> None:
        self._g.add_node(account_id, label=label or account_id[:8], device_id=device_id)
        self._g.nodes[account_id]["flagged"] = flagged
        if device_id:
            self.link_device(account_id, device_id)

    def set_flagged(self, account_id: str, flagged: bool = True) -> None:
        self._ensure(account_id)
        self._g.nodes[account_id]["flagged"] = flagged

    def link_device(self, account_id: str, device_id: str) -> None:
        self._ensure(account_id)
        self._device_accounts.setdefault(device_id, set()).add(account_id)
        self._account_devices.setdefault(account_id, set()).add(device_id)

    def add_transfer(
        self, source: str, target: str, amount: float, *, tx_count: int = 1, ts: float = 0.0
    ) -> None:
        self._ensure(source)
        self._ensure(target)
        if self._g.has_edge(source, target):
            data = self._g.edges[source, target]
            data["weight"] += amount
            data["count"] += tx_count
            data["last_ts"] = max(data["last_ts"], ts)
        else:
            self._g.add_edge(source, target, weight=amount, count=tx_count, last_ts=ts)

    def _ensure(self, account_id: str) -> None:
        if account_id not in self._g:
            self._g.add_node(account_id, label=account_id[:8], device_id="", flagged=False)

    # ----------------------------------------------------------------- queries
    def __contains__(self, account_id: object) -> bool:
        return account_id in self._g

    @property
    def node_count(self) -> int:
        return int(self._g.number_of_nodes())

    @property
    def edge_count(self) -> int:
        return int(self._g.number_of_edges())

    def has_transfer(self, source: str, target: str) -> bool:
        return bool(self._g.has_edge(source, target))

    def accounts_on_device(self, device_id: str) -> set[str]:
        return set(self._device_accounts.get(device_id, ()))

    def device_peers(self, account_id: str) -> set[str]:
        peers: set[str] = set()
        for dev in self._account_devices.get(account_id, ()):
            peers |= self._device_accounts.get(dev, set())
        peers.discard(account_id)
        return peers

    def metrics(self, account_id: str) -> GraphMetrics:
        if account_id not in self._g:
            return GraphMetrics(0, 0, 0.0, 0.0, 0, False)
        g = self._g
        in_w = sum(float(d["weight"]) for _, _, d in g.in_edges(account_id, data=True))
        out_w = sum(float(d["weight"]) for _, _, d in g.out_edges(account_id, data=True))
        return GraphMetrics(
            in_degree=int(g.in_degree(account_id)),
            out_degree=int(g.out_degree(account_id)),
            in_weight=in_w,
            out_weight=out_w,
            shared_device_accounts=len(self.device_peers(account_id)),
            flagged=bool(g.nodes[account_id].get("flagged", False)),
        )

    def subgraph(self, center: str, *, depth: int = 2, max_nodes: int = 60) -> SubgraphView:
        """BFS (ignoring direction) around ``center``, plus shared-device links among the set."""
        if center not in self._g:
            return SubgraphView(center=center)
        depths: dict[str, int] = {center: 0}
        frontier = [center]
        for d in range(1, depth + 1):
            nxt: list[str] = []
            for node in frontier:
                neighbours = set(self._g.successors(node)) | set(self._g.predecessors(node))
                neighbours |= self.device_peers(node)
                weighted = [(-self._link_weight(node, nb), nb) for nb in neighbours - depths.keys()]
                for _, nb in sorted(weighted):
                    if len(depths) >= max_nodes:
                        break
                    depths[nb] = d
                    nxt.append(nb)
            frontier = nxt

        nodes = [
            NodeView(
                id=n,
                label=str(self._g.nodes[n].get("label", n[:8])),
                device_id=str(self._g.nodes[n].get("device_id", "")),
                depth=dep,
                metrics=self.metrics(n),
            )
            for n, dep in depths.items()
        ]
        edges = [
            EdgeView(s, t, "transfer", float(d["weight"]), int(d["count"]))
            for s, t, d in self._g.subgraph(depths.keys()).edges(data=True)
        ]
        seen: set[tuple[str, str]] = set()
        for n in depths:
            for peer in self.device_peers(n):
                pair = (min(n, peer), max(n, peer))
                if peer in depths and pair not in seen:
                    seen.add(pair)
                    edges.append(EdgeView(pair[0], pair[1], "shared_device", 0.0, 0))
        return SubgraphView(center=center, nodes=nodes, edges=edges)

    def _link_weight(self, a: str, b: str) -> float:
        w = 0.0
        if self._g.has_edge(a, b):
            w += float(self._g.edges[a, b]["weight"])
        if self._g.has_edge(b, a):
            w += float(self._g.edges[b, a]["weight"])
        return w
