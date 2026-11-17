import { flow, src } from "../../tests/helpers/projects";
import { autoLayout } from "../canvas/layout";
import {
  canvasProject,
  hasQueriesToMove,
  isQueryNode,
  offCanvasIds,
  projectOutline,
  setQueriesInPanel,
} from "./outline";
import { createProject } from "./project";
import type { Project } from "./schema";

// A file, a script making two tables, a clean-up chain on one, two queries that end the flow (one exported) and one that feeds a step.
const base = (): Project =>
  // The helper starts from a new project, which keeps queries in the panel: these start as an older project does.
  setQueriesInPanel(
    flow({
      sources: [src({ id: "files", format: "csv" })],
      nodes: [
        { id: "files", type: "source", sourceId: "files" },
        {
          id: "script",
          type: "sql",
          sqlSpec: {
            query:
              "CREATE TABLE log AS SELECT * FROM input1;\nCREATE TABLE docs AS SELECT * FROM log",
          },
        },
        { id: "log", type: "scriptTable", scriptTable: { table: "log" } },
        { id: "docs", type: "scriptTable", scriptTable: { table: "docs" } },
        { id: "trim", type: "transform" },
        { id: "clean", type: "transform" },
        {
          id: "rate",
          type: "sql",
          sqlSpec: { query: "SELECT count(*) AS n FROM docs" },
        },
        { id: "out", type: "output" },
        { id: "perUser", type: "query" },
        { id: "middle", type: "sql", sqlSpec: { query: "SELECT * FROM log" } },
        { id: "after", type: "transform" },
      ],
      wires: [
        ["files", "script", 0],
        ["script", "log", 0],
        ["script", "docs", 0],
        ["log", "trim", 0],
        ["trim", "clean", 0],
        ["docs", "rate", 0],
        ["rate", "out", 0],
        ["clean", "perUser", 0],
        ["log", "middle", 0],
        ["middle", "after", 0],
      ],
    }),
    false,
  );
const inPanel = () => setQueriesInPanel(base(), true);
const ids = (rows: { node: { id: string } }[]) => rows.map((r) => r.node.id);

describe("the project outline", () => {
  it("lists tables, queries and outputs: a script and a step on the way to a table are none of them", () => {
    const o = projectOutline(base());
    expect(ids(o.tables)).toEqual(["files", "log", "docs", "clean", "after"]);
    expect(ids(o.queries)).toEqual(["rate", "perUser", "middle"]);
    expect(ids(o.outputs)).toEqual(["out"]);
    expect(o.queries.map((r) => r.reads)).toEqual([
      ["docs"],
      ["clean"],
      ["log"],
    ]);
  });

  it("counts SQL that creates tables as a script, not a query, in a SQL node or a Query’s SQL view", () => {
    const p = base();
    expect(isQueryNode(p.nodes.find((n) => n.id === "script")!)).toBe(false);
    const query = p.nodes.find((n) => n.id === "perUser")!;
    expect(isQueryNode(query)).toBe(true);
    expect(
      isQueryNode({
        ...query,
        querySpec: {
          ...(query as Extract<typeof query, { type: "query" }>).querySpec,
          sql: "CREATE TABLE t AS SELECT 1 AS a",
        },
      } as typeof query),
    ).toBe(false);
  });
});

describe("queries in the panel", () => {
  it("stay on the canvas until the project keeps them in the panel, which a new project does", () => {
    expect(offCanvasIds(base()).size).toBe(0);
    const plain = base();
    expect(canvasProject(plain)).toBe(plain);
    expect(hasQueriesToMove(base())).toBe(true);
    expect(createProject().settings.queriesInPanel).toBe(true);
    expect(hasQueriesToMove(inPanel())).toBe(false);
  });

  it("take a query that ends its flow off the canvas with the outputs it feeds; one that feeds a step stays", () => {
    const p = inPanel();
    expect([...offCanvasIds(p)].sort()).toEqual(["out", "perUser", "rate"]);
    const shown = canvasProject(p);
    expect(shown.nodes.map((n) => n.id)).toEqual([
      "files",
      "script",
      "log",
      "docs",
      "trim",
      "clean",
      "middle",
      "after",
    ]);
    expect(
      shown.edges.every(
        (e) => !["rate", "out", "perUser"].includes(e.to.nodeId),
      ),
    ).toBe(true);
    expect(projectOutline(p).queries.map((r) => r.offCanvas)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("are left out of auto layout, which moves only what the canvas draws", () => {
    const p = inPanel();
    const laid = autoLayout(p);
    const at = (q: Project, id: string) =>
      q.nodes.find((n) => n.id === id)!.position;
    expect(at(laid, "rate")).toEqual(at(p, "rate"));
    expect(at(laid, "out")).toEqual(at(p, "out"));
    expect(laid.nodes.length).toBe(p.nodes.length);
    expect(at(laid, "docs").x).toBeGreaterThan(at(laid, "script").x);
  });
});
