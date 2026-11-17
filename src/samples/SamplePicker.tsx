import { useState } from 'react';
import { Section, StatusBadge } from '../ui';
import { SAMPLES, type Sample } from './catalog';
import { openSampleOrSay } from './open';

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

function SampleCard({ sample, index, busy, compact, onOpen }: { sample: Sample; index: number; busy: boolean; compact: boolean; onOpen: (s: Sample) => void }) {
  return (
    <button
      type="button"
      className="flex flex-1 cursor-pointer flex-col overflow-hidden rounded-md border border-line bg-surface-raised text-left text-ink hover:bg-surface-hover disabled:cursor-wait"
      data-testid={`sample-${sample.id}`}
      disabled={busy}
      onClick={() => onOpen(sample)}
    >
      {!compact && <SampleCover index={index} />}
      <span className="flex flex-col gap-1 p-3">
        <span className="flex items-center justify-between gap-2">
          <span className="text-body-strong">{sample.title}</span>
          {!compact && <StatusBadge>Sample</StatusBadge>}
        </span>
        <span className="text-label text-ink-muted">{sample.blurb}</span>
      </span>
    </button>
  );
}

/**
 * The sample cards: one click opens a sample as a new project. Shared by the home screen and the empty canvas, where
 * they are compact (no cover) so all of them fit beside the drop zone.
 */
export function SamplePicker({ title = 'Try a sample', compact = false }: { title?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const open = async (sample: Sample) => {
    setBusy(true);
    await openSampleOrSay(sample);
    setBusy(false);
  };
  return (
    <Section title={title}>
      {!compact && <p className="text-label text-ink-muted">Small, deliberately messy datasets that ship with Puddle, each with a note on what’s wrong. They work offline too.</p>}
      <div className="grid grid-cols-2 gap-3" role="list" aria-label="Samples">
        {SAMPLES.map((s, i) => (
          <div key={s.id} role="listitem" className="flex">
            <SampleCard sample={s} index={i} busy={busy} compact={compact} onOpen={(x) => void open(x)} />
          </div>
        ))}
      </div>
    </Section>
  );
}
