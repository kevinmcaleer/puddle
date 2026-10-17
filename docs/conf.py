# Sphinx configuration for the Puddle user guide. Build with `npm run docs` (see docs/README.md).

project = 'Puddle'
author = 'Kevin McAleer'
copyright = '2026, Kevin McAleer'

extensions = ['myst_parser']
source_suffix = {'.md': 'markdown'}
myst_enable_extensions = ['colon_fence', 'deflist']
myst_heading_anchors = 3

# The screenshot script, its config and the docs' own readme aren't pages.
exclude_patterns = ['_build', 'screenshots', 'README.md', 'playwright.config.ts', 'requirements.txt']

html_theme = 'furo'
html_title = 'Puddle'
html_static_path = ['_static']
html_css_files = ['puddle.css']
html_js_files = ['puddle.js']
# The design system's brand teal and accent amber (src/design-system/tokens.css).
html_theme_options = {
    'light_css_variables': {
        'color-brand-primary': '#0b6b6b',
        'color-brand-content': '#0b6b6b',
    },
    'dark_css_variables': {
        'color-brand-primary': '#4fc2bf',
        'color-brand-content': '#4fc2bf',
    },
    'source_repository': 'https://github.com/kevinmcaleer/puddle/',
    'source_branch': 'main',
    'source_directory': 'docs/',
}
