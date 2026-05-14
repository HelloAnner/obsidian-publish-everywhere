import { App, Notice, TFile } from 'obsidian';
import { FeishuSettings, FrontMatterData, ShareResult } from '../types';
import { MarkdownProcessor } from '../markdown-processor';
import { McpHttpClient, McpError } from './mcp-client';
import { Debug } from '../debug';

const PARENT_LINK_KEYS = [
	'feishu',
	'feishu_parent',
	'feishu.parent',
	'feishu_parent_url',
	'parent_feishu_url',
	'feishu_parent_link',
];

interface CreateDocResult {
	doc_id?: string;
	doc_url?: string;
	task_id?: string;
	message?: string;
}

interface UpdateDocResult {
	doc_id?: string;
	mode?: string;
	message?: string;
	warnings?: unknown;
}

interface FetchDocResult {
	title?: string;
	content?: string;
	error?: string;
}

export class FeishuMcpPublisher {
	private mcp: McpHttpClient;

	constructor(
		private app: App,
		private settings: FeishuSettings,
		private markdownProcessor: MarkdownProcessor,
	) {
		this.mcp = new McpHttpClient(settings.mcpUrl || '');
	}

	updateSettings(settings: FeishuSettings) {
		this.settings = settings;
		this.mcp.setEndpoint(settings.mcpUrl || '');
	}

	isConfigured(): boolean {
		return !!this.settings.mcpUrl;
	}

	async publishFile(file: TFile, statusNotice?: Notice): Promise<ShareResult> {
		if (!this.isConfigured()) {
			return { success: false, error: '请先在设置中填入飞书 MCP URL' };
		}

		try {
			const rawContent = await this.app.vault.read(file);
			const { content: stripped, frontMatter } = this.markdownProcessor.processFrontMatter(
				rawContent,
				this.settings.frontMatterHandling,
			);
			const title = this.markdownProcessor.extractTitle(
				file.basename,
				frontMatter,
				this.settings.titleSource,
			);
			const markdown = this.cleanMarkdownForMcp(stripped);

			const existingDocUrl = this.pickFeishuUrl(frontMatter);
			const parentLink = this.pickParentLink(frontMatter);

			statusNotice?.setMessage(existingDocUrl ? '🔄 通过 MCP 更新飞书文档...' : '📤 通过 MCP 创建飞书文档...');

			if (existingDocUrl && (await this.docExists(existingDocUrl))) {
				return await this.updateDocument(existingDocUrl, title, markdown);
			}

			return await this.createDocument(title, markdown, parentLink);
		} catch (error) {
			Debug.error('FeishuMcpPublisher.publishFile error:', error);
			return { success: false, error: this.describeError(error) };
		}
	}

	private async createDocument(title: string, markdown: string, parentLink?: string): Promise<ShareResult> {
		const args: Record<string, unknown> = { title, markdown };
		if (parentLink) {
			args.wiki_node = parentLink;
		}
		const result = await this.mcp.callTool<CreateDocResult>('create-doc', args);

		if (result.task_id && !result.doc_url) {
			const polled = await this.pollCreateTask(result.task_id);
			if (polled.doc_url) return { success: true, url: polled.doc_url, title };
			return { success: false, error: '创建任务超时' };
		}
		if (!result.doc_url) {
			return { success: false, error: result.message || 'MCP 创建文档未返回 doc_url' };
		}
		return { success: true, url: result.doc_url, title };
	}

	private async updateDocument(docUrl: string, title: string, markdown: string): Promise<ShareResult> {
		const args: Record<string, unknown> = {
			doc_id: docUrl,
			mode: 'overwrite',
			markdown,
			new_title: title,
		};
		const result = await this.mcp.callTool<UpdateDocResult>('update-doc', args);
		if (result.mode || result.doc_id || result.message) {
			return { success: true, url: docUrl, title };
		}
		return { success: false, error: 'MCP 更新文档返回异常' };
	}

	private async pollCreateTask(taskId: string, maxAttempts = 12, intervalMs = 2500): Promise<CreateDocResult> {
		for (let i = 0; i < maxAttempts; i++) {
			await new Promise((r) => setTimeout(r, intervalMs));
			const status = await this.mcp.callTool<CreateDocResult>('create-doc', { task_id: taskId });
			if (status.doc_url) return status;
		}
		return {};
	}

	private async docExists(docUrlOrId: string): Promise<boolean> {
		try {
			const result = await this.mcp.callTool<FetchDocResult>('fetch-doc', {
				doc_id: docUrlOrId,
				limit: 1,
				skip_task_detail: true,
			});
			return !result.error;
		} catch (error) {
			Debug.log('fetch-doc probe failed, will create new doc:', this.describeError(error));
			return false;
		}
	}

	private pickFeishuUrl(frontMatter: FrontMatterData | null): string | undefined {
		if (!frontMatter) return undefined;
		const raw = frontMatter.feishu_url;
		if (typeof raw !== 'string') return undefined;
		const trimmed = raw.trim();
		return trimmed || undefined;
	}

	private pickParentLink(frontMatter: FrontMatterData | null): string | undefined {
		if (!frontMatter) return undefined;
		for (const key of PARENT_LINK_KEYS) {
			const value = frontMatter[key];
			if (typeof value === 'string' && value.trim()) {
				return value.trim();
			}
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

		const codeFilter = (this.settings.codeBlockFilterLanguages || []).map((s) => s.toLowerCase());
		if (codeFilter.length > 0) {
			const fencedRegex = /(^|\n)(```|~~~)\s*([^\n]*)\n([\s\S]*?)\n\2\s*(?=\n|$)/g;
			result = result.replace(fencedRegex, (full, leading, _fence, info) => {
				const lang = (info || '').trim().split(/\s+/)[0].toLowerCase();
				return lang && codeFilter.includes(lang) ? leading || '' : full;
			});
		}

		// ![alt](src) where src isn't http(s) → drop the image, keep a hint
		result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawSrc) => {
			const src = rawSrc.trim();
			if (/^https?:\/\//i.test(src)) return match;
			const name = this.extractFileName(src);
			const label = alt && alt.trim() ? alt.trim() : name || '本地图片';
			return `_(本地图片已省略: ${label})_`;
		});

		// ![[file]] obsidian embed → keep a hint
		result = result.replace(/!\[\[([^\]]+)\]\]/g, (_match, target) => {
			const name = String(target).split('|')[0].split('#')[0].trim();
			return `_(本地引用已省略: ${name})_`;
		});

		// [[file|alias]] obsidian link → render alias as plain text
		result = result.replace(/\[\[([^\]]+)\]\]/g, (_match, target) => {
			const parts = String(target).split('|');
			const display = (parts[1] || parts[0] || '').split('#')[0].trim();
			return display;
		});

		return result;
	}

	private extractFileName(path: string): string {
		const cleaned = path.split('?')[0].split('#')[0];
		const segments = cleaned.split(/[\\/]/);
		return segments[segments.length - 1] || cleaned;
	}

	private describeError(error: unknown): string {
		if (error instanceof McpError) return `MCP 错误 (${error.code}): ${error.message}`;
		if (error instanceof Error) return error.message;
		return String(error);
	}
}
