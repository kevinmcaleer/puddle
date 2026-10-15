import { useState } from 'react';
import { removeProject, renameProject } from '../persistence/workspace';
import { Dialog, Field, TextInput } from '../ui';
import { openProjectDialog, useProjectDialog } from './dialogs';

function RenameDialog({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState(name);
  const close = () => openProjectDialog(null);
  return (
    <Dialog
      title="Rename project"
      confirm="Rename"
      onClose={close}
      onConfirm={() => {
        close();
        void renameProject(id, value);
      }}
    >
      <Field label="Name" htmlFor="project-name">
        <TextInput id="project-name" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** Rename and delete dialogs, shared by the home screen and the editor's project menu. */
export function ProjectDialogs() {
  const dialog = useProjectDialog((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.kind === 'rename') return <RenameDialog key={dialog.id} id={dialog.id} name={dialog.name} />;
  const close = () => openProjectDialog(null);
  return (
    <Dialog
      title="Delete project?"
      confirm="Delete project"
      danger
      onClose={close}
      onConfirm={() => {
        close();
        void removeProject(dialog.id);
      }}
    >
      <p className="text-ink-muted">
        {dialog.name} and its steps will be deleted from this browser. Your data files aren’t touched. Export the project first if you might want it again.
      </p>
    </Dialog>
  );
}
