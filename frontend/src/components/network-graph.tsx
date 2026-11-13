"use client";

import { useEffect, useMemo, useState } from "react";
import { Background, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { Maximize2, Minus, Plus, Smartphone, UserRound } from "lucide-react";
import type { Graph, GraphData } from "@/lib/contracts";
import { useLocale } from "@/lib/i18n";

type AccountNode = Node<GraphData & { tone: string; caption: string }, "account">;
function Account({ data, selected }: NodeProps<AccountNode>) {
  return <div className={`account-node ${data.tone} ${selected ? "selected" : ""}`}>
    <Handle type="target" position={Position.Left} />
    <div className="flex items-center gap-2">{data.shared_device_accounts > 0 ? <Smartphone size={18} /> : <UserRound size={18} />}<strong>{data.label}</strong></div><small>{data.caption}</small>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { account: Account };
function Controls() {
  const { t } = useLocale();
  const flow = useReactFlow();
  return <Panel position="bottom-left"><div className="graph-controls"><button aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => void flow.zoomIn()}><Plus size={16} /></button><button aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => void flow.zoomOut()}><Minus size={16} /></button><button aria-label={t("fit")} title={t("fit")} onClick={() => void flow.fitView({ padding: 0.2 })}><Maximize2 size={16} /></button></div></Panel>;
}
function Canvas({ graph }: { graph: Graph }) {
  const { t, lang } = useLocale();
  const [selected, setSelected] = useState<GraphData | null>(null);
  const prepared = useMemo(() => {
    const suspicious = new Set(graph.nodes.filter(n => n.data.suspected_mule || n.data.flagged || n.data.role === "hub" || n.data.role === "mule").map(n => n.id));
    const incoming = new Set(graph.edges.filter(e => e.data.edge_type === "transfer" && suspicious.has(e.target)).map(e => e.source));
    return graph.nodes.map(n => ({ ...n, type: "account" as const, data: { ...n.data,
      tone: suspicious.has(n.id) ? "danger" : n.data.shared_device_accounts > 0 || incoming.has(n.id) ? "warning" : "safe",
      caption: t(suspicious.has(n.id) ? "hub" : n.data.shared_device_accounts > 0 ? "shared" : incoming.has(n.id) ? "victim" : "account"),
    } }));
  // Translation changes rebuild labels while the effect below preserves dragged positions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lang]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AccountNode>(prepared);
  useEffect(() => { setNodes(previous => prepared.map(n => ({ ...n, position: previous.find(p => p.id === n.id)?.position ?? n.position }))); }, [prepared, setNodes]);
  const edges = graph.edges.map(edge => {
    const shared = edge.data.edge_type === "shared_device";
    const risky = edge.data.highlight || prepared.some(n => n.id === edge.target && n.data.tone === "danger");
    const color = shared ? "#fbbf24" : risky ? "#fb7185" : "#32d997";
    return { ...edge, ariaLabel: shared ? t("shared") : t("transfer"), label: shared ? t("shared") : edge.label ?? undefined, animated: !shared && risky,
      style: { stroke: color, strokeWidth: 1.8, strokeDasharray: shared ? "6 5" : undefined },
      markerEnd: shared ? undefined : { type: MarkerType.ArrowClosed, color },
      labelStyle: { fill: "#e4eeeb", fontSize: 10 }, labelBgStyle: { fill: "#14251f", fillOpacity: 0.95 },
    };
  });
  return <><div className="graph-canvas"><ReactFlow<AccountNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
    onNodeClick={(_, node) => setSelected(node.data)} onPaneClick={() => setSelected(null)} fitView minZoom={0.2} maxZoom={2} nodesConnectable={false} edgesFocusable={false} colorMode="dark"
    ariaLabelConfig={{ "node.a11yDescription.default": t("graphKeyboard"), "node.a11yDescription.keyboardDisabled": t("graphKeyboard"), "node.a11yDescription.ariaLiveMessage": ({ x, y }) => `${t("account")}: ${x}, ${y}`, "edge.a11yDescription.default": t("graphKeyboard"), "handle.ariaLabel": t("account") }}>
    <Background color="#2b4037" gap={24} /><Controls />
  </ReactFlow></div>
    <div className="graph-legend"><span><i className="bg-rose-400" />{t("hub")}</span><span><i className="bg-amber-400" />{t("victim")}</span><span><Smartphone size={13} />{t("shared")}</span></div>
    {selected && <div className="node-detail"><strong>{selected.label}</strong><span>{t("incoming")}: {selected.in_degree}</span><span>{t("outgoing")}: {selected.out_degree}</span><span>{t("device")}: {selected.device_id || "—"}</span></div>}
  </>;
}
export default function NetworkGraph({ graph }: { graph: Graph }) {
  return <ReactFlowProvider><Canvas key={graph.center} graph={graph} /></ReactFlowProvider>;
}
