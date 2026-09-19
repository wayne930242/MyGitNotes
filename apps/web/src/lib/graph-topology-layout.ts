import type { GraphLayout } from '@mygitnotes/core/screen-page';
import type { NoteGraphLink } from '@mygitnotes/core/note-graph';
import { arrangeGraphLayout } from './graph-layout.js';
import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import forceAtlas2 from 'graphology-layout-forceatlas2';

type Node = GraphLayout['nodes'][number];
type Edge = [number, number];
const endpoint = (value: string | { id: string; }) => typeof value === 'string' ? value : value.id;
const dimensions = (n: Node) => n.expanded ? [n.width || 360, n.height || 300] : [32, 32];
const overlaps = (a: Node, b: Node) => {
  const [aw, ah] = dimensions(a), [bw, bh] = dimensions(b);
  return Math.abs(a.x - b.x) < (aw + bw) / 2 + 23.5 && Math.abs(a.y - b.y) < (ah + bh) / 2 + 23.5;
};
const turn = (a: Node, b: Node, c: Node) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function crosses(nodes: Node[], [a, b]: Edge, [c, d]: Edge) {
  if (a === c || a === d || b === c || b === d) return false;
  return turn(nodes[a], nodes[b], nodes[c]) * turn(nodes[a], nodes[b], nodes[d]) < 0 && turn(nodes[c], nodes[d], nodes[a]) * turn(nodes[c], nodes[d], nodes[b]) < 0;
}

// A bounded local search: swaps within a community preserve its footprint.
// Only accept fewer crossings, no collisions, and at most 10% more edge length.
function untangle(nodes: Node[], edges: Edge[], communities: Record<string, number>) {
  let budget = 250_000;
  const count = () => {
    let total = 0;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        if (--budget < 0) return Infinity;
        if (crosses(nodes, edges[i], edges[j])) total++;
      }
    }
    return total;
  };
  const length = () => edges.reduce((sum, [a, b]) => sum + Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y), 0);
  let best = count();
  const lengthLimit = length() * 1.1;
  if (!Number.isFinite(best) || !best) return;
  for (let pass = 0; pass < 3 && budget > 0; pass++) {
    let improved = false;
    for (let i = 0; i < nodes.length && budget > 0; i++) {
      for (let j = i + 1; j < nodes.length && budget > 0; j++) {
        budget--;
        const a = nodes[i], b = nodes[j];
        if (a.pinned || b.pinned || communities[a.path] !== communities[b.path]) continue;
        [a.x, b.x] = [b.x, a.x];
        [a.y, b.y] = [b.y, a.y];
        const collision = nodes.some((n, k) => (k !== i && overlaps(a, n)) || (k !== j && overlaps(b, n)));
        const score = collision ? Infinity : count(), candidateLength = length();
        if (score < best && candidateLength <= lengthLimit) {
          best = score;
          improved = true;
        } else {
          [a.x, b.x] = [b.x, a.x];
          [a.y, b.y] = [b.y, a.y];
        }
        if (!best) return;
      }
    }
    if (!improved) break;
  }
}

/** Explicit rearrangement only; ordinary card expansion keeps the existing map. */
export function optimizeGraphLayout(layout: GraphLayout, links: NoteGraphLink[]): GraphLayout {
  if (layout.nodes.length < 2) return { nodes: layout.nodes.map(n => ({ ...n })) };
  const sorted = [...layout.nodes].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const graph = new UndirectedGraph();
  sorted.forEach(n => graph.addNode(n.path));
  // The renderer mutates endpoints into node objects. Build a separate graph,
  // ignore filtered endpoints and treat reciprocal links as one relationship.
  const pairs = links.map(l => [endpoint(l.source), endpoint(l.target)].sort()).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  for (const [a, b] of pairs) if (a !== b && graph.hasNode(a) && graph.hasNode(b) && !graph.hasEdge(a, b)) graph.addEdge(a, b);
  if (!graph.size) return arrangeGraphLayout(layout, { compact: true });
  const communities = louvain(graph, { randomWalk: false });
  const groups = new Map<number, Node[]>();
  for (const n of sorted) {
    const key = communities[n.path];
    const group = groups.get(key) || [];
    group.push(n);
    groups.set(key, group);
  }
  const coarse = new UndirectedGraph();
  const groupLayouts = new Map<string, GraphLayout>();
  const center = { x: sorted.reduce((s, n) => s + n.x, 0) / sorted.length, y: sorted.reduce((s, n) => s + n.y, 0) / sorted.length };
  for (const [key, members] of groups) {
    const id = String(key), local = new UndirectedGraph(), pinned = members.filter(n => n.pinned);
    const anchor = pinned.length ? { x: pinned.reduce((s, n) => s + n.x, 0) / pinned.length, y: pinned.reduce((s, n) => s + n.y, 0) / pinned.length } : center;
    members.forEach((n, i) => {
      const angle = i * 2.399963229728653, radius = 40 * Math.sqrt(i + 1);
      local.addNode(n.path, { x: n.pinned ? n.x - anchor.x : Math.cos(angle) * radius, y: n.pinned ? n.y - anchor.y : Math.sin(angle) * radius, fixed: !!n.pinned });
    });
    graph.forEachEdge((_edge, _attributes, a, b) => {
      if (local.hasNode(a) && local.hasNode(b)) local.addEdge(a, b);
    });
    if (local.size) forceAtlas2.assign(local, { iterations: 160, settings: { linLogMode: true, gravity: .1, scalingRatio: 12, slowDown: 2, barnesHutOptimize: local.order > 100 } });
    const arranged = arrangeGraphLayout({ nodes: members.map(n => ({ ...n, x: local.getNodeAttribute(n.path, 'x'), y: local.getNodeAttribute(n.path, 'y') })) });
    groupLayouts.set(id, arranged);
    const angle = key * 2.399963229728653;
    coarse.addNode(id, { x: pinned.length ? anchor.x : center.x + Math.cos(angle) * 200, y: pinned.length ? anchor.y : center.y + Math.sin(angle) * 200, fixed: !!pinned.length });
  }
  graph.forEachEdge((_e, _attr, a, b) => {
    const ca = String(communities[a]), cb = String(communities[b]);
    if (ca === cb) return;
    if (coarse.hasEdge(ca, cb)) coarse.updateEdgeAttribute(ca, cb, 'weight', value => value + 1);
    else coarse.addEdge(ca, cb, { weight: 1 });
  });
  if (coarse.order > 1) forceAtlas2.assign(coarse, { iterations: 120, settings: { linLogMode: true, gravity: .05, scalingRatio: 50, barnesHutOptimize: coarse.order > 100 } });
  // Reserve each group's full rectangular footprint, including expanded cards.
  const boxes = arrangeGraphLayout({
    nodes: coarse.nodes().map(path => {
      const local = groupLayouts.get(path)!.nodes;
      const width = Math.max(...local.map(n => Math.abs(n.x) + dimensions(n)[0] / 2)) * 2 + 80;
      const height = Math.max(...local.map(n => Math.abs(n.y) + dimensions(n)[1] / 2)) * 2 + 80;
      return { path, x: coarse.getNodeAttribute(path, 'x'), y: coarse.getNodeAttribute(path, 'y'), width, height, expanded: true, pinned: coarse.getNodeAttribute(path, 'fixed') };
    }),
  });
  const positions = new Map<string, Node>();
  for (const box of boxes.nodes) for (const node of groupLayouts.get(box.path)!.nodes) positions.set(node.path, { ...node, x: node.x + box.x, y: node.y + box.y });
  const result = arrangeGraphLayout({ nodes: layout.nodes.map(n => n.pinned ? { ...n } : positions.get(n.path)!) });
  const indices = new Map(result.nodes.map((n, i) => [n.path, i]));
  const edges: Edge[] = [];
  graph.forEachEdge((_e, _a, a, b) => edges.push([indices.get(a)!, indices.get(b)!]));
  untangle(result.nodes, edges, communities);
  return result;
}
