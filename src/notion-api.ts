/**
 * Notion API 服务
 * 提供完整的 Notion API 集成功能，包括页面创建、更新、文件上传等
 */

import { App, requestUrl } from 'obsidian';
import {
    NotionSettings,
    NotionUserInfo,
    NotionPage,
    NotionDatabase,
    NotionBlock,
    NotionRichText,
    NotionFileUploadResponse,
    NotionPublishResult,
    NotionProcessContext,
} from './types';
import { convertMarkdownToBlocks } from './notion-markdown';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as mime from 'mime-types';
import { Debug } from './debug';

// Notion API 约束与重试策略（遵循 AGENTS.md 中的网络退避规定）
const MAX_CHILDREN_PER_REQ = 100;           // Notion 每次追加 children 的上限
const INTER_REQUEST_DELAY_MS = 350;         // 为降低 429 概率，批次之间加入轻微间隔
const TABLE_ROW_BATCH_SIZE_DEFAULT = 10;    // 大表使用更小的默认批次，更稳健
const RETRY_429_DELAY_MS = 20_000;          // 429 固定退避 20 秒
const RETRY_5XX_DELAY_MS = 2_000;           // 5xx 退避 2 秒
const MAX_429_RETRIES = 3;                  // 429 最多重试 3 次
const MAX_5XX_RETRIES = 1;                  // 5xx/网络超时最多重试 1 次

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NotionApiService {
    private apiToken: string;
    private baseUrl: string = 'https://api.notion.com/v1';

    constructor(private settings: NotionSettings, private app: App) {
        this.apiToken = settings.notionApiToken;
    }

    /**
     * 将 Notion 页面 URL 提取并规范为带短横线的 pageId
     */
    parseNotionPageIdFromUrl(url: string): string | null {
        try {
            Debug.log(`[Notion] Parsing page ID from URL: ${url}`);
            const last = url.trim().split('/').pop() || '';

            // 尝试提取32字符的十六进制字符串
            const hexMatches = last.match(/[a-fA-F0-9]{32}/g);

            if (hexMatches && hexMatches.length > 0) {
                const hex = hexMatches[0];
                const result = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
                Debug.log(`[Notion] Extracted page ID via regex: ${result}`);
                return result;
            }

            // 备用方法：移除所有非十六进制字符
            const hex = last.replace(/[^a-fA-F0-9]/g, '');
            if (hex.length === 32) {
                const result = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase();
                Debug.log(`[Notion] Extracted page ID via cleanup: ${result}`);
                return result;
            }

            Debug.log(`[Notion] Could not extract page ID from URL: ${url}`);
            return null;
        } catch (error) {
            Debug.error(`[Notion] Error parsing page ID from URL: ${error}`);
            return null;
        }
    }

	/**
	 * 测试 API 连接和获取用户信息
	 */
	async testConnection(): Promise<{ success: boolean; userInfo?: NotionUserInfo; error?: string }> {
		try {
			// 验证API Token格式
			if (!this.apiToken) {
				return { success: false, error: 'API Token未配置' };
			}

			if (!this.apiToken.startsWith('ntn_') && !this.apiToken.startsWith('secret_')) {
				return { success: false, error: 'API Token格式不正确，应以ntn_或secret_开头' };
			}

			const userInfo = await this.getCurrentUser();
			return { success: true, userInfo };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';

			// 提供更详细的错误信息
			if (message.includes('401') || message.includes('unauthorized')) {
				return { success: false, error: 'API Token无效或已过期' };
			} else if (message.includes('403') || message.includes('restricted_resource')) {
				return { success: false, error: '权限不足，请检查集成权限设置' };
			} else if (message.includes('429') || message.includes('rate_limited')) {
				return { success: false, error: 'API调用频率限制，请稍后重试' };
			} else {
				return { success: false, error: message };
			}
		}
	}

	/**
	 * 获取当前用户信息
	 */
	async getCurrentUser(): Promise<NotionUserInfo> {
		const response = await this.makeRequest<NotionUserInfo>('/users/me', 'GET');
		return response;
	}

	/**
	 * 搜索页面或数据库
	 */
    async searchPages(query: string): Promise<NotionPage[]> {
        const body: any = {
            query,
            filter: { value: 'page', property: 'object' },
            sort: { direction: 'descending', timestamp: 'last_edited_time' },
            page_size: 50,
        };
        const response = await this.makeRequest<{ results: NotionPage[] }>('/search', 'POST', body);
        return (response as any).results || [];
    }

	/**
	 * 根据标题查找现有页面
	 */
    async findPageByTitle(title: string, opts?: { databaseId?: string; parentPageId?: string }): Promise<NotionPage | null> {
        try {
            if (opts?.databaseId) {
                const resp = await this.makeRequest<{ results: NotionPage[] }>(`/databases/${opts.databaseId}/query`, 'POST', {
                    filter: { property: 'Name', title: { equals: title } },
                    page_size: 10,
                });
                const pages = (resp as any).results || [];
                return pages[0] || null;
            }

            const results = await this.searchPages(title);
            const filtered = (results || []).filter((p: any) => {
                const parent = p.parent;
                if (opts?.parentPageId) return parent?.type === 'page_id' && parent.page_id === opts.parentPageId;
                return true;
            });
            return filtered[0] || null;
        } catch (error) {
            console.warn('Error finding page by title:', error);
            return null;
        }
    }

	/**
	 * 创建新页面
	 */
	async createPage(
		title: string,
		content: NotionBlock[],
		options: {
			databaseId?: string;
			parentPageId?: string;
			icon?: string;
			cover?: string;
			properties?: Record<string, any>;
		} = {}
	): Promise<NotionPage> {
		const parent: any = {};

		if (options.databaseId) {
			parent.type = 'database_id';
			parent.database_id = options.databaseId;
		} else if (options.parentPageId) {
			parent.type = 'page_id';
			parent.page_id = options.parentPageId;
		} else {
			parent.type = 'workspace';
			parent.workspace = true;
		}

		const pageData: any = {
			parent,
			children: content,
			properties: options.properties || {}
		};

		// 添加标题属性
		if (options.databaseId) {
			pageData.properties.Name = {
				title: [{ text: { content: title } }]
			};
        } else {
            // 对于非数据库页面，标题在 children 中设置
            (content as any).unshift({
                object: 'block',
                type: 'heading_1',
                heading_1: {
                    rich_text: [{ type: 'text', text: { content: title }, plain_text: title, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }],
                    color: 'default',
                    is_toggleable: false
                }
            } as any);
        }

		// 添加图标和封面
		if (options.icon) {
			pageData.icon = this.parseIcon(options.icon);
		}

		if (options.cover) {
			pageData.cover = {
				type: 'external',
				external: { url: options.cover }
			};
		}

		const response = await this.makeRequest<NotionPage>('/pages', 'POST', pageData);
		return response;
	}

	/**
	 * 更新现有页面
	 */
    async updatePage(
        pageId: string,
        content: NotionBlock[],
        options: { replaceContent?: boolean; properties?: Record<string, any> } = {}
    ): Promise<NotionPage> {
        // 先更新属性
        if (options.properties) {
            await this.makeRequest<NotionPage>(`/pages/${pageId}`, 'PATCH', { properties: options.properties });
        }

        // 替换内容：删除现有块
        if (options.replaceContent) {
            const blocks = await this.getPageBlocks(pageId);
            for (const block of blocks) await this.deleteBlock(block.id);
        }

        // 追加新内容，支持表格处理
        if (content?.length) {
            const { prepared, tablePlans } = this.prepareBlocksForAppend(content as any[]);
            await this.appendBlocksWithTables(pageId, prepared, tablePlans);
        }

        return await this.makeRequest<NotionPage>(`/pages/${pageId}`, 'GET');
    }

    /**
     * 直接将 Markdown 发布到已存在的 Notion 页面（按页面ID覆盖内容）
     * - 不创建/搜索页面；仅对指定 pageId 执行 replaceContent=true 的更新
     */
    async publishToExistingPage(
        pageId: string,
        markdown: string,
        context: NotionProcessContext & { sourceDir?: string }
    ): Promise<NotionPublishResult> {
        Debug.log(`[Notion] publishToExistingPage: pageId=${pageId}`);
        try {
            // Markdown → Blocks（含本地资源上传解析）
            let blocks = await this.mdToBlocks(markdown, (context as any).sourceDir);
            Debug.log(`[Notion] Converted ${blocks.length} blocks (existing page)`);
            // 全局兜底修复只含表头的表格
            blocks = this.repairTablesFromMarkdown(blocks, markdown);
            const tblInfoExisting = (blocks as any[]).filter(b => (b as any)?.type === 'table').map((t: any) => t?.table?.children?.length ?? 0).join(',');
            Debug.log(`[Notion] After repair (existing), table rows per block: [${tblInfoExisting}]`);

            // 预处理并分批追加（表格行分批） - 仅用于日志统计，不把裁剪后的 prepared 当作内容传入
            const { prepared, tablePlans } = this.prepareBlocksForAppend(blocks as any[]);
            Debug.log(`[Notion] Prepared ${prepared.length} blocks (existing page), tables=${tablePlans.size}`);

            // 覆盖写入：传入原始 blocks，让 updatePage 自行 prepare，避免只剩表头
            await this.updatePage(pageId, blocks as any[], { replaceContent: true });

            // 回读页面获取URL
            const page = await this.makeRequest<NotionPage>(`/pages/${pageId}`, 'GET');
            Debug.log(`[Notion] Updated existing page ok: ${page?.url}`);
            return { success: true, pageId, url: (page as any)?.url, title: undefined, updatedExisting: true };
        } catch (error) {
            Debug.error('[Notion] publishToExistingPage failed:', error);
            return { success: false, error: (error as Error)?.message || 'Unknown error' };
        }
    }

    /**
     * 获取页面块内容
     */
    async getPageBlocks(pageId: string, startCursor?: string): Promise<NotionBlock[]> {
		let url = `/blocks/${pageId}/children`;
		if (startCursor) {
			url += `?start_cursor=${startCursor}`;
		}

		const response = await this.makeRequest<{
			results: NotionBlock[];
			next_cursor?: string;
			has_more: boolean;
		}>(url, 'GET');

		// 如果还有更多内容，递归获取
		if (response.has_more && response.next_cursor) {
			const moreBlocks = await this.getPageBlocks(pageId, response.next_cursor);
			return [...response.results, ...moreBlocks];
		}

        return response.results || [];
    }

    /**
     * 使用 remark 将 Markdown 转为 Notion Blocks，并在过程中解析本地资源→file_upload
     */
    private async mdToBlocks(markdown: string, sourceDir?: string): Promise<NotionBlock[]> {
        // 去掉开头的 YAML front matter，Notion 只发布正文
        const stripFrontMatter = (md: string): string => {
            if (!md) return md;
            // 支持开头为 --- 或 \ufeff---（带 BOM）
            const starts = md.startsWith('---') || md.startsWith('\ufeff---');
            if (!starts) return md;
            const lines = md.split(/\r?\n/);
            if (lines[0].trim() !== '---' && lines[0].replace('\ufeff', '').trim() !== '---') return md;
            let end = -1;
            for (let i = 1; i < Math.min(lines.length, 500); i++) {
                if (lines[i].trim() === '---') { end = i; break; }
            }
            if (end === -1) return md; // 不成对就不剥离
            const body = lines.slice(end + 1).join('\n');
            Debug.log('[Notion] Front matter stripped');
            return body;
        };

        const mdNoFm = stripFrontMatter(markdown);

        const resolver = async (src: string) => {
            let abs: string | null = null;
            if (src.startsWith('/')) {
                abs = src; // 认为是绝对路径（Obsidian 中不常见）
            } else if (sourceDir) {
                abs = path.join(sourceDir, src);
            }
            if (!abs) return null;
            try { await fs.stat(abs); } catch { return null; }
            const uploadId = await this.uploadLocalFile(abs);
            const ext = path.extname(abs).toLowerCase();
            const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.avif'].includes(ext);
            return { kind: (isImage ? 'image' : 'file'), uploadId };
        };
        const blocks = await convertMarkdownToBlocks(mdNoFm, { resolveLocalAsset: resolver as any });
        return blocks as NotionBlock[];
    }

    /**
     * 二次兜底：若某些 table 仍只有表头（<=1 行），基于整篇 Markdown 做全局恢复。
     * 这样即使 remark 的位置信息不可用，也能尽量把数据行补齐。
     */
    private repairTablesFromMarkdown(blocks: NotionBlock[], markdown: string): NotionBlock[] {
        if (!Array.isArray(blocks) || !markdown) return blocks;
        // 简单的“pipe 表格段落”切分（连续带竖线的行构成一个段落）
        const lines = markdown.split(/\r?\n/);
        const segments: string[][] = [];
        let cur: string[] = [];
        const isSep = (ln: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test((ln || '').trim());
        const isRow = (ln: string) => !!ln && ln.includes('|');

        for (const ln of lines) {
            if (isRow(ln)) cur.push(ln); else { if (cur.length) { segments.push(cur); cur = []; } }
        }
        if (cur.length) segments.push(cur);

        const splitByUnescapedPipes = (line: string): string[] => {
            const parts: string[] = [];
            let acc = '';
            let escaped = false;
            let inCode = false;
            let wikiDepth = 0;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                const next = line[i + 1];
                if (escaped) { acc += ch; escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === '`') { inCode = !inCode; acc += ch; continue; }
                if (ch === '[' && next === '[') { wikiDepth++; acc += ch; continue; }
                if (ch === ']' && next === ']') { wikiDepth = Math.max(0, wikiDepth - 1); acc += ch; continue; }
                if (ch === '|' && !inCode && wikiDepth === 0) { parts.push(acc); acc = ''; continue; }
                acc += ch;
            }
            parts.push(acc);
            return parts;
        };

        const buildRowsFromRawLines = (segLines: string[], expectedWidth: number): any[] => {
            const rows: any[] = [];
            for (const raw of segLines) {
                if (!raw) continue;
                const trimmed = raw.trim();
                if (isSep(trimmed)) continue;
                let cells = splitByUnescapedPipes(raw).map(s => s.trim());
                if (cells[0] === '') cells.shift();
                if (cells.length && cells[cells.length - 1] === '') cells.pop();
                const width = expectedWidth || cells.length || 1;
                if (cells.length > width) cells.length = width;
                while (cells.length < width) cells.push('');
                const row: any = { object: 'block', type: 'table_row', table_row: { cells: cells.map(txt => [{
                    type: 'text', text: { content: txt }, plain_text: txt,
                    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
                }]) } };
                rows.push(row);
            }
            return rows;
        };

        const norm = (s: string) => (s || '').replace(/\s+/g, '');

        blocks.forEach((b: any, idx: number) => {
            if (!b || b.type !== 'table' || !b.table) return;
            const table = b.table;
            const current = Array.isArray(table.children) ? table.children : [];
            if (current.length > 1) return; // 已经有数据行

            const width = table.table_width || (current[0]?.table_row?.cells?.length ?? 1) || 1;
            const headerCells = (current[0]?.table_row?.cells || []).map((cell: any[]) => (cell?.[0]?.plain_text ?? '').trim());
            const expected = headerCells.map(norm);
            if (expected.length === 0) return;

            // 在所有候选段落里按表头文本精确匹配
            for (const seg of segments) {
                if (seg.length === 0) continue;
                const headerLine = isSep(seg[0]) && seg.length > 1 ? seg[1] : seg[0];
                if (!headerLine) continue;
                let cells = splitByUnescapedPipes(headerLine).map(s => s.trim());
                if (cells[0] === '') cells.shift();
                if (cells.length && cells[cells.length - 1] === '') cells.pop();
                while (cells.length < width) cells.push('');
                if (cells.length > width) cells.length = width;
                const normalized = cells.map(norm);
                const match = normalized.length === expected.length && normalized.every((v, i) => v === expected[i]);
                if (!match) continue;

                const recovered = buildRowsFromRawLines(seg, width);
                Debug.log(`[Notion] Global table recovery hit at block#${idx}: recoveredRows=${recovered.length}`);
                if (recovered.length > current.length) {
                    table.children = recovered as any;
                }
                break;
            }
        });

        return blocks;
    }

    /**
     * 追加子块到页面/块底部，带自适应批次与重试：
     * - 默认每批 ≤100；若触发 413（Payload Too Large）则对半降批次重试
     * - 批次之间延时以降低 429 概率
     */
    private async appendBlockChildren(pageId: string, children: NotionBlock[]): Promise<void> {
        Debug.log(`[Notion] appendBlockChildren: adding ${children.length} children to block ${pageId}`);
        const allTableRows = children.length > 0 && children.every((c: any) => c?.type === 'table_row');
        // 对表格行使用更小默认批次，避免大表触发 413/429
        let batchSize = allTableRows ? Math.min(TABLE_ROW_BATCH_SIZE_DEFAULT, MAX_CHILDREN_PER_REQ) : Math.min(MAX_CHILDREN_PER_REQ, Math.max(1, Math.ceil(children.length / Math.ceil(children.length / MAX_CHILDREN_PER_REQ))));
        const totalBatches = Math.ceil(children.length / batchSize);

        for (let start = 0, batchIndex = 0; start < children.length; start += batchSize, batchIndex++) {
            const batch = children.slice(start, start + batchSize);
            Debug.log(`[Notion] Processing children batch ${batchIndex + 1}/${totalBatches} with ${batch.length} items`);

            try {
                await this.makeRequest(`/blocks/${pageId}/children`, 'PATCH', { children: batch });
            } catch (err) {
                const msg = (err as Error)?.message || '';
                Debug.error(`[Notion] appendBlockChildren error on batch ${batchIndex + 1}: ${msg}`);

                // 兼容部分工作区 PATCH 不可用的情况，切换为 POST
                if (/invalid_request_url|405|method/i.test(msg) || /\b400\b/.test(msg)) {
                    Debug.log(`[Notion] Retrying with POST method for batch ${batchIndex + 1}`);
                    await this.makeRequest(`/blocks/${pageId}/children`, 'POST', { children: batch });
                }
                // 请求体过大，降低批次大小重试一次
                else if (/\b413\b|payload\s*too\s*large/i.test(msg)) {
                    const newSize = Math.max(1, Math.floor(batchSize / 2));
                    if (newSize === batchSize) throw err; // 已无法再降
                    Debug.log(`[Notion] Payload too large. Shrinking batch size ${batchSize} -> ${newSize} and retrying batch ${batchIndex + 1}`);
                    batchSize = newSize;
                    // 回退 start 到该批次开头以便重试
                    start -= batch.length;
                    batchIndex--;
                    await sleep(INTER_REQUEST_DELAY_MS);
                    continue;
                }
                else {
                    throw err;
                }
            }

            // 降低触发 429 的概率
            await sleep(INTER_REQUEST_DELAY_MS);
        }
        Debug.log(`[Notion] Successfully added all ${children.length} children to block ${pageId}`);
    }

    /**
     * 追加块并为 table 追加行（分批 ≤100），避免单请求超限。
     */
    private async appendBlocksWithTables(pageId: string, prepared: any[], tablePlans: Map<number, any[]>): Promise<void> {
        // 策略：
        // - 非表格块使用批量（≤100）提交；
        // - 表格块单独提交，拿到 table id 后再分批写入行，避免依赖返回顺序映射导致错配。

        let batch: any[] = [];
        const flushBatch = async () => {
            if (batch.length === 0) return;
            let resp: any = null;
            try {
                resp = await this.makeRequest(`/blocks/${pageId}/children`, 'PATCH', { children: batch });
            } catch (err) {
                const msg = (err as Error)?.message || '';
                if (/invalid_request_url|405|method/i.test(msg) || /\b400\b/.test(msg)) {
                    resp = await this.makeRequest(`/blocks/${pageId}/children`, 'POST', { children: batch });
                } else if (/\b413\b|payload\s*too\s*large/i.test(msg)) {
                    // 若批次仍过大，改为逐个发送
                    const items = batch;
                    batch = [];
                    for (const item of items) {
                        await this.appendBlocksWithTables(pageId, [item], tablePlans);
                    }
                    await sleep(INTER_REQUEST_DELAY_MS);
                    return;
                } else {
                    throw err;
                }
            }
            Debug.log(`[Notion] Flushed non-table batch with ${batch.length} items`);
            batch = [];
            await sleep(INTER_REQUEST_DELAY_MS);
            return resp;
        };

        for (let i = 0; i < prepared.length; i++) {
            const b = prepared[i];
            const isTable = b && b.type === 'table';

            if (!isTable) {
                batch.push(b);
                if (batch.length >= MAX_CHILDREN_PER_REQ) await flushBatch();
                continue;
            }

            // 先把之前累积的非表格块刷出去
            await flushBatch();

            // 单独提交表格块
            let resp: any = null;
            try {
                resp = await this.makeRequest(`/blocks/${pageId}/children`, 'PATCH', { children: [b] });
            } catch (err) {
                const msg = (err as Error)?.message || '';
                if (/invalid_request_url|405|method/i.test(msg) || /\b400\b/.test(msg)) {
                    resp = await this.makeRequest(`/blocks/${pageId}/children`, 'POST', { children: [b] });
                } else {
                    throw err;
                }
            }

            const created = (resp && resp.results && resp.results[0]) ? resp.results[0] : null;
            if (!created) {
                Debug.warn('[Notion] No table block returned after append; fetching page children to locate it.');
                // 兜底：获取最后一个子块作为新建的表格（代价较高，仅在异常情况触发）
                const pageChildren = await this.getPageBlocks(pageId);
                const last = pageChildren[pageChildren.length - 1] as any;
                if (last?.type === 'table') {
                    (resp as any) = { results: [last] };
                }
            }

            const tbl = (resp && resp.results && resp.results[0]) ? resp.results[0] : null;
            if (tbl?.id) {
                const planRows = tablePlans.get(i) || [];
                Debug.log(`[Notion] Table#${i} created: ${tbl.id}. Planned rows: ${planRows.length}`);

                // 分批添加表格行（跳过表头，因为表头已经包含在空表格中）
                if (planRows.length > 1) {
                    const dataRows = planRows.slice(1); // 跳过表头
                    const batchSize = Math.min(TABLE_ROW_BATCH_SIZE_DEFAULT, MAX_CHILDREN_PER_REQ); // 表格行使用更小的批次
                    const totalBatches = Math.ceil(dataRows.length / batchSize);

                    Debug.log(`[Notion] Adding ${dataRows.length} data rows in ${totalBatches} batches (batch size: ${batchSize})`);

                    for (let start = 0, batchIndex = 0; start < dataRows.length; start += batchSize, batchIndex++) {
                        const batch = dataRows.slice(start, start + batchSize);
                        Debug.log(`[Notion] Processing table row batch ${batchIndex + 1}/${totalBatches} with ${batch.length} rows`);

                        try {
                            await this.makeRequest(`/blocks/${tbl.id}/children`, 'PATCH', { children: batch });
                            Debug.log(`[Notion] Table row batch ${batchIndex + 1} successful`);
                        } catch (err) {
                            const msg = (err as Error)?.message || '';
                            Debug.error(`[Notion] Table row batch ${batchIndex + 1} failed: ${msg}`);

                            // 兼容部分工作区 PATCH 不可用的情况，切换为 POST
                            if (/invalid_request_url|405|method/i.test(msg) || /\b400\b/.test(msg)) {
                                Debug.log(`[Notion] Retrying table row batch ${batchIndex + 1} with POST method`);
                                await this.makeRequest(`/blocks/${tbl.id}/children`, 'POST', { children: batch });
                            } else {
                                throw err;
                            }
                        }

                        // 降低触发 429 的概率
                        await sleep(INTER_REQUEST_DELAY_MS);
                    }
                    Debug.log(`[Notion] Successfully added all ${dataRows.length} table rows to table ${tbl.id}`);
                }
                await sleep(INTER_REQUEST_DELAY_MS);
            } else {
                Debug.warn('[Notion] Unable to obtain created table id; rows will be skipped for this table.');
            }
        }

        // 刷掉尾批非表格块
        await flushBatch();
    }

    /**
     * 从块列表中提取 table 的行，使用成功的分批处理方法
     */
    private prepareBlocksForAppend(blocks: any[]): { prepared: any[]; tablePlans: Map<number, any[]> } {
        const prepared: any[] = [];
        const plans = new Map<number, any[]>();

        Debug.log(`[Notion] prepareBlocksForAppend: processing ${blocks.length} blocks`);

        blocks.forEach((b, idx) => {
            if (b && b.type === 'table' && b.table) {
                // 确保表格有 children 数组
                if (!Array.isArray(b.table.children)) {
                    b.table.children = [];
                }

                Debug.log(`[Notion] Found table at index ${idx} with ${b.table.children.length} rows, width=${b.table.table_width}, has_column_header=${b.table.has_column_header}`);

                // 提取表格行到单独的计划中
                plans.set(idx, b.table.children);

                // 创建表格块的副本，只包含表头行以满足API验证
                // 实际的行数据会在后续步骤中从tablePlans分批添加
                const clone = {
                    ...b,
                    table: {
                        ...b.table,
                        children: b.table.children.length > 0
                            ? [b.table.children[0]] // 只包含表头
                            : [
                                // 如果没有任何行，添加一个空行作为表头
                                {
                                    object: 'block',
                                    type: 'table_row',
                                    table_row: {
                                        cells: Array(b.table.table_width || 1).fill([])
                                    }
                                }
                            ]
                    }
                };
                prepared.push(clone);
            } else {
                prepared.push(b);
            }
        });

        Debug.log(`[Notion] prepareBlocksForAppend: prepared ${prepared.length} blocks, ${plans.size} table plans`);
        // 追加每个表格计划的统计，便于定位行数异常
        for (const [i, rows] of plans.entries()) {
            Debug.log(`[Notion] tablePlan[${i}] rows=${rows?.length ?? 0}`);
        }
        return { prepared, tablePlans: plans };
    }

    // （移除重复定义，保留前面的 appendBlockChildren 实现）

	/**
	 * 删除块
	 */
	async deleteBlock(blockId: string): Promise<void> {
		await this.makeRequest(`/blocks/${blockId}`, 'DELETE');
	}

	/**
	 * 上传文件到 Notion
	 */
    /**
     * 上传本地文件（小文件）到 Notion，返回 file_upload 对象 id
     */
    private async uploadLocalFile(filePath: string): Promise<string> {
        const fileName = path.basename(filePath);
        const contentType = (mime.lookup(fileName) || 'application/octet-stream').toString();

        // 检查文件大小（Notion限制为20MB）
        const stats = await fs.stat(filePath);
        const maxSize = 20 * 1024 * 1024; // 20MB

        if (stats.size > maxSize) {
            throw new Error(`文件大小超过限制: ${(stats.size / 1024 / 1024).toFixed(2)}MB > ${maxSize / 1024 / 1024}MB`);
        }

        if (stats.size === 0) {
            throw new Error('文件为空');
        }

        const content = await fs.readFile(filePath);

        try {
            // 1) 创建 file_upload 对象
            const createResp = await this.makeRequest<NotionFileUploadResponse>(`/file_uploads`, 'POST', {
                filename: fileName,
                content_type: contentType,
            });
            const uploadId = (createResp as any).id;

            // 2) 发送内容（multipart/form-data via requestUrl，绕过 CORS）
            const boundary = `----obn_${Date.now().toString(16)}`;
            const pre = Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
                `Content-Type: ${contentType}\r\n\r\n`, 'utf8'
            );
            const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
            const bodyBuf = Buffer.concat([pre, content, post]);
            const sendUrl = `${this.baseUrl}/file_uploads/${uploadId}/send`;
            const sendResp = await requestUrl({
                url: sendUrl,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': `multipart/form-data; boundary=${boundary}`
                },
                body: bodyBuf,
                throw: false
            });

            if (sendResp.status < 200 || sendResp.status >= 300) {
                let errorMessage = `文件上传失败: ${sendResp.status}`;
                try {
                    const errorData = sendResp.json || JSON.parse(sendResp.text || '{}');
                    if (errorData.message) {
                        errorMessage += ` - ${errorData.message}`;
                    } else {
                        errorMessage += ` - ${sendResp.text}`;
                    }
                } catch {
                    errorMessage += ` - ${sendResp.text}`;
                }
                throw new Error(errorMessage);
            }

            return uploadId;
        } catch (error) {
            if (error instanceof Error && error.message.includes('file_upload')) {
                throw new Error(`文件上传失败: ${error.message}`);
            }
            throw error;
        }
    }

	/**
	 * 获取数据库信息
	 */
	async getDatabase(databaseId: string): Promise<NotionDatabase> {
		const response = await this.makeRequest<NotionDatabase>(`/databases/${databaseId}`, 'GET');
		return response;
	}

	/**
	 * 获取数据库列表
	 */
	async getDatabases(): Promise<NotionDatabase[]> {
        const searchResponse = await this.makeRequest<any>('/search', 'POST', {
            filter: {
                property: 'object',
                value: 'database'
            }
        });

		const databases: NotionDatabase[] = [];
        for (const result of (searchResponse.results || [])) {
            const r: any = result as any;
            if (r.object === 'database') {
                const dbResponse = await this.makeRequest<NotionDatabase>(`/databases/${r.id}`, 'GET');
                databases.push(dbResponse);
            }
        }

		return databases;
	}

	/**
	 * 解析图标
	 */
	private parseIcon(icon: string): any {
		if (icon.startsWith('http')) {
			return {
				type: 'external',
				external: { url: icon }
			};
		} else if (icon.startsWith('data:')) {
			return {
				type: 'file',
				file: { url: icon }
			};
		} else {
			// 假设是 emoji
			return {
				type: 'emoji',
				emoji: icon
			};
		}
	}


	/**
	 * 通用请求方法
	 */
    private async makeRequest<T>(
        path: string,
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
        body?: any
    ): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        };

        let attempt429 = 0;
        let attempt5xx = 0;

        while (true) {
            Debug.api(`[Notion] ${method}`, url, body);
            let resp: any;

            try {
                resp = await requestUrl({
                    url,
                    method,
                    headers,
                    body: (body && method !== 'GET') ? JSON.stringify(body) : undefined,
                    throw: false
                });
            } catch (networkErr) {
                // 认为是网络故障或超时 → 2s 后最多重试一次
                if (attempt5xx < MAX_5XX_RETRIES) {
                    attempt5xx++;
                    Debug.error(`[Notion] Network error, retrying in ${RETRY_5XX_DELAY_MS}ms (attempt ${attempt5xx}/${MAX_5XX_RETRIES})`, networkErr);
                    await sleep(RETRY_5XX_DELAY_MS);
                    continue;
                }
                throw networkErr;
            }

            Debug.log(`[Notion] API Response Status: ${resp.status}`);
            Debug.log(`[Notion] API Response Headers:`, resp.headers);

            // 成功
            if (resp.status >= 200 && resp.status < 300) {
                if (resp.json) {
                    Debug.log(`[Notion] API Response JSON:`, resp.json);
                    return resp.json as T;
                }
                try {
                    const parsed = JSON.parse(resp.text || '{}') as T;
                    Debug.log(`[Notion] API Response Text (parsed):`, parsed);
                    return parsed;
                } catch {
                    Debug.log(`[Notion] API Response Text (raw): ${resp.text}`);
                    return {} as T;
                }
            }

            // 非 2xx：判断重试策略
            const status = resp.status as number;
            let errorMessage = `[${method} ${path}] Notion API Error: ${status}`;
            try {
                const errorData = resp.json || JSON.parse(resp.text || '{}');
                Debug.error(`[Notion] API Error Data:`, errorData);
                if (errorData.code && errorData.message) {
                    errorMessage += ` - ${errorData.code}: ${errorData.message}`;
                } else {
                    errorMessage += ` - ${resp.text}`;
                }
            } catch {
                errorMessage += ` - ${resp.text}`;
            }

            if (status === 429) {
                if (attempt429 < MAX_429_RETRIES) {
                    attempt429++;
                    const retryAfter = Number(resp.headers?.['retry-after']) || (RETRY_429_DELAY_MS / 1000);
                    const wait = Math.max(RETRY_429_DELAY_MS, retryAfter * 1000);
                    Debug.log(`[Notion] 429 rate limited. Backing off for ${wait}ms (attempt ${attempt429}/${MAX_429_RETRIES}).`);
                    await sleep(wait);
                    continue;
                }
                throw new Error(`[HTTP 429] API调用频率限制，请稍后重试。${errorMessage}`);
            }

            if (status >= 500 && status < 600) {
                if (attempt5xx < MAX_5XX_RETRIES) {
                    attempt5xx++;
                    Debug.log(`[Notion] ${status} server error. Retrying in ${RETRY_5XX_DELAY_MS}ms (attempt ${attempt5xx}/${MAX_5XX_RETRIES}).`);
                    await sleep(RETRY_5XX_DELAY_MS);
                    continue;
                }
                throw new Error(`[HTTP ${status}] Notion服务器内部错误，请稍后重试。${errorMessage}`);
            }

            // 其他错误 → 直接抛出，保留状态码便于上层判定
            if (status === 401) errorMessage = 'API Token无效或已过期，请检查Notion集成设置';
            else if (status === 403) errorMessage = '权限不足，请确保集成有足够的权限访问目标页面';
            else if (status === 404) errorMessage = '资源未找到，请检查页面ID或数据库ID是否正确';

            throw new Error(`[HTTP ${status}] ${errorMessage}`);
        }
    }

    /**
     * 发布文档到 Notion
     */
    async publishDocument(
        title: string,
        markdown: string,
        context: NotionProcessContext & { parentPageId?: string; sourceDir?: string }
    ): Promise<NotionPublishResult> {
        Debug.log(`[Notion] Starting publishDocument: title="${title}", parentPageId="${(context as any).parentPageId}", sourceDir="${(context as any).sourceDir}"`);

        try {
            const parentPageId = (context as any).parentPageId;
            let existingPage: NotionPage | null = null;
            if (context.updateExistingPages) {
                Debug.log(`[Notion] Searching for existing page with title: "${title}"`);
                existingPage = await this.findPageByTitle(title, { databaseId: context.targetDatabaseId, parentPageId });
                Debug.log(`[Notion] Existing page found:`, existingPage ? existingPage.id : 'none');
            }

            Debug.log(`[Notion] Converting markdown to blocks...`);
            let blocks = await this.mdToBlocks(markdown, (context as any).sourceDir);
            Debug.log(`[Notion] Converted ${blocks.length} blocks`);
            // 全局兜底修复只含表头的表格
            blocks = this.repairTablesFromMarkdown(blocks, markdown);
            const tblInfoNew = (blocks as any[]).filter(b => (b as any)?.type === 'table').map((t: any) => t?.table?.children?.length ?? 0).join(',');
            Debug.log(`[Notion] After repair, table rows per block: [${tblInfoNew}]`);

            const { prepared, tablePlans } = this.prepareBlocksForAppend(blocks as any[]);
            Debug.log(`[Notion] Prepared ${prepared.length} blocks for append, table plans: ${tablePlans.size}`);

            if (existingPage) {
                Debug.log(`[Notion] Found existing page with same title: ${existingPage.id}, updating content...`);

                // 更新现有页面：删除旧内容，添加新内容
                await this.updatePage(existingPage.id, prepared, { replaceContent: true });
                Debug.log(`[Notion] Successfully updated existing page: ${existingPage.url}`);
                return { success: true, pageId: existingPage.id, url: existingPage.url, title, updatedExisting: true };
            }

            if (!context.createNewIfNotExists) {
                Debug.log(`[Notion] No existing page found and createNewIfNotExists is false`);
                return { success: false, error: '未找到同名页面且被配置为不创建新页面' };
            }

            Debug.log(`[Notion] Creating new page...`);
            const parent: any = context.targetDatabaseId
                ? { type: 'database_id', database_id: context.targetDatabaseId }
                : parentPageId
                    ? { type: 'page_id', page_id: parentPageId }
                    : { type: 'workspace', workspace: true };

            const pageData: any = { parent };
            if (parent.type === 'database_id') {
                pageData.properties = { [context.pageTitleProperty || 'Name']: { title: [{ text: { content: title } }] } };
            }
            if ((context as any).defaultPageIcon) pageData.icon = this.parseIcon((context as any).defaultPageIcon);

            const created = await this.makeRequest<NotionPage>('/pages', 'POST', pageData);
            Debug.log(`[Notion] New page created: ${created.id}`);
            await this.appendBlocksWithTables(created.id, prepared, tablePlans);
            Debug.log(`[Notion] Successfully published to new page: ${created.url}`);
            return { success: true, pageId: created.id, url: created.url, title, updatedExisting: false };
        } catch (error) {
            Debug.error(`[Notion] Error in publishDocument:`, error);
            return { success: false, error: (error as Error).message || 'Unknown error occurred' };
        }
    }
}

export default NotionApiService;
