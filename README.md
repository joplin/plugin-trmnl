# Joplin TRMNL Plugin

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
7. After completing the Joplin configuration, run **Tools** > **Test TRMNL connection** (or **Push search results to TRMNL**) to send the first payload — this registers the variable schema with TRMNL.
8. Add the plugin to a **Playlist** so it appears in your device's screen rotation.

See the [TRMNL Private Plugins documentation](https://docs.usetrmnl.com/go/private-plugins) for the canonical reference on the webhook strategy, payload shape, and Liquid templating.

## Configuration

Go to **Settings** > **TRMNL** and configure:

| Setting | Description |
|---------|-------------|
| TRMNL Webhook URL | The webhook URL from your TRMNL private plugin |
| Search Query | Joplin search query (e.g., `tag:todo type:note`) |
| Display Mode | `List of notes` (titles only) or `Single note (with body)` |
| Result Limit | Maximum number of notes to include in list mode (default: 5) |
| Push Interval | Automatic push interval in minutes (0 to disable) |
| Include Updated Time | Include last updated time for each note |

In **Single note** mode, the most recent matching note is sent with its body
(truncated to fit the device). `Result Limit` is ignored in this mode.

## Usage

### Manual Push

Go to **Tools** > **Push search results to TRMNL**

### Test Connection

Go to **Tools** > **Test TRMNL connection**

## TRMNL Template

The plugin sends data in this format. The `mode` field indicates which view to render.

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

**Single-note mode payload:** (no `query` field — the note's title is the headline)

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
      "body": "Check the auth refactor and the migration script before Friday..."
    },
    "pushed_at": "2026-03-13 14:00"
  }
}
```

The note body is stripped of basic Markdown syntax (images, links, emphasis, code
fences) and truncated to ~1200 characters so it fits the TRMNL "full" view on
the device.

The following template handles both modes and renders correctly on the TRMNL
e-ink display. Paste it into the **Markup** field of your Private Plugin's
**Full** view:

```html
<div class="view view--full">
  {% if mode == "single" and note %}
    <div class="title title--bold">{{ note.title }}</div>
    {% if note.updated %}
      <div class="meta">{{ note.updated }}</div>
    {% endif %}
    <div class="content content--center" style="margin-top: 12px; line-height: 1.35; font-size: 22px; white-space: pre-wrap;">
      {{ note.body }}
    </div>
  {% else %}
    <div class="title title--bold">{{ title }}</div>
    <div class="meta">{{ query }} • {{ count }} notes</div>

    <div class="list" style="margin-top: 12px;">
      {% for item in items %}
        <div class="item" style="padding: 6px 0; border-bottom: 1px solid #000;">
          <span class="item__title" style="font-weight: bold;">{{ item.title }}</span>
          {% if item.updated %}
            <span class="item__meta" style="float: right; opacity: 0.7;">{{ item.updated }}</span>
          {% endif %}
        </div>
      {% endfor %}
    </div>
  {% endif %}

  <div class="footer" style="position: absolute; bottom: 8px; left: 0; right: 0; text-align: center; font-size: 14px; opacity: 0.6;">
    Updated {{ pushed_at }}
  </div>
</div>
```

Notes for getting it to render well on the device:

- TRMNL's "full" layout is ~800×480 pixels of 1-bit e-ink — keep font sizes
  generous (20–24px for body text) and avoid color, shadows, or thin strokes.
- The `white-space: pre-wrap` on the single-note body preserves paragraph
  breaks from the original Joplin note.
- If your notes are short, lower `SINGLE_NOTE_BODY_MAX_CHARS` in the source
  for a tighter fit; if they're long, raise it and reduce the font size in
  the template.

## Building

```bash
npm install
npm run dist
```

The plugin will be created at `publish/org.joplinapp.TrmnlPlugin.jpl`.

## License

MIT
