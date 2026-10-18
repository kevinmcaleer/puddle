# Projects

A project is your flow: its sources (how to read them, not their data), nodes, steps, rules, notes and settings. Puddle saves it in your browser as you work, so there's no save button.

## The projects list

**All projects**, in the project menu (click the project's name in the toolbar), opens the home screen: your projects, newest first, with the samples and the recipe gallery below. **New project** starts an empty one, and each project's **...** menu renames, duplicates or deletes it. Undo on this screen brings back a project deleted by mistake (see [Undo and redo](#undo-and-redo)).

![The projects home screen with samples and the recipe gallery](_static/screenshots/projects-home.png)

The project menu also renames the open project, saves and opens project files, and shares and opens recipes. In Puddle, *export* only ever means data leaving it, from an Output node.

![The project menu](_static/screenshots/projects-menu.png)

## Undo and redo

Every change you make can be undone: **Undo** and **Redo** in the toolbar, or Ctrl+Z to undo and Ctrl+Shift+Z or Ctrl+Y to redo (Cmd on a Mac). Hold the keys to step back through several changes.

- **In a project**, undo covers everything you change: adding sources and nodes, wiring, moving and grouping nodes, steps and their settings, read options, rules, the query designer, notes, renaming, and the column mapping for a recipe. One action is one undo step, so several files chosen or dropped together come off with one undo. The keys work from the canvas and from a field you've just changed, such as a drop-down or a switch; in a text box you're still typing in, they undo the typing first.
- **On the projects screen**, undo brings back a deleted project (with its saved file access and its sync), and undoes renaming or duplicating one.
- **In the templates library**, the undo and redo buttons beside **Open template file** (or the keys) undo adding, importing, renaming and deleting templates.

A few things aren't undo steps, because they record what happened rather than change your work: exports (the export history), which file a source is attached to, and moving around the canvas or changing what the results show. Undoing never takes a source back to a file it no longer reads. When sync brings in a newer version of the open project from another browser, that is an undo step too, so undo returns to the version you had.

The undo history lasts while the tab is open. Projects themselves are saved as you go.

## Moving projects between browsers

Projects live in this browser's storage. To move one, or keep a backup, choose **Save project file**: it downloads a `.puddle.json` file with the steps, notes and settings (and any pasted rows), but no file data. **Open project file** opens one again.

To have a project follow you from browser to browser automatically, sync it:

GitHub Gist
: **Sync to GitHub Gist** keeps the project in a secret Gist. It needs a fine-grained personal access token with the Gists permission only; the token stays in this browser. **Open from GitHub Gist** on the home screen brings a synced project into another browser.

Google Drive
: Where the site has been set up with a Google client ID, **Sync to Google Drive** keeps the project in a Puddle folder in your Drive. Puddle can see only the files it makes there, and keeps the sign-in for an hour at most.

![Connecting a project to a GitHub Gist](_static/screenshots/sync-gist.png)

Sync only ever sends the project file: steps, notes and settings. Your data, and any pasted rows, stay in this browser. If the same project changes in two places, Puddle asks which to keep.

## Notes

The **Notes** tab in the inspector holds the project's notes: Markdown you write about the project, such as where the files come from or what each step is for. **Preview** shows it formatted. Each node has its own notes too, in the inspector.

![Writing the project's notes](_static/screenshots/projects-notes.png)

## Templates

A template is a Transform node's steps, saved to use again in any project. Select a Transform and choose **Save as template** in the inspector. The template remembers which columns its steps read.

![Saving a Transform's steps as a template](_static/screenshots/templates-save.png)

To use one, choose **From template** in **Add**. The library shows each template's steps and the columns it expects. When the input calls a column something else, choose which column to use instead; steps whose columns are missing are turned off rather than failing. A template can also be saved to a file (**Save to file**) and opened again (**Open template file**).

![The templates library, with a template's steps and expected columns](_static/screenshots/templates-library.png)

## Recipes

A recipe is a whole pipeline with no data in it: sources (as the columns they expect), steps, rules and outputs. Share one with a colleague, or keep one for a job you do every month. **Share as recipe** in the project menu saves the open project as a `.puddle-recipe.json`, leaving out rows, file names, pasted data and anything else private.

The recipe gallery on the home screen has a few to start from.

![The recipe gallery](_static/screenshots/recipes-gallery.png)

**Use recipe** (or **Open recipe** for a file) makes a new project from it, and asks you to attach a file for each source. Choose a file with the columns it expects and the project runs; if the columns are named differently, Puddle asks which to use.

![A new project from a recipe, waiting for its file](_static/screenshots/recipes-attach.png)
