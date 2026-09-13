import type { SVGProps } from 'react';

/** Three folding panels, like a GM screen. */
export function ScreenIcon({ size = 20, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M3 5.5 9 3l6 2.5L21 3v15.5L15 21l-6-2.5L3 21Z" /><path d="M9 3v15.5M15 5.5V21" />
  </svg>;
}
