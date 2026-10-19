import { useProject } from '../model';
import { Tabs } from '../ui';
import { useSession } from './session';
import { currentView, showView, viewItems, type CanvasView } from './views';

/** The tabs over the canvas area that name every surface able to stand in the canvas's place. */
export function ViewSwitcher() {
  const project = useProject();
  const schemaOpen = useSession((s) => s.schemaOpen);
  const relationshipsOpen = useSession((s) => s.relationshipsOpen);
  const designerNodeId = useSession((s) => s.designerNodeId);
  const selectedNodeId = useSession((s) => s.selectedNodeId);
  const state = { schemaOpen, relationshipsOpen, designerNodeId, selectedNodeId };
  return (
    <div className="puddle-views" data-testid="view-switcher">
      <Tabs label="Views" items={viewItems(project, state)} value={currentView(project, state)} onChange={(v) => showView(project, v as CanvasView)} />
    </div>
  );
}
