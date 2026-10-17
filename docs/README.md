# Puddle user guide

The user guide, built with Sphinx from the Markdown pages here. See [about-these-docs.md](about-these-docs.md) for how to build it and retake the screenshots:

```sh
python3 -m venv .venv && source .venv/bin/activate && pip install -r docs/requirements.txt
npm run docs                        # docs/_build/html/index.html
npm run docs:screenshots            # retakes docs/_static/screenshots/
```
