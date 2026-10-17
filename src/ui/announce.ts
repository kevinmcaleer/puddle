import { create } from 'zustand';

/**
 * What screen readers are told as it happens: a query still running, a node that broke, a wire added. Polite news
 * waits for a pause; assertive news (something broke) interrupts. `LiveRegions` reads it out.
 */
interface Announcements {
  polite: string;
  assertive: string;
}

export const useAnnouncements = create<Announcements>(() => ({ polite: '', assertive: '' }));

/** A no-break space: the same words said twice in a row still change the region's text, so they're read twice. */
const AGAIN = String.fromCharCode(0xa0);

/** Say `text` to screen readers. */
export function announce(text: string, politeness: 'polite' | 'assertive' = 'polite') {
  useAnnouncements.setState((s) => ({ [politeness]: s[politeness] === text ? text + AGAIN : text }));
}
