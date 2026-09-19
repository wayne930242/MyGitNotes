import './graph-controls.css';
import type { ReactNode, RefObject } from 'react';
import { RotateCcw, Eye, EyeOff } from 'lucide-react';
import { Select } from '../Select.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { GRAPH_COLOR_MODES, GRAPH_PALETTES, type GraphAppearance } from '../../lib/graph-colors.js';

interface GraphControlsProps {
  controlsRef: RefObject<HTMLDivElement>;
  filterPanel: ReactNode;
  appearance: GraphAppearance; onAppearanceChange: (appearance: GraphAppearance) => void;
  visibleColorGroups: { key: string; label: string; color: string }[]; appearanceSaveError: boolean;
  showOrphans?: boolean; onToggleOrphans?: () => void; onReset?: () => void;
}

export function GraphControls({ controlsRef, filterPanel, appearance, onAppearanceChange, visibleColorGroups, appearanceSaveError, showOrphans, onToggleOrphans, onReset }: GraphControlsProps) {
  const { t } = useTranslation();
  return (
      <div ref={controlsRef} className="graph-controls">
        <div className="graph-filter-slot">{filterPanel}</div>
        <details className="graph-appearance">
            <summary className="cursor-pointer rounded-md px-2.5 py-1 text-muted">{t('graph.appearance')}</summary>
            <div className="absolute right-0 top-full mt-2 max-h-[50dvh] overflow-y-auto w-64 rounded-xl border border-line bg-surface p-3 shadow-lg">
              <label className="mb-1 block text-muted">{t('graph.colorBy')}</label>
              <Select aria-label={t('graph.colorBy')} value={appearance.mode} onValueChange={mode => onAppearanceChange({ ...appearance, mode: mode as GraphAppearance['mode'] })} options={GRAPH_COLOR_MODES.map(mode => ({ value: mode, label: t(`graph.color.${mode}`) }))} className="mb-3 w-full" />
              <label className="mb-1 block text-muted">{t('graph.palette')}</label>
              <Select aria-label={t('graph.palette')} value={appearance.palette} onValueChange={palette => onAppearanceChange({ ...appearance, palette: palette as GraphAppearance['palette'] })} options={GRAPH_PALETTES.map(palette => ({ value: palette, label: t(`graph.palette.${palette}`) }))} className="mb-3 w-full" />
              <p className="mb-2 text-[11px] text-muted">{t('graph.appearanceHint')}</p>
              <ul aria-label={t('graph.legend')} className="max-h-40 space-y-2 overflow-y-auto border-t border-line pt-2">
                {visibleColorGroups.map(group => <li key={group.key} className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} /><span className="break-words text-muted">{group.label || t('editor.noStatus')}</span></li>)}
              </ul>
              {appearanceSaveError && <p role="status" className="mt-2 text-warning">{t('graph.appearanceSaveError')}</p>}
            </div>
        </details>
        {onToggleOrphans && <div className="graph-view-actions">
          <button
            type="button"
            onClick={onToggleOrphans}
            title={t('graph.showOrphans')}
            aria-pressed={showOrphans}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition ${
              showOrphans
                ? 'bg-primary-soft text-primary font-medium'
                : 'text-muted hover:text-fg'
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
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition"
          >
            <RotateCcw size={13} />
            <span>{t('graph.resetZoom')}</span>
          </button>
        </div>}

      </div>

  );
}
