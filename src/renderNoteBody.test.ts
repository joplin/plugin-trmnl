import { renderNoteBody, truncateHtmlToBytes, BODY_HTML_MAX_BYTES } from './renderNoteBody';

describe('renderNoteBody', () => {
	test('renders empty input as empty string', () => {
		expect(renderNoteBody('').html).toBe('');
		expect(renderNoteBody('').truncated).toBe(false);
	});

	test('renders bold and italic', () => {
		const { html } = renderNoteBody('Some **bold** and *italic* text.');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
	});

	test('renders headings', () => {
		const { html } = renderNoteBody('## Today\n\nSome text.');
		expect(html).toContain('<h2>Today</h2>');
		expect(html).toContain('<p>Some text.</p>');
	});

	test('renders unchecked checkbox with ☐', () => {
		const { html } = renderNoteBody('- [ ] Buy groceries');
		expect(html).toContain('☐ Buy groceries');
	});

	test('renders checked checkbox with ☑', () => {
		const { html } = renderNoteBody('- [x] Buy groceries');
		expect(html).toContain('☑ Buy groceries');
	});

	test('checked detection is case-insensitive', () => {
		const { html } = renderNoteBody('- [X] Done');
		expect(html).toContain('☑ Done');
	});

	test('checkbox items have glyph baked into the text', () => {
		const { html } = renderNoteBody('- [ ] one\n- [x] two');
		expect(html).toContain('☐ one');
		expect(html).toContain('☑ two');
	});

	test('plain bullet items have • baked into the text', () => {
		const { html } = renderNoteBody('- one\n- two');
		expect(html).toContain('<li>• one</li>');
		expect(html).toContain('<li>• two</li>');
	});

	test('mixed checkbox + plain bullet lists each get the right glyph', () => {
		const md = '## Tasks\n\n- [ ] task one\n- [x] task two\n\n## Items\n\n- item A\n- item B';
		const { html } = renderNoteBody(md);
		expect(html).toContain('<li>☐ task one</li>');
		expect(html).toContain('<li>☑ task two</li>');
		expect(html).toContain('<li>• item A</li>');
		expect(html).toContain('<li>• item B</li>');
	});

	test('renders the full sample note from the bug report', () => {
		const md = `## Today

- [ ] Morning workout
- [ ] Finish quarterly report
- [ ] Call insurance provider
- [x] Book dentist appointment
- [ ] Buy groceries

## Meals

- Lunch: Chicken salad
- Dinner: Pasta with vegetables`;
		const { html, truncated } = renderNoteBody(md);
		expect(html).toContain('<h2>Today</h2>');
		expect(html).toContain('<h2>Meals</h2>');
		expect(html).toContain('☑ Book dentist appointment');
		expect(html).toContain('☐ Morning workout');
		expect(html).toContain('<li>• Lunch: Chicken salad</li>');
		expect(truncated).toBe(false);
	});

	test('passes through inline HTML', () => {
		const { html } = renderNoteBody('Hello <span style="color: red">world</span>');
		expect(html).toContain('<span style="color: red">world</span>');
	});

	test('passes through block HTML', () => {
		const { html } = renderNoteBody('<div class="custom">block content</div>');
		expect(html).toContain('<div class="custom">block content</div>');
	});

	test('renders nested lists', () => {
		const { html } = renderNoteBody('- outer\n  - inner');
		expect(html).toContain('<ul>');
		expect(html).toContain('outer');
		expect(html).toContain('inner');
	});

	test('renders inline code', () => {
		const { html } = renderNoteBody('Run `npm install` first.');
		expect(html).toContain('<code>npm install</code>');
	});

	test('unwraps links to plain text (TRMNL cannot follow them)', () => {
		const { html } = renderNoteBody('See [the docs](https://example.com) for more.');
		expect(html).not.toContain('<a ');
		expect(html).not.toContain('href');
		expect(html).toContain('the docs');
	});

	test('keeps external HTTPS images', () => {
		const { html } = renderNoteBody('![pic](https://example.com/x.png)');
		expect(html).toContain('<img');
		expect(html).toContain('src="https://example.com/x.png"');
	});

	test('drops Joplin resource images (:/...)', () => {
		const { html } = renderNoteBody('![alt](:/abc123def456)');
		expect(html).not.toContain('<img');
		expect(html).not.toContain(':/');
	});

	test('strips language-* class from fenced code blocks', () => {
		const { html } = renderNoteBody('```js\nconst x = 1;\n```');
		expect(html).toContain('<pre><code>');
		expect(html).not.toContain('language-');
		expect(html).not.toContain('class=');
		expect(html).toContain('const x = 1;');
	});

	test('escapes HTML inside fenced code blocks', () => {
		const { html } = renderNoteBody('```\n<script>alert(1)</script>\n```');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	test('disables tables (renders as plain text)', () => {
		const md = '| col | col |\n|---|---|\n| a | b |';
		const { html } = renderNoteBody(md);
		expect(html).not.toContain('<table');
		expect(html).not.toContain('<thead');
		expect(html).not.toContain('<td');
	});

	test('long input is truncated and marked', () => {
		const md = 'paragraph one.\n\n' + 'long body. '.repeat(500);
		const { html, truncated } = renderNoteBody(md);
		expect(truncated).toBe(true);
		expect(html.endsWith('<p>…</p>')).toBe(true);
		// length should respect the cap (with a little headroom for the marker)
		expect(html.length).toBeLessThanOrEqual(BODY_HTML_MAX_BYTES);
	});

	test('short input is not truncated', () => {
		const { truncated } = renderNoteBody('Just a short note.');
		expect(truncated).toBe(false);
	});
});

describe('truncateHtmlToBytes', () => {
	test('returns input unchanged if under the limit', () => {
		const html = '<p>short</p>';
		expect(truncateHtmlToBytes(html, 1000)).toEqual({ html, truncated: false });
	});

	test('truncates at a block boundary and appends marker', () => {
		const html = '<p>one</p><p>two</p><p>three</p><p>four</p>';
		const { html: cut, truncated } = truncateHtmlToBytes(html, 40);
		expect(truncated).toBe(true);
		expect(cut.endsWith('<p>…</p>')).toBe(true);
		// must end on a clean </p>, never mid-tag
		expect(cut).not.toMatch(/<p>[^<]*$/);
	});

	test('counts bytes, not characters (handles multi-byte Unicode)', () => {
		// ☑ is 3 bytes in UTF-8 but 1 character
		const html = '<p>☑ ☑ ☑ ☑ ☑ ☑ ☑ ☑ ☑ ☑</p><p>more</p>';
		// 10 checkmarks × 3 bytes + 9 spaces + <p></p> = ~50 bytes for the first p
		const { truncated } = truncateHtmlToBytes(html, 30);
		expect(truncated).toBe(true);
	});
});
