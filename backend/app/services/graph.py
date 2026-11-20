"""In-memory NetworkX money-flow graph (hydrated from ``graph_edges``, updated per transfer).

Keeping the graph resident makes recipient metrics O(degree) instead of a DB round trip,
which is what lets Layer 2 stay inside its ~25 ms budget.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field

import networkx as nx

HUB_MIN_SENDERS = 10
TRANSIT_MIN_SENDERS = 3
TRANSIT_RATIO = 0.7
SHARED_DEVICE_MIN = 2
MAX_GRAPH_NEIGHBOURS = 4096
MAX_SUBGRAPH_WORK = MAX_GRAPH_NEIGHBOURS * 4


class GraphCapacityError(RuntimeError):
    """The resident graph cannot safely evaluate this account within its bounded budget."""


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

        Fan-in and shared devices can describe a family collection. A mule label
        requires independent money movement or a reviewed account flag.
        """
        return self.flagged or self.is_transit

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
        self._registered_devices: dict[str, str] = {}
        self._linked_devices: dict[str, set[str]] = {}
        self._applied_pending: set[str] = set()
        self._flag_versions: dict[str, int] = {}

    def mark_projected(self, transaction_ids: Iterable[str]) -> None:
        self._applied_pending.update(transaction_ids)

    def forget_projected(self, transaction_ids: Iterable[str]) -> None:
        self._applied_pending.difference_update(transaction_ids)

    # ---------------------------------------------------------------- mutation
    def add_account(
        self,
        account_id: str,
        *,
        label: str = "",
        device_id: str = "",
        flagged: bool = False,
        flag_version: int | None = None,
    ) -> None:
        previous = self._registered_devices.pop(account_id, None)
        # Replacement removes only current-registration evidence. An observed
        # demo device or an explicit persisted shared-device link stays valid.
        if (
            previous
            and previous != device_id
            and previous not in self._linked_devices.get(account_id, set())
        ):
            members = self._device_accounts[previous]
            members.discard(account_id)
            if not members:
                del self._device_accounts[previous]
            devices = self._account_devices[account_id]
            devices.discard(previous)
            if not devices:
                del self._account_devices[account_id]
        self._g.add_node(account_id, label=label or account_id[:8], device_id=device_id)
        self.set_flagged(account_id, flagged, version=flag_version)
        if device_id:
            self._registered_devices[account_id] = device_id
            self._associate_device(account_id, device_id)

    def set_flagged(
        self, account_id: str, flagged: bool = True, *, version: int | None = None
    ) -> None:
        self._ensure(account_id)
        if version is not None:
            if version < self._flag_versions.get(account_id, -1):
                return
            self._flag_versions[account_id] = version
        self._g.nodes[account_id]["flagged"] = flagged

    def link_device(self, account_id: str, device_id: str) -> None:
        """Retain observed demo or explicit shared-edge evidence independently of registration."""
        self._ensure(account_id)
        if not device_id:
            return
        self._linked_devices.setdefault(account_id, set()).add(device_id)
        self._associate_device(account_id, device_id)

    def _associate_device(self, account_id: str, device_id: str) -> None:
        self._device_accounts.setdefault(device_id, set()).add(account_id)
        self._account_devices.setdefault(account_id, set()).add(device_id)

    def add_transfer(
        self,
        source: str,
        target: str,
        amount: float,
        *,
        tx_count: int = 1,
        ts: float = 0.0,
        transaction_id: str | None = None,
    ) -> None:
        if transaction_id is not None and transaction_id in self._applied_pending:
            return
        self._ensure(source)
        self._ensure(target)
        if self._g.has_edge(source, target):
            data = self._g.edges[source, target]
            data["weight"] += amount
            data["count"] += tx_count
            data["last_ts"] = max(data["last_ts"], ts)
        else:
            self._g.add_edge(source, target, weight=amount, count=tx_count, last_ts=ts)
        if transaction_id is not None:
            self._applied_pending.add(transaction_id)

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

    def transfer_count(self, source: str, target: str) -> int:
        edge = self._g.get_edge_data(source, target)
        return int(edge["count"]) if edge else 0

    def accounts_on_device(self, device_id: str) -> set[str]:
        accounts = self._device_accounts.get(device_id, set())
        if len(accounts) > MAX_GRAPH_NEIGHBOURS:
            raise GraphCapacityError("Device cluster exceeds the supported graph capacity")
        return set(accounts)

    def registered_accounts_on_device(self, device_id: str) -> set[str]:
        """Bounded cached registrations that must be refreshed even after moving away."""
        return {
            account_id
            for account_id in self.accounts_on_device(device_id)
            if self._registered_devices.get(account_id) == device_id
        }

    def device_peers(self, account_id: str) -> set[str]:
        peers: set[str] = set()
        devices = self._account_devices.get(account_id, set())
        if len(devices) > MAX_GRAPH_NEIGHBOURS:
            raise GraphCapacityError("Device history exceeds the supported graph capacity")
        work = 0
        for dev in devices:
            members = self._device_accounts.get(dev, set())
            work += len(members)
            if work > MAX_GRAPH_NEIGHBOURS:
                raise GraphCapacityError("Device associations exceed the supported graph capacity")
            peers |= members
        peers.discard(account_id)
        return peers

    def metrics(self, account_id: str) -> GraphMetrics:
        if account_id not in self._g:
            return GraphMetrics(0, 0, 0.0, 0.0, 0, False)
        g = self._g
        self._check_degree(account_id)
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

    def _check_degree(self, account_id: str) -> int:
        degree = int(self._g.in_degree(account_id)) + int(self._g.out_degree(account_id))
        if degree > MAX_GRAPH_NEIGHBOURS:
            raise GraphCapacityError("Account degree exceeds the supported graph capacity")
        return degree

    def subgraph(self, center: str, *, depth: int = 2, max_nodes: int = 60) -> SubgraphView:
        """BFS (ignoring direction) around ``center``, plus shared-device links among the set."""
        if center not in self._g:
            return SubgraphView(center=center)
        depths: dict[str, int] = {center: 0}
        frontier = [center]
        work = 0
        for d in range(1, depth + 1):
            nxt: list[str] = []
            for node in frontier:
                peers = self.device_peers(node)
                work += self._check_degree(node) + len(peers)
                if work > MAX_SUBGRAPH_WORK:
                    raise GraphCapacityError("Subgraph exceeds the supported graph work budget")
                neighbours = set(self._g.successors(node)) | set(self._g.predecessors(node))
                neighbours |= peers
                weighted = [(-self._link_weight(node, nb), nb) for nb in neighbours - depths.keys()]
                for _, nb in sorted(weighted):
                    if len(depths) >= max_nodes:
                        break
                    depths[nb] = d
                    nxt.append(nb)
            frontier = nxt

        if sum(self._check_degree(node) for node in depths) > MAX_SUBGRAPH_WORK:
            raise GraphCapacityError("Subgraph metrics exceed the supported graph work budget")

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
