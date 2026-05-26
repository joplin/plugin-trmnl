// markdown-it exports as `module.exports = MarkdownIt`. Using require avoids
// the esModuleInterop flag issue with `import` syntax.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MarkdownIt = require('markdown-it');

// TRMNL caps merge_variables payloads at ~2 KB on the free plan. Reserve a
// few hundred bytes for the JSON envelope and truncate the rendered HTML
// body to this budget.
export const BODY_HTML_MAX_BYTES = 1800;

const md = new MarkdownIt({
	html: true,
	linkify: false,
	typographer: false,
	breaks: false,
});

// Disable elements TRMNL can't render well on its small e-ink screen.
// Tables in particular produce ~200 bytes of <thead>/<tbody> boilerplate
// and overflow the 800px viewport.
md.disable(['table']);

// Links: TRMNL can't follow them, so unwrap to plain text and save the
// bytes the href attribute would cost.
md.renderer.rules.link_open = () => '';
md.renderer.rules.link_close = () => '';

// Images: keep external HTTPS images, drop Joplin resource references
// (`:/abc...`) since those URLs aren't reachable from TRMNL's servers.
const defaultImageRender = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
	const src = tokens[idx].attrGet('src') || '';
	if (src.startsWith(':/') || src.startsWith('joplin-content://')) return '';
	return defaultImageRender ? defaultImageRender(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

// Fenced code blocks: strip the `language-xyz` class since TRMNL doesn't
// do syntax highlighting and the class is wasted bytes.
md.renderer.rules.fence = (tokens, idx) => {
	const content = md.utils.escapeHtml(tokens[idx].content);
	return `<pre><code>${content}</code></pre>`;
};

// Prefix list items with the appropriate marker glyph at the markdown level
// (rather than relying on CSS pseudo-elements which TRMNL's renderer handles
// inconsistently). Bulleted items get "• ", GFM task items get "☐ " / "☑ ".
md.core.ruler.after('inline', 'list_markers', (state) => {
	const tokens = state.tokens;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.type !== 'inline') continue;
		if (!token.children || !token.children.length) continue;

		// Only operate on inline tokens that are the first child of a list item.
		// The token directly before an inline is paragraph_open; before that
		// should be list_item_open for us to act.
		if (i < 2) continue;
		if (tokens[i - 1].type !== 'paragraph_open') continue;
		if (tokens[i - 2].type !== 'list_item_open') continue;

		// Skip ordered lists — they keep their numbers (we don't strip those).
		// We need to find the enclosing list to know if it's bulleted.
		let listType: 'bullet' | 'ordered' | null = null;
		for (let j = i - 2; j >= 0; j--) {
			if (tokens[j].type === 'bullet_list_open') { listType = 'bullet'; break; }
			if (tokens[j].type === 'ordered_list_open') { listType = 'ordered'; break; }
		}
		if (listType !== 'bullet') continue;

		const first = token.children[0];
		if (first.type !== 'text') continue;

		const checkMatch = first.content.match(/^\[([ xX])\]\s?(.*)$/);
		if (checkMatch) {
			const checked = checkMatch[1].toLowerCase() === 'x';
			first.content = `${checked ? '☑' : '☐'} ${checkMatch[2]}`;
		} else {
			first.content = `• ${first.content}`;
		}
	}
});

function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

export function truncateHtmlToBytes(html: string, maxBytes: number): { html: string; truncated: boolean } {
	if (byteLength(html) <= maxBytes) return { html, truncated: false };

	const boundaryRegex = /<\/(?:p|li|ul|ol|h[1-6]|blockquote|pre)>/gi;
	let lastSafeEnd = -1;
	let match: RegExpExecArray | null;
	while ((match = boundaryRegex.exec(html)) !== null) {
		const candidate = html.slice(0, match.index + match[0].length);
		if (byteLength(candidate) <= maxBytes - 16) {
			lastSafeEnd = match.index + match[0].length;
		} else {
			break;
		}
	}

	if (lastSafeEnd < 0) {
		return { html: html.slice(0, maxBytes - 16) + '…', truncated: true };
	}

	return { html: html.slice(0, lastSafeEnd) + '<p>…</p>', truncated: true };
}

export function renderNoteBody(markdown: string): { html: string; truncated: boolean } {
	if (!markdown) return { html: '', truncated: false };
	const rendered = md.render(markdown).trim();
	return truncateHtmlToBytes(rendered, BODY_HTML_MAX_BYTES);
}
