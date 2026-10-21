# Cleaning data

Cleaning in Puddle is a chain of steps, each in a Transform node wired after the one before. Each step does one thing, such as trimming spaces or parsing dates, and the steps run in order along the wires. Nothing changes your file: the steps are a recipe that DuckDB runs each time you look at the data.

**Fix all** on the Issues panel adds the steps for every problem Puddle found in one go (see {doc}`analysing`). Otherwise there are three ways to add a step: the quick-fix bar, which covers the common fixes in one click; the column menu, which opens when you right-click a column in the results; and the **Add** menu in the toolbar, which has every step. All three file the steps under the same groups (Clean, Change type, Columns, Rows, Text, Dates, Numbers, Reshape and Advanced), so a step is found under one name wherever it is offered. Each gives the step a Transform node of its own after the node you are looking at, so the canvas reads like Power Query's applied steps laid out left to right. A Transform can also hold several steps: **Add step** in the inspector adds to the node you have open.

## Quick fixes

Select one or more column headers in the results table, and the quick-fix bar appears above it. Click a header to select it, Ctrl+click (Command+click on a Mac) to add another, or Shift+click to select a range. The chips sit in the order of the step groups, Clean first, then Change type, Rows and Text; hover one to see its group.

![The contact list with name and city selected, and the quick-fix bar above the results](_static/screenshots/quickfix-selected.png)

![The quick-fix bar](_static/screenshots/quickfix-bar.png)

| Fix | What it adds |
| --- | --- |
| Trim | Removes spaces from both ends of each value. |
| Collapse spaces | Turns runs of spaces inside a value into one. |
| Empty to null | Treats empty text as a missing value. |
| Non-printing | Removes invisible characters. |
| Parse numbers | Reads text such as `£1,234.50` as a number. |
| Parse dates | Reads text as dates, detecting every format the column uses. |
| Remove duplicates | Removes rows that repeat in the selected columns. |
| Case | UPPER CASE, lower case, Title Case or Sentence case. |

![The Case menu: UPPER CASE, lower case, Title Case and Sentence case](_static/screenshots/quickfix-case-menu.png)

A fix lands where you're looking. On a source, it adds a Transform node after the source. On a Transform, it adds the step after the one you're viewing, so you can fix things in the order you find them.

![After three fixes: three Transform nodes in a line, and tidy names and cities](_static/screenshots/quickfix-applied.png)

## Steps in the inspector

Select a Transform node to see its **Applied steps** in the inspector. Each is labelled by what it did, such as "Trimmed name, city". A node with one step shows that step's settings straight away; with several, select a step to change its settings below the list.

![A Transform's applied steps, with the selected step's settings below](_static/screenshots/steps-settings.png)

With a step selected you can:

- change its settings, and see the results update straight away;
- turn it off with **Enabled**, to see the data without it;
- rename it with **Label** (the label then stops following the settings);
- drag it up or down the list by its handle (or press Alt+Up or Alt+Down) to run it earlier or later;
- delete it with **Delete step**.

Undo (Ctrl+Z) and redo (Ctrl+Shift+Z or Ctrl+Y) cover every change, even with focus still on the setting you just changed. See [Undo and redo](projects.md#undo-and-redo).

## Seeing the data at any step

The results show the data after the selected step, and the results title says which ("Transform 1 · step 1"). Select an earlier step to see the data as it was there, and an eye marks the step being viewed. This is the quickest way to find which step changed something.

![The data viewed at step 1, before the case change](_static/screenshots/steps-view-earlier.png)

## The column menu

Right-click a column header in the results table, or click the arrow at the right of a header, to open the column menu. It works on the columns selected in the results: right-clicking a column that isn't selected selects it first. With a header selected, the context menu key or Shift+F10 opens it from the keyboard.

![The column menu for the city column](_static/screenshots/column-menu.png)

The top of the menu has the steps you reach for most: **Replace values**, **Remove matching rows**, **Keep matching rows**, **Remove empty rows**, **Remove duplicates**, **Keep duplicates** and the two sorts, then a submenu for each step group the rest fall in, named as the **Add** menu names them (below). Under them, **Summarise** has **Group by this column** (or these columns) and, for one column, **Pivot into columns**; both open the pivot editor, where you choose what to summarise and how (see {doc}`reshaping`). **Keep duplicates** shows only the rows whose value in the selected columns appears more than once, every copy of them, so you can look at the repeats before deciding what to do. The submenus hold:

| Submenu | What's in it |
| --- | --- |
| Clean | Trim, Collapse spaces, Remove non-printing characters, Empty text to null. |
| Change type | Parse numbers, Parse dates, To text, To whole number, To decimal number. |
| Columns | Rename, Duplicate column (marked New column), Split column, Move to the front, Remove column, Remove other columns. |
| Rows | Fill down, Fill up. |
| Text | UPPER CASE, lower case, Title Case, Find and replace. |

![The Text submenu open beside the column menu](_static/screenshots/column-menu-submenu.png)

Right-click a cell and the menu adds a **This value** group at the top for the value in that cell: replace it, keep only the rows that have it, or remove the rows that have it.

![The column menu for a cell holding London, with its This value group](_static/screenshots/column-menu-cell.png)

Like a quick fix, a step from the column menu lands where you're looking (see [Quick fixes](#quick-fixes)). Items that end in "…" open the step's settings, or a short dialog, before anything is added.

### Replace values

**Replace values** swaps whole values for another value. Choose what to find: a value you type, empty values (null), or empty values and blank text. Then type what goes in their place, or turn on **Replace with an empty value (null)**. A typed value matches the whole value, not part of it, and matches case unless you turn off **Match case** in the step's settings. To change text inside a value, use **Find and replace** instead.

![The Replace values dialog, set to replace empty values in city with the word empty](_static/screenshots/column-menu-replace.png)

A number or date column can't hold a word such as `empty`. Turn on **Change to text** and the column becomes text first, so the word fits. Puddle turns it on for you when the replacement wouldn't fit, and warns you if you turn it off.

### Each step as a new node

**Add each step as a new node** is on for a new project: every step you add from the Add menu or the results table (by the column menu or a quick fix) gets a Transform node of its own, wired after the one you're viewing, the way Power Query lists its applied steps. Turn it off in the project settings (the inspector's **Project** tab) to stack those steps into the Transform you're viewing instead. Viewing an earlier step of a Transform always adds the step in place, after the one you're viewing. A stacked Transform's card lists its steps on the canvas, and a group of one-step nodes can [merge into one node](#merging-a-group-into-one-node) and come apart again.

## The Add menu

**Add** in the toolbar lists every step after the sources and the other nodes, grouped as Clean, Change type, Columns, Rows, Text, Dates, Numbers, Reshape and Advanced. Steps that add a column rather than changing one, such as Duplicate column, Text length and Time between dates, are marked **New column**. Type to search it (a group's name finds its steps), or press T on the canvas to open it with the search focused. A new step starts on the columns selected in the results, and goes after the selected node. **Add step** in the inspector lists the same steps, in the same groups, and adds to the open node (/ opens it with its search focused).

![The Add menu with its search box](_static/screenshots/steps-add-menu.png)

The {doc}`step-reference` describes them all.

## Merging a group into one node

A group is the way to bundle nodes (see [Groups](canvas.md#groups)): right-click a Transform and choose **Group the chain** to gather the line of Transforms it is in. A group that is a line of Transforms can also run as one node: right-click the group and choose **Merge into one node**. The merged node runs their steps in order, and **Split into the original nodes**, on the group's menu or in the inspector, puts them back, still in the group. Either way the data that comes out is the same; merging only changes how many nodes the canvas shows. The group's menu also saves the steps as a template (see [Templates](projects.md#templates)).
