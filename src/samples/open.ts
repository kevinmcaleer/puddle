import { useSession } from '../app/session';
import { addSource, createProject, newId, type Project, type Source } from '../model';
import { openNewProject } from '../persistence/workspace';
import { useUrlFetches } from '../sources/url';
import { sampleAddress, sampleById, sampleProjectName, type Sample, type SampleId } from './catalog';

/** Where the samples are served from in this page. */
const pageBase = () => (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');

/**
 * A new project for a sample: one URL source per file (marked as a sample, so it is read from wherever Puddle is
 * served), stacked down the canvas, and the sample's note. The first file is the one viewed.
 */
export function sampleProject(sample: Sample, base = pageBase(), at = new Date()): Project {
  let project: Project = { ...createProject(sampleProjectName(sample), at), notes: sample.note };
  sample.files.forEach(({ file }, i) => {
    const source: Source = {
      id: newId('s'),
      name: file,
      kind: 'url',
      format: 'csv',
      url: { href: sampleAddress(file, base).href, sample: file },
      parseOptions: {},
      detectedSchema: [],
    };
    project = addSource(project, source, { x: 80, y: 80 + i * 200 });
  });
  const first = project.nodes[0];
  return first ? { ...project, view: { ...project.view, viewedNodeId: first.id } } : project;
}

/** Resolves once none of these sources is still being fetched. */
function fetched(ids: string[]): Promise<void> {
  const done = () => ids.every((id) => {
    const f = useUrlFetches.getState().fetches[id];
    return f != null && f.state !== 'fetching';
  });
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useUrlFetches.subscribe(() => {
      if (!done()) return;
      off();
      resolve();
    });
  });
}

/**
 * Open a sample as a new project, with its files read and its note open beside the canvas. Resolves once the files
 * are fetched (a file that couldn't be read shows its problem on its node, as any URL source does). Called by the
 * sample picker; the guided tour can call it to start on a sample.
 */
export async function openSample(id: SampleId | string, base = pageBase()): Promise<Project> {
  const sample = sampleById(id);
  if (!sample) throw new Error(`There’s no sample called ${id}.`);
  const project = sampleProject(sample, base);
  await openNewProject(project);
  // The note says what's wrong with the data, so it's the first thing to read.
  useSession.getState().setInspectorTab('notes');
  await fetched(project.sources.map((s) => s.id));
  return project;
}
