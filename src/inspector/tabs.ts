import type { InspectorTab } from '../app/session';
import type { TabItem } from '../ui';

/** The inspector's tabs: Node only while a node is selected; then the project's settings and its notes. */
export function inspectorTabs(hasNode: boolean): TabItem[] {
  return [...(hasNode ? [{ id: 'node', label: 'Node' }] : []), { id: 'project', label: 'Project' }, { id: 'notes', label: 'Notes' }];
}

/** The tab that shows: the one asked for, or Project when the Node tab was asked for and nothing is selected. */
export function shownTab(tab: InspectorTab, hasNode: boolean): InspectorTab {
  return tab === 'node' && !hasNode ? 'project' : tab;
}
