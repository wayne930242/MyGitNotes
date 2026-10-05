import { useEffect, useState } from 'react';

// Without media queries (a test DOM, a server render) there is no phone viewport to detect.
const phoneQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)') : null;

/** Whether the viewport is a phone: 767px wide or less. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => phoneQuery()?.matches ?? false);
  useEffect(() => {
    const media = phoneQuery();
    if (!media) return;
    const update = () => setPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return phone;
}
