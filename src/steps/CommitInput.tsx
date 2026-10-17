import { useState } from 'react';
import { appUndo, TextInput } from '../ui';

/**
 * A text input that commits on Enter or blur, so typing doesn't add an undo step per key. Key it by value to reset.
 * With no uncommitted typing, Ctrl+Z undoes the project's last change rather than the field's text.
 */
export function CommitInput({ value, onCommit, ...rest }: { id?: string; value: string; onCommit: (v: string) => void; mono?: boolean; placeholder?: string; error?: boolean; 'aria-label'?: string }) {
  const [draft, setDraft] = useState(value);
  const commit = () => draft !== value && onCommit(draft);
  return <TextInput {...rest} {...appUndo(draft === value)} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
