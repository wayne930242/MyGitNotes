import { useEffect, useState } from 'react';

/** Settles a fast-changing value (a search box) before it becomes a server query. */
export function useDebounced<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);
  return settled;
}
