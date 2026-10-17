# Cleaning data

Cleaning in Puddle is a list of steps in a Transform node. Each step does one thing, such as trimming spaces or parsing dates, and the steps run in order. Nothing changes your file: the steps are a recipe that DuckDB runs each time you look at the data.

There are two ways to add steps: the quick-fix bar, which covers the common fixes in one click, and the **Add step** menu, which has every step.

## Quick fixes

Select one or more column headers in the results table, and the quick-fix bar appears above it. Click a header to select it, Ctrl+click (Command+click on a Mac) to add another, or Shift+click to select a range.

![The contact list with name and city selected, and the quick-fix bar above the results](_static/screenshots/quickfix-selected.png)

![The quick-fix bar](_static/screenshots/quickfix-bar.png)

| Fix | What it adds |
| --- | --- |
| Trim | Removes spaces from both ends of each value. |
| Case | UPPER CASE, lower case, Title Case or Sentence case. |
| Collapse spaces | Turns runs of spaces inside a value into one. |
| Empty to null | Treats empty text as a missing value. |
| Parse numbers | Reads text such as `£1,234.50` as a number. |
| Parse dates | Reads text as dates, detecting the format. |
| Non-printing | Removes invisible characters. |
| Remove duplicates | Removes rows that repeat in the selected columns. |

![The Case menu: UPPER CASE, lower case, Title Case and Sentence case](_static/screenshots/quickfix-case-menu.png)

A fix lands where you're looking. On a source, it adds a Transform node after the source. On a Transform, it adds the step after the one you're viewing, so you can fix things in the order you find them.

![After three fixes: a Transform node with three steps, and tidy names and cities](_static/screenshots/quickfix-applied.png)

## Steps in the inspector

Select a Transform node to see its **Applied steps** in the inspector. Each is labelled by what it did, such as "Trimmed name, city". Select a step to change its settings below the list.

![A Transform's applied steps, with the selected step's settings below](_static/screenshots/steps-settings.png)

With a step selected you can:

- change its settings, and see the results update straight away;
- turn it off with **Enabled**, to see the data without it;
- rename it with **Label** (the label then stops following the settings);
- drag it up or down the list by its handle (or press Alt+Up or Alt+Down) to run it earlier or later;
- delete it with **Delete step**.

Undo (Ctrl+Z) and redo (Ctrl+Shift+Z or Ctrl+Y) cover every change.

## Seeing the data at any step

The results show the data after the selected step, and the results title says which ("Transform 1 · step 1"). Select an earlier step to see the data as it was there, and an eye marks the step being viewed. This is the quickest way to find which step changed something.

![The data viewed at step 1, before the case change](_static/screenshots/steps-view-earlier.png)

## The Add step menu

**Add step**, above the step list, has every step, grouped as Clean, Columns, Rows, Text, Dates, Numbers, Reshape and Advanced. Type to search it. A new step starts on the columns selected in the results.

![The Add step menu with its search box](_static/screenshots/steps-add-menu.png)

The {doc}`step-reference` describes them all.

## Grouping

Several Transform nodes in a row can become one: select them, then choose **Group into one node** on the selection bar (or press G). The group runs their steps in order, and can be ungrouped again.
