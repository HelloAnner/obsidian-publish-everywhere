import { requestUrl } from 'obsidian';

const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface McpToolResult {
	[key: string]: any;
}

export class McpError extends Error {
	constructor(public code: number, message: string, public data?: unknown) {
		super(message);
		this.name = 'McpError';
	}
}

/**
 * Minimal JSON-RPC client for an MCP server that speaks streamable HTTP.
 * Feishu's hosted MCP at mcp.feishu.cn responds with plain JSON when
 * Accept includes `text/event-stream`, so SSE framing isn't needed.
 */
export class McpHttpClient {
	private nextId = 1;
	private initialized = false;

	constructor(private endpoint: string) {}

	setEndpoint(endpoint: string) {
		if (endpoint !== this.endpoint) {
			this.endpoint = endpoint;
			this.initialized = false;
		}
	}

	async callTool<T = McpToolResult>(name: string, args: Record<string, unknown>): Promise<T> {
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
		const block = content.find((b) => b.type === 'text' && typeof b.text === 'string');
		return block?.text;
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;
		await this.request('initialize', {
			protocolVersion: MCP_PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: 'obsidian-publish-everywhere', version: '1.0.0' },
		});
		this.initialized = true;
	}

	private async request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
		if (!this.endpoint) throw new Error('MCP endpoint is not configured');
		const body = {
			jsonrpc: '2.0',
			id: this.nextId++,
			method,
			params,
		};

		const response = await requestUrl({
			url: this.endpoint,
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
			throw new Error(`MCP HTTP ${response.status}: ${response.text?.slice(0, 200) ?? ''}`);
		}

		const payload = this.parsePayload(response.text);
		if (payload.error) {
			throw new McpError(payload.error.code, payload.error.message, payload.error.data);
		}
		return payload.result as T;
	}

	private parsePayload(text: string): { result?: unknown; error?: { code: number; message: string; data?: unknown } } {
		const trimmed = text.trim();
		// Streamable HTTP may wrap the JSON payload in SSE-like frames.
		if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
			for (const line of trimmed.split(/\r?\n/)) {
				if (line.startsWith('data:')) {
					const data = line.slice(5).trim();
					if (data) return JSON.parse(data);
				}
			}
			throw new Error('MCP response did not contain a data frame');
		}
		return JSON.parse(trimmed);
	}
}
