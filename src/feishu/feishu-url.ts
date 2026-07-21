export type FeishuResourceKind = 'wiki' | 'docx' | 'doc';

export interface FeishuResourceRef {
	kind: FeishuResourceKind;
	token: string;
	origin?: string;
	url?: string;
}

const RESOURCE_PATHS: Array<{ marker: string; kind: FeishuResourceKind }> = [
	{ marker: '/wiki/', kind: 'wiki' },
	{ marker: '/docx/', kind: 'docx' },
	{ marker: '/doc/', kind: 'doc' },
];

export function parseFeishuResourceRef(input: string): FeishuResourceRef | null {
	const raw = input.trim();
	if (!raw) return null;

	if (!raw.includes('://')) {
		if (/[/?#]/.test(raw)) return null;
		return { kind: 'docx', token: raw };
	}

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch (_error) {
		return null;
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

	for (const item of RESOURCE_PATHS) {
		const index = parsed.pathname.indexOf(item.marker);
		if (index < 0) continue;
		const token = parsed.pathname.slice(index + item.marker.length).split('/')[0]?.trim();
		if (!token) return null;
		return {
			kind: item.kind,
			token,
			origin: parsed.origin,
			url: raw,
		};
	}
	return null;
}

export function buildFeishuResourceUrl(origin: string | undefined, kind: FeishuResourceKind, token: string): string {
	const safeOrigin = origin?.replace(/\/$/, '') || 'https://feishu.cn';
	return `${safeOrigin}/${kind}/${encodeURIComponent(token)}`;
}
