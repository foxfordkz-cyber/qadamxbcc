"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Background, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { Maximize2, Minus, Plus, Smartphone, UserRound } from "lucide-react";
import type { Graph, GraphData } from "@/lib/contracts";
import { directGraphLayout } from "@/lib/graph-layout";
import { useLocale } from "@/lib/i18n";

type AccountNode = Node<GraphData & { tone: string; caption: string; isCenter: boolean }, "account">;
function Account({ data, selected }: NodeProps<AccountNode>) {
  return <div className={`account-node ${data.tone} ${selected ? "selected" : ""}${data.isCenter ? " is-center" : ""}`}>
    <Handle type="target" position={Position.Left} />
    <span className="account-icon" aria-hidden="true">{data.shared_device_accounts > 0 ? <Smartphone size={16} /> : <UserRound size={16} />}</span><span className="account-text"><strong title={data.label}>{data.label}</strong><small title={data.caption}>{data.caption}</small></span>
    <Handle type="source" position={Position.Right} />
  </div>;
}
const nodeTypes = { account: Account };
function Controls() {
  const { t } = useLocale();
  const flow = useReactFlow();
  return <Panel position="bottom-left"><div className="graph-controls"><button aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => void flow.zoomIn()}><Plus size={16} /></button><button aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => void flow.zoomOut()}><Minus size={16} /></button><button aria-label={t("fit")} title={t("fit")} onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1.1 })}><Maximize2 size={16} /></button></div></Panel>;
}
function Canvas({ graph, streaming }: { graph: Graph; streaming: boolean }) {
  const { t, lang } = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow<AccountNode>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = graph.nodes.find(node => node.id === selectedId)?.data;
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let previous: { width: number; height: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    let disposed = false;
    const observer = new ResizeObserver(([entry]) => {
      const size = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };
      const changed = previous !== null && (previous.width !== size.width || previous.height !== size.height);
      previous = size;
      if (!changed) return;
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (!size.width || !size.height) return;
      // Initial fitting remains React Flow's job. Refit only after a real
      // container resize, so polling, language changes and dragging keep the view.
      timer = setTimeout(() => {
        frame = requestAnimationFrame(() => {
          if (!disposed) void fitView({ padding: 0.2, maxZoom: 1.1 });
        });
      }, 100);
    });
    observer.observe(element);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [fitView]);
  const prepared = useMemo(() => {
    const suspicious = new Set(graph.nodes.filter(n => n.data.suspected_mule || n.data.flagged || n.data.role === "hub" || n.data.role === "mule").map(n => n.id));
    const hubs = new Set(graph.nodes.filter(n => n.data.role === "hub" || (n.data.suspected_mule && n.data.in_degree >= 5)).map(n => n.id));
    const incoming = new Set(graph.edges.filter(e => e.data.edge_type === "transfer" && suspicious.has(e.target)).map(e => e.source));
    return directGraphLayout(graph).map(n => ({ ...n, type: "account" as const, data: { ...n.data,
      isCenter: n.id === graph.center,
      tone: n.data.flagged || hubs.has(n.id) ? "danger" : suspicious.has(n.id) || n.data.shared_device_accounts > 0 || incoming.has(n.id) ? "warning" : "safe",
      caption: t(n.data.flagged ? "flaggedAccount" : hubs.has(n.id) ? "hub" : n.data.shared_device_accounts > 0 ? "shared" : incoming.has(n.id) ? "victim" : suspicious.has(n.id) ? "account" : "safeAccount"),
    } }));
  // Translation changes rebuild labels while the effect below preserves dragged positions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, lang]);
  const [nodes, setNodes, onNodesChange] = useNodesState<AccountNode>(prepared);
  useEffect(() => { setNodes(previous => prepared.map(n => {
    const retained = previous.find(p => p.id === n.id);
    return { ...retained, ...n, position: retained?.position ?? n.position, selected: retained?.selected };
  })); }, [prepared, setNodes]);
  const edges = graph.edges.map(edge => {
    const shared = edge.data.edge_type === "shared_device";
    const risky = edge.data.highlight || prepared.some(n => n.id === edge.target && n.data.tone === "danger");
    const color = shared ? "#DC6803" : risky ? "#D92D20" : "#079455";
    return { ...edge, ariaLabel: shared ? t("shared") : t("transfer"), label: shared ? t("shared") : edge.label ?? undefined, animated: !shared && (risky || streaming),
      style: { stroke: color, strokeWidth: 1.8, strokeDasharray: shared ? "6 5" : undefined },
      markerEnd: shared ? undefined : { type: MarkerType.ArrowClosed, color },
      labelStyle: { fill: "#344054", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }, labelBgStyle: { fill: "#FFFFFF", fillOpacity: 0.96 },
    };
  });
  return <><div className="graph-canvas" data-depth={graph.depth} ref={container}><ReactFlow<AccountNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
    onNodeClick={(_, node) => setSelectedId(node.id)} onSelectionChange={({ nodes: selectedNodes }) => setSelectedId(selectedNodes[0]?.id ?? null)} onPaneClick={() => setSelectedId(null)} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }} minZoom={0.2} maxZoom={2} nodesConnectable={false} edgesFocusable={false} colorMode="light"
    ariaLabelConfig={{ "node.a11yDescription.default": t("graphKeyboard"), "node.a11yDescription.keyboardDisabled": t("graphKeyboard"), "node.a11yDescription.ariaLiveMessage": ({ x, y }) => `${t("account")}: ${x}, ${y}`, "edge.a11yDescription.default": t("graphKeyboard"), "handle.ariaLabel": t("account") }}>
    <Background color="#E4E7EC" gap={22} size={1.2} /><Controls />
    {graph.depth === 1 && <Panel position="top-center"><div className="graph-columns" aria-hidden="true"><span>{t("legendIncoming")}</span><b>{t("legendHub")}</b><span>{t("legendOutgoing")}</span></div></Panel>}
  </ReactFlow></div>
    <div className="graph-legend"><span><i className="legend-warning" />{t("legendIncoming")}</span><span><i className="legend-danger" />{t("legendHub")}</span><span><i className="legend-safe" />{t("legendOutgoing")}</span><span><i className="legend-shared" />{t("shared")}</span></div>
    {selected && <div className="node-detail"><strong>{selected.label}</strong><span>{t("incoming")}: <b className="tabular-nums">{selected.in_degree}</b></span><span>{t("outgoing")}: <b className="tabular-nums">{selected.out_degree}</b></span><span>{t("device")}: <code>{selected.device_id || "—"}</code></span></div>}
  </>;
}
export default function NetworkGraph({ graph, streaming = false }: { graph: Graph; streaming?: boolean }) {
  return <ReactFlowProvider key={`${graph.center}:${graph.depth}`}><Canvas graph={graph} streaming={streaming} /></ReactFlowProvider>;
}
