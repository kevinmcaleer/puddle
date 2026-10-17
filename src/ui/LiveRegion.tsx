import { useAnnouncements } from './announce';

/**
 * The page's two live regions, polite and assertive, always present: a live region must be in the page before its
 * text changes for every screen reader to read the change. `announce` fills them.
 */
export function LiveRegions() {
  const { polite, assertive } = useAnnouncements();
  return (
    <div className="sr-only">
      <div aria-live="polite" data-testid="announce-polite">
        {polite}
      </div>
      <div aria-live="assertive" data-testid="announce-assertive">
        {assertive}
      </div>
    </div>
  );
}
