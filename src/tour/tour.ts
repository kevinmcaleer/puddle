import { create } from 'zustand';
import { useSession } from '../app/session';
import { useProjectStore } from '../model';
import { openSample } from '../samples/open';
import { TOUR_STOPS } from './stops';

const KEY = 'puddle.tour';

/** What the tour remembers in this browser: whether it has been offered, and how far it got. */
export interface TourProgress {
  /** The first-launch offer was answered (taken, or don't show again); it isn't offered again. */
  offered: boolean;
  /** The stop reached last, from 0. */
  stop: number;
  /** The tour was seen to the end. */
  finished: boolean;
}

const FRESH: TourProgress = { offered: false, stop: 0, finished: false };

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const local = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

export function readProgress(storage: Storage | undefined = local()): TourProgress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return FRESH;
    const v = JSON.parse(raw) as Partial<TourProgress>;
    const stop = typeof v.stop === 'number' && Number.isInteger(v.stop) ? Math.max(0, Math.min(v.stop, TOUR_STOPS.length - 1)) : 0;
    return { offered: v.offered === true, stop, finished: v.finished === true };
  } catch {
    return FRESH;
  }
}

export function writeProgress(change: Partial<TourProgress>, storage: Storage | undefined = local()): TourProgress {
  const next = { ...readProgress(storage), ...change };
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private window): the tour still runs, it just may be offered again next time.
  }
  return next;
}

/** Offered on first launch until answered or seen through. */
export const shouldOffer = (p: TourProgress) => !p.offered && !p.finished;

/** A tour stopped part way can be picked up from Help. */
export const canResume = (p: TourProgress) => !p.finished && p.stop > 0;

interface TourState {
  /** The project the tour runs over; it ends if another project opens. Null while it isn't running. */
  projectId: string | null;
  stop: number;
  /** The offer has been answered in this tab. */
  offerAnswered: boolean;
  /** A sample is being opened to start the tour on. */
  starting: boolean;
}

export const useTour = create<TourState>(() => ({ projectId: null, stop: 0, offerAnswered: false, starting: false }));

/**
 * Start the tour at a stop. With no source in the open project it opens the contact list sample first, so every stop
 * has something to point at; otherwise it runs over the project that's open.
 */
export async function startTour(from = 0) {
  if (useTour.getState().starting) return;
  writeProgress({ offered: true, stop: from });
  useTour.setState({ offerAnswered: true, starting: true });
  try {
    if (!useProjectStore.getState().history.present.sources.length) {
      await openSample('contacts');
    }
    useTour.setState({ projectId: useProjectStore.getState().history.present.id, stop: from });
  } finally {
    useTour.setState({ starting: false });
  }
}

export function goToStop(stop: number) {
  const s = Math.max(0, Math.min(stop, TOUR_STOPS.length - 1));
  writeProgress({ stop: s });
  useTour.setState({ stop: s });
}

/** End the tour; seen to the last stop, it counts as finished and Help offers it from the start again. */
export function endTour() {
  const { stop, projectId } = useTour.getState();
  if (!projectId) return;
  writeProgress(stop === TOUR_STOPS.length - 1 ? { finished: true, stop: 0 } : { stop });
  useTour.setState({ projectId: null });
}

/** Don't show the first-launch offer again. */
export function declineOffer() {
  writeProgress({ offered: true });
  useTour.setState({ offerAnswered: true });
}

/** Start the tour from a button, saying so if the sample it starts on can't be opened. */
export function startTourSafely(from?: number) {
  startTour(from).catch((e: unknown) => {
    const text = `Puddle couldn’t start the tour: ${e instanceof Error ? e.message : String(e)}`;
    useSession.getState().notify({ tone: 'fail', text });
  });
}
