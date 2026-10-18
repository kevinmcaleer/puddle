import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { Menu, type MenuItem } from './Menu';

/**
 * The top bar: the wordmark, the open project's name (a menu when `projectMenu` is given), then actions. With
 * `onHome`, the wordmark is the way to the projects screen, as a site's logo goes home, so the way out of a project
 * is always in the same corner and the toolbar gains no control.
 */
export function Toolbar({
  brand = 'Puddle',
  project,
  projectMenu,
  onHome,
  children,
}: {
  brand?: string;
  project?: ReactNode;
  projectMenu?: MenuItem[];
  onHome?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="ui-toolbar">
      {onHome ? (
        <button type="button" className="ui-wordmark ui-wordmark--home" aria-label={`${brand}: all projects`} title="All projects" data-testid="home-button" onClick={onHome}>
          {brand}
        </button>
      ) : (
        <span className="ui-wordmark">{brand}</span>
      )}
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
