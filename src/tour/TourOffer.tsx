import { useState } from 'react';
import { Button } from '../ui';
import { declineOffer, readProgress, shouldOffer, startTourSafely, useTour } from './tour';

/**
 * The first-launch offer, on the empty canvas: not a dialog, so nothing is in the way of starting work. Answering it,
 * either way, means it isn't offered again; Help has the tour any time.
 */
export function TourOffer() {
  const answered = useTour((s) => s.offerAnswered);
  const starting = useTour((s) => s.starting);
  const [progress] = useState(readProgress);
  if (answered && !starting) return null;
  if (!answered && !shouldOffer(progress)) return null;
  return (
    <section className="ui-popover w-full text-left" aria-label="Guided tour" data-testid="tour-offer">
      <div className="ui-popover__head">
        <span className="ui-eyebrow">New to Puddle?</span>
      </div>
      <p className="px-3 py-2 text-label text-ink-muted">A short tour opens a sample project and points out the main ideas, one at a time. Help has it any time.</p>
      <div className="ui-popover__foot flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={starting} onClick={declineOffer}>Don’t show again</Button>
        <Button variant="primary" size="sm" disabled={starting} onClick={() => startTourSafely()}>{starting ? 'Opening the sample' : 'Take the tour'}</Button>
      </div>
    </section>
  );
}
