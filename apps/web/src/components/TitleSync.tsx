import { useEffect } from 'react';
import { usePathname } from '@/lib/nav';

const SITE = 'AccessAudit';

/**
 * Keeps document.title in step with the page's first h1, so each route has a distinct title
 * (WCAG 2.4.2) and screen readers announce a change on navigation. Pages render their h1 after
 * data loads, so this watches the DOM instead of reading once.
 */
export function TitleSync() {
  const pathname = usePathname();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const h1 = document.querySelector('h1')?.textContent.trim();
      const next = h1 ? `${h1} · ${SITE}` : SITE;
      if (document.title !== next) document.title = next;
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    schedule();
    const root = document.getElementById('root');
    const observer = new MutationObserver(schedule);
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return null;
}
