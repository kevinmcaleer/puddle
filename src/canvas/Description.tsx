import { useRef } from 'react';
import { useSession } from '../app/session';
import { cleanDescription, DESCRIPTION_MAX } from '../model';
import { cx } from '../ui';

const PLACEHOLDER = 'What this is for, e.g. combine into a single list';

/**
 * A node's or a group's description on the canvas: one or two lines in the user's words under the card's heading.
 * Add description or Edit description on the right-click menu writes it in place (a double-click on the card keeps
 * its own meaning: open the group, show the steps); Enter or clicking away saves, Escape leaves it as it was. Shows
 * nothing while there is no description and none is being written, so an undescribed card looks as it always did.
 */
export function Description({ flowId, name, text, onSave, className }: { flowId: string; name: string; text?: string; onSave: (text: string) => void; className?: string }) {
  const editing = useSession((s) => s.describing === flowId);
  if (editing) return <DescriptionInput name={name} text={text} onSave={onSave} className={className} />;
  if (!text) return null;
  return (
    <p className={cx('puddle-description', className)} data-testid="description" title={text}>
      {text}
    </p>
  );
}

function DescriptionInput({ name, text, onSave, className }: { name: string; text?: string; onSave: (text: string) => void; className?: string }) {
  // Enter saves and closes; the blur that may follow as the field goes must not save again.
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    if (value != null && cleanDescription(value) !== cleanDescription(text)) onSave(value);
    useSession.getState().askDescribe(null);
  };
  return (
    <input
      // Typing here must not drag the canvas, scroll it or reach its keys (Delete, G, arrows).
      className={cx('ui-input nodrag nowheel nopan puddle-description__input', className)}
      aria-label={`Description of ${name}`}
      placeholder={PLACEHOLDER}
      maxLength={DESCRIPTION_MAX}
      defaultValue={text ?? ''}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
