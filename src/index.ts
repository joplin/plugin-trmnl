import joplin from 'api';
import { SettingItemType, MenuItemLocation } from 'api/types';
import { renderNoteBody } from './renderNoteBody';

const SETTING_SECTION = 'trmnlPlugin';

type DisplayMode = 'list' | 'single';

interface SearchResultItem {
	id: string;
	title: string;
	updated_time: number;
	body?: string;
}

interface TrmnlPayload {
	title: string;
	query?: string;
	count: number;
	mode: DisplayMode;
	items: { title: string; updated?: string }[];
	note?: { title: string; updated?: string; body: string; body_html: string };
	pushed_at: string;
}

let pushIntervalId: ReturnType<typeof setInterval> | null = null;

function formatDateTime(timestamp: number): string {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${year}-${month}-${day} ${hours}:${minutes}`;
}

async function getSettings() {
	return {
		webhookUrl: await joplin.settings.value('trmnlWebhookUrl') as string,
		searchQuery: await joplin.settings.value('searchQuery') as string,
		resultLimit: await joplin.settings.value('resultLimit') as number,
		pushIntervalMinutes: await joplin.settings.value('pushIntervalMinutes') as number,
		includeUpdatedTime: await joplin.settings.value('includeUpdatedTime') as boolean,
		displayMode: await joplin.settings.value('displayMode') as DisplayMode,
		debugMode: await joplin.settings.value('debugMode') as boolean,
	};
}

async function fetchSearchResults(query: string, limit: number, includeBody: boolean): Promise<SearchResultItem[]> {
	const results: SearchResultItem[] = [];
	let page = 1;
	let hasMore = true;
	const fields = includeBody
		? ['id', 'title', 'updated_time', 'body']
		: ['id', 'title', 'updated_time'];

	while (hasMore && results.length < limit) {
		const response = await joplin.data.get(['search'], {
			query,
			fields,
			limit: Math.min(limit - results.length, 100),
			page,
		});

		if (response.items && response.items.length > 0) {
			results.push(...response.items);
			hasMore = response.has_more;
			page++;
		} else {
			hasMore = false;
		}
	}

	return results.slice(0, limit);
}

let lastDebugInfo: string = '';

function renderNoteHtml(body: string): string {
	const { html, truncated } = renderNoteBody(body);
	lastDebugInfo = `=== INPUT MD ===\n${body}\n\n=== OUTPUT HTML ===\n${html}\n\n=== TRUNCATED: ${truncated} ===`;
	return html;
}

function transformResults(
	results: SearchResultItem[],
	query: string,
	includeUpdatedTime: boolean,
	mode: DisplayMode
): TrmnlPayload {
	const items = results.map(item => {
		const entry: { title: string; updated?: string } = { title: item.title };
		if (includeUpdatedTime) {
			entry.updated = formatDateTime(item.updated_time);
		}
		return entry;
	});

	const payload: TrmnlPayload = {
		title: 'Joplin Search',
		count: results.length,
		mode,
		items,
		pushed_at: formatDateTime(Date.now()),
	};

	if (mode === 'list') {
		payload.query = query;
	}

	if (mode === 'single' && results.length > 0) {
		const first = results[0];
		const rawBody = first.body || '';
		const note: { title: string; updated?: string; body: string; body_html: string } = {
			title: first.title,
			body: rawBody,
			body_html: renderNoteHtml(rawBody),
		};
		if (includeUpdatedTime) {
			note.updated = formatDateTime(first.updated_time);
		}
		payload.note = note;
	}

	return payload;
}

async function pushToTrmnl(webhookUrl: string, payload: TrmnlPayload): Promise<{ ok: boolean; status: number; statusText: string; body: string; payloadBytes: number }> {
	const bodyText = JSON.stringify({ merge_variables: payload });
	console.info('[TRMNL] POST body:', bodyText);
	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: bodyText,
	});

	let responseBody = '';
	try {
		responseBody = await response.text();
	} catch {
		// ignore — body may not be readable
	}

	return {
		ok: response.ok,
		status: response.status,
		statusText: response.statusText,
		body: responseBody,
		payloadBytes: bodyText.length,
	};
}

async function executePush(): Promise<{ success: boolean; message: string }> {
	const settings = await getSettings();

	if (!settings.webhookUrl) {
		return { success: false, message: 'TRMNL webhook URL is not configured' };
	}

	if (!settings.searchQuery) {
		return { success: false, message: 'Search query is not configured' };
	}

	try {
		const isSingle = settings.displayMode === 'single';
		const effectiveLimit = isSingle ? 1 : settings.resultLimit;
		const results = await fetchSearchResults(settings.searchQuery, effectiveLimit, isSingle);
		const payload = transformResults(results, settings.searchQuery, settings.includeUpdatedTime, settings.displayMode);
		const response = await pushToTrmnl(settings.webhookUrl, payload);

		if (response.ok) {
			return { success: true, message: `Pushed ${results.length} results to TRMNL` };
		}

		return {
			success: false,
			message: formatTrmnlError(response.status, response.statusText, response.body, response.payloadBytes) + (settings.debugMode && lastDebugInfo ? `\n\n${lastDebugInfo}` : ''),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, message: `Failed to push to TRMNL: ${message}` };
	}
}

function formatTrmnlError(status: number, statusText: string, body: string, payloadBytes: number): string {
	const sizeKb = (payloadBytes / 1024).toFixed(1);
	const trimmedBody = body ? body.trim().slice(0, 400) : '';
	const parts: string[] = [`TRMNL responded with HTTP ${status}${statusText ? ` ${statusText}` : ''}`];

	if (trimmedBody) {
		parts.push(`Response: ${trimmedBody}`);
	}

	parts.push(`Payload size: ${sizeKb} KB`);

	// Add specific hints for common failure modes
	if (status === 422) {
		// TRMNL caps merge_variables at ~2 KB on the free plan. We already
		// compact the rendered HTML, but very long notes can still exceed it.
		const hints: string[] = [];
		if (payloadBytes > 2048) {
			hints.push(`payload is ${sizeKb} KB — TRMNL's merge_variables limit is 2 KB on the free plan`);
		}
		hints.push('try shortening the matched note, or switch to a shorter note via your search query. TRMNL+ raises the limit.');
		parts.push(`Likely cause: ${hints.join('. ')}`);
	} else if (status === 401 || status === 403) {
		parts.push('Likely cause: the webhook URL is incorrect or has been regenerated — copy the latest one from your TRMNL Private Plugin');
	} else if (status === 404) {
		parts.push('Likely cause: the webhook URL is wrong or the plugin was deleted on the TRMNL side');
	} else if (status === 429) {
		parts.push('Likely cause: too many requests — TRMNL rate-limits webhook pushes. Reduce the push interval.');
	} else if (status >= 500) {
		parts.push('Likely cause: TRMNL server-side issue — retry in a moment');
	}

	return parts.join('\n\n');
}

function setupPeriodicPush(intervalMinutes: number) {
	if (pushIntervalId) {
		clearInterval(pushIntervalId);
		pushIntervalId = null;
	}

	if (intervalMinutes > 0) {
		const intervalMs = intervalMinutes * 60 * 1000;
		pushIntervalId = setInterval(async () => {
			const result = await executePush();
			console.info(`TRMNL periodic push: ${result.message}`);
		}, intervalMs);
		console.info(`TRMNL periodic push scheduled every ${intervalMinutes} minutes`);
	}
}

joplin.plugins.register({
	onStart: async function() {
		// Register settings section
		await joplin.settings.registerSection(SETTING_SECTION, {
			label: 'TRMNL Push',
			iconName: 'fas fa-tv',
		});

		// Register settings
		await joplin.settings.registerSettings({
			trmnlWebhookUrl: {
				section: SETTING_SECTION,
				type: SettingItemType.String,
				public: true,
				value: '',
				label: 'TRMNL Webhook URL',
				description: 'The webhook URL for your TRMNL private plugin',
			},
			searchQuery: {
				section: SETTING_SECTION,
				type: SettingItemType.String,
				public: true,
				value: '',
				label: 'Search Query',
				description: 'Joplin search query to execute (e.g., "tag:todo type:note")',
			},
			displayMode: {
				section: SETTING_SECTION,
				type: SettingItemType.String,
				public: true,
				value: 'list',
				isEnum: true,
				options: {
					list: 'List of notes',
					single: 'Single note (with body)',
				},
				label: 'Display Mode',
				description: 'List shows multiple note titles; Single shows the most recent matching note with its body',
			},
			resultLimit: {
				section: SETTING_SECTION,
				type: SettingItemType.Int,
				public: true,
				value: 5,
				minimum: 1,
				maximum: 50,
				label: 'Result Limit',
				description: 'Maximum number of notes to include in the push',
			},
			pushIntervalMinutes: {
				section: SETTING_SECTION,
				type: SettingItemType.Int,
				public: true,
				value: 0,
				minimum: 0,
				maximum: 1440,
				label: 'Push Interval (minutes)',
				description: 'Automatic push interval in minutes (0 to disable)',
			},
			includeUpdatedTime: {
				section: SETTING_SECTION,
				type: SettingItemType.Bool,
				public: true,
				value: true,
				label: 'Include Updated Time',
				description: 'Include the last updated time for each note',
			},
			debugMode: {
				section: SETTING_SECTION,
				type: SettingItemType.Bool,
				public: true,
				value: true,
				label: 'Debug Mode',
				description: 'When a push fails, include the rendered HTML in the error message for troubleshooting',
			},
		});

		// Register commands
		await joplin.commands.register({
			name: 'trmnlPush',
			label: 'Push search results to TRMNL',
			execute: async () => {
				const result = await executePush();
				await joplin.views.dialogs.showMessageBox(result.message);
			},
		});

		await joplin.views.menuItems.create('trmnlPushMenuItem', 'trmnlPush', MenuItemLocation.Tools);

		// Setup periodic push based on current settings
		const settings = await getSettings();
		setupPeriodicPush(settings.pushIntervalMinutes);

		// Listen for settings changes to update periodic push
		await joplin.settings.onChange(async (event) => {
			if (event.keys.includes('pushIntervalMinutes')) {
				const newInterval = await joplin.settings.value('pushIntervalMinutes') as number;
				setupPeriodicPush(newInterval);
			}
		});

		console.info('TRMNL plugin started');
	},
});
