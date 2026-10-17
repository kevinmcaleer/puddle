import { useState } from 'react';
import { Dialog, Section, StatusBadge } from '../ui';
import { SAMPLES, type Sample } from './catalog';
import { openSampleOrSay } from './open';
import { openSamplesDialog, useSamplesDialog } from './samplesDialog';

/** Each card's cover blocks, in the brand cover's colours, turned round so no two samples look alike. */
const BLOCKS = ['fill-brand', 'fill-accent', 'fill-brand-tint', 'fill-accent-tint', 'fill-ink'];

/** A small cover in the design system's Cover style: flush colour blocks and the ripples of one drop. */
function SampleCover({ index }: { index: number }) {
  const fill = (i: number) => BLOCKS[(i + index) % BLOCKS.length];
  const cx = 60 + ((index * 70) % 140);
  return (
    <svg viewBox="0 0 240 72" className="block h-auto w-full" aria-hidden="true">
      <rect className={fill(0)} x="0" y="0" width="124" height="72" />
      <rect className={fill(1)} x="128" y="0" width="112" height="34" />
      <rect className={fill(2)} x="128" y="38" width="52" height="34" />
      <rect className={fill(3)} x="184" y="38" width="56" height="34" />
      <g className="fill-none stroke-surface-raised opacity-50" strokeWidth="2">
        <circle cx={cx} cy="36" r="10" />
        <circle cx={cx} cy="36" r="22" />
        <circle cx={cx} cy="36" r="34" />
      </g>
      <circle className="fill-surface-raised" cx={cx} cy="36" r="4" />
    </svg>
  );
}

function SampleCard({ sample, index, busy, onOpen }: { sample: Sample; index: number; busy: boolean; onOpen: (s: Sample) => void }) {
  return (
    <button
      type="button"
      className="flex flex-1 cursor-pointer flex-col overflow-hidden rounded-md border border-line bg-surface-raised text-left text-ink hover:bg-surface-hover disabled:cursor-wait"
      data-testid={`sample-${sample.id}`}
      disabled={busy}
      onClick={() => onOpen(sample)}
    >
      <SampleCover index={index} />
      <span className="flex flex-col gap-1 p-3">
        <span className="flex items-center justify-between gap-2">
          <span className="text-body-strong">{sample.title}</span>
          <StatusBadge>Sample</StatusBadge>
        </span>
        <span className="text-label text-ink-muted">{sample.blurb}</span>
      </span>
    </button>
  );
}

/** The sample cards: one click opens a sample as a new project. Shared by the home screen and the empty canvas. */
export function SamplePicker({ title = 'Try a sample', onOpened }: { title?: string; onOpened?: () => void }) {
  const [busy, setBusy] = useState(false);
  const open = async (sample: Sample) => {
    setBusy(true);
    onOpened?.();
    await openSampleOrSay(sample);
    setBusy(false);
  };
  return (
    <Section title={title}>
      <p className="text-label text-ink-muted">Small, deliberately messy datasets that ship with Puddle, each with a note on what’s wrong. They work offline too.</p>
      <div className="grid grid-cols-2 gap-3" role="list" aria-label="Samples">
        {SAMPLES.map((s, i) => (
          <div key={s.id} role="listitem" className="flex">
            <SampleCard sample={s} index={i} busy={busy} onOpen={(x) => void open(x)} />
          </div>
        ))}
      </div>
    </Section>
  );
}

/** The sample picker as a dialog, from the empty canvas. */
export function SamplesDialog() {
  const open = useSamplesDialog((s) => s.open);
  if (!open) return null;
  const close = () => openSamplesDialog(false);
  return (
    <Dialog title="Try a sample" onClose={close} className="w-[640px] max-w-full">
      <SamplePicker title="Samples" onOpened={close} />
    </Dialog>
  );
}
