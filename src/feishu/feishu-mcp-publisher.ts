import { App, Notice, TFile } from 'obsidian';
import { FeishuSettings, FrontMatterData, ShareResult } from '../types';
import { MarkdownProcessor } from '../markdown-processor';
import { McpHttpClient, McpError } from './mcp-client';
import { Debug } from '../debug';

/** secretStorage key holding the personal Feishu MCP URL (never in data.json). */
export const FEISHU_MCP_URL_SECRET_ID = 'feishu-mcp-url';

const PARENT_LINK_KEYS = [
	'feishu',
	'feishu_parent',
	'feishu.parent',
	'feishu_parent_url',
	'parent_feishu_url',
	'feishu_parent_link',
];

interface McpChildDoc {
	title: string;
	url?: string;
}

/**
 * Publishes notes through the hosted Feishu MCP server (mcp.feishu.cn).
 * The MCP URL is a personal key supplied via `getMcpUrl` (backed by the
 * system keychain, never written to data.json).
 *
 * State machine matches the KMS publisher:
 *  1. feishu_url identifies an existing page → overwrite via update-doc;
 *  2. otherwise look for a same-titled child under the feishu parent wiki
 *     node (list-docs) → overwrite it;
 *  3. otherwise create-doc below the parent node;
 *  4. every successful publish returns the canonical URL for backfill.
 */
export class FeishuMcpPublisher {
	private readonly mcp: McpHttpClient;

	constructor(
		private readonly app: App,
		private settings: FeishuSettings,
		private readonly markdownProcessor: MarkdownProcessor,
		getMcpUrl: () => string | null,
	) {
		this.mcp = new McpHttpClient(getMcpUrl);
	}

	updateSettings(settings: FeishuSettings): void {
		this.settings = settings;
	}

	isConfigured(): boolean {
		return this.settings.feishuMcpUrlSaved;
	}

	/** Used by the settings tab "测试连接" button. */
	async testConnection(): Promise<{ userName?: string; tools: string[] }> {
		const tools = await this.mcp.listTools();
		let userName: string | undefined;
		try {
			const user = await this.mcp.callTool<Record<string, any>>('get-user', {});
			userName = this.findStringField(user, ['name']) || undefined;
		} catch (error) {
			Debug.log('get-user probe failed during connection test:', this.describeError(error));
		}
		return { userName, tools: tools.map(tool => tool.name) };
	}

	async publishFile(file: TFile, statusNotice?: Notice): Promise<ShareResult> {
		if (!this.isConfigured()) {
			return { success: false, error: '请先在插件设置中填入飞书 MCP URL' };
		}

		try {
			const rawContent = await this.app.vault.read(file);
			const { content: stripped, frontMatter } = this.markdownProcessor.processFrontMatter(
				rawContent,
				this.settings.frontMatterHandling,
			);
			// KMS always follows the current file name, including rename updates.
			const title = file.basename;
			const markdown = this.cleanMarkdownForMcp(stripped);
			const parentLink = this.pickParentLink(frontMatter);
			if (!parentLink) {
				return { success: false, error: '当前笔记缺少 feishu 属性，请填写飞书 Wiki 父页面链接' };
			}

			const existingUrl = this.pickFeishuUrl(frontMatter);
			if (existingUrl && (await this.docExists(existingUrl))) {
				statusNotice?.setMessage('🔄 正在更新飞书页面…');
				await this.updateDocument(existingUrl, title, markdown);
				return { success: true, url: existingUrl, title, operation: 'updated' };
			}

			statusNotice?.setMessage('🔍 正在定位飞书子页面…');
			const matched = await this.findChildDocumentByTitle(parentLink, title);
			if (matched?.url) {
				statusNotice?.setMessage('🔄 正在更新飞书页面…');
				await this.updateDocument(matched.url, title, markdown);
				return { success: true, url: matched.url, title, operation: 'updated' };
			}

			statusNotice?.setMessage('📤 正在新建飞书子页面…');
			return await this.createDocument(title, markdown, parentLink);
		} catch (error) {
			Debug.error('FeishuMcpPublisher.publishFile error:', error);
			return { success: false, error: this.describeError(error) };
		}
	}

	private async createDocument(title: string, markdown: string, parentLink: string): Promise<ShareResult> {
		const result = await this.mcp.callTool<Record<string, any>>('create-doc', {
			title,
			markdown,
			wiki_node: parentLink,
		});

		const taskId = this.findStringField(result, ['task_id', 'taskId']);
		let docUrl = this.findStringField(result, ['doc_url', 'docUrl', 'url']);
		if (!docUrl && taskId) {
			const polled = await this.pollCreateTask(taskId);
			docUrl = this.findStringField(polled, ['doc_url', 'docUrl', 'url']);
		}
		if (!docUrl) {
			return { success: false, error: this.findStringField(result, ['message']) || 'MCP 创建文档未返回 doc_url' };
		}
		return { success: true, url: docUrl, title, operation: 'created' };
	}

	private async updateDocument(docIdOrUrl: string, title: string, markdown: string): Promise<void> {
		await this.mcp.callTool<Record<string, any>>('update-doc', {
			doc_id: docIdOrUrl,
			mode: 'overwrite',
			markdown,
			new_title: title,
		});
	}

	private async pollCreateTask(taskId: string, maxAttempts = 12, intervalMs = 2500): Promise<Record<string, any>> {
		for (let i = 0; i < maxAttempts; i++) {
			await new Promise(resolve => setTimeout(resolve, intervalMs));
			const status = await this.mcp.callTool<Record<string, any>>('create-doc', { task_id: taskId });
			if (this.findStringField(status, ['doc_url', 'docUrl', 'url'])) return status;
		}
		return {};
	}

	private async docExists(docUrlOrId: string): Promise<boolean> {
		try {
			const result = await this.mcp.callTool<Record<string, any>>('fetch-doc', {
				doc_id: docUrlOrId,
				limit: 1,
				skip_task_detail: true,
			});
			return !this.findStringField(result, ['error']);
		} catch (error) {
			Debug.log('fetch-doc probe failed, will fall back to title match:', this.describeError(error));
			return false;
		}
	}

	/** list-docs returns direct children of a wiki node; paginate and match by exact title. */
	private async findChildDocumentByTitle(parentLink: string, title: string): Promise<McpChildDoc | null> {
		let pageToken = '';
		const visited = new Set<string>();
		for (let page = 0; page < 20; page++) {
			const args: Record<string, unknown> = { doc_id: parentLink, page_size: 50 };
			if (pageToken) args.page_token = pageToken;
			const result = await this.mcp.callTool<Record<string, any>>('list-docs', args);
			const items = this.extractArray(result);
			const match = items
				.map(item => ({
					title: this.findStringField(item, ['title', 'name']),
					url: this.findStringField(item, ['url', 'doc_url', 'docUrl', 'wiki_url', 'node_url']) || undefined,
				}))
				.find(item => item.title === title && !!item.url);
			if (match) return match;

			const nextToken = this.findStringField(result, ['page_token', 'next_page_token', 'nextPageToken']);
			const hasMore = result.has_more === true || result.hasMore === true || !!nextToken;
			if (!hasMore || !nextToken || visited.has(nextToken)) return null;
			visited.add(nextToken);
			pageToken = nextToken;
		}
		return null;
	}

	private extractArray(result: Record<string, any>): Array<Record<string, any>> {
		if (Array.isArray(result)) return result;
		for (const key of ['items', 'children', 'docs', 'nodes', 'list', 'data']) {
			const value = result?.[key];
			if (Array.isArray(value)) return value;
			if (value && typeof value === 'object') {
				const nested = this.extractArray(value);
				if (nested.length > 0) return nested;
			}
		}
		return [];
	}

	/** Depth-limited search for the first non-empty string among candidate keys. */
	private findStringField(source: unknown, keys: string[], depth = 0): string {
		if (!source || typeof source !== 'object' || depth > 3) return '';
		for (const key of keys) {
			const value = (source as Record<string, any>)[key];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
		if (depth < 3) {
			for (const value of Object.values(source as Record<string, any>)) {
				if (value && typeof value === 'object' && !Array.isArray(value)) {
					const found = this.findStringField(value, keys, depth + 1);
					if (found) return found;
				}
			}
		}
		return '';
	}

	private pickFeishuUrl(frontMatter: FrontMatterData | null): string | undefined {
		const raw = frontMatter?.feishu_url;
		return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
	}

	private pickParentLink(frontMatter: FrontMatterData | null): string | undefined {
		if (!frontMatter) return undefined;
		for (const key of PARENT_LINK_KEYS) {
			const value = frontMatter[key];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
		return undefined;
	}

	/**
	 * Strip artefacts that the hosted MCP cannot render:
	 *  - local images (only `http(s)://` URLs are accepted)
	 *  - obsidian wiki-links (`![[file]]` / `[[file|alias]]`)
	 *  - filtered code blocks
	 */
	private cleanMarkdownForMcp(content: string): string {
		let result = content;
		const codeFilter = (this.settings.codeBlockFilterLanguages || []).map(value => value.toLowerCase());
		if (codeFilter.length > 0) {
			const fencedRegex = /(^|\n)(```|~~~)\s*([^\n]*)\n([\s\S]*?)\n\2\s*(?=\n|$)/g;
			result = result.replace(fencedRegex, (full, leading, _fence, info) => {
				const language = (info || '').trim().split(/\s+/)[0].toLowerCase();
				return language && codeFilter.includes(language) ? leading || '' : full;
			});
		}

		result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawSource) => {
			const source = rawSource.trim();
			if (/^https?:\/\//i.test(source)) return match;
			const name = this.extractFileName(source);
			const label = alt && alt.trim() ? alt.trim() : name || '本地图片';
			return `_(本地图片已省略: ${label})_`;
		});
		result = result.replace(/!\[\[([^\]]+)\]\]/g, (_match, target) => {
			const name = String(target).split('|')[0].split('#')[0].trim();
			return `_(本地引用已省略: ${name})_`;
		});
		result = result.replace(/\[\[([^\]]+)\]\]/g, (_match, target) => {
			const parts = String(target).split('|');
			return (parts[1] || parts[0] || '').split('#')[0].trim();
		});
		return result;
	}

	private extractFileName(path: string): string {
		const cleaned = path.split('?')[0].split('#')[0];
		const segments = cleaned.split(/[\\/]/);
		return segments[segments.length - 1] || cleaned;
	}

	private describeError(error: unknown): string {
		if (error instanceof McpError) {
			// Expired/revoked links surface as JSON-RPC auth errors.
			if (/token|auth|expire|invalid|forbidden|unauthorized/i.test(error.message)) {
				return `MCP 链接已失效或被重置，请到飞书开放平台重新复制 MCP 服务器链接（${error.message}）`;
			}
			return `MCP 错误 (${error.code})：${error.message}`;
		}
		return error instanceof Error ? error.message : String(error);
	}
}
