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
        return await convertMarkdownToBlocks(markdown, { resolveLocalAsset: resolver as any });
    }

    /**
     * 追加子块到页面底部（每次最多100个）
     */
    private async appendBlockChildren(pageId: string, children: NotionBlock[]): Promise<void> {
        Debug.log(`[Notion] appendBlockChildren: adding ${children.length} children to block ${pageId}`);
        for (let i = 0; i < children.length; i += 100) {
            const batch = children.slice(i, i + 100);
            Debug.log(`[Notion] Processing batch ${i/100 + 1}/${Math.ceil(children.length/100)} with ${batch.length} items`);
            try {
                await this.makeRequest(`/blocks/${pageId}/children`, 'PATCH', { children: batch });
            } catch (err) {
                const msg = (err as Error).message || '';
                Debug.error(`[Notion] Error in appendBlockChildren batch ${i/100 + 1}:`, err);
                if (/invalid_request_url|405|method/i.test(msg) || /400/.test(msg)) {
                    Debug.log(`[Notion] Retrying with POST method for batch ${i/100 + 1}`);
                    await this.makeRequest(`/blocks/${pageId}/children`, 'POST', { children: batch });
                } else {
                    throw err;
                }
            }
        }
        Debug.log(`[Notion] Successfully added all ${children.length} children to block ${pageId}`);
    }

    /**
     * 追加块并为 table 追加行（分批 ≤100），避免单请求超限。
     */
    private async appendBlocksWithTables(pageId: string, prepared: any[], tablePlans: Map<number, any[]>): Promise<void> {
        for (let offset = 0; offset < prepared.length; offset += 100) {
            const batch = prepared.slice(offset, offset + 100);
            let resp: any = null;
            try {
                resp = await this.makeRequest(`/blocks/${pageId}/children`, 'PATCH', { children: batch });
            } catch (err) {
                const msg = (err as Error).message || '';
                if (/invalid_request_url|405|method/i.test(msg) || /400/.test(msg)) {
                    resp = await this.makeRequest(`/blocks/${pageId}/children`, 'POST', { children: batch });
                } else {
                    throw err;
                }
            }
            const results: any[] = (resp && (resp as any).results) ? (resp as any).results : [];
            for (let k = 0; k < batch.length; k++) {
                const originalIndex = offset + k;
                const sent = batch[k];
                const created = results[k];
                if (!created) continue;
                if (sent && sent.type === 'table') {
                    const rows = tablePlans.get(originalIndex) || [];
                    if (rows.length > 0) {
                        Debug.log(`[Notion] Processing table with ${rows.length} rows`);
                        // 首先删除占位符行
                        const tableBlocks = await this.getPageBlocks(created.id);
                        Debug.log(`[Notion] Found ${tableBlocks.length} blocks in table, deleting placeholder rows`);
                        for (const block of tableBlocks) {
                            if (block.type === 'table_row') {
                                await this.deleteBlock(block.id);
                            }
                        }
                        // 然后添加实际的行
                        Debug.log(`[Notion] Adding ${rows.length} actual rows to table`);
                        await this.appendBlockChildren(created.id, rows as any);
                        Debug.log(`[Notion] Successfully added ${rows.length} rows to table`);
                    }
                }
            }
        }
    }

    /**
     * 从块列表中提取 table 的行，避免单请求超过 children 最大限制
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

                Debug.log(`[Notion] Found table at index ${idx} with ${b.table.children.length} rows`);

                // 提取表格行到单独的计划中
                plans.set(idx, b.table.children);

                // 创建表格块的副本，总是包含至少一个空行以满足API验证
                // 实际的行数据会在后续步骤中从tablePlans添加
                const clone = {
                    ...b,
                    table: {
                        ...b.table,
                        children: [
                            // 添加一个空行以满足API要求（table.children.length ≥ 1）
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

        Debug.api(`[Notion] ${method}`, url, body);

        const resp = await requestUrl({
            url,
            method,
            headers,
            body: (body && method !== 'GET') ? JSON.stringify(body) : undefined,
            throw: false
        });

        Debug.log(`[Notion] API Response Status: ${resp.status}`);
        Debug.log(`[Notion] API Response Headers:`, resp.headers);

        if (resp.status < 200 || resp.status >= 300) {
            let errorMessage = `[${method} ${path}] Notion API Error: ${resp.status}`;

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

            // 提供用户友好的错误信息
            if (resp.status === 401) {
                errorMessage = 'API Token无效或已过期，请检查Notion集成设置';
            } else if (resp.status === 403) {
                errorMessage = '权限不足，请确保集成有足够的权限访问目标页面';
            } else if (resp.status === 404) {
                errorMessage = '资源未找到，请检查页面ID或数据库ID是否正确';
            } else if (resp.status === 429) {
                errorMessage = 'API调用频率限制，请稍后重试';
            } else if (resp.status === 500) {
                errorMessage = 'Notion服务器内部错误，请稍后重试';
            }

            throw new Error(errorMessage);
        }

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
            const blocks = await this.mdToBlocks(markdown, (context as any).sourceDir);
            Debug.log(`[Notion] Converted ${blocks.length} blocks`);

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
