import type { CSSProperties, ReactNode } from 'react';
import { Spinner } from './Spinner.js';

/**
 * Every pending view announces itself the same way: one spinner beside its own label, inside
 * whatever element that view already used, so each placeholder keeps its own layout and colour.
 */
export function LoadingStatus({ children, className, style, as: Tag = 'p' }: { children: ReactNode; className?: string; style?: CSSProperties; as?: 'p' | 'div' | 'span'; }) {
  return (
    <Tag role='status' className={className} style={style}>
      <span className='inline-flex items-center gap-2 align-middle'>
        <Spinner />
        <span>{children}</span>
      </span>
    </Tag>
  );
}
