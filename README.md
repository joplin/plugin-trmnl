# Joplin TRMNL Push

Push Joplin search results to a [TRMNL](https://usetrmnl.com/) private plugin webhook.

## Features

- Configure a Joplin search query to find matching notes
- Push results to TRMNL as merge variables
- Two display modes: list of notes, or single note with body
- Manual push via Tools menu command
- Optional periodic automatic push
- Configurable result limit
- Optional updated time for each note

## Installation

1. Download the latest `.jpl` file from the releases
2. In Joplin, go to **Settings** > **Plugins**
3. Click the gear icon and select **Install from file**
4. Select the downloaded `.jpl` file

## TRMNL Setup

Before configuring the Joplin plugin, set up a Private Plugin on the TRMNL side:

1. Log into [usetrmnl.com](https://usetrmnl.com/) and go to **Plugins**.
2. Add a new **Private Plugin**.
3. Give it a name (e.g. "Joplin Search").
4. Set the **Strategy** to **Webhook** — TRMNL will generate a unique webhook URL.
5. Copy that URL — you'll paste it into the Joplin plugin settings below.
6. In the TRMNL plugin editor, paste the markup template (see [TRMNL Template](#trmnl-template) below). Merge variables become available once data has been pushed at least once.
7. After completing the Joplin configuration, run **Tools** > **Push search results to TRMNL** to send the first payload — this registers the variable schema with TRMNL so the merge variables become available in the template editor.
8. Add the plugin to a **Playlist** so it appears in your device's screen rotation.

See the [TRMNL Private Plugins documentation](https://docs.usetrmnl.com/go/private-plugins) for the canonical reference on the webhook strategy, payload shape, and Liquid templating.

## Configuration

Go to **Settings** > **TRMNL Push** and configure:

| Setting | Description |
|---------|-------------|
| TRMNL Webhook URL | The webhook URL from your TRMNL private plugin |
| Search Query | Joplin search query (e.g., `tag:todo type:note`) |
| Display Mode | `List of notes` (titles only) or `Single note (with body)` |
| Result Limit | Maximum number of notes to include in list mode (default: 5) |
| Push Interval | Automatic push interval in minutes (0 to disable) |
| Include Updated Time | Include last updated time for each note |

In **Single note** mode, the most recent matching note is sent with its body. `Result Limit` is ignored in this mode.

## Usage

Go to **Tools** > **Push search results to TRMNL** to push the current search results to your TRMNL device. Run this once after setting up your config to verify everything works and to register the merge variables with TRMNL.

## TRMNL Template

The plugin sends one of two payload shapes, depending on the **Display Mode** setting.

**List mode payload:**

```json
{
	"merge_variables": {
		"title": "Joplin Search",
		"query": "tag:todo type:note",
		"count": 3,
		"mode": "list",
		"items": [
			{ "title": "Review PR", "updated": "2026-03-13 09:20" },
			{ "title": "Release notes", "updated": "2026-03-12 18:05" }
		],
		"pushed_at": "2026-03-13 14:00"
	}
}
```

**Single-note mode payload:**

```json
{
	"merge_variables": {
		"title": "Joplin Search",
		"count": 1,
		"mode": "single",
		"items": [ { "title": "Review PR", "updated": "2026-03-13 09:20" } ],
		"note": {
			"title": "Review PR",
			"updated": "2026-03-13 09:20",
			"body": "Check the auth refactor...",
			"body_html": "<p>Check the <strong>auth refactor</strong>...</p>"
		},
		"pushed_at": "2026-03-13 14:00"
	}
}
```

`note.body` is the raw Markdown of the note. `note.body_html` is the note rendered to HTML — use this in your template so bold, italics, lists, checkboxes, and headings render properly on the device.

A few things to keep in mind:

- **Keep matched notes short.** Long notes are clipped to fit TRMNL's payload limit, ending with `…`.
- **Joplin attachment images won't display.** Use external HTTPS image URLs (`![alt](https://...)`) for any images you want on the device.

The following template handles both display modes. Paste it into the **Markup** field of your Private Plugin's **Full** view:

```html
<style>
	.note-body p { margin: 0 0 10px; }
	.note-body ul, .note-body ol { margin: 0 0 10px; padding-left: 24px; }
	.note-body ul { list-style: none; padding-left: 4px; }
	.note-body li { margin: 2px 0; }
	.note-body h1, .note-body h2, .note-body h3 { margin: 10px 0 6px; }
</style>

<div class="view view--full">
	<div style="padding: 16px; box-sizing: border-box; height: 100%; display: block;">
		{% if mode == "single" and note %}
			<div style="font-size: 26px; font-weight: bold;">{{ note.title }}</div>
			{% if note.updated %}
				<div style="font-size: 14px; opacity: 0.7; margin-top: 2px;">{{ note.updated }}</div>
			{% endif %}
			<div class="note-body" style="margin-top: 12px; line-height: 1.35; font-size: 20px;">
				{{ note.body_html }}
			</div>
		{% else %}
			<div style="font-size: 26px; font-weight: bold;">{{ title }}</div>
			<div style="font-size: 14px; opacity: 0.7;">{{ query }} • {{ count }} notes</div>
			<div style="margin-top: 12px;">
				{% for item in items %}
					<div style="padding: 6px 0; border-bottom: 1px solid #000;">
						<span style="font-weight: bold;">{{ item.title }}</span>
						{% if item.updated %}
							<span style="float: right; opacity: 0.7;">{{ item.updated }}</span>
						{% endif %}
					</div>
				{% endfor %}
			</div>
		{% endif %}
	</div>

	<div style="position: absolute; bottom: 8px; left: 0; right: 0; text-align: center; font-size: 14px; opacity: 0.6;">
		Updated {{ pushed_at }}
	</div>
</div>
```

Tips for adjusting the template:

- Edit the `<style>` block to change spacing and font sizes for paragraphs, lists, and headings inside the note body.
- Keep font sizes generous (18–22px for body text) for readable e-ink rendering.
- Checkboxes in your notes appear as `☐` (unchecked) and `☑` (checked) inline in list items.

### Compact layouts (half / quadrant)

TRMNL devices can mix multiple plugins on one screen, which uses smaller layouts: **Half horizontal**, **Half vertical**, and **Quadrant**. If you only use the Full layout you can skip these and ignore the "view not available" warnings. Otherwise, here are condensed templates for each.

**Half horizontal:**

```html
<style>
	.note-body p { margin: 0 0 6px; }
	.note-body ul, .note-body ol { margin: 0 0 6px; padding-left: 20px; }
	.note-body ul { list-style: none; padding-left: 4px; }
	.note-body li { margin: 1px 0; }
</style>

<div class="view view--half_horizontal">
	<div style="padding: 12px; box-sizing: border-box; height: 100%; display: block;">
		{% if mode == "single" and note %}
			<div style="font-size: 24px; font-weight: bold;">{{ note.title }}</div>
			<div class="note-body" style="margin-top: 6px; font-size: 16px; line-height: 1.3; max-height: 180px; overflow: hidden;">
				{{ note.body_html }}
			</div>
		{% else %}
			<div style="font-size: 24px; font-weight: bold;">{{ title }} <span style="font-weight: normal; opacity: 0.7;">• {{ count }}</span></div>
			<div style="margin-top: 6px;">
				{% for item in items limit: 4 %}
					<div style="padding: 3px 0; font-size: 18px;">• {{ item.title }}</div>
				{% endfor %}
			</div>
		{% endif %}
	</div>
</div>
```

**Half vertical:**

```html
<style>
	.note-body p { margin: 0 0 8px; }
	.note-body ul, .note-body ol { margin: 0 0 8px; padding-left: 20px; }
	.note-body ul { list-style: none; padding-left: 4px; }
	.note-body li { margin: 2px 0; }
	.note-body h1, .note-body h2, .note-body h3 { margin: 8px 0 4px; }
</style>

<div class="view view--half_vertical">
	<div style="padding: 12px; box-sizing: border-box; height: 100%; display: block;">
		{% if mode == "single" and note %}
			<div style="font-size: 22px; font-weight: bold;">{{ note.title }}</div>
			{% if note.updated %}
				<div style="font-size: 13px; opacity: 0.7; margin-top: 2px;">{{ note.updated }}</div>
			{% endif %}
			<div class="note-body" style="margin-top: 10px; font-size: 16px; line-height: 1.35; max-height: 400px; overflow: hidden;">
				{{ note.body_html }}
			</div>
		{% else %}
			<div style="font-size: 22px; font-weight: bold;">{{ title }}</div>
			<div style="font-size: 13px; opacity: 0.7;">{{ count }} notes</div>
			<div style="margin-top: 10px;">
				{% for item in items limit: 8 %}
					<div style="padding: 4px 0; font-size: 16px; border-bottom: 1px solid #000;">
						{{ item.title | truncate: 30 }}
					</div>
				{% endfor %}
			</div>
		{% endif %}
	</div>
</div>
```

**Quadrant:**

```html
<style>
	.note-body p { margin: 0 0 4px; }
	.note-body ul, .note-body ol { margin: 0 0 4px; padding-left: 18px; }
	.note-body ul { list-style: none; padding-left: 4px; }
	.note-body li { margin: 1px 0; }
</style>

<div class="view view--quadrant">
	<div style="padding: 8px; box-sizing: border-box; height: 100%; display: block;">
		{% if mode == "single" and note %}
			<div style="font-size: 20px; font-weight: bold;">{{ note.title | truncate: 60 }}</div>
			<div class="note-body" style="margin-top: 4px; font-size: 13px; line-height: 1.3; max-height: 180px; overflow: hidden;">
				{{ note.body_html }}
			</div>
		{% else %}
			<div style="font-size: 18px; font-weight: bold;">{{ title }} ({{ count }})</div>
			<div style="margin-top: 4px;">
				{% for item in items limit: 3 %}
					<div style="padding: 2px 0; font-size: 15px;">• {{ item.title | truncate: 40 }}</div>
				{% endfor %}
			</div>
		{% endif %}
	</div>
</div>
```

Adjust font sizes, item limits, and spacing in any template if your notes are typically shorter or longer than the defaults.

## Building

```bash
npm install
npm run dist
```

The plugin will be created at `publish/org.joplinapp.plugins.TrmnlPlugin.jpl`.

## License

MIT
