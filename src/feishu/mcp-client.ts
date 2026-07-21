import { requestUrl } from 'obsidian';

const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface McpToolInfo {
	name: string;
	description?: string;
}

export class McpError extends Error {
	constructor(public code: number, message: string, public data?: unknown) {
		super(message);
		this.name = 'McpError';
	}
}

/**
 * Minimal JSON-RPC client for the hosted Feishu MCP server (mcp.feishu.cn),
 * which speaks streamable HTTP and responds with plain JSON when Accept
 * includes `text/event-stream`. The endpoint URL itself is the credential
 * (a personal key), so no additional auth headers are needed.
 */
export class McpHttpClient {
	private nextId = 1;
	private initializedEndpoint: string | null = null;

	constructor(private readonly getEndpoint: () => string | null) {}

	async listTools(): Promise<McpToolInfo[]> {
		await this.ensureInitialized();
		const result = await this.request<{ tools?: McpToolInfo[] }>('tools/list', {});
		return Array.isArray(result.tools) ? result.tools : [];
	}

	async callTool<T = Record<string, any>>(name: string, args: Record<string, unknown>): Promise<T> {
		await this.ensureInitialized();
		const result = await this.request<{
			content?: Array<{ type: string; text?: string }>;
			structuredContent?: T;
			isError?: boolean;
		}>('tools/call', { name, arguments: args });

		if (result.isError) {
			const message = this.firstTextBlock(result.content) || `tool ${name} returned an error`;
			throw new McpError(-32000, message);
		}

		if (result.structuredContent !== undefined) {
			return result.structuredContent;
		}

		const text = this.firstTextBlock(result.content);
		if (!text) return {} as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			return { text } as unknown as T;
		}
	}

	private firstTextBlock(content?: Array<{ type: string; text?: string }>): string | undefined {
		if (!content) return undefined;
		const block = content.find(b => b.type === 'text' && typeof b.text === 'string');
		return block?.text;
	}

	private async ensureInitialized(): Promise<void> {
		const endpoint = this.endpoint();
		if (this.initializedEndpoint === endpoint) return;
		await this.request('initialize', {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: 'obsidian-publish-everywhere', version: '1.1.0' },
		});
		this.initializedEndpoint = endpoint;
	}

	private async request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
		const endpoint = this.endpoint();
		const body = {
			jsonrpc: '2.0',
			id: this.nextId++,
			method,
			params,
		};

		const response = await requestUrl({
			url: endpoint,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
			},
			body: JSON.stringify(body),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`MCP HTTP ${response.status}：${(response.text || '').slice(0, 200)}`);
		}

		const payload = this.parsePayload(response.text);
		if (payload.error) {
			throw new McpError(payload.error.code, payload.error.message, payload.error.data);
		}
		return payload.result as T;
	}

	private endpoint(): string {
		const endpoint = (this.getEndpoint() || '').trim();
		if (!endpoint) throw new Error('尚未配置飞书 MCP URL，请先在插件设置中粘贴 MCP 服务器链接');
		if (!/^https:\/\/[^/]+\.feishu\.cn\//i.test(endpoint) && !/^https:\/\/[^/]+\.larksuite\.com\//i.test(endpoint)) {
			throw new Error('飞书 MCP URL 格式不正确，应以 https://mcp.feishu.cn/mcp/ 开头');
		}
		return endpoint;
	}

	private parsePayload(text: string): { result?: unknown; error?: { code: number; message: string; data?: unknown } } {
		const trimmed = (text || '').trim();
		// Streamable HTTP may wrap the JSON payload in SSE frames.
		if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
			for (const line of trimmed.split(/\r?\n/)) {
				if (line.startsWith('data:')) {
					const data = line.slice(5).trim();
					if (data) return JSON.parse(data);
				}
			}
			throw new Error('MCP 响应中没有 data 帧');
		}
		return JSON.parse(trimmed);
	}
}
