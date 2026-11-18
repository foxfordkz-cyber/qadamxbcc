import type { Graph } from "./contracts";

/** Keep every direct neighbour; separate fan-in from outgoing/shared accounts. */
export function directGraphLayout(graph: Graph): Graph["nodes"] {
  if (graph.depth !== 1) return graph.nodes;
  const incoming = new Set(graph.edges.filter(edge => edge.data.edge_type === "transfer" && edge.target === graph.center).map(edge => edge.source));
  const neighbours = graph.nodes.filter(node => node.id !== graph.center).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const positions = new Map<string, { x: number; y: number }>([[graph.center, { x: 0, y: 0 }]]);
  const place = (group: Graph["nodes"], left: boolean) => {
    const columns = group.length > 6 ? 2 : 1;
    const rows = Math.ceil(group.length / columns);
    group.forEach((node, index) => {
      const column = Math.floor(index / rows);
      positions.set(node.id, {
        x: left ? -(columns - column) * 260 : (column + 1) * 280,
        y: (index % rows - (rows - 1) / 2) * 132,
      });
    });
  };
  place(neighbours.filter(node => incoming.has(node.id)), true);
  place(neighbours.filter(node => !incoming.has(node.id)), false);
  return graph.nodes.map(node => ({ ...node, position: positions.get(node.id)! }));
}
