import { FeishuOpenApiClient } from './feishu-open-api-client';
import { buildFeishuResourceUrl, FeishuResourceRef, parseFeishuResourceRef } from './feishu-url';

export interface FeishuDocumentTarget {
	documentToken: string;
	url: string;
	title?: string;
	wikiNodeToken?: string;
}

export interface FeishuCreatedDocument {
	documentToken: string;
	url?: string;
	revisionId?: number;
}

interface WikiNode {
	space_id?: string;
	node_token?: string;
	obj_token?: string;
	obj_type?: string;
	parent_node_token?: string;
	title?: string;
}

/** Direct REST wrapper for the document and wiki calls used by publishing. */
export class FeishuDocsApi {
	constructor(private readonly client: FeishuOpenApiClient) {}

	async createMarkdownDocument(params: {
		title: string;
		markdown: string;
		parentWikiToken: string;
	}): Promise<FeishuCreatedDocument> {
		const data = await this.client.post<any>('/open-apis/docs_ai/v1/documents', {
			format: 'markdown',
			content: buildTitledMarkdown(params.title, params.markdown),
			parent_token: params.parentWikiToken,
		});
		const document = data?.document || data;
		const documentToken = stringValue(document?.document_id) || stringValue(document?.token);
		if (!documentToken) throw new Error('飞书创建文档成功，但响应中没有 document_id');
		return {
			documentToken,
			url: stringValue(document?.url) || undefined,
			revisionId: numberValue(document?.revision_id),
		};
	}

	async overwriteMarkdownDocument(params: {
		documentToken: string;
		title: string;
		markdown: string;
	}): Promise<void> {
		await this.client.put(
			`/open-apis/docs_ai/v1/documents/${encodeURIComponent(params.documentToken)}`,
			{
				format: 'markdown',
				command: 'overwrite',
				content: buildTitledMarkdown(params.title, params.markdown),
				revision_id: -1,
			},
		);
	}

	async resolveExistingDocument(input: string): Promise<FeishuDocumentTarget> {
		const ref = parseFeishuResourceRef(input);
		if (!ref) throw new Error('飞书文档链接格式不正确');
		if (ref.kind === 'wiki') return this.resolveWikiDocument(ref);
		if (ref.kind === 'doc') throw new Error('旧版 doc 文档不支持 Markdown 覆盖更新，请使用 docx 文档');

		const data = await this.client.get<any>(
			`/open-apis/docx/v1/documents/${encodeURIComponent(ref.token)}`,
		);
		const document = data?.document || data;
		return {
			documentToken: stringValue(document?.document_id) || ref.token,
			title: stringValue(document?.title) || undefined,
			url: ref.url || buildFeishuResourceUrl(ref.origin, 'docx', ref.token),
		};
	}

	async resolveParentWikiNode(parentLink: string): Promise<{
		spaceId: string;
		nodeToken: string;
		origin?: string;
	}> {
		const ref = parseFeishuResourceRef(parentLink);
		if (!ref || ref.kind !== 'wiki') {
			throw new Error('feishu 属性必须填写飞书 Wiki 父页面链接，例如 https://xxx.feishu.cn/wiki/xxx');
		}
		const node = await this.getWikiNode(ref.token);
		const spaceId = stringValue(node.space_id);
		const nodeToken = stringValue(node.node_token) || ref.token;
		if (!spaceId) throw new Error('无法从 feishu 父页面解析知识空间 ID');
		return { spaceId, nodeToken, origin: ref.origin };
	}

	async findChildDocumentByTitle(params: {
		spaceId: string;
		parentNodeToken: string;
		title: string;
		origin?: string;
	}): Promise<FeishuDocumentTarget | null> {
		let pageToken = '';
		let shouldContinue = true;
		const visitedTokens = new Set<string>();
		while (shouldContinue) {
			const data = await this.client.get<any>(
				`/open-apis/wiki/v2/spaces/${encodeURIComponent(params.spaceId)}/nodes`,
				{
					parent_node_token: params.parentNodeToken,
					page_size: 50,
					page_token: pageToken || undefined,
				},
			);
			const items: WikiNode[] = Array.isArray(data?.items) ? data.items : [];
			const match = items.find(item =>
				stringValue(item.title) === params.title
				&& stringValue(item.obj_type) === 'docx'
				&& !!stringValue(item.obj_token),
			);
			if (match) {
				const nodeToken = stringValue(match.node_token);
				return {
					documentToken: stringValue(match.obj_token),
					wikiNodeToken: nodeToken || undefined,
					title: stringValue(match.title),
					url: nodeToken
						? buildFeishuResourceUrl(params.origin, 'wiki', nodeToken)
						: buildFeishuResourceUrl(params.origin, 'docx', stringValue(match.obj_token)),
				};
			}

			const hasMore = data?.has_more === true;
			const nextPageToken = stringValue(data?.page_token);
			if (!hasMore || !nextPageToken || visitedTokens.has(nextPageToken)) {
				shouldContinue = false;
				continue;
			}
			visitedTokens.add(nextPageToken);
			pageToken = nextPageToken;
		}
		return null;
	}

	private async resolveWikiDocument(ref: FeishuResourceRef): Promise<FeishuDocumentTarget> {
		const node = await this.getWikiNode(ref.token);
		if (stringValue(node.obj_type) !== 'docx') {
			throw new Error(`feishu_url 指向的 Wiki 节点不是 docx 文档（类型：${stringValue(node.obj_type) || '未知'}）`);
		}
		const documentToken = stringValue(node.obj_token);
		if (!documentToken) throw new Error('无法从 feishu_url 解析 docx 文档 Token');
		return {
			documentToken,
			wikiNodeToken: stringValue(node.node_token) || ref.token,
			title: stringValue(node.title) || undefined,
			url: ref.url || buildFeishuResourceUrl(ref.origin, 'wiki', ref.token),
		};
	}

	private async getWikiNode(token: string): Promise<WikiNode> {
		const data = await this.client.get<any>('/open-apis/wiki/v2/spaces/get_node', { token });
		const node = data?.node || data;
		if (!node || typeof node !== 'object') throw new Error('飞书 Wiki 节点响应为空');
		return node as WikiNode;
	}
}

function buildTitledMarkdown(title: string, markdown: string): string {
	const titleTag = `<title>${escapeXmlText(title.trim())}</title>`;
	return markdown ? `${titleTag}\n${markdown}` : titleTag;
}

function escapeXmlText(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
