import { nodeRequest } from './node-http';
import { buildReadRestrictionPayload } from './kms-restriction-utils';

export interface ConfluencePage {
	id: string;
	title: string;
	version?: {
		number: number;
	};
	_links?: Record<string, string>;
}

export interface ConfluenceAttachment {
	id?: string;
	title?: string;
	_links?: Record<string, any>;
}

export class ConfluenceClient {
	private readonly baseUrl: string;
	private readonly spaceKey: string;
	private readonly username: string;
	private readonly password: string;

	constructor(params: { baseUrl: string; spaceKey: string; username: string; password: string }) {
		this.baseUrl = params.baseUrl.replace(/\/$/, '');
		this.spaceKey = params.spaceKey;
		this.username = params.username;
		this.password = params.password;
	}

	private xsrfBypassCandidates(): string[] {
		return ['no-check', 'nocheck'];
	}

	private isXsrfFailure(status: number, message: string): boolean {
		if (status !== 403) {
			return false;
		}
		const m = (message || '').toLowerCase();
		return m.includes('xsrf') || m.includes('csrf');
	}

	getBaseUrl(): string {
		return this.baseUrl;
	}

	toAbsoluteUrl(maybeRelative: string): string {
		if (maybeRelative.startsWith('http://') || maybeRelative.startsWith('https://')) {
			return maybeRelative;
		}
		return `${this.baseUrl}${maybeRelative}`;
	}

	buildPageUrl(pageId: string): string {
		return `${this.baseUrl}/pages/viewpage.action?pageId=${pageId}`;
	}

	async findPageInParent(title: string, parentPageId: string): Promise<ConfluencePage | null> {
		let start = 0;
		const limit = 100;

		while (true) {
			const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(parentPageId)}/child/page?limit=${limit}&start=${start}`;
			const res = await this.requestJson(url, 'GET');
			const results = Array.isArray(res?.results) ? res.results : [];
			for (const item of results) {
				if (item?.title === title && item?.id) {
					return { id: String(item.id), title: String(item.title), version: item.version, _links: item._links };
				}
			}
			const next = res?._links?.next;
			if (!next || results.length < limit) {
				return null;
			}
			start += limit;
		}
	}

	async getPageInfoById(pageId: string): Promise<ConfluencePage> {
		const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}?expand=version`;
		const res = await this.requestJson(url, 'GET');
		return {
			id: String(res?.id ?? pageId),
			title: String(res?.title ?? ''),
			version: res?.version ? { number: Number(res.version.number) } : undefined
		};
	}

	async createPage(params: { title: string; bodyStorage: string; parentPageId: string }): Promise<ConfluencePage> {
		const url = `${this.baseUrl}/rest/api/content`;
		const payload = {
			type: 'page',
			title: params.title,
			space: { key: this.spaceKey },
			body: { storage: { value: params.bodyStorage, representation: 'storage' } },
			ancestors: [{ id: params.parentPageId }]
		};
		const res = await this.requestJson(url, 'POST', payload);
		return { id: String(res?.id), title: String(res?.title ?? params.title), version: res?.version };
	}

	async updatePage(params: { pageId: string; title: string; bodyStorage: string }): Promise<void> {
		const current = await this.getPageInfoById(params.pageId);
		const versionNumber = Number(current.version?.number ?? 0) + 1;
		const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(params.pageId)}`;
		const payload = {
			id: params.pageId,
			type: 'page',
			title: params.title,
			space: { key: this.spaceKey },
			body: { storage: { value: params.bodyStorage, representation: 'storage' } },
			version: { number: versionNumber }
		};
		await this.requestJson(url, 'PUT', payload);
	}

	async setReadRestrictionToUser(pageId: string, username: string): Promise<void> {
		const primaryUrl = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/restriction`;
		const fallbackUrl = `${this.baseUrl}/rest/experimental/content/${encodeURIComponent(pageId)}/restriction`;
		const payload = buildReadRestrictionPayload(username);
		try {
			await this.requestJson(primaryUrl, 'PUT', payload);
			return;
		} catch (error) {
			if (!this.shouldFallbackToExperimentalRestrictionApi(error)) {
				throw error;
			}
		}
		await this.requestJson(fallbackUrl, 'PUT', payload);
	}

	async isPageReadOpen(pageId: string): Promise<boolean> {
		const primaryUrl = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/restriction/byOperation/read`;
		try {
			const readInfo = await this.requestJson(primaryUrl, 'GET');
			return this.isRestrictionOpen(readInfo?.restrictions);
		} catch (error) {
			if (!this.shouldFallbackToExperimentalRestrictionApi(error)) {
				throw error;
			}
		}

		const fallbackUrl = `${this.baseUrl}/rest/experimental/content/${encodeURIComponent(pageId)}/restriction`;
		const restrictionInfo = await this.requestJson(fallbackUrl, 'GET');
		const results = Array.isArray(restrictionInfo?.results) ? restrictionInfo.results : [];
		const readOperation = results.find((item: any) => item?.operation === 'read');
		return this.isRestrictionOpen(readOperation?.restrictions);
	}

	private shouldFallbackToExperimentalRestrictionApi(error: unknown): boolean {
		if (!(error instanceof ConfluenceHttpError)) {
			return false;
		}
		return error.status === 404 || error.status === 405;
	}

	private isRestrictionOpen(restrictions: any): boolean {
		const hasUserRestriction = this.hasRestrictionItems(restrictions?.user);
		const hasGroupRestriction = this.hasRestrictionItems(restrictions?.group);
		return !hasUserRestriction && !hasGroupRestriction;
	}

	private hasRestrictionItems(entity: any): boolean {
		if (!entity) {
			return false;
		}

		if (typeof entity.size === 'number') {
			return entity.size > 0;
		}

		if (Array.isArray(entity.results)) {
			return entity.results.length > 0;
		}

		return false;
	}

	async getAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
		const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`;
		const res = await this.requestJson(url, 'GET');
		return Array.isArray(res?.results) ? res.results : [];
	}

	async attachFile(params: {
		pageId: string;
		filename: string;
		content: Uint8Array;
		contentType: string;
		comment?: string;
	}): Promise<any> {
		const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(params.pageId)}/child/attachment`;
		const boundary = `----obsidian-publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;

		const headerLines = [
			`--${boundary}`,
			`Content-Disposition: form-data; name="file"; filename="${params.filename}"`,
			`Content-Type: ${params.contentType}`,
			'',
			''
		].join('\r\n');
		const commentLines = params.comment
			? [
					``,
					`--${boundary}`,
					`Content-Disposition: form-data; name="comment"`,
					'',
					params.comment,
					''
				].join('\r\n')
			: '';
		const footer = `\r\n--${boundary}--\r\n`;

		const headerBytes = new TextEncoder().encode(headerLines);
		const commentBytes = commentLines ? new TextEncoder().encode(commentLines) : new Uint8Array();
		const footerBytes = new TextEncoder().encode(footer);

		const body = new Uint8Array(headerBytes.length + params.content.length + commentBytes.length + footerBytes.length);
		let offset = 0;
		body.set(headerBytes, offset);
		offset += headerBytes.length;
		body.set(params.content, offset);
		offset += params.content.length;
		if (commentBytes.length > 0) {
			body.set(commentBytes, offset);
			offset += commentBytes.length;
		}
		body.set(footerBytes, offset);

		const payload = Buffer.from(body);
		for (const token of this.xsrfBypassCandidates()) {
			const res = await nodeRequest({
				url,
				method: 'POST',
				headers: {
					Authorization: this.basicAuthHeader(),
					'X-Atlassian-Token': token,
					'X-Requested-With': 'XMLHttpRequest',
					Accept: 'application/json',
					'Content-Type': `multipart/form-data; boundary=${boundary}`,
					'Content-Length': String(payload.byteLength)
				},
				body: payload
			});

			const text = res.body.toString('utf8');
			if (res.status >= 200 && res.status < 300) {
				return safeJson(text);
			}
			if (!this.isXsrfFailure(res.status, text)) {
				throw new Error(`[Confluence] POST ${url} HTTP ${res.status} ${text}`.trim());
			}
		}

		throw new Error(`[Confluence] POST ${url} HTTP 403 XSRF check failed`);
	}

	private async requestJson(url: string, method: 'GET' | 'POST' | 'PUT', body?: any): Promise<any> {
		const candidates = method === 'GET' ? [''] : this.xsrfBypassCandidates();

		for (const token of candidates) {
			const headers: Record<string, string> = {
				Authorization: this.basicAuthHeader(),
				Accept: 'application/json'
			};
			if (method !== 'GET') {
				headers['X-Atlassian-Token'] = token;
				headers['X-Requested-With'] = 'XMLHttpRequest';
			}

			const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
			if (payload) {
				headers['Content-Type'] = 'application/json';
				headers['Content-Length'] = String(payload.byteLength);
			}

			const res = await nodeRequest({
				url,
				method,
				headers,
				body: payload
			});

			const text = res.body.toString('utf8');
			if (res.status >= 200 && res.status < 300) {
				return safeJson(text);
			}
			if (method === 'GET' || !this.isXsrfFailure(res.status, text)) {
				throw new ConfluenceHttpError(method, url, res.status, text);
			}
		}

		throw new ConfluenceHttpError(method, url, 403, 'XSRF check failed');
	}

	private basicAuthHeader(): string {
		const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
		return `Basic ${token}`;
	}
}

class ConfluenceHttpError extends Error {
	readonly method: string;
	readonly url: string;
	readonly status: number;
	readonly responseText: string;

	constructor(method: string, url: string, status: number, responseText: string) {
		super(`[Confluence] ${method} ${url} HTTP ${status} ${responseText}`.trim());
		this.name = 'ConfluenceHttpError';
		this.method = method;
		this.url = url;
		this.status = status;
		this.responseText = responseText;
	}
}

function safeJson(text: string): any {
	try {
		return JSON.parse(text);
	} catch (_e) {
		return {};
	}
}
