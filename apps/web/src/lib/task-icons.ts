import { CalendarCheck, CalendarDays, Clock, type LucideIcon, PlaneTakeoff } from 'lucide-react';
import { DONE_EMOJI, DUE_EMOJI, START_EMOJI, TIMESTAMP_EMOJI } from './task-tokens.js';

/** Maps each date-token emoji to its lucide-react icon, for React UI (e.g. the Todo panel). */
export const TASK_TOKEN_ICON: Record<string, LucideIcon> = { [DUE_EMOJI]: CalendarDays, [DONE_EMOJI]: CalendarCheck, [TIMESTAMP_EMOJI]: Clock, [START_EMOJI]: PlaneTakeoff };

function svg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/**
 * Inline SVG markup for each date-token emoji, for the vanilla-DOM editor
 * widgets. Kept as raw markup (not lucide-react components) since those
 * widgets are built with `document.createElement`, not React.
 */
export const TASK_TOKEN_ICON_SVG: Record<string, string> = { [DUE_EMOJI]: svg('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>'), [DONE_EMOJI]: svg('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>'), [TIMESTAMP_EMOJI]: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'), [START_EMOJI]: svg('<path d="M2 22h20"/><path d="M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z"/>') };
