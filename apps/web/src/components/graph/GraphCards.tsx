import { PanelTopOpen } from 'lucide-react';
import { GraphNoteCard } from './GraphNoteCard.js';
import type { useGraphController } from './useGraphController.js';
export function GraphCards({ model }: { model: ReturnType<typeof useGraphController>; }) {
  const { t, laneIds, showOutside, closing, hoverTimer, transform, selected, layout, maximized, setMaximized, setHover, sessions, updateSession, editorRef, carets, link, laneMembers, expanded, graphData, nodeColor, finishClosing, setExpanded, select, drag, startLink, hoveredNode } = model;

  return (
    <>
      {graphData.nodes.filter(node => expanded.has(node.id) || closing.has(node.id)).map(node => {
        const card = layout.nodes.find(n => n.path === node.id)!;
        const large = maximized === node.id, w = card.width || 360, h = card.height || 300;
        return (
          <div
            key={node.id}
            onAnimationEnd={event => {
              if (event.animationName === 'graph-note-exit' && closing.has(node.id) && (event.target as HTMLElement).classList.contains('graph-note-card')) finishClosing(node.id);
            }}
            className={`graph-card-position ${closing.has(node.id) ? 'is-closing' : ''} ${large ? 'is-maximized' : ''} ${showOutside && laneIds.length && !laneMembers.has(node.id) ? 'is-outside-lane' : ''}`}
            style={large ? { inset: 8, zIndex: 80 } : { left: (node.x || 0) * transform.k + transform.x - w * transform.k / 2, top: (node.y || 0) * transform.k + transform.y - h * transform.k / 2, width: w, height: h, transform: `scale(${transform.k})`, zIndex: selected.includes(node.id) ? 24 : 20 }}
          >
            <GraphNoteCard node={node} color={nodeColor(node)} session={sessions.get(node.id)} editorRef={editorRef(node.id)} onSession={session => updateSession(node.id, session)} selected={selected.includes(node.id)} maximized={large} onSelect={event => select(node.id, event)} onCaret={position => carets.current.set(node.id, position)} onMove={event => drag(event, node.id, 'move')} onResize={event => drag(event, node.id, 'resize')} onConnect={event => startLink(event, node.id)} onLink={target => link(node.id, target)} onCollapse={() => void setExpanded([node.id], false)} onMaximize={() => setMaximized(large ? null : node.id)} />
          </div>
        );
      })}
      {hoveredNode && (
        <button
          className='ui-button graph-hover-expand'
          style={{ left: (hoveredNode.x || 0) * transform.k + transform.x + 14, top: (hoveredNode.y || 0) * transform.k + transform.y - 14 }}
          title={t('graph.expandEnter')}
          aria-label={`${t('graph.expand')}: ${hoveredNode.title}`}
          onMouseEnter={() => clearTimeout(hoverTimer.current)}
          onMouseLeave={() => setHover(null)}
          onClick={() => {
            setExpanded([hoveredNode.id], true);
            setHover(null);
          }}
        >
          <PanelTopOpen size={16} />
        </button>
      )}
    </>
  );
}
