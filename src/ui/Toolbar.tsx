import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { Menu, type MenuItem } from './Menu';

/** The top bar: wordmark, the open project's name (a menu when `projectMenu` is given), then actions. */
export function Toolbar({ brand = 'Puddle', project, projectMenu, children }: { brand?: string; project?: ReactNode; projectMenu?: MenuItem[]; children?: ReactNode }) {
  return (
    <header className="ui-toolbar">
      <span className="ui-wordmark">{brand}</span>
      {project && !projectMenu && (
        <span className="ui-toolbar__project">
          {project}
          <Icon name="chevron-down" size={14} />
        </span>
      )}
      {project && projectMenu && (
        <Menu
          label={project}
          items={projectMenu}
          align="start"
          renderTrigger={(p) => (
            <button type="button" className="ui-toolbar__project cursor-pointer bg-transparent text-ink" data-testid="project-menu" {...p}>
              <span className="truncate" data-testid="project-name">{project}</span>
              <Icon name="chevron-down" size={14} />
            </button>
          )}
        />
      )}
      <span className="ui-toolbar__spacer" />
      <div className="ui-toolbar__group">{children}</div>
    </header>
  );
}
