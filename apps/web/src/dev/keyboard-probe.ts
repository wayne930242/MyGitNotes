/**
 * Phase 0 keyboard probe (docs/specs/2026-10-10-keyboard-navigation/design.md, "Phase 0").
 * Development only: served by Vite from keyboard-probe.html, which production builds never include.
 *
 * Modes:
 * - auto (`?collector=<url>&session=<id>`): scripts/qa-keyboard-probe.mjs arms trials through a long poll and
 *   injects OS-level keys; the page reports every trial with navigator.sendBeacon.
 * - guide (`#mode=guide`): a person walks through each (context, chord) step and copies the result JSON.
 * - ime (`#mode=ime`): a person types with 注音 / 拼音 and the page logs the event order per step.
 * - free (`#mode=free&context=<id>`): live event log only.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

const PROBE_VERSION = 1;
const MAC = /mac|iphone|ipad/i.test((navigator as Navigator & { userAgentData?: { platform?: string; }; }).userAgentData?.platform || navigator.platform);
const FOCUS_WATCH_MS = 800;
const POLL_MS = 50;

const CONTEXTS = ['body', 'input', 'textarea', 'contenteditable', 'codemirror'] as const;
type ContextId = (typeof CONTEXTS)[number];
type Variant = 'fresh' | 'address-bar' | 'normal';
type Mode = 'auto' | 'guide' | 'ime' | 'free';

const CONTEXT_NAMES: Record<ContextId, string> = { body: '頁面本體（page body）', input: '<input>', textarea: '<textarea>', contenteditable: 'contenteditable', codemirror: 'CodeMirror 6' };
const TEXT_CONTEXTS: readonly ContextId[] = ['input', 'textarea', 'contenteditable'];

interface Chord {
  id: string;
  code: string;
  /** The lower-case `key` accepted when a browser reports no `code`. */
  key: string;
  mod: boolean;
  shift: boolean;
  /** Controls: Mod+T must fail; everything else is expected to pass. */
  expect: 'pass' | 'fail';
  /** Contexts the automated driver covers. */
  contexts: readonly ContextId[];
  /** Contexts the manual guide covers, kept short enough for about five minutes per browser. */
  guide: readonly ContextId[];
}

const BODY_AND_EDITOR: readonly ContextId[] = ['body', 'codemirror'];
const CHORDS: readonly Chord[] = [{ id: 'mod+k', code: 'KeyK', key: 'k', mod: true, shift: false, expect: 'pass', contexts: CONTEXTS, guide: CONTEXTS }, { id: 'mod+p', code: 'KeyP', key: 'p', mod: true, shift: false, expect: 'pass', contexts: CONTEXTS, guide: CONTEXTS }, { id: 'mod+shift+p', code: 'KeyP', key: 'p', mod: true, shift: true, expect: 'pass', contexts: CONTEXTS, guide: CONTEXTS }, { id: 'mod+shift+f', code: 'KeyF', key: 'f', mod: true, shift: true, expect: 'pass', contexts: CONTEXTS, guide: CONTEXTS }, { id: 'mod+/', code: 'Slash', key: '/', mod: true, shift: false, expect: 'pass', contexts: CONTEXTS, guide: CONTEXTS }, { id: 'mod+f', code: 'KeyF', key: 'f', mod: true, shift: false, expect: 'pass', contexts: ['codemirror'], guide: ['codemirror'] }, { id: 'mod+g', code: 'KeyG', key: 'g', mod: true, shift: false, expect: 'pass', contexts: CONTEXTS, guide: BODY_AND_EDITOR }, { id: 'f1', code: 'F1', key: 'f1', mod: false, shift: false, expect: 'pass', contexts: CONTEXTS, guide: CONTEXTS }, { id: 'f6', code: 'F6', key: 'f6', mod: false, shift: false, expect: 'pass', contexts: CONTEXTS, guide: CONTEXTS }, { id: 'shift+f6', code: 'F6', key: 'f6', mod: false, shift: true, expect: 'pass', contexts: CONTEXTS, guide: BODY_AND_EDITOR }, { id: 'mod+f6', code: 'F6', key: 'f6', mod: true, shift: false, expect: 'pass', contexts: CONTEXTS, guide: BODY_AND_EDITOR }, { id: 'mod+shift+e', code: 'KeyE', key: 'e', mod: true, shift: true, expect: 'pass', contexts: CONTEXTS, guide: BODY_AND_EDITOR }, { id: 'mod+enter', code: 'Enter', key: 'enter', mod: true, shift: false, expect: 'pass', contexts: CONTEXTS, guide: BODY_AND_EDITOR }, { id: 'mod+t', code: 'KeyT', key: 't', mod: true, shift: false, expect: 'fail', contexts: BODY_AND_EDITOR, guide: ['body'] }, { id: '?', code: 'Slash', key: '?', mod: false, shift: true, expect: 'pass', contexts: ['body'], guide: ['body'] }];
const chordById = new Map(CHORDS.map(chord => [chord.id, chord]));
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'OS', 'Hyper', 'Super', 'CapsLock', 'Fn']);

function chordLabel(chord: Chord): string {
  if (chord.id === '?') return '?（Shift+/）';
  const keyName = chord.code.startsWith('Key') ? chord.code.slice(3) : chord.code === 'Slash' ? '/' : chord.code === 'Enter' ? (MAC ? '↩' : 'Enter') : chord.code;
  if (MAC) return `${chord.mod ? '⌘' : ''}${chord.shift ? '⇧' : ''}${keyName}`;
  return [chord.mod ? 'Ctrl' : '', chord.shift ? 'Shift' : '', keyName].filter(Boolean).join('+');
}

function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  const primary = MAC ? event.metaKey : event.ctrlKey;
  const other = MAC ? event.ctrlKey : event.metaKey;
  const keyMatches = event.code ? event.code === chord.code : event.key.toLowerCase() === chord.key;
  return keyMatches && primary === chord.mod && !other && event.shiftKey === chord.shift && !event.altKey;
}

// ---------------------------------------------------------------------------------------------------------------------
// Event log

interface LoggedEvent {
  t: number;
  type: string;
  key?: string;
  code?: string;
  keyCode?: number;
  mods?: string;
  isComposing?: boolean;
  repeat?: boolean;
  cancelable?: boolean;
  defaultPrevented?: boolean;
  candidate?: string;
  /** design.md `trackComposition`: composing per the rule at dispatch time. */
  ruleComposing?: boolean;
  /** The same rule without the setTimeout(0) clear, 100 ms window only. */
  windowComposing?: boolean;
  data?: string | null;
  inputType?: string;
  target?: string;
  visibility?: string;
}

const origin = performance.now();
const now = () => Math.round((performance.now() - origin) * 10) / 10;
let listeners: ((event: LoggedEvent) => void)[] = [];

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return target === window ? 'window' : target === document ? 'document' : '';
  const context = target.closest('[data-context]')?.getAttribute('data-context');
  return `${target.tagName.toLowerCase()}${context ? `@${context}` : ''}`;
}

function modifiers(event: KeyboardEvent): string {
  return [event.metaKey && 'meta', event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift'].filter(Boolean).join('+');
}

function emit(record: LoggedEvent) {
  for (const listener of listeners) listener(record);
}

// Design rule from ime.ts: composing = isComposing || keyCode 229 || justEnded (set on compositionend, cleared by
// setTimeout(0), expiring after 100 ms).
let justEnded = false;
let compositionEndedAt = -Infinity;

document.addEventListener('compositionstart', event => emit({ t: now(), type: 'compositionstart', data: event.data, target: describeTarget(event.target) }), { capture: true });
document.addEventListener('compositionupdate', event => emit({ t: now(), type: 'compositionupdate', data: event.data, target: describeTarget(event.target) }), { capture: true });
document.addEventListener('compositionend', event => {
  justEnded = true;
  compositionEndedAt = performance.now();
  setTimeout(() => {
    justEnded = false;
  }, 0);
  emit({ t: now(), type: 'compositionend', data: event.data, target: describeTarget(event.target) });
}, { capture: true });
document.addEventListener('beforeinput', event => emit({ t: now(), type: 'beforeinput', data: event.data, inputType: event.inputType, isComposing: event.isComposing, target: describeTarget(event.target) }), { capture: true });
document.addEventListener('input', event => {
  if (event instanceof InputEvent) emit({ t: now(), type: 'input', data: event.data, inputType: event.inputType, isComposing: event.isComposing, target: describeTarget(event.target) });
}, { capture: true });

window.addEventListener('keydown', event => {
  const withinWindow = performance.now() - compositionEndedAt < 100;
  const ruleComposing = event.isComposing || event.keyCode === 229 || (justEnded && withinWindow);
  const windowComposing = event.isComposing || event.keyCode === 229 || withinWindow;
  const candidate = CHORDS.find(chord => matchesChord(event, chord) && chord.contexts.includes(activeContext));
  if (candidate) {
    event.preventDefault();
    event.stopPropagation();
  }
  emit({ t: now(), type: 'keydown', key: event.key, code: event.code, keyCode: event.keyCode, mods: modifiers(event), isComposing: event.isComposing, repeat: event.repeat, cancelable: event.cancelable, defaultPrevented: event.defaultPrevented, candidate: candidate?.id, ruleComposing, windowComposing, target: describeTarget(event.target) });
}, { capture: true });
window.addEventListener('keyup', event => emit({ t: now(), type: 'keyup', key: event.key, code: event.code, keyCode: event.keyCode, mods: modifiers(event), isComposing: event.isComposing, target: describeTarget(event.target) }), { capture: true });
window.addEventListener('blur', event => {
  if (event.target === window) emit({ t: now(), type: 'blur', target: 'window' });
});
window.addEventListener('focus', event => {
  if (event.target === window) emit({ t: now(), type: 'focus', target: 'window' });
});
document.addEventListener('visibilitychange', () => emit({ t: now(), type: 'visibilitychange', visibility: document.visibilityState }));
window.addEventListener('beforeprint', () => emit({ t: now(), type: 'beforeprint' }));
window.addEventListener('afterprint', () => emit({ t: now(), type: 'afterprint' }));
window.addEventListener('resize', () => emit({ t: now(), type: 'resize', data: `${innerWidth}x${innerHeight}` }));

// ---------------------------------------------------------------------------------------------------------------------
// Contexts

let activeContext: ContextId = 'body';
const contextHost = document.getElementById('probe-contexts')!;
const wrappers = new Map<ContextId, HTMLElement>();
const targets = new Map<ContextId, HTMLElement>();
let editor: EditorView | null = null;

function buildContexts() {
  for (const id of CONTEXTS) {
    const wrapper = document.createElement('section');
    wrapper.className = 'probe-context';
    wrapper.dataset.context = id;
    const title = document.createElement('h2');
    title.textContent = CONTEXT_NAMES[id];
    wrapper.append(title);
    let target: HTMLElement;
    if (id === 'body') {
      target = document.createElement('div');
      target.className = 'probe-pad';
      target.textContent = '點這裡讓焦點回到頁面本體';
    } else if (id === 'input') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'input 欄位';
      input.setAttribute('aria-label', 'probe input');
      target = input;
    } else if (id === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.value = 'textarea 欄位';
      textarea.setAttribute('aria-label', 'probe textarea');
      target = textarea;
    } else if (id === 'contenteditable') {
      target = document.createElement('div');
      target.className = 'probe-editable';
      target.contentEditable = 'true';
      target.textContent = 'contenteditable 區塊';
      target.setAttribute('aria-label', 'probe contenteditable');
    } else {
      target = document.createElement('div');
      target.className = 'probe-codemirror';
      editor = new EditorView({ parent: target, state: EditorState.create({ doc: '# CodeMirror 6\n\n在這裡打字或按鍵。\n', extensions: [markdown(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping] }) });
    }
    wrapper.append(target);
    wrapper.addEventListener('mousedown', () => setActiveContext(id, false));
    contextHost.append(wrapper);
    wrappers.set(id, wrapper);
    targets.set(id, target);
  }
}

function setActiveContext(id: ContextId, focus: boolean) {
  activeContext = id;
  for (const [contextId, wrapper] of wrappers) wrapper.dataset.active = String(contextId === id);
  if (!focus) return;
  if (id === 'body') {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  } else if (id === 'codemirror') editor?.focus();
  else {
    const target = targets.get(id)!;
    target.focus();
    if (id === 'contenteditable') {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  }
}

function contextFocused(): boolean {
  if (activeContext === 'body') return document.activeElement === document.body || document.activeElement === null;
  if (activeContext === 'codemirror') return editor?.hasFocus ?? false;
  return document.activeElement === targets.get(activeContext);
}

function snapshot() {
  const rect = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  };
  return { hasFocus: document.hasFocus(), visibility: document.visibilityState, context: activeContext, contextFocused: contextFocused(), activeElement: describeTarget(document.activeElement), geometry: { screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight, devicePixelRatio, target: rect(targets.get(activeContext)!), pad: rect(targets.get('body')!) } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Trials

interface TrialSpec {
  id: string;
  chord: string;
  context: ContextId;
  variant: Variant;
}

interface TrialResult {
  spec: TrialSpec;
  label: string;
  expect: 'pass' | 'fail';
  pagePass: boolean;
  reasons: string[];
  matched: number;
  otherKeydowns: number;
  key: string | null;
  code: string | null;
  defaultPrevented: boolean | null;
  cancelable: boolean | null;
  hasFocusAtArm: boolean;
  contextFocusedAtArm: boolean;
  firstKeydownMs: number | null;
  events: LoggedEvent[];
}

interface TrialOptions {
  /** Finalize without a keydown after this long; null waits for the person (guide mode). */
  noKeyTimeoutMs: number | null;
  onDone: (result: TrialResult) => void;
}

class Trial {
  readonly events: LoggedEvent[] = [];
  private readonly armedAt = performance.now();
  private readonly hasFocusAtArm = document.hasFocus();
  private readonly contextFocusedAtArm = contextFocused();
  private firstMatchAt: number | null = null;
  private focusLost = false;
  private lostAndReturnedAt: number | null = null;
  private readonly timer: number;
  private done = false;
  private readonly listener = (event: LoggedEvent) => this.record(event);

  constructor(readonly spec: TrialSpec, private readonly options: TrialOptions) {
    listeners.push(this.listener);
    this.timer = window.setInterval(() => this.tick(), POLL_MS);
  }

  private record(event: LoggedEvent) {
    this.events.push(event);
    const chord = chordById.get(this.spec.chord)!;
    if (event.type === 'keydown' && event.candidate === chord.id && this.firstMatchAt === null) this.firstMatchAt = performance.now();
    if (event.type === 'focus' && this.focusLost) this.lostAndReturnedAt = performance.now();
  }

  private tick() {
    if (!document.hasFocus()) {
      if (!this.focusLost) this.events.push({ t: now(), type: 'hasFocus=false' });
      this.focusLost = true;
      this.lostAndReturnedAt = null;
    } else if (this.focusLost && this.lostAndReturnedAt === null) this.lostAndReturnedAt = performance.now();
    const at = performance.now();
    if (this.firstMatchAt !== null && at - this.firstMatchAt >= FOCUS_WATCH_MS) this.finish();
    else if (this.firstMatchAt === null && this.options.noKeyTimeoutMs !== null && at - this.armedAt >= this.options.noKeyTimeoutMs) this.finish();
    else if (this.firstMatchAt === null && this.options.noKeyTimeoutMs === null && this.lostAndReturnedAt !== null && at - this.lostAndReturnedAt >= 300) this.finish();
  }

  get keyArrived(): boolean {
    return this.firstMatchAt !== null;
  }

  cancel() {
    if (this.done) return;
    this.done = true;
    window.clearInterval(this.timer);
    listeners = listeners.filter(listener => listener !== this.listener);
  }

  finish() {
    if (this.done) return;
    this.cancel();
    this.options.onDone(this.result());
  }

  private result(): TrialResult {
    const chord = chordById.get(this.spec.chord)!;
    const keydowns = this.events.filter(event => event.type === 'keydown' && !MODIFIER_KEYS.has(event.key ?? ''));
    const matched = keydowns.filter(event => event.candidate === chord.id);
    const first = matched[0];
    const reasons: string[] = [];
    if (!matched.length) reasons.push('no-keydown');
    if (matched.length > 1) reasons.push('repeated-keydown');
    if (keydowns.length > matched.length) reasons.push('unexpected-keydown');
    if (first && !first.defaultPrevented) reasons.push('not-prevented');
    for (const [type, reason] of [['blur', 'blur'], ['beforeprint', 'beforeprint'], ['resize', 'resize']] as const) {
      if (this.events.some(event => event.type === type)) reasons.push(reason);
    }
    if (this.events.some(event => event.type === 'visibilitychange' && event.visibility === 'hidden')) reasons.push('hidden');
    if (this.focusLost) reasons.push('focus-lost');
    return { spec: this.spec, label: chordLabel(chord), expect: chord.expect, pagePass: reasons.length === 0, reasons, matched: matched.length, otherKeydowns: keydowns.length - matched.length, key: first?.key ?? null, code: first?.code ?? null, defaultPrevented: first ? first.defaultPrevented ?? null : null, cancelable: first ? first.cancelable ?? null : null, hasFocusAtArm: this.hasFocusAtArm, contextFocusedAtArm: this.contextFocusedAtArm, firstKeydownMs: this.firstMatchAt === null ? null : Math.round(this.firstMatchAt - this.armedAt), events: this.events };
  }
}

const REASON_TEXT: Record<string, string> = { 'no-keydown': '頁面沒有收到這個按鍵', 'repeated-keydown': '收到不只一次 keydown', 'unexpected-keydown': '同時收到其他按鍵', 'not-prevented': 'preventDefault 沒有生效', blur: '視窗失去焦點（blur）', beforeprint: '觸發列印（beforeprint）', resize: '頁面大小改變（瀏覽器介面變動）', hidden: '頁面被切到背景（新分頁或視窗）', 'focus-lost': 'document.hasFocus() 變成 false', 'browser-ui': '手動標記：瀏覽器開出了介面' };

// ---------------------------------------------------------------------------------------------------------------------
// Auto mode: the collector arms trials through a long poll; reports go out by sendBeacon.

const params = new URLSearchParams(location.search);
const collector = params.get('collector');
const session = params.get('session') ?? 'default';
let autoTrial: Trial | null = null;

function report(payload: Record<string, unknown>) {
  if (!collector) return;
  navigator.sendBeacon(`${collector}/report?session=${encodeURIComponent(session)}`, JSON.stringify({ ...payload, session, at: Date.now() }));
}

type Command =
  | { seq: number; type: 'arm'; spec: TrialSpec; noKeyTimeoutMs: number; }
  | { seq: number; type: 'state'; context?: ContextId; }
  | { seq: number; type: 'reload'; }
  | { seq: number; type: 'cancel'; }
  /** The driver typed the chord a while ago: a trial still without its keydown ends now. */
  | { seq: number; type: 'deadline'; trialId: string; };

async function handleCommand(command: Command) {
  if (command.type === 'reload') {
    autoTrial?.cancel();
    location.reload();
    return;
  }
  if (command.type === 'deadline') {
    if (autoTrial && autoTrial.spec.id === command.trialId && !autoTrial.keyArrived) autoTrial.finish();
    return;
  }
  if (command.type === 'cancel') {
    autoTrial?.cancel();
    autoTrial = null;
    report({ type: 'cancelled', seq: command.seq });
    return;
  }
  if (command.type === 'state') {
    if (command.context) setActiveContext(command.context, true);
    await nextFrame();
    report({ type: 'state', seq: command.seq, state: snapshot() });
    return;
  }
  autoTrial?.cancel();
  setActiveContext(command.spec.context, true);
  await nextFrame();
  const seq = command.seq;
  autoTrial = new Trial(command.spec, { noKeyTimeoutMs: command.noKeyTimeoutMs, onDone: result => report({ type: 'result', seq, result }) });
  report({ type: 'armed', seq, trialId: command.spec.id, state: snapshot() });
  renderAuto(command.spec);
}

/** One long poll; it schedules the next one, so the page keeps listening for as long as it is open. */
async function pollCollector() {
  const seqKey = `mgn-probe-seq:${session}`;
  const after = Number(sessionStorage.getItem(seqKey) ?? '0');
  try {
    const response = await fetch(`${collector}/next?session=${encodeURIComponent(session)}&after=${after}`, { cache: 'no-store' });
    if (response.status === 200) {
      const command = await response.json() as Command;
      sessionStorage.setItem(seqKey, String(command.seq));
      await handleCommand(command);
    }
  } catch {
    await sleep(250);
  }
  void pollCollector();
}

function renderAuto(spec?: TrialSpec) {
  panel.replaceChildren(heading(`自動模式（session ${session}）`), paragraph(spec ? `trial ${spec.id}: ${chordLabel(chordById.get(spec.chord)!)} @ ${CONTEXT_NAMES[spec.context]}（${spec.variant}）` : '等待 driver…', 'probe-step-hint'));
}

// ---------------------------------------------------------------------------------------------------------------------
// Guide mode (manual chords, e.g. Windows)

interface GuideStepResult {
  step: number;
  chord: string;
  label: string;
  context: ContextId;
  variant: Variant;
  expect: 'pass' | 'fail';
  pagePass: boolean;
  manualBrowserUi: boolean;
  pass: boolean;
  reasons: string[];
  key: string | null;
  code: string | null;
  defaultPrevented: boolean | null;
  events?: string[];
}

interface GuideState {
  browser: string;
  startedAt: string;
  index: number;
  results: (GuideStepResult | null)[];
}

const GUIDE_KEY = 'mgn-probe-guide';
const RESUME_KEY = 'mgn-probe-resume';

function guideSteps(): TrialSpec[] {
  const steps: TrialSpec[] = [];
  const push = (chord: string, context: ContextId, variant: Variant) => steps.push({ id: String(steps.length + 1), chord, context, variant });
  for (const context of CONTEXTS) {
    push('mod+k', context, 'fresh');
    push('mod+k', context, 'address-bar');
    push('mod+k', context, 'normal');
    for (const chord of CHORDS) {
      if (chord.id !== 'mod+k' && chord.id !== 'mod+t' && chord.guide.includes(context)) push(chord.id, context, 'normal');
    }
  }
  push('mod+t', 'body', 'normal');
  return steps;
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  const match = ua.match(/Edg\/([\d.]+)/) ? ['Edge', ua.match(/Edg\/([\d.]+)/)![1]] : ua.match(/Firefox\/([\d.]+)/) ? ['Firefox', ua.match(/Firefox\/([\d.]+)/)![1]] : ua.match(/Chrome\/([\d.]+)/) ? ['Chrome', ua.match(/Chrome\/([\d.]+)/)![1]] : ua.match(/Version\/([\d.]+).*Safari/) ? ['Safari', ua.match(/Version\/([\d.]+)/)![1]] : ['Browser', ''];
  return `${match[0]} ${match[1]} / ${os}`.replace('  ', ' ');
}

function loadGuide(): GuideState | null {
  try {
    return JSON.parse(localStorage.getItem(GUIDE_KEY) ?? 'null') as GuideState | null;
  } catch {
    return null;
  }
}

function saveGuide(state: GuideState) {
  localStorage.setItem(GUIDE_KEY, JSON.stringify(state));
}

let guideTrial: Trial | null = null;
let guideCurrent: GuideStepResult | null = null;

function compactEvents(events: LoggedEvent[]): string[] {
  return events.slice(0, 14).map(event => [event.t, event.type, event.key, event.code, event.mods, event.defaultPrevented ? 'prevented' : '', event.visibility].filter(Boolean).join(' '));
}

function renderGuide() {
  guideTrial?.cancel();
  guideTrial = null;
  const state = loadGuide();
  const steps = guideSteps();
  if (!state) {
    const browser = document.createElement('input');
    browser.value = detectBrowser();
    browser.setAttribute('aria-label', '瀏覽器');
    browser.style.width = '100%';
    panel.replaceChildren(
      heading('按鍵引導檢查'),
      paragraph(`共 ${steps.length} 步，約 5 分鐘。每一步會告訴你要按哪個組合鍵；按完後頁面自己判斷 PASS / FAIL。若瀏覽器開出任何介面（新分頁、列印、網址列、說明頁、側欄），請按「瀏覽器有開出介面」。每個瀏覽器各跑一次。`, 'probe-step-hint'),
      paragraph('瀏覽器（自動偵測，可修改）：'),
      browser,
      actions(button('開始', () => {
        saveGuide({ browser: browser.value.trim() || detectBrowser(), startedAt: new Date().toISOString(), index: 0, results: steps.map(() => null) });
        renderGuide();
      })),
    );
    return;
  }
  if (state.index >= steps.length) {
    renderGuideSummary(state, steps);
    return;
  }
  const spec = steps[state.index];
  const chord = chordById.get(spec.chord)!;
  const label = chordLabel(chord);
  const title = heading(`按 ${label}`, 'probe-step-title');
  const where = paragraph(`位置：${CONTEXT_NAMES[spec.context]}`);
  const hint = paragraph('', 'probe-step-hint');
  const verdict = document.createElement('div');
  verdict.className = 'probe-verdict';
  const log = document.createElement('div');
  log.className = 'probe-log';
  const controls = document.createElement('div');
  controls.className = 'probe-actions';
  const progress = paragraph(`第 ${state.index + 1} / ${steps.length} 步 · ${state.browser}`, 'probe-progress');
  panel.replaceChildren(progress, title, where, hint, verdict, controls, log);
  setActiveContext(spec.context, false);

  const show = (result: GuideStepResult | null) => {
    if (!result) {
      verdict.dataset.verdict = 'waiting';
      verdict.textContent = '等待按鍵…';
      controls.replaceChildren(button('按了，但頁面沒反應（或已回到頁面）', () => guideTrial?.finish()), button('跳過', () => advance(null)));
      return;
    }
    const expectedFail = result.expect === 'fail' && !result.pass;
    verdict.dataset.verdict = expectedFail ? 'expected-fail' : result.pass ? 'pass' : 'fail';
    verdict.textContent = expectedFail ? 'FAIL（這是對照組，預期失敗，正常）' : result.pass ? 'PASS' : `FAIL：${result.reasons.map(reason => REASON_TEXT[reason] ?? reason).join('、')}`;
    const uiToggle = button(result.manualBrowserUi ? '取消「瀏覽器有開出介面」' : '瀏覽器有開出介面（標記 FAIL）', () => {
      result.manualBrowserUi = !result.manualBrowserUi;
      result.reasons = result.reasons.filter(reason => reason !== 'browser-ui').concat(result.manualBrowserUi ? ['browser-ui'] : []);
      result.pass = result.pagePass && !result.manualBrowserUi;
      show(result);
    });
    controls.replaceChildren(uiToggle, button('重做這一步', () => renderGuide()), button('下一步', () => advance(result)));
  };

  const advance = (result: GuideStepResult | null) => {
    const latest = loadGuide()!;
    latest.results[latest.index] = result;
    latest.index += 1;
    saveGuide(latest);
    renderGuide();
  };

  const arm = () => {
    setActiveContext(spec.context, true);
    show(null);
    guideTrial = new Trial(spec, {
      noKeyTimeoutMs: null,
      onDone: trial => {
        guideCurrent = { step: state.index + 1, chord: spec.chord, label, context: spec.context, variant: spec.variant, expect: trial.expect, pagePass: trial.pagePass, manualBrowserUi: false, pass: trial.pagePass, reasons: trial.reasons, key: trial.key, code: trial.code, defaultPrevented: trial.defaultPrevented, ...(trial.pagePass ? {} : { events: compactEvents(trial.events) }) };
        show(guideCurrent);
      },
    });
    const update = () => {
      if (!guideTrial) return;
      log.textContent = guideTrial.events.map(event => JSON.stringify(event)).join('\n');
    };
    listeners.push(update);
  };

  if (spec.variant === 'fresh') {
    if (sessionStorage.getItem(RESUME_KEY) === `${state.index}`) {
      sessionStorage.removeItem(RESUME_KEY);
      hint.textContent = '頁面已重新載入。不要點任何地方，直接按上面的組合鍵。';
      arm();
    } else {
      hint.textContent = '這一步要測「剛載入頁面後的第一次按鍵」。按下方按鈕重新載入，載入後不要點任何地方，直接按組合鍵。';
      verdict.dataset.verdict = 'waiting';
      verdict.textContent = '尚未開始';
      controls.replaceChildren(
        button('重新載入並開始', () => {
          sessionStorage.setItem(RESUME_KEY, `${state.index}`);
          location.reload();
        }),
        button('跳過', () => advance(null)),
      );
    }
  } else if (spec.variant === 'address-bar') {
    hint.textContent = `這一步要測「從網址列回到頁面後」：1. 用滑鼠點一下瀏覽器的網址列；2. 再點左邊綠框（${CONTEXT_NAMES[spec.context]}）回到頁面；3. 按組合鍵。`;
    verdict.dataset.verdict = 'waiting';
    verdict.textContent = '等你點網址列再點回來…';
    controls.replaceChildren(button('跳過', () => advance(null)));
    let left = false;
    const watch = window.setInterval(() => {
      if (!document.hasFocus()) left = true;
      else if (left) {
        window.clearInterval(watch);
        hint.textContent = '已回到頁面，現在按組合鍵。';
        arm();
      }
    }, POLL_MS);
  } else {
    hint.textContent = spec.chord === 'mod+t' ? '對照組：這個組合鍵瀏覽器不讓頁面攔，會開出新分頁。按下去後把新分頁關掉（Ctrl+W／⌘W）回到這頁；預期結果是 FAIL。' : TEXT_CONTEXTS.includes(spec.context) || spec.context === 'codemirror' ? '游標已經放在綠框裡，直接按組合鍵。' : '焦點在頁面本體（沒有任何欄位被選取），直接按組合鍵。';
    arm();
  }
}

function renderGuideSummary(state: GuideState, steps: TrialSpec[]) {
  const results = state.results.filter((result): result is GuideStepResult => result !== null);
  const output = { probe: 'mgn-keyboard-probe', version: PROBE_VERSION, kind: 'guide', browser: state.browser, userAgent: navigator.userAgent, platform: navigator.platform, startedAt: state.startedAt, finishedAt: new Date().toISOString(), skipped: state.results.map((result, index) => result ? null : `${index + 1}:${steps[index].chord}@${steps[index].context}/${steps[index].variant}`).filter(Boolean), steps: results };
  const table = document.createElement('table');
  table.className = 'probe-summary';
  table.innerHTML = '<tr><th>#</th><th>組合鍵</th><th>位置</th><th>變化</th><th>結果</th></tr>';
  for (const result of results) {
    const row = table.insertRow();
    for (const value of [String(result.step), result.label, result.context, result.variant, result.pass ? 'PASS' : result.expect === 'fail' ? 'FAIL（預期）' : `FAIL ${result.reasons.join(',')}`]) row.insertCell().textContent = value;
  }
  const json = JSON.stringify(output, null, 1);
  const area = document.createElement('textarea');
  area.className = 'probe-result';
  area.readOnly = true;
  area.value = json;
  const failures = results.filter(result => !result.pass && result.expect === 'pass').length;
  panel.replaceChildren(
    heading(`完成：${state.browser}`),
    paragraph(`${results.length} 步完成、${output.skipped.length} 步跳過、${failures} 個非預期 FAIL。按「複製結果」，把 JSON 整段貼回對話。`, 'probe-step-hint'),
    actions(
      copyButton(json),
      downloadButton(json, `keyboard-probe-${state.browser.replace(/[^\w.-]+/g, '-')}.json`),
      button('換下一個瀏覽器／重新開始', () => {
        localStorage.removeItem(GUIDE_KEY);
        renderGuide();
      }),
    ),
    area,
    table,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// IME mode (manual 注音 / 拼音 session)

interface ImeStep {
  ime: '注音' | '拼音';
  context: ContextId;
  action: 'enter' | 'space' | 'escape' | 'mod-k' | 'mod-k-composing';
}

interface ImeStepResult extends ImeStep {
  step: number;
  pass: boolean;
  notes: string[];
  compositions: number;
  /** Keydowns that commit or cancel a composition: during it, or up to 200 ms after compositionend. */
  commitKeys: { key: string; code: string; keyCode: number; isComposing: boolean; afterEndMs: number | null; ruleComposing: boolean; windowComposing: boolean; }[];
  /** The first keydown after each compositionend (Safari's order), with its delay. */
  postEndKeydowns: { key: string; isComposing: boolean; keyCode: number; delayMs: number; }[];
  modK?: { key: string; code: string; keyCode: number; isComposing: boolean; defaultPrevented: boolean; } | null;
  events: LoggedEvent[];
}

const IME_KEY = 'mgn-probe-ime';
const IME_ACTIONS: Record<ImeStep['action'], (ime: string) => string> = { enter: ime => `用${ime}在綠框裡打一個詞（例：測試），選字或確認時按 Enter。完成後按「這一步做完了」。`, space: ime => `用${ime}在綠框裡打一個詞，這次用空白鍵選字／確認（不要按 Enter）。完成後按「這一步做完了」。`, escape: ime => `用${ime}開始打字，候選字出現時按 Escape 取消（不要確認）。完成後按「這一步做完了」。`, 'mod-k': ime => `輸入法維持${ime}、但不在組字中，按 ${MAC ? '⌘K' : 'Ctrl+K'} 一次。完成後按「這一步做完了」。`, 'mod-k-composing': ime => `用${ime}打一個音（候選字還在、不要選字），然後按 ${MAC ? '⌘K' : 'Ctrl+K'} 一次。完成後按「這一步做完了」。` };

function imeSteps(): ImeStep[] {
  const steps: ImeStep[] = [];
  for (const ime of ['注音', '拼音'] as const) {
    for (const context of ['input', 'textarea', 'codemirror'] as const) {
      for (const action of ['enter', 'space', 'escape'] as const) steps.push({ ime, context, action });
    }
    steps.push({ ime, context: 'input', action: 'mod-k' }, { ime, context: 'codemirror', action: 'mod-k-composing' });
  }
  return steps;
}

function analyseIme(step: ImeStep, index: number, events: LoggedEvent[]): ImeStepResult {
  const notes: string[] = [];
  const commitKeys: ImeStepResult['commitKeys'] = [];
  const postEndKeydowns: ImeStepResult['postEndKeydowns'] = [];
  let composing = false;
  let endedAt: number | null = null;
  let compositions = 0;
  let awaitingPostEnd: number | null = null;
  for (const event of events) {
    if (event.type === 'compositionstart') {
      composing = true;
      compositions += 1;
    } else if (event.type === 'compositionend') {
      composing = false;
      endedAt = event.t;
      awaitingPostEnd = event.t;
    } else if (event.type === 'keydown') {
      if (awaitingPostEnd !== null && event.t - awaitingPostEnd <= 500) {
        postEndKeydowns.push({ key: event.key ?? '', isComposing: event.isComposing ?? false, keyCode: event.keyCode ?? 0, delayMs: Math.round((event.t - awaitingPostEnd) * 10) / 10 });
      }
      awaitingPostEnd = null;
      const afterEnd = endedAt === null ? null : event.t - endedAt;
      const commitLike = ['Enter', ' ', 'Escape', 'Process'].includes(event.key ?? '') || event.keyCode === 229;
      if (commitLike && (composing || (afterEnd !== null && afterEnd <= 200)) && !event.mods?.includes('meta') && !event.mods?.includes('ctrl')) {
        commitKeys.push({ key: event.key ?? '', code: event.code ?? '', keyCode: event.keyCode ?? 0, isComposing: event.isComposing ?? false, afterEndMs: composing ? null : Math.round((afterEnd ?? 0) * 10) / 10, ruleComposing: event.ruleComposing ?? false, windowComposing: event.windowComposing ?? false });
      }
    }
  }
  let pass = true;
  let modK: ImeStepResult['modK'];
  if (step.action === 'mod-k' || step.action === 'mod-k-composing') {
    const hit = events.find(event => event.type === 'keydown' && event.code === 'KeyK' && (MAC ? event.mods?.includes('meta') : event.mods?.includes('ctrl')));
    modK = hit ? { key: hit.key ?? '', code: hit.code ?? '', keyCode: hit.keyCode ?? 0, isComposing: hit.isComposing ?? false, defaultPrevented: hit.defaultPrevented ?? false } : null;
    if (!hit) {
      pass = false;
      notes.push('沒有收到 code=KeyK 的組合鍵');
    } else if (!hit.defaultPrevented || hit.candidate !== 'mod+k') {
      pass = false;
      notes.push(`收到 key=${hit.key}，但沒有被當成 Mod+K 攔下`);
    }
    if (step.action === 'mod-k-composing' && !compositions) notes.push('這一步沒有記到組字，請重做');
  } else {
    if (!compositions) {
      pass = false;
      notes.push('沒有記到組字（compositionstart），請確認已切換輸入法後重做');
    }
    const misses = commitKeys.filter(key => !key.ruleComposing);
    if (misses.length) {
      pass = false;
      notes.push(`trackComposition 規則漏判 ${misses.length} 個確認鍵：${misses.map(key => `${key.key}(+${key.afterEndMs}ms)`).join(', ')}`);
    }
    if (postEndKeydowns.some(key => !key.isComposing)) notes.push('compositionend 之後還有 isComposing=false 的 keydown（Safari 順序）');
  }
  return { ...step, step: index + 1, pass, notes, compositions, commitKeys, postEndKeydowns, ...(modK === undefined ? {} : { modK }), events };
}

function renderIme() {
  const steps = imeSteps();
  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem(IME_KEY) ?? 'null') as { browser: string; startedAt: string; index: number; results: (ImeStepResult | null)[]; } | null;
    } catch {
      return null;
    }
  })();
  if (!stored) {
    const browser = document.createElement('input');
    browser.value = detectBrowser();
    browser.style.width = '100%';
    browser.setAttribute('aria-label', '瀏覽器');
    panel.replaceChildren(
      heading('IME 檢查（注音／拼音）'),
      paragraph(`共 ${steps.length} 步。需要在系統設定加入「注音」與「拼音 - 簡體」或「拼音 - 繁體」輸入法。頁面會記錄每一步的事件順序，最後產生結果 JSON。`, 'probe-step-hint'),
      browser,
      actions(button('開始', () => {
        localStorage.setItem(IME_KEY, JSON.stringify({ browser: browser.value.trim() || detectBrowser(), startedAt: new Date().toISOString(), index: 0, results: steps.map(() => null) }));
        renderIme();
      })),
    );
    return;
  }
  const save = () => localStorage.setItem(IME_KEY, JSON.stringify(stored));
  if (stored.index >= steps.length) {
    const results = stored.results.filter((result): result is ImeStepResult => result !== null);
    const output = { probe: 'mgn-keyboard-probe', version: PROBE_VERSION, kind: 'ime', browser: stored.browser, userAgent: navigator.userAgent, startedAt: stored.startedAt, finishedAt: new Date().toISOString(), steps: results.map(result => ({ ...result, events: result.events.slice(0, 60) })) };
    const json = JSON.stringify(output);
    const area = document.createElement('textarea');
    area.className = 'probe-result';
    area.readOnly = true;
    area.value = json;
    panel.replaceChildren(
      heading(`IME 檢查完成：${stored.browser}`),
      paragraph(`${results.filter(result => result.pass).length} / ${results.length} 步通過。按「複製結果」，把 JSON 整段貼回對話。`, 'probe-step-hint'),
      actions(
        copyButton(json),
        downloadButton(json, `keyboard-probe-ime-${stored.browser.replace(/[^\w.-]+/g, '-')}.json`),
        button('換下一個瀏覽器／重新開始', () => {
          localStorage.removeItem(IME_KEY);
          renderIme();
        }),
      ),
      area,
    );
    return;
  }
  const step = steps[stored.index];
  setActiveContext(step.context, true);
  const events: LoggedEvent[] = [];
  const log = document.createElement('div');
  log.className = 'probe-log';
  const listener = (event: LoggedEvent) => {
    events.push(event);
    log.textContent = events.map(item => [item.t, item.type, item.key ?? '', item.code ?? '', item.keyCode ?? '', item.isComposing ? 'isComposing' : '', item.ruleComposing ? 'rule:composing' : '', item.data ?? ''].join(' ')).join('\n');
  };
  listeners.push(listener);
  const finish = (result: ImeStepResult | null) => {
    listeners = listeners.filter(item => item !== listener);
    stored.results[stored.index] = result;
    stored.index += 1;
    save();
    renderIme();
  };
  const verdict = document.createElement('div');
  verdict.className = 'probe-verdict';
  verdict.dataset.verdict = 'waiting';
  verdict.textContent = '記錄中…';
  panel.replaceChildren(
    paragraph(`第 ${stored.index + 1} / ${steps.length} 步 · ${stored.browser}`, 'probe-progress'),
    heading(`${step.ime}：${CONTEXT_NAMES[step.context]}`, 'probe-step-title'),
    paragraph(IME_ACTIONS[step.action](step.ime), 'probe-step-hint'),
    verdict,
    actions(
      button('這一步做完了', () => {
        const result = analyseIme(step, stored.index, events);
        verdict.dataset.verdict = result.pass ? 'pass' : 'fail';
        verdict.textContent = result.pass ? `PASS${result.notes.length ? `（${result.notes.join('；')}）` : ''}` : `FAIL：${result.notes.join('；')}`;
        listeners = listeners.filter(item => item !== listener);
        const next = button('下一步', () => finish(result));
        const redo = button('重做這一步', () => renderIme());
        next.style.fontWeight = '700';
        verdict.after(actions(redo, next));
      }),
      button('跳過', () => finish(null)),
    ),
    log,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Free mode

function renderFree() {
  const log = document.createElement('div');
  log.className = 'probe-log';
  const lines: string[] = [];
  listeners.push(event => {
    lines.unshift(JSON.stringify(event));
    lines.length = Math.min(lines.length, 200);
    log.textContent = lines.join('\n');
  });
  const contextButtons = CONTEXTS.map(id =>
    button(id, () => {
      window.history.replaceState(null, '', `#mode=free&context=${id}`);
      setActiveContext(id, true);
    })
  );
  panel.replaceChildren(heading('自由記錄'), paragraph('所有候選組合鍵都會被攔下（preventDefault）並記錄。', 'probe-step-hint'), actions(...contextButtons), log);
  const requested = new URLSearchParams(location.hash.slice(1)).get('context');
  setActiveContext(CONTEXTS.includes(requested as ContextId) ? requested as ContextId : 'body', true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Small DOM helpers

const panel = document.getElementById('probe-panel')!;

function heading(text: string, className?: string) {
  const element = document.createElement('div');
  element.className = className ?? 'probe-step-hint';
  if (!className) element.style.fontWeight = '700';
  element.textContent = text;
  return element;
}

function paragraph(text: string, className?: string) {
  const element = document.createElement('p');
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function button(text: string, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.addEventListener('click', onClick);
  return element;
}

function actions(...children: HTMLElement[]) {
  const element = document.createElement('div');
  element.className = 'probe-actions';
  element.append(...children);
  return element;
}

function copyButton(text: string) {
  const element = button('複製結果', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    element.textContent = '已複製';
  });
  return element;
}

function downloadButton(text: string, filename: string) {
  return button('下載 JSON', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Boot

function currentMode(): Mode {
  if (collector) return 'auto';
  const mode = new URLSearchParams(location.hash.slice(1)).get('mode');
  return mode === 'ime' || mode === 'free' ? mode : 'guide';
}

function renderModes(mode: Mode) {
  const host = document.getElementById('probe-modes')!;
  if (mode === 'auto') return;
  const entries: [Mode, string][] = [['guide', '按鍵引導檢查'], ['ime', 'IME 檢查（注音／拼音）'], ['free', '自由記錄']];
  host.replaceChildren(...entries.map(([id, text]) => {
    const element = button(text, () => {
      location.hash = `mode=${id}`;
      location.reload();
    });
    element.setAttribute('aria-pressed', String(id === mode));
    return element;
  }));
}

buildContexts();
const mode = currentMode();
document.getElementById('probe-meta')!.textContent = `probe v${PROBE_VERSION} · ${detectBrowser()} · ${MAC ? 'Mod = ⌘' : 'Mod = Ctrl'} · ${navigator.userAgent}`;
renderModes(mode);
if (mode === 'auto') {
  // The driver finds this window by its title.
  document.title = `MGN Keyboard Probe ${session}`;
  setActiveContext('body', true);
  renderAuto();
  report({ type: 'ready', state: snapshot(), userAgent: navigator.userAgent, probeVersion: PROBE_VERSION, mac: MAC, chords: CHORDS, contexts: CONTEXTS });
  void pollCollector();
} else if (mode === 'guide') renderGuide();
else if (mode === 'ime') renderIme();
else renderFree();
