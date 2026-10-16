import { Fragment } from 'react';
import { Dialog } from '../ui';
import { useSession } from './session';
import { comboKeys, isMac, SHORTCUT_AREAS, SHORTCUTS, type Shortcut } from './shortcuts';

const WHERE: Partial<Record<NonNullable<Shortcut['handledBy']>, string>> = { canvas: 'on the canvas', 'step list': 'in the applied steps' };

/** Every keyboard shortcut, by area, straight from the registry (?). */
export function ShortcutsDialog() {
  const open = useSession((s) => s.shortcutsOpen);
  if (!open) return null;
  const mac = isMac();
  const close = () => useSession.getState().setShortcutsOpen(false);
  return (
    <Dialog title="Keyboard shortcuts" onClose={close} className="w-[560px] max-w-[calc(100vw-32px)]">
      <p className="text-label text-ink-muted">Shortcuts work anywhere outside a text field. {mac ? '⌘ is Command.' : 'On a Mac, use Command in place of Ctrl.'}</p>
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto pr-2 focus-visible:outline-brand" data-testid="shortcuts-list">
        {SHORTCUT_AREAS.map((area) => (
          <section key={area} aria-label={area}>
            <h3 className="ui-eyebrow pb-1">{area}</h3>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
              {(SHORTCUTS as readonly Shortcut[])
                .filter((s) => s.area === area)
                .map((s) => (
                  <Fragment key={s.id}>
                    <dt className="text-body" data-shortcut={s.id}>
                      {s.label}
                      {s.handledBy && WHERE[s.handledBy] && <span className="text-ink-muted"> ({WHERE[s.handledBy]})</span>}
                    </dt>
                    <dd className="flex items-center justify-end gap-1">
                      {s.keys.map((c, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className="text-label text-ink-subtle">or</span>}
                          {comboKeys(c, mac).map((key) => (
                            <kbd key={key} className="rounded-sm border border-line-strong bg-surface-sunken px-1 font-mono text-label text-ink">
                              {key}
                            </kbd>
                          ))}
                        </Fragment>
                      ))}
                    </dd>
                  </Fragment>
                ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
