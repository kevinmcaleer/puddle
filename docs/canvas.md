# The canvas

The canvas is where your flow lives. Tabs above it switch to the {doc}`relationships` view and, once the project has a Query node, the {doc}`query designer <query-designer>`. Data runs left to right along wires: sources feed transforms and other nodes, and those feed outputs. Every node shows its row and column counts, and a badge when one of its rules fails.

![A flow on the canvas: two sources wired into a Join node](_static/screenshots/combine-join.png)

## Kinds of node

**Add** in the toolbar adds a source, a node after the selected one, or a step, which goes in a Transform node of its own after the selected node. A node you add is selected and shown in the results straight away (unless the results are pinned). New nodes always arrive wired, so with nothing selected the nodes and steps wait, marked **Select a node first**; sources can be added at any time.

![The Add menu: sources, then the nodes From template, Join, Append, Lookup, Query and Output, then every step](_static/screenshots/canvas-add-node-menu.png)

You can also add the next node from where you are looking: click a node's right-hand connector. A menu opens beside it with the same nodes and steps as the Add menu, the steps in a submenu for each group (**Clean**, **Change type**, **Columns** and so on), and **Search steps** at the end for the Add menu's search. What you pick goes after that node, wired from it. Dragging from the connector still draws a wire.

![Clicking the connector of contacts.csv: Join, Append, Lookup, Query, SQL and Output, then the steps by group with Clean open](_static/screenshots/canvas-connector-menu.png)

| Node | What it does | More |
| --- | --- | --- |
| Source | Reads a file, a web address or pasted rows. | {doc}`sources` |
| Transform | A cleaning step, or a list of them, applied in order. Any step in the Add menu makes one. | {doc}`cleaning` |
| From template | Steps you saved earlier, as a chain of Transforms in a group. | {doc}`projects` |
| Join | Combines two inputs side by side on matching keys. | {doc}`combining` |
| Append | Stacks the rows of two or more inputs. | {doc}`combining` |
| Lookup | Brings columns across from a second input, keeping every row of the first. | {doc}`combining` |
| Query | Designs a query over several tables with a grid, in the style of Access. | {doc}`query-designer` |
| Schema table | A table designed in the Schema view, as a real DuckDB table holding its records and any rows wired into it, checked against its keys, types and checks. | {doc}`schema` |
| SQL | A DuckDB query you write over any nodes wired into it, readable as `input1`, `input2`... or by their names; or a script of `CREATE TABLE` statements. It can read the files of the sources wired into it by name. | {doc}`combining` |
| Script table | One table a script creates with `CREATE TABLE name AS`, in a SQL node or a Query's SQL view, as a node of its own. | {doc}`combining` |
| Output | Marks data that's ready, and exports it. | {doc}`exporting` |

Nodes that are tables in their own right carry a tag on the top edge of their card, so they stand out from the nodes that work on them. **Imported table** marks a source: a file, a web address, a database table or pasted rows. **SQL table** marks a table a script created with `CREATE TABLE name AS`.

## Renaming a node

Give a node a name that says what it holds: select it and press F2, or right-click it and choose **Rename…**, or change **Node name** in the inspector. The name shows on the card and in the results, and it is the name SQL reads the node by: a SQL node or a Query's SQL that reads the node by its old name is rewritten to read it by the new one, as part of the same change, so one undo puts both back. Where the query already uses the new name for something else, it is rewritten to the node's numbered name (`input1`) instead. A renamed source still says which file it reads in the inspector.

## Describing what a node is for

A name says what a node holds; a description says why it is there, in your own words: "combine into a single list", "touchless rate per month". It shows under the node's heading on the canvas, so a flow with many steps reads at a glance. Right-click a node and choose **Add description**, type a few words and press Enter. To change it, right-click the node and choose **Edit description**, or change **Description** in the inspector, under **Node name**. Escape leaves it as it was, and clearing the words removes it. A description is one line of up to 140 characters; the card shows the first two lines of it, and the rest on hover. For anything longer, use the node's notes in the inspector.

![Writing a node's description in place on the canvas](_static/screenshots/canvas-describe.png)

Groups take a description too (see [Groups](#groups)). Descriptions are saved with the project and never change what runs.

## Selecting, viewing and moving

- Click a node to select it. Its settings show in the inspector and its data in the results; a **Viewing** tag marks the node whose data is shown.
- Shift+click adds nodes to the selection. With two or more selected, a bar offers to join, look up, append or query them, to group them (G), or, when they sit in a longer line of Transforms, to **Group the chain**.
- Drag a node to move it. **Auto layout** (L), in the canvas controls at the bottom left, arranges the whole flow neatly.
- Drag from a node's right-hand handle to another node's input to wire them. Click the handle instead to add a node or step after it. Select a wire and press Delete to remove it.
- The zoom buttons sit at the bottom left. An overview map appears at the bottom right when part of the flow is off screen.
- The canvas keeps what you are working on in view. A node you add or select off screen is panned into view, and a project you open, such as a sample, starts with all its nodes showing. A project you have already panned or zoomed opens where you left it.

![The selection bar shown when two sources are selected](_static/screenshots/combine-selection-bar.png)

## Using the keyboard

Arrow keys move between connected nodes and show each one in the results, as a click does (with the results pinned they only select, and V moves the pin to the selected node). Enter opens the selected node, F2 renames it, T opens the Add menu to add a step after it, O adds an Output, and G groups the selected nodes. C starts wiring the selected node: move to another node and press Enter to wire or unwire them. 1, 2, 3 and 4 switch between the canvas, the relationships view, the query designer and the Schema view. **?** lists every shortcut (see {doc}`settings`).

## Groups

A group gathers nodes together and can hide them behind a single card, as node groups do in Blender. It is the one way to bundle nodes: a group can be closed to a card, saved as a template, or merged into one node. Select two or more nodes (Shift+click adds to the selection), then press G or choose **Group** on the selection bar. You can also right-click a selected node and choose **Group**, or **Group the chain** to gather the whole line of Transforms wired one after another through it, which is the usual way to bundle a run of cleaning steps.

A closed group is one card. It has a socket on the left for each wire coming in from outside the group, and one on the right for each result going out, named after the node it comes from. Click a result's name to see its data in the results. Drag from a result's socket to wire it into another node.

![The contact list and its Transform grouped into one card, wired into an Output](_static/screenshots/groups-card.png)

Double-click the card, or click its arrow, to open the group. It opens as a frame round its nodes, so you can work on them as usual, and the frame's arrow closes it again. If other nodes sit where the group's nodes are, opening it moves them along to the right to make room.

![The group open as a frame round contacts.csv and Transform 1](_static/screenshots/groups-open.png)

Right-click a group to open or close it, rename it, describe it, or **Ungroup** it. **Add group description** says what the group's nodes do together, such as "tidy the contact list"; it shows on the closed card and at the top of the open frame, and **Edit group description** changes it. Ungrouping leaves the nodes where they are, wired as they were. Groups only change how the canvas looks: every node runs the same whether its group is open or closed. **Auto layout** treats a closed group as one node.

![The menu of a group that is a line of Transforms](_static/screenshots/groups-menu.png)

A group that is a line of Transforms has more on its menu: **Merge into one node** runs their steps as one Transform and **Split into the original nodes** puts them back (see [Merging a group into one node](cleaning.md#merging-a-group-into-one-node)), and **Save as template** keeps their steps for any project (see [Templates](projects.md#templates)).
