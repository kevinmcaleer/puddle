import { useProject } from '../model';
import { Button, Tabs } from '../ui';
import { useSession } from './session';
import { currentView, showView, viewItems, type CanvasView } from './views';

/** The tabs over the canvas area that name every surface able to stand in the canvas's place. */
export function ViewSwitcher({ outlineOpen = true }: { outlineOpen?: boolean }) {
  const project = useProject();
  const schemaOpen = useSession((s) => s.schemaOpen);
  const relationshipsOpen = useSession((s) => s.relationshipsOpen);
  const designerNodeId = useSession((s) => s.designerNodeId);
  const selectedNodeId = useSession((s) => s.selectedNodeId);
  const state = { schemaOpen, relationshipsOpen, designerNodeId, selectedNodeId };
  return (
    <div className="puddle-views" data-testid="view-switcher">
      {/* The way back to the project panel while it is hidden: where the panel's own edge would be. */}
      {!outlineOpen && (
        <Button variant="ghost" size="sm" icon="outline-open" iconOnly className="mr-2" aria-label="Show the project panel" title="Show the project panel: tables, queries and outputs" data-testid="outline-toggle" onClick={() => useSession.getState().setOutlineOpen(true)} />
      )}
      <Tabs label="Views" items={viewItems(project, state)} value={currentView(project, state)} onChange={(v) => showView(project, v as CanvasView)} />
    </div>
  );
}
