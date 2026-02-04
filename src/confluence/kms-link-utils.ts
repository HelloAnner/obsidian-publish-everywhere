/**
 * KMS 链接预处理工具
 *
 * @author Anner
 * @since 12.0
 * Created on 2026/2/3
 */

export interface KmsLinkReplaceResult {
	content: string;
	changed: boolean;
}

/**
 * 替换裸露的 KMS 链接为 Markdown 链接
 *
 * @param content 原始文本
 * @param resolveTitle 标题解析函数
 */
export async function replaceBareKmsLinks(
	content: string,
	resolveTitle: (pageId: string, url: string) => Promise<string | null>
): Promise<KmsLinkReplaceResult> {
	const linkRanges = findMarkdownLinkRanges(content);
	const urlRegex = /https?:\/\/[^\s<>()]+/g;
	let out = '';
	let lastIndex = 0;
	let changed = false;
	let match: RegExpExecArray | null;

	while ((match = urlRegex.exec(content)) !== null) {
		const start = match.index;
		const rawUrl = match[0];
		out += content.slice(lastIndex, start);
		const result = await buildBareKmsReplacement(rawUrl, start, linkRanges, resolveTitle);
		out += result.text;
		changed = changed || result.changed;
		lastIndex = start + rawUrl.length;
	}

	out += content.slice(lastIndex);
	return { content: out, changed };
}

/**
 * 替换 Obsidian Wiki 链接为 KMS 超链
 *
 * @param content 原始文本
 * @param resolveKmsUrl 根据笔记名解析 kms_url
 */
export async function replaceWikiLinksWithKmsUrl(
	content: string,
	resolveKmsUrl: (noteName: string) => Promise<string | null>
): Promise<string> {
	const wikiRegex = /\[\[([^\]|]+)(\|([^\]]+))?\]\]/g;
	let out = '';
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	const cache = new Map<string, string | null>();

	while ((match = wikiRegex.exec(content)) !== null) {
		const start = match.index;
		const raw = match[0];
		out += content.slice(lastIndex, start);
		const result = await buildWikiReplacement(match, resolveKmsUrl, cache);
		out += result ?? raw;
		lastIndex = start + raw.length;
	}

	out += content.slice(lastIndex);
	return out;
}

async function buildBareKmsReplacement(
	rawUrl: string,
	start: number,
	linkRanges: Array<{ start: number; end: number }>,
	resolveTitle: (pageId: string, url: string) => Promise<string | null>
): Promise<{ text: string; changed: boolean }> {
	if (isInsideRanges(start, linkRanges)) {
		return { text: rawUrl, changed: false };
	}

	const { url, suffix } = splitTrailingPunctuation(rawUrl);
	const pageId = extractPageId(url);
	if (!pageId) {
		return { text: rawUrl, changed: false };
	}

	const title = (await resolveTitle(pageId, url))?.trim();
	if (!title) {
		return { text: rawUrl, changed: false };
	}

	return {
		text: `[${escapeMarkdownText(title)}](${url})${suffix}`,
		changed: true
	};
}

async function buildWikiReplacement(
	match: RegExpExecArray,
	resolveKmsUrl: (noteName: string) => Promise<string | null>,
	cache: Map<string, string | null>
): Promise<string | null> {
	const targetRaw = (match[1] || '').trim();
	if (!targetRaw) {
		return null;
	}

	const displayRaw = (match[3] || '').trim();
	const noteName = stripWikiTarget(targetRaw);
	const displayText = displayRaw || noteName;
	const url = await resolveKmsUrlCached(noteName, resolveKmsUrl, cache);

	if (!url) {
		return null;
	}

	return `[${escapeMarkdownText(displayText)}](${url})`;
}

function findMarkdownLinkRanges(content: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	const re = /\[[^\]]*]\([^)]+\)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		ranges.push({ start: match.index, end: match.index + match[0].length });
	}
	return ranges;
}

function isInsideRanges(index: number, ranges: Array<{ start: number; end: number }>): boolean {
	for (const range of ranges) {
		if (index >= range.start && index < range.end) {
			return true;
		}
	}
	return false;
}

function splitTrailingPunctuation(rawUrl: string): { url: string; suffix: string } {
	let url = rawUrl;
	let suffix = '';
	while (url.length > 0 && /[).,!?:;]$/.test(url)) {
		suffix = url.slice(-1) + suffix;
		url = url.slice(0, -1);
	}
	return { url, suffix };
}

function extractPageId(url: string): string | null {
	const match = /[?&]pageId=(\d+)/.exec(url);
	return match?.[1] ?? null;
}

function escapeMarkdownText(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/]/g, '\\]');
}

function stripWikiTarget(target: string): string {
	const hashIndex = target.indexOf('#');
	const blockIndex = target.indexOf('^');
	const cutIndex = firstPositiveIndex(hashIndex, blockIndex);
	if (cutIndex === -1) {
		return target.trim();
	}
	return target.slice(0, cutIndex).trim();
}

function firstPositiveIndex(a: number, b: number): number {
	if (a === -1) {
		return b;
	}
	if (b === -1) {
		return a;
	}
	return Math.min(a, b);
}

async function resolveKmsUrlCached(
	noteName: string,
	resolveKmsUrl: (noteName: string) => Promise<string | null>,
	cache: Map<string, string | null>
): Promise<string | null> {
	if (cache.has(noteName)) {
		return cache.get(noteName) ?? null;
	}
	const url = await resolveKmsUrl(noteName);
	cache.set(noteName, url ?? null);
	return url ?? null;
}
