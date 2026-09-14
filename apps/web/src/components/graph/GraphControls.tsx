import type { ReactNode, RefObject } from 'react';
import { RotateCcw, Eye, EyeOff } from 'lucide-react';
import { Select } from '../Select.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { GRAPH_COLOR_MODES, GRAPH_PALETTES, type GraphAppearance } from '../../lib/graph-colors.js';

interface GraphControlsProps {
  controlsRef: RefObject<HTMLDivElement>;
  filterPanel: ReactNode; matchingCount: number;
  appearance: GraphAppearance; onAppearanceChange: (appearance: GraphAppearance) => void;
  visibleColorGroups: { key: string; label: string; color: string }[]; appearanceSaveError: boolean;
  showOrphans: boolean; onToggleOrphans: () => void; onReset: () => void;
  nodeCount: number; linkCount: number;
}

export function GraphControls({ controlsRef, filterPanel, matchingCount, appearance, onAppearanceChange, visibleColorGroups, appearanceSaveError, showOrphans, onToggleOrphans, onReset, nodeCount, linkCount }: GraphControlsProps) {
  const { t } = useTranslation();
  return (
      <div ref={controlsRef} className="absolute top-3 left-3 right-3 z-40 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md">{filterPanel}</div>
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto bg-white/80 dark:bg-slate-900/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs">
          {/* Toggle Unlinked */}
          <details className="relative">
            <summary className="cursor-pointer rounded-md px-2.5 py-1 text-slate-600 dark:text-slate-300">{t('graph.appearance')}</summary>
            <div className="absolute right-0 top-full mt-2 max-h-[50dvh] overflow-y-auto w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <label className="mb-1 block text-slate-500">{t('graph.colorBy')}</label>
              <Select aria-label={t('graph.colorBy')} value={appearance.mode} onValueChange={mode => onAppearanceChange({ ...appearance, mode: mode as GraphAppearance['mode'] })} options={GRAPH_COLOR_MODES.map(mode => ({ value: mode, label: t(`graph.color.${mode}`) }))} className="mb-3 w-full" />
              <label className="mb-1 block text-slate-500">{t('graph.palette')}</label>
              <Select aria-label={t('graph.palette')} value={appearance.palette} onValueChange={palette => onAppearanceChange({ ...appearance, palette: palette as GraphAppearance['palette'] })} options={GRAPH_PALETTES.map(palette => ({ value: palette, label: t(`graph.palette.${palette}`) }))} className="mb-3 w-full" />
              <p className="mb-2 text-[11px] text-slate-400">{t('graph.appearanceHint')}</p>
              <ul aria-label={t('graph.legend')} className="max-h-40 space-y-2 overflow-y-auto border-t border-slate-100 pt-2 dark:border-slate-800">
                {visibleColorGroups.map(group => <li key={group.key} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} /><span className="break-words text-slate-600 dark:text-slate-300">{group.label || t('editor.noStatus')}</span></li>)}
              </ul>
              {appearanceSaveError && <p role="status" className="mt-2 text-amber-600">{t('graph.appearanceSaveError')}</p>}
            </div>
          </details>
          <button
            type="button"
            onClick={onToggleOrphans}
            title={t('graph.showOrphans')}
            aria-pressed={showOrphans}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
              showOrphans
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-medium'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {showOrphans ? <Eye size={13} /> : <EyeOff size={13} />}
            <span>{t('graph.showOrphans')}</span>
          </button>

          {/* Reset Zoom */}
          <button
            type="button"
            onClick={onReset}
            title={t('graph.resetZoom')}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 transition"
          >
            <RotateCcw size={13} />
            <span>{t('graph.resetZoom')}</span>
          </button>
        </div>

        {/* Stats Pill */}
        <div className="pointer-events-auto bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs text-slate-500 dark:text-slate-400 flex items-center gap-3">
          <span data-filter-results={matchingCount}>{t('filters.results', { count: matchingCount })}</span>
          <span data-graph-nodes={nodeCount}>{t('filters.graphTotal', { count: nodeCount })}</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          <span>
            <strong className="text-slate-800 dark:text-slate-200">{linkCount}</strong> {t('graph.links')}
          </span>
        </div>
      </div>

  );
}
