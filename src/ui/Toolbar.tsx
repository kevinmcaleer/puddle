import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Toolbar({ brand = 'Puddle', project, children }: { brand?: string; project?: ReactNode; children?: ReactNode }) {
  return (
    <header className="ui-toolbar">
      <span className="ui-wordmark">{brand}</span>
      {project && (
        <span className="ui-toolbar__project">
          {project}
          <Icon name="chevron-down" size={14} />
        </span>
      )}
      <span className="ui-toolbar__spacer" />
      <div className="ui-toolbar__group">{children}</div>
    </header>
  );
}
