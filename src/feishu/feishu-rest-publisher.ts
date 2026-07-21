import { App, Notice, TFile } from 'obsidian';
import { FeishuSettings, FrontMatterData, ShareResult } from '../types';
import { MarkdownProcessor } from '../markdown-processor';
import { Debug } from '../debug';
import { FeishuAuthService } from './feishu-auth';
import { FeishuDocsApi, FeishuDocumentTarget } from './feishu-docs-api';
import { FeishuApiError, FeishuOpenApiClient } from './feishu-open-api-client';
import { buildFeishuResourceUrl } from './feishu-url';

const PARENT_LINK_KEYS = [
	'feishu',
	'feishu_parent',
	'feishu.parent',
	'feishu_parent_url',
	'parent_feishu_url',
	'feishu_parent_link',
];

/**
 * KMS-compatible Feishu publisher:
 *  1. feishu_url identifies an existing child page;
 *  2. stale/missing feishu_url falls back to exact title lookup under feishu;
 *  3. otherwise create below feishu;
 *  4. every successful publish returns the canonical child URL for backfill.
 */
export class FeishuRestPublisher {
	private settings: FeishuSettings;
	private readonly docs: FeishuDocsApi;

	constructor(
		private readonly app: App,
		settings: FeishuSettings,
		private readonly markdownProcessor: MarkdownProcessor,
		private readonly auth: FeishuAuthService,
	) {
		this.settings = settings;
		this.docs = new FeishuDocsApi(new FeishuOpenApiClient(auth));
	}

	updateSettings(settings: FeishuSettings): void {
		this.settings = settings;
	}

	isConfigured(): boolean {
		return this.auth.isConnected();
	}

	async publishFile(file: TFile, statusNotice?: Notice): Promise<ShareResult> {
		if (!this.isConfigured()) {
			return { success: false, error: '请先在插件设置中连接飞书账号' };
		}

		try {
			const rawContent = await this.app.vault.read(file);
			const { content: stripped, frontMatter } = this.markdownProcessor.processFrontMatter(
				rawContent,
				this.settings.frontMatterHandling,
			);
			// KMS always follows the current file name, including rename updates.
			const title = file.basename;
			const markdown = this.cleanMarkdownForFeishu(stripped);
			const parentLink = this.pickParentLink(frontMatter);
			if (!parentLink) {
				return { success: false, error: '当前笔记缺少 feishu 属性，请填写飞书 Wiki 父页面链接' };
			}

			statusNotice?.setMessage('🔍 正在定位飞书子页面…');
			const parent = await this.docs.resolveParentWikiNode(parentLink);
			const existingUrl = this.pickFeishuUrl(frontMatter);
			let target = existingUrl
				? await this.tryResolveMarkedDocument(existingUrl)
				: null;

			if (!target) {
				target = await this.docs.findChildDocumentByTitle({
					spaceId: parent.spaceId,
					parentNodeToken: parent.nodeToken,
					title,
					origin: parent.origin,
				});
			}

			if (target) {
				statusNotice?.setMessage('🔄 正在更新飞书页面…');
				await this.docs.overwriteMarkdownDocument({
					documentToken: target.documentToken,
					title,
					markdown,
				});
				return { success: true, url: target.url, title, operation: 'updated' };
			}

			statusNotice?.setMessage('📤 正在新建飞书子页面…');
			const created = await this.docs.createMarkdownDocument({
				title,
				markdown,
				parentWikiToken: parent.nodeToken,
			});
			const url = created.url
				|| buildFeishuResourceUrl(parent.origin, 'docx', created.documentToken);
			return { success: true, url, title, operation: 'created' };
		} catch (error) {
			Debug.error('FeishuRestPublisher.publishFile error:', this.safeErrorForLog(error));
			return { success: false, error: this.describeError(error) };
		}
	}

	private async tryResolveMarkedDocument(url: string): Promise<FeishuDocumentTarget | null> {
		try {
			return await this.docs.resolveExistingDocument(url);
		} catch (error) {
			if (this.canFallbackToTitle(error)) {
				Debug.warn(`[Feishu] feishu_url 不可用，将按父页面和标题匹配：${this.describeError(error)}`);
				return null;
			}
			throw error;
		}
	}

	private canFallbackToTitle(error: unknown): boolean {
		if (error instanceof FeishuApiError) return error.isNotFound();
		if (!(error instanceof Error)) return false;
		return /链接格式不正确|旧版 doc 文档|不是 docx 文档|无法从 feishu_url 解析/.test(error.message);
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

	private cleanMarkdownForFeishu(content: string): string {
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
		if (error instanceof FeishuApiError) {
			if (error.isMissingScope()) return `${error.message}，请在设置中重新授权飞书`;
			return error.message;
		}
		return error instanceof Error ? error.message : String(error);
	}

	private safeErrorForLog(error: unknown): string {
		return this.describeError(error).replace(/(u-|t-|a-)[A-Za-z0-9_-]+/g, '$1****');
	}
}
