import { requestUrl } from 'obsidian';
import { FeishuAuthService } from './feishu-auth';
import { FEISHU_ENDPOINTS } from './feishu-endpoints';

export class FeishuApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly code: number,
		public readonly details?: any,
		public readonly logId?: string,
	) {
		super(message);
		this.name = 'FeishuApiError';
	}

	isNotFound(): boolean {
		return this.status === 404 || [131005, 1770002, 1770003].includes(this.code);
	}

	isMissingScope(): boolean {
		return this.code === 99991679;
	}
}

interface FeishuRequestOptions {
	query?: Record<string, string | number | boolean | undefined>;
	body?: unknown;
}

export class FeishuOpenApiClient {
	constructor(private readonly auth: FeishuAuthService) {}

	async get<T>(path: string, query?: FeishuRequestOptions['query']): Promise<T> {
		return this.request<T>('GET', path, { query });
	}

	async post<T>(path: string, body?: unknown): Promise<T> {
		return this.request<T>('POST', path, { body });
	}

	async put<T>(path: string, body?: unknown): Promise<T> {
		return this.request<T>('PUT', path, { body });
	}

	private async request<T>(
		method: 'GET' | 'POST' | 'PUT',
		path: string,
		options: FeishuRequestOptions,
		retryAuthentication = true,
	): Promise<T> {
		const accessToken = await this.auth.getValidAccessToken();
		const url = this.buildUrl(path, options.query);
		const response = await requestUrl({
			url,
			method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: 'application/json',
				...(options.body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			throw: false,
		});
		const payload = parsePayload(response.text, response.json);
		const code = Number(payload?.code || 0);

		if (retryAuthentication && this.isAuthenticationFailure(response.status, code)) {
			await this.auth.getValidAccessToken(true);
			return this.request<T>(method, path, options, false);
		}

		if (response.status < 200 || response.status >= 300 || code !== 0) {
			throw this.toApiError(response.status, code, payload, response.headers);
		}
		return (payload?.data ?? payload) as T;
	}

	private buildUrl(path: string, query?: FeishuRequestOptions['query']): string {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;
		const url = new URL(`${FEISHU_ENDPOINTS.open}${normalizedPath}`);
		for (const [key, value] of Object.entries(query || {})) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}
		return url.toString();
	}

	private isAuthenticationFailure(status: number, code: number): boolean {
		return status === 401 || [99991663, 99991664, 99991668].includes(code);
	}

	private toApiError(status: number, code: number, payload: any, headers: Record<string, string>): FeishuApiError {
		const missingScopes = extractMissingScopes(payload);
		let message = stringValue(payload?.msg)
			|| stringValue(payload?.error_description)
			|| stringValue(payload?.error)
			|| `HTTP ${status}`;
		if (missingScopes.length > 0) {
			message = `缺少飞书权限：${missingScopes.join(', ')}`;
		}
		const logId = headerValue(headers, 'x-tt-logid');
		if (logId) message += `（log_id: ${logId}）`;
		return new FeishuApiError(`飞书 API 错误 ${code || status}：${message}`, status, code, payload, logId);
	}
}

function parsePayload(text: string, json: any): any {
	if (json && typeof json === 'object') return json;
	try {
		return JSON.parse(text || '{}');
	} catch (_error) {
		return {};
	}
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const key = Object.keys(headers || {}).find(item => item.toLowerCase() === name.toLowerCase());
	return key ? headers[key] : undefined;
}

function extractMissingScopes(payload: any): string[] {
	const candidates = [
		payload?.data?.missing_scopes,
		payload?.data?.required_scopes,
		payload?.missing_scopes,
		payload?.required_scopes,
		payload?.required_scope,
	];
	const scopes = new Set<string>();
	for (const candidate of candidates) {
		if (Array.isArray(candidate)) {
			for (const item of candidate) if (typeof item === 'string' && item.trim()) scopes.add(item.trim());
		} else if (typeof candidate === 'string') {
			for (const item of candidate.split(/[ ,]+/)) if (item.trim()) scopes.add(item.trim());
		}
	}
	return Array.from(scopes);
}
