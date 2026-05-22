import joplin from 'api';
import { SettingItemType, MenuItemLocation } from 'api/types';

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
	note?: { title: string; updated?: string; body: string };
	pushed_at: string;
}

const SINGLE_NOTE_BODY_MAX_CHARS = 1200;

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

function prepareNoteBody(body: string, maxChars: number): string {
	if (!body) return '';
	// Strip front matter, collapse whitespace, and truncate so the body
	// fits comfortably in the TRMNL e-ink "full" view (~800x480).
	let text = body.replace(/\r\n/g, '\n');
	text = text.replace(/^---\n[\s\S]*?\n---\n/, '');
	text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
	text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
	text = text.replace(/`{1,3}[^`]*`{1,3}/g, '');
	text = text.replace(/[*_>#]+/g, '');
	text = text.replace(/\n{2,}/g, '\n\n').trim();
	if (text.length > maxChars) {
		text = text.slice(0, maxChars).trimEnd() + '…';
	}
	return text;
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
		const note: { title: string; updated?: string; body: string } = {
			title: first.title,
			body: prepareNoteBody(first.body || '', SINGLE_NOTE_BODY_MAX_CHARS),
		};
		if (includeUpdatedTime) {
			note.updated = formatDateTime(first.updated_time);
		}
		payload.note = note;
	}

	return payload;
}

async function pushToTrmnl(webhookUrl: string, payload: TrmnlPayload): Promise<{ ok: boolean; status: number; statusText: string }> {
	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ merge_variables: payload }),
	});

	return {
		ok: response.ok,
		status: response.status,
		statusText: response.statusText,
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
		} else {
			return { success: false, message: `TRMNL responded with ${response.status}: ${response.statusText}` };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, message: `Failed to push to TRMNL: ${message}` };
	}
}

async function testConnection(): Promise<{ success: boolean; message: string }> {
	const settings = await getSettings();

	if (!settings.webhookUrl) {
		return { success: false, message: 'TRMNL webhook URL is not configured' };
	}

	try {
		const mode = settings.displayMode || 'list';
		const testPayload: TrmnlPayload = {
			title: 'Joplin Search',
			count: 0,
			mode,
			items: [],
			pushed_at: formatDateTime(Date.now()),
		};
		if (mode === 'list') {
			testPayload.query = 'test';
		}

		const response = await pushToTrmnl(settings.webhookUrl, testPayload);

		if (response.ok) {
			return { success: true, message: 'Connection to TRMNL successful' };
		} else {
			return { success: false, message: `TRMNL responded with ${response.status}: ${response.statusText}` };
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, message: `Connection failed: ${message}` };
	}
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
			label: 'TRMNL',
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

		await joplin.commands.register({
			name: 'trmnlTestConnection',
			label: 'Test TRMNL connection',
			execute: async () => {
				const result = await testConnection();
				await joplin.views.dialogs.showMessageBox(result.message);
			},
		});

		// Add commands to Tools menu
		await joplin.views.menuItems.create('trmnlPushMenuItem', 'trmnlPush', MenuItemLocation.Tools);
		await joplin.views.menuItems.create('trmnlTestMenuItem', 'trmnlTestConnection', MenuItemLocation.Tools);

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
