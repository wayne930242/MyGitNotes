/** The one loading indicator: a ring in the current text colour, sized to the text beside it. */
export function Spinner({ size = '1em', className = '' }: { size?: number | string; className?: string; }) {
  return (
    <svg className={`shrink-0 animate-spin motion-reduce:animate-none ${className}`.trim()} style={{ width: size, height: size }} viewBox='0 0 24 24' fill='none' aria-hidden='true' focusable='false'>
      <circle cx='12' cy='12' r='9' stroke='currentColor' strokeWidth='2.5' className='opacity-20' />
      <path d='M21 12a9 9 0 0 0-9-9' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' />
    </svg>
  );
}
