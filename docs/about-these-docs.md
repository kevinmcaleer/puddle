# About these docs

These pages are written in Markdown (MyST) and built with [Sphinx](https://www.sphinx-doc.org) and the Furo theme. They live in `docs/` in the repository.

## Building them

With Python 3.10 or later:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r docs/requirements.txt
npm run docs        # writes docs/_build/html
```

`npm run docs` builds with warnings as errors, so a broken link or a missing picture fails the build. CI builds the docs on every pull request.

## The screenshots

Every picture is taken by a script, so they can all be taken again when the app changes:

```sh
npm run docs:screenshots
```

It builds the app, then drives it in Chromium with Playwright (`docs/screenshots/*.spec.ts`), at one window size, locale and theme, and saves each picture to `docs/_static/screenshots/`. Each test captures the pictures for one page and checks the app got where it should on the way, so a change to the app that breaks a picture fails loudly rather than leaving a stale one. Commit the pictures that changed along with the change that changed them.

The taxi tutorial's pictures (`docs/screenshots/tutorial.spec.ts`) are taken on the TLC's real files, which are too big to keep in the repository. `npm run docs:tutorial-data` downloads them into `docs/_data` first; without them that test is skipped, except in CI. To retake those pictures on a pull request, add the **tutorial screenshots** label: a workflow retakes them on the real files and commits any that changed to the branch.

A unit test (`tests/docs.test.ts`) checks that every picture the pages use exists, that every picture is used, and that the step and rule references list every step and rule the app has.
