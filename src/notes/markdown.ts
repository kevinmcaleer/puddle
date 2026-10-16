import MarkdownIt from 'markdown-it';

/**
 * Markdown for project notes. Raw HTML is off, so tags and scripts in a note are escaped and show as text;
 * markdown-it's link check drops javascript:, vbscript:, file: and data: links. Images are off too, so a note
 * never makes the browser fetch anything. Links open in a new tab without access to this one.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
md.disable('image');

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, idx, options);
};

/** The note as safe HTML, for the rendered view. */
export const renderMarkdown = (text: string): string => md.render(text);
