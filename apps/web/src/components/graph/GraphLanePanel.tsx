import { Minus, Pencil, Plus, Save, X } from 'lucide-react';
import type { ScreenController } from '../../lib/use-screen-page.js';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { I18nContextValue } from '../../lib/i18n/index.js';

interface GraphLanePanelProps {
  t: I18nContextValue['t'];
  activeLane: ScreenRow | undefined;
  onClose: () => void;
  laneRows: ScreenRow[];
  onSelectLane: (id: string) => void;
  showOutside: boolean;
  onToggleShowOutside: (checked: boolean) => void;
  screen: ScreenController | undefined;
  onEditLane: () => void;
  onSaveCurrentLane: () => void;
  laneMembers: Set<string>;
  visibleSelected: string[];
  onChangeMembership: (add: boolean) => void;
}

/** The lane picker and per-lane actions (edit, save layout, membership) shown when the lane panel is open. */
export function GraphLanePanel({ t, activeLane, onClose, laneRows, onSelectLane, showOutside, onToggleShowOutside, screen, onEditLane, onSaveCurrentLane, laneMembers, visibleSelected, onChangeMembership }: GraphLanePanelProps) {
  return (
    <section className='graph-lane-panel' aria-label={t('graph.chooseLane')}>
      <header>
        <strong>{activeLane?.name || t('graph.lanes')}</strong>
        <button aria-label={t(activeLane ? 'graph.minimizeLane' : 'common.close')} title={t(activeLane ? 'graph.minimizeLane' : 'common.close')} onClick={onClose}>{activeLane ? <Minus size={16} /> : <X size={16} />}</button>
      </header>
      <select aria-label={t('graph.chooseLane')} value={activeLane?.id || ''} onChange={event => onSelectLane(event.target.value)}>
        <option value=''>{t('graph.allLanes')}</option>
        {laneRows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select>
      {activeLane && (
        <>
          <label>
            <input type='checkbox' checked={showOutside} onChange={event => onToggleShowOutside(event.target.checked)} />
            {t('graph.showOutsideLane')}
          </label>
          {showOutside && <p>{t('graph.outsideLaneHint')}</p>}
          <button className='ui-button' disabled={!screen?.writable} title={t('screen.editRow')} onClick={onEditLane}>
            <Pencil size={14} />
            {t('screen.editRow')}
          </button>
          <button className='ui-button graph-save-lane' disabled={!screen?.writable || screen.saving || Boolean(screen.error)} title={t('graph.saveLayoutHint')} onClick={onSaveCurrentLane}>
            <Save size={14} />
            {t(screen?.saving ? 'editor.saving' : 'graph.saveCurrentLane')}
          </button>
          <p className='graph-save-hint'>{t('graph.saveLayoutHint')}</p>
          {activeLane.kind === 'custom'
            ? (
              <div className='graph-lane-membership'>
                <button className='ui-button' disabled={!screen?.writable || !visibleSelected.some(path => !laneMembers.has(path))} onClick={() => onChangeMembership(true)}>
                  <Plus size={14} />
                  {t('graph.addToLane')}
                </button>
                <button className='ui-button' disabled={!screen?.writable || !visibleSelected.some(path => laneMembers.has(path))} onClick={() => onChangeMembership(false)}>
                  <Minus size={14} />
                  {t('graph.removeFromLane')}
                </button>
              </div>
            )
            : <p>{t('graph.dynamicLaneHint')}</p>}
        </>
      )}
      {screen?.error && <p role='alert'>{screen.error}</p>}
    </section>
  );
}
