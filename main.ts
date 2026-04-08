import { Plugin, Notice, TFile, MarkdownView, requestUrl, normalizePath } from 'obsidian';
import * as path from 'path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { FeishuSettings, ShareResult, NotionSettings } from './src/types';
import { DEFAULT_SETTINGS as DEFAULT_FEISHU_SETTINGS, SUCCESS_NOTICE_TEMPLATE, CALLOUT_TYPE_MAPPING } from './src/constants';
import { FeishuApiService } from './src/feishu/feishu-api';
import { NotionApiService } from './src/notion/notion-api';
import { PublishEverywhereSettingTab } from './src/settings';
import { MarkdownProcessor } from './src/markdown-processor';
import { Debug } from './src/debug';
import { CallbackPublishQueue, PublishTask } from './src/publish-queue';
import { ConfluenceClient } from './src/confluence/confluence-client';
import { ConfluencePublisher } from './src/confluence/confluence-publisher';
import { replaceBareKmsLinks, replaceWikiLinksWithKmsUrl } from './src/confluence/kms-link-utils';
import { GitHubPublisher } from './src/github/github-publisher';
import { XiaohongshuPublisher } from './src/xiaohongshu/xiaohongshu-publisher';

interface ConfluencePublisherSettings {
	confluenceUrl: string;
	username: string;
	password: string;
	space: string;
}

type PublishEverywhereSettings = FeishuSettings & ConfluencePublisherSettings & NotionSettings;

const DEFAULT_CONFLUENCE_SETTINGS: ConfluencePublisherSettings = {
	confluenceUrl: '',
	username: '',
	password: '',
	space: ''
};

const DEFAULT_SETTINGS: PublishEverywhereSettings = {
	...DEFAULT_FEISHU_SETTINGS,
	...DEFAULT_CONFLUENCE_SETTINGS
} as PublishEverywhereSettings;

export default class PublishEverywherePlugin extends Plugin {
	settings: PublishEverywhereSettings;
	feishuApi: FeishuApiService;
	notionApi: NotionApiService;
	markdownProcessor: MarkdownProcessor;
	publishQueue: CallbackPublishQueue;

	async onload(): Promise<void> {
		// 加载设置
		await this.loadSettings();

		// 初始化服务
		this.feishuApi = new FeishuApiService(this.settings, this.app);
		this.notionApi = new NotionApiService(this.settings, this.app);
		this.markdownProcessor = new MarkdownProcessor(this.app);

		// 初始化发布队列
		this.publishQueue = new CallbackPublishQueue(async (task: PublishTask) => {
			await this.executePublishTask(task);
		});

		// 注册自定义协议处理器，实现自动授权回调
		this.registerObsidianProtocolHandler('feishu-auth', (params) => {
			this.handleOAuthCallback(params);
		});

		// 添加设置页面
		this.addSettingTab(new PublishEverywhereSettingTab(this.app, this));

		// 注册命令和菜单
		this.registerCommands();
		}

	onunload(): void {
		// 清理资源
	}

	/**
	 * 注册插件命令
	 */
	private registerCommands(): void {
		this.addCommand({
			id: 'publish-to-confluence',
			name: '发布到KMS',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.enqueuePlatformPublish('confluence', markdownView);
					}
					return true;
				}
				return false;
			},
			hotkeys: [
				{
					modifiers: ['Mod', 'Shift'],
					key: 'k'
				}
			]
		});

		this.addCommand({
			id: 'publish-to-feishu',
			name: '发布到飞书',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.enqueuePlatformPublish('feishu', markdownView);
					}
					return true;
				}
				return false;
			},
			hotkeys: [
				{
					modifiers: ['Mod', 'Shift'],
					key: 'f'
				}
			]
		});

		this.addCommand({
			id: 'publish-to-github',
			name: '发布到GitHub',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.enqueuePlatformPublish('github', markdownView);
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'publish-to-xiaohongshu',
			name: '发布到小红书',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.enqueuePlatformPublish('xiaohongshu', markdownView);
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'publish-to-all-platforms',
			name: '🚀 一键发布到所有平台',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.publishToAllPlatforms();
					}
					return true;
				}
				return false;
			},
			hotkeys: [
				{
					modifiers: ['Mod', 'Shift'],
					key: 'p'
				}
			]
		});

		// 添加 Notion 相关命令
		this.addCommand({
			id: 'publish-to-notion',
			name: '发布到Notion',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.enqueuePlatformPublish('notion', markdownView as MarkdownView);
					}
					return true;
				}
				return false;
			},
			hotkeys: [
				{
					modifiers: ['Mod', 'Shift'],
					key: 'n'
				}
			]
		});

		// 保留一个一键发布命令（已移除重复的”含Notion”命令）

		this.addCommand({
			id: 'copy-rich-content',
			name: '复制富文本到剪贴板（含图片）',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.copyRichContent(markdownView);
					}
					return true;
				}
				return false;
			},
			hotkeys: [
				{
					modifiers: ['Mod', 'Shift'],
					key: 'c'
				}
			]
		});
	}

	private enqueuePlatformPublish(type: 'feishu' | 'confluence' | 'notion' | 'github' | 'xiaohongshu', view: MarkdownView): void {
		const filePath = view.file?.path;
		const added = this.publishQueue.add({
			type,
			view,
			filePath
		});
		if (!added) {
			new Notice('⏳ 相同任务已在队列中，等待顺序执行...');
			return;
		}

		const queueStatus = this.publishQueue.getStatus();
		if (this.publishQueue.processing) {
			new Notice(`⏳ ${queueStatus}`, 3000);
		} else {
			new Notice('⏳ 已加入发布队列...', 2000);
		}
	}

	private async copyRichContent(view: MarkdownView): Promise<void> {
		try {
			const file = view.file;
			if (!file) {
				new Notice('❌ 无法获取当前文件');
				return;
			}

			await this.ensureFileSaved(file);
			const rawContent = await this.app.vault.read(file);

			// 处理 Obsidian 语法，提取本地文件列表
			const processResult = this.markdownProcessor.processCompleteWithFiles(
				rawContent,
				3,
				'remove',
				false, // 不处理子文档
				true,  // 启用本地图片
				false, // 不处理附件
				'filename',
				[]
			);

			// 在 markdown→HTML 转换前，先将所有占位符替换为真实 HTML
			// （避免 __OB_CONTENT_xxx__ 双下划线被 markdown 解析为粗体）
			let richContent = processResult.content;

			// 1. 图片占位符 → <img> base64 data URI
			for (const localFile of processResult.localFiles) {
				if (!localFile.isImage) continue;
				try {
					const imageData = await this.readLocalImageForClipboard(localFile.originalPath, file.path);
					if (!imageData) {
						richContent = richContent.replace('!' + localFile.placeholder, '');
						richContent = richContent.replace(localFile.placeholder, '');
						continue;
					}
					const ext = localFile.fileName.toLowerCase().split('.').pop() || 'png';
					const mimeMap: Record<string, string> = {
						jpg: 'image/jpeg', jpeg: 'image/jpeg',
						png: 'image/png', gif: 'image/gif',
						webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp'
					};
					const mime = mimeMap[ext] || 'image/png';
					const base64 = this.arrayBufferToBase64(imageData);
					const widthAttr = localFile.displayWidth ? ` width="${localFile.displayWidth}"` : '';
					const imgTag = `<img src="data:${mime};base64,${base64}" alt="${localFile.altText || '图片'}"${widthAttr}>`;
					// 清理占位符前可能残留的 !（来自 ![[image]] 语法中的 !）
					richContent = richContent.replace('!' + localFile.placeholder, imgTag);
					richContent = richContent.replace(localFile.placeholder, imgTag);
				} catch (e) {
					Debug.warn(`⚠️ 图片处理失败: ${localFile.originalPath}`, e);
					richContent = richContent.replace(localFile.placeholder, '');
				}
			}

			// 2. 非图片占位符（附件等）→ 移除
			for (const localFile of processResult.localFiles) {
				if (localFile.isImage) continue;
				richContent = richContent.replace(localFile.placeholder, localFile.altText || '');
			}

			// 3. Callout 占位符 → HTML blockquote
			const calloutColorMap: Record<string, string> = {
				blue: '#dbeafe', green: '#dcfce7', yellow: '#fef9c3',
				red: '#fee2e2', purple: '#f3e8ff', gray: '#f3f4f6', cyan: '#cffafe'
			};
			for (const callout of (processResult.calloutBlocks || [])) {
				const bgColor = calloutColorMap[callout.type] || calloutColorMap[CALLOUT_TYPE_MAPPING[callout.type]?.color] || '#f3f4f6';
				const emoji = CALLOUT_TYPE_MAPPING[callout.type]?.emoji || '📌';
				const title = callout.title || CALLOUT_TYPE_MAPPING[callout.type]?.title || '';
				const calloutHtml = `<blockquote style="background:${bgColor};border-left:4px solid;padding:12px 16px;margin:8px 0;border-radius:4px"><strong>${emoji} ${title}</strong><br>${callout.content}</blockquote>`;
				richContent = richContent.replace(callout.placeholder, calloutHtml);
			}

			// 4. 高亮占位符 → <mark> 标签
			richContent = richContent.replace(/!!OB_HL_START_(\d+)_[^!]+!!([\s\S]*?)!!OB_HL_END_[^!]+!!/g,
				(_, _color, text) => `<mark>${text}</mark>`
			);

			// 5. 清理残余占位符（含可能的前导 !）
			richContent = richContent.replace(/!?__OB_CONTENT_\d+_[a-z0-9]+__/g, '');

			// Markdown → HTML（allowDangerousHtml 保留已插入的 HTML 标签）
			const processor = unified()
				.use(remarkParse)
				.use(remarkGfm)
				.use(remarkRehype, { allowDangerousHtml: true })
				.use(rehypeRaw)
				.use(rehypeStringify, { allowDangerousHtml: true });
			const html = String(await processor.process(richContent));

			// 写入剪贴板
			const blob = new Blob([html], { type: 'text/html' });
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);

			new Notice('✅ 已复制富文本到剪贴板');
		} catch (error: any) {
			Debug.error('复制富文本失败:', error);
			new Notice(`❌ 复制失败: ${error?.message || '未知错误'}`);
		}
	}

	private async readLocalImageForClipboard(imagePath: string, sourceFilePath: string): Promise<ArrayBuffer | null> {
		// 先尝试直接路径
		const normalized = normalizePath(imagePath);
		if (await this.app.vault.adapter.exists(normalized)) {
			return await this.app.vault.adapter.readBinary(normalized);
		}

		// 通过 metadataCache 解析 Obsidian 链接路径
		const resolved = this.app.metadataCache.getFirstLinkpathDest(normalized, sourceFilePath);
		if (resolved instanceof TFile) {
			return await this.app.vault.readBinary(resolved);
		}

		Debug.warn(`⚠️ 找不到图片: ${imagePath}`);
		return null;
	}

	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return window.btoa(binary);
	}

	async loadSettings(): Promise<void> {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		if (this.feishuApi) {
			this.feishuApi.updateSettings(this.settings);
		}
	}

	/**
	 * 处理OAuth回调
	 */
	private async handleOAuthCallback(params: Record<string, string>): Promise<void> {
		this.log('Processing OAuth callback');

		if (params.code) {
			new Notice('🔄 正在处理授权回调...');

			try {
				const success = await this.feishuApi.processCallback(`obsidian://feishu-auth?${new URLSearchParams(params).toString()}`);

				if (success) {
					this.log('OAuth authorization successful');
					new Notice('🎉 自动授权成功！');
					await this.saveSettings();

					// 通知设置页面刷新和分享流程继续 - 使用自定义事件
					window.dispatchEvent(new CustomEvent('feishu-auth-success', {
						detail: {
							timestamp: Date.now(),
							source: 'oauth-callback'
						}
					}));
				} else {
					this.log('OAuth authorization failed', 'warn');
					new Notice('❌ 授权处理失败，请重试');
				}
			} catch (error) {
				this.handleError(error as Error, 'OAuth回调处理');
			}
		} else if (params.error) {
			const errorMsg = params.error_description || params.error;
			this.log(`OAuth error: ${errorMsg}`, 'error');
			new Notice(`❌ 授权失败: ${errorMsg}`);
		} else {
			this.log('Invalid OAuth callback parameters', 'warn');
			new Notice('❌ 无效的授权回调');
		}
	}

	/**
	 * 发布当前笔记到Notion（使用notion属性指定父页面）
	 * @param view Markdown视图
	 */
    async publishCurrentNoteToNotion(view: MarkdownView): Promise<void> {
        const file = view.file;
        if (!file) {
            this.log('[Publish to Notion] No active file', 'error');
            new Notice('No file is currently open');
            return;
        }

        // 检查配置
        if (!this.settings.notionApiToken) {
            this.log('[Publish to Notion] Missing Notion API Token', 'error');
            new Notice('请先完成 Notion 配置');
            return;
        }

        try {
            const title = file.basename;
            new Notice('⏳ 正在发布到 Notion...');

            // 读取文件内容
            await this.ensureFileSaved(file);
            const rawContent = await this.app.vault.read(file);

            // frontmatter 解析：
            // - notion      始终表示“父页面位置”（不要动父页面内容）
            // - notion_url  表示“已创建的子页面链接”（若存在则直接更新该子页面）
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            let childPageIdToUpdate: string | undefined;
            let parentPageId: string | undefined;
            if (fm?.notion_url) {
                const maybe = this.notionApi.parseNotionPageIdFromUrl(String(fm.notion_url));
                if (maybe) childPageIdToUpdate = maybe;
            }
            if (fm?.notion) {
                const maybe = this.notionApi.parseNotionPageIdFromUrl(String(fm.notion));
                if (maybe) parentPageId = maybe;
            }
            // 保护：若误将父页面链接写入了 notion_url，避免覆盖父页面内容
            if (childPageIdToUpdate && parentPageId && childPageIdToUpdate === parentPageId) {
                this.log('[Publish to Notion] notion_url 等于 notion（父页面），将忽略 notion_url 以避免覆盖父页面内容', 'warn');
                childPageIdToUpdate = undefined;
            }

            // 构造源文件所在目录（用于解析相对路径的本地资源）
            const vaultPath = (this.app.vault.adapter as any).basePath;
            const absoluteFilePath = path.join(vaultPath, file.path);
            const sourceDir = path.dirname(absoluteFilePath);

            // 标题决定更新/创建（普通父页面）；如果父链接是数据库（表格），则按标题查找，存在则更新，不存在则新建
            let result;
            if (parentPageId) {
                const isDb = await this.notionApi.isDatabaseId(parentPageId);
                if (isDb) {
                    // 数据库模式：对比标题（数据库标题列），匹配则更新，否则新建
                    result = await this.notionApi.publishDocument(title, rawContent, {
                        apiToken: this.settings.notionApiToken as any,
                        targetDatabaseId: parentPageId,
                        workspaceId: this.settings.notionWorkspaceId,
                        pageTitleProperty: this.settings.notionPageTitleProperty,
                        pageTagsProperty: this.settings.notionPageTagsProperty,
                        pageStatusProperty: this.settings.notionPageStatusProperty,
                        createNewIfNotExists: true,
                        updateExistingPages: true,
                        defaultPageIcon: this.settings.notionDefaultPageIcon,
                        sourceDir,
                    } as any);
                } else {
                    // 普通父页面：按标题匹配同名子页面；存在则更新，不存在则创建
                    result = await this.notionApi.publishDocument(title, rawContent, {
                        apiToken: this.settings.notionApiToken as any,
                        targetDatabaseId: this.settings.notionTargetDatabaseId,
                        workspaceId: this.settings.notionWorkspaceId,
                        pageTitleProperty: this.settings.notionPageTitleProperty,
                        pageTagsProperty: this.settings.notionPageTagsProperty,
                        pageStatusProperty: this.settings.notionPageStatusProperty,
                        createNewIfNotExists: this.settings.notionCreateNewIfNotExists !== false,
                        updateExistingPages: this.settings.notionUpdateExistingPages !== false,
                        defaultPageIcon: this.settings.notionDefaultPageIcon,
                        parentPageId,
                        sourceDir,
                    });
                }
            } else if (childPageIdToUpdate) {
                // 无父页面信息时，才使用 notion_url 指向的页面进行直接更新
                result = await this.notionApi.publishToExistingPage(childPageIdToUpdate, rawContent, {
                    apiToken: this.settings.notionApiToken as any,
                    targetDatabaseId: this.settings.notionTargetDatabaseId,
                    workspaceId: this.settings.notionWorkspaceId,
                    pageTitleProperty: this.settings.notionPageTitleProperty,
                    pageTagsProperty: this.settings.notionPageTagsProperty,
                    pageStatusProperty: this.settings.notionPageStatusProperty,
                    createNewIfNotExists: this.settings.notionCreateNewIfNotExists !== false,
                    updateExistingPages: this.settings.notionUpdateExistingPages !== false,
                    defaultPageIcon: this.settings.notionDefaultPageIcon,
                    sourceDir,
                    title,
                } as any);
            } else {
                // 既无父页面也无 notion_url，则在工作区或目标数据库创建一个新页面
                result = await this.notionApi.publishDocument(title, rawContent, {
                    apiToken: this.settings.notionApiToken as any,
                    targetDatabaseId: this.settings.notionTargetDatabaseId,
                    workspaceId: this.settings.notionWorkspaceId,
                    pageTitleProperty: this.settings.notionPageTitleProperty,
                    pageTagsProperty: this.settings.notionPageTagsProperty,
                    pageStatusProperty: this.settings.notionPageStatusProperty,
                    createNewIfNotExists: this.settings.notionCreateNewIfNotExists !== false,
                    updateExistingPages: this.settings.notionUpdateExistingPages !== false,
                    defaultPageIcon: this.settings.notionDefaultPageIcon,
                    sourceDir,
                });
            }

		if (result.success) {
			// 检查是否为更新模式
			const isUpdateMode = this.checkNotionUpdateMode(fm || null);
			const operation = isUpdateMode.shouldUpdate ? '更新' : '发布';
			new Notice(`✅ 成功${operation}到 Notion！`);

			// 更新 front matter 中的 notion_url
			await this.updateNotionUrlInFrontMatter(file, result.url!, result.pageId!);

			// 如果是更新模式，更新时间戳
			if (isUpdateMode.shouldUpdate) {
				try {
					this.log('Updating Notion share timestamp in front matter');
					const updatedContent = this.updateNotionShareTimestamp(rawContent);
					if (rawContent !== updatedContent) {
						await this.app.vault.modify(file, updatedContent);
						this.log('Notion share timestamp updated successfully');
					}
				} catch (error) {
					this.log(`Failed to update Notion share timestamp: ${error.message}`, 'warn');
				}
			}

			// 复制链接到剪贴板
			if (this.settings.simpleSuccessNotice) {
				await navigator.clipboard.writeText(result.url!);
				new Notice(`🔗 已复制 Notion 链接到剪贴板`);
			}
		} else {
			this.log(`[Publish to Notion] Failed: ${result.error}`, 'error');
			new Notice(`❌ 发布到 Notion 失败: ${result.error}`);
		}
		} catch (error) {
			this.handleError(error as Error, 'Notion发布');
		}
	}

	/**
	 * 更新 Notion URL 在 front matter
	 */
    private async updateNotionUrlInFrontMatter(file: TFile, notionUrl: string, pageId: string): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            (fm as any).notion_url = notionUrl;
        });
    }

    /**
     * 更新 Notion 分享时间戳
     * 基于文本操作，保留原始YAML结构
     * @param content 原始文件内容
     * @returns 更新后的文件内容
     */
    private updateNotionShareTimestamp(content: string): string {
        // 获取东8区时间
        const now = new Date();
        const chinaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
        const yyyy = chinaTime.getUTCFullYear();
        const mm = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(chinaTime.getUTCDate()).padStart(2, '0');
        const HH = String(chinaTime.getUTCHours()).padStart(2, '0');
        const MM = String(chinaTime.getUTCMinutes()).padStart(2, '0');
        const currentTime = `${yyyy}-${mm}-${dd} ${HH}:${MM}`;

        // 检查是否有Front Matter
        if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
            return content; // 没有Front Matter，直接返回
        }

        const lines = content.split('\n');
        let endIndex = -1;

        // 找到Front Matter的结束位置
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                endIndex = i;
                break;
            }
        }

        if (endIndex === -1) {
            return content; // 没有找到结束标记
        }

        // 查找并更新notion_shared_at字段
        for (let i = 1; i < endIndex; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            if (trimmedLine.startsWith('notion_shared_at:')) {
                lines[i] = `notion_shared_at: "${currentTime}"`;
                break;
            }
        }

        return lines.join('\n');
    }

    /**
     * 检查是否为 Notion 更新模式
     * @param frontMatter Front Matter数据
     * @returns 更新模式检查结果
     */
    private checkNotionUpdateMode(frontMatter: Record<string, unknown> | null): { shouldUpdate: boolean; notionUrl?: string } {
        if (!frontMatter) {
            return { shouldUpdate: false };
        }

        // 检查是否存在notion_url
        const rawUrl = frontMatter.notion_url;
        const notionUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';

        if (notionUrl) {
            this.log(`Found Notion URL marker: ${notionUrl}`);
            return {
                shouldUpdate: true,
                notionUrl: notionUrl
            };
        }

        return { shouldUpdate: false };
    }

	/**
	 * 发布当前笔记到飞书（使用feishu属性指定父页面）
	 * @param view Markdown视图
	 */
	async publishCurrentNoteToFeishu(view: MarkdownView): Promise<void> {
		const file = view.file;
		if (!file) {
			this.log('[Publish to Feishu] No active file', 'error');
			new Notice('No file is currently open');
			return;
		}

		// 检查配置
		if (!this.settings.appId || !this.settings.appSecret || !this.settings.callbackUrl) {
			this.log('[Publish to Feishu] Missing Feishu configuration', 'error');
			new Notice('请先完成飞书配置');
			return;
		}

		// 检查frontmatter中的feishu属性
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter?.feishu) {
			this.log('[Publish to Feishu] No Feishu URL in frontmatter', 'error');
			new Notice('当前笔记缺少 feishu Front Matter 信息');
			return;
		}

		// 解析feishu URL
		const parentUrl = frontmatter.feishu;
		const parsedParent = this.feishuApi.parseFeishuParentUrl(parentUrl);
		if (!parsedParent.parsed) {
			this.log(`[Publish to Feishu] Invalid Feishu URL: ${parsedParent.error}`, 'error');
			new Notice(`feishu URL格式错误: ${parsedParent.error}`);
			return;
		}

		try {
			const title = file.basename;
			new Notice('⏳ 正在发布到飞书...');

			// 读取文件内容
			await this.ensureFileSaved(file);
			const rawContent = await this.app.vault.read(file);

			// 处理Markdown内容
			const processResult = this.markdownProcessor.processCompleteWithFiles(
				rawContent,
				3, // maxDepth
				'remove', // frontMatterHandling
				this.settings.enableSubDocumentUpload,
				this.settings.enableLocalImageUpload,
				this.settings.enableLocalAttachmentUpload,
				this.settings.titleSource,
				this.settings.codeBlockFilterLanguages || []
			);

			// 发布到飞书（带父位置）
			const result = await this.feishuApi.shareMarkdownWithFiles(
				title,
				processResult,
				undefined, // statusNotice
				false, // isTemporary
				{
					type: parsedParent.type,
					nodeToken: parsedParent.nodeToken,
					folderId: parsedParent.folderId,
					spaceId: parsedParent.spaceId,
					host: parsedParent.host
				}
			);

			if (result.success && result.url) {
				// 检查是否为更新模式
				const isUpdateMode = this.checkUpdateMode(processResult.frontMatter);

				// 更新frontmatter
				if (this.settings.enableShareMarkInFrontMatter) {
					try {
						const updatedContent = this.markdownProcessor.addShareMarkToFrontMatter(rawContent, result.url);
						await this.app.vault.modify(file, updatedContent);
						this.log('Feishu frontmatter updated');
					} catch (error) {
						this.log(`Failed to update frontmatter: ${error.message}`, 'warn');
					}
				}

				// 显示成功通知
				this.showSuccessNotification(result);

				const operation = isUpdateMode.shouldUpdate ? '更新' : '发布';
				const notice = new Notice(`✅ 成功${operation}到飞书`, 5000);
				notice.noticeEl.createEl('button', {
					text: '查看页面',
					cls: 'mod-cta'
				}).onclick = () => {
					window.open(result.url, '_blank');
				};
			} else {
				new Notice(`❌ 发布失败: ${result.error}`);
			}
		} catch (error) {
			this.handleError(error as Error, '发布到飞书');
		}
	}

	/**
	 * 分享当前笔记
	 */
	async shareCurrentNote(): Promise<void> {
		this.log('Attempting to share current note');

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			this.log('No active file found', 'warn');
			new Notice('❌ 没有打开的笔记');
			return;
		}

		if (activeFile.extension !== 'md') {
			this.log(`Unsupported file type: ${activeFile.extension}`, 'warn');
			new Notice('❌ 只支持分享 Markdown 文件');
			return;
		}

		this.log(`Sharing file: ${activeFile.path}`);
		await this.shareFile(activeFile);
	}

	private async publishCurrentNoteToConfluence(view: MarkdownView): Promise<void> {
		const context = this.resolveConfluencePublishContext(view);
		if (!context) {
			return;
		}
		try {
			await this.publishConfluenceWithContext(context);
		} catch (error) {
			const message = (error as Error).message || '发布失败';
			new Notice(message);
		}
	}

	private async publishCurrentNoteToGitHub(view: MarkdownView): Promise<void> {
		const file = this.requireActiveMarkdownFile(view);
		if (!file) {
			return;
		}

		const frontmatter = this.getFileFrontmatter(file);
		const githubRepoUrl = this.normalizeGitHubRepoUrl(frontmatter?.github);
		if (!githubRepoUrl) {
			this.log('[Publish to GitHub] Missing github frontmatter', 'error');
			new Notice('当前笔记缺少 github Front Matter 信息');
			return;
		}

		try {
			new Notice('⏳ 正在发布到 GitHub...');
			const vaultPath = (this.app.vault.adapter as any).basePath;
			const publisher = new GitHubPublisher({
				app: this.app,
				vaultBasePath: vaultPath
			});
			await this.ensureFileSaved(file);
			const rawContent = await this.app.vault.read(file);
			const result = await publisher.publishMarkdownFile({
				file,
				repoUrl: githubRepoUrl,
				rawContent
			});

			if (result.updated) {
				new Notice('✅ GitHub README 已更新');
			} else {
				new Notice('✅ GitHub 内容无变化，无需更新');
			}

			this.log(`[Publish to GitHub] Completed: ${result.repoUrl}#${result.branch}`);
		} catch (error) {
			const message = (error as Error).message || '发布失败';
			this.log(`[Publish to GitHub] Failed: ${message}`, 'error');
			new Notice(`❌ 发布到 GitHub 失败: ${message}`);
		}
	}

	private async publishCurrentNoteToXiaohongshu(view: MarkdownView): Promise<void> {
		const file = this.requireActiveMarkdownFile(view);
		if (!file) {
			return;
		}

		try {
			new Notice('⏳ 正在准备小红书素材...');
			await this.ensureFileSaved(file);
			const rawContent = await this.app.vault.read(file);
			const vaultPath = (this.app.vault.adapter as any).basePath;
			const publisher = new XiaohongshuPublisher({
				app: this.app,
				settings: this.settings,
				vaultBasePath: vaultPath
			});

			const reportProgress = (message: string): void => {
				this.log(`[Xiaohongshu] ${message}`);
			};
			const result = await publisher.prepareMaterials(file, rawContent, reportProgress);
			if (result.draft?.styleSeed !== undefined) {
				this.settings.xiaohongshuLastStyleSeed = result.draft.styleSeed;
				await this.saveSettings();
			}
			if (result.success && result.outputDir) {
				await this.updateXiaohongshuFrontMatter(file);
				// 显示带"打开文件夹"按钮的通知
				const fragment = document.createDocumentFragment();
				fragment.createEl('div', { text: '✅ 小红书素材准备完成' });
				const btn = fragment.createEl('button', { text: '📂 打开文件夹', cls: 'mod-cta' });
				btn.style.marginTop = '8px';
				btn.onclick = () => {
					const { shell } = require('electron');
					shell.openPath(result.outputDir as string);
				};
				new Notice(fragment, 10000);
				return;
			}

			const reason = result.error || '未知错误';
			new Notice(`❌ 小红书素材准备失败：${reason}`, 9000);
			this.log(`[Xiaohongshu] failed: ${reason}`, 'warn');
		} catch (error) {
			const message = (error as Error).message || '素材准备失败';
			new Notice(`❌ 小红书素材准备失败：${message}`, 9000);
			this.log(`[Xiaohongshu] Failed: ${message}`, 'error');
		}
	}

	private async updateXiaohongshuFrontMatter(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			(fm as any)['小红书'] = true;
		});
	}

	private resolveConfluencePublishContext(view: MarkdownView): {
		file: TFile;
		parentId: string;
		vaultPath: string;
		fallbackUrl: string;
		kmsOpen: boolean;
		targetPageId: string | null;
	} | null {
		const file = this.requireActiveMarkdownFile(view);
		if (!file || !this.ensureConfluenceSettings()) {
			return null;
		}
		const frontmatter = this.getFileFrontmatter(file);
		const parentInfo = this.resolveConfluenceParentInfo(frontmatter);
		if (!parentInfo) {
			return null;
		}
		return {
			file,
			parentId: parentInfo.parentId,
			vaultPath: (this.app.vault.adapter as any).basePath,
			fallbackUrl: parentInfo.fallbackUrl,
			kmsOpen: parentInfo.kmsOpen,
			targetPageId: this.resolveKmsTargetPageId(frontmatter)
		};
	}

	private async publishConfluenceWithContext(context: {
		file: TFile;
		parentId: string;
		vaultPath: string;
		fallbackUrl: string;
		kmsOpen: boolean;
		targetPageId: string | null;
	}): Promise<void> {
		new Notice('⏳ 页面发布中...');
		const title = context.file.basename;
		const client = this.createConfluenceClient();
		const publishContent = await this.prepareConfluenceContentForFile(context.file, client);
		const publisher = this.createConfluencePublisher(client, context.vaultPath);
		const publishResult = await publisher.publishMarkdownFile({
			file: context.file,
			title,
			parentPageId: context.parentId,
			targetPageId: context.targetPageId ?? undefined,
			rawContent: publishContent
		});
		await this.applyConfluenceReadRestriction(client, publishResult.pageId, context.kmsOpen);
		const actualKmsOpen = await this.resolveActualKmsOpen(client, publishResult.pageId, context.kmsOpen);
		await this.updateKmsFrontmatter(context.file, publishResult.pageUrl, actualKmsOpen);
		this.showConfluencePublishNotice(publishResult.pageUrl, context.fallbackUrl);
	}

	private createConfluenceClient(): ConfluenceClient {
		return new ConfluenceClient({
			baseUrl: this.settings.confluenceUrl,
			spaceKey: this.settings.space,
			username: this.settings.username,
			password: this.settings.password
		});
	}

	private createConfluencePublisher(client: ConfluenceClient, vaultPath: string): ConfluencePublisher {
		return new ConfluencePublisher({
			app: this.app,
			client,
			vaultBasePath: vaultPath
		});
	}

	private async prepareConfluenceContentForFile(file: TFile, client: ConfluenceClient): Promise<string> {
		const rawContent = await this.app.vault.read(file);
		const prepared = await this.prepareConfluencePublishContent(rawContent, client);
		await this.tryUpdateKmsLinksInNote(file, rawContent, prepared.updatedContent);
		return prepared.publishContent;
	}

	private async updateKmsFrontmatter(file: TFile, pageUrl: string, kmsOpen: boolean): Promise<void> {
		try {
			this.log('[Publish to Confluence] Page published successfully');
			const latestContent = await this.app.vault.read(file);
			const updatedContent = this.markdownProcessor.addOrUpdateKmsFrontmatter(latestContent, pageUrl, kmsOpen);
			if (latestContent !== updatedContent) {
				await this.app.vault.modify(file, updatedContent);
				this.log(`[Publish to Confluence] kms_url and kms_open frontmatter updated (kms_open=${kmsOpen})`);
			}
		} catch (error) {
			this.log(`[Publish to Confluence] Failed to update kms frontmatter: ${(error as Error).message}`, 'warn');
		}
	}

	private async resolveActualKmsOpen(client: ConfluenceClient, pageId: string, expectedKmsOpen: boolean): Promise<boolean> {
		try {
			return await client.isPageReadOpen(pageId);
		} catch (error) {
			this.log(`[Publish to Confluence] Failed to resolve online read restriction, fallback to local kms_open: ${(error as Error).message}`, 'warn');
			return expectedKmsOpen;
		}
	}

	private showConfluencePublishNotice(resolvedUrl: string | null, fallbackUrl: string): void {
		const notice = new Notice('✅ 已成功创建页面');
		const targetUrl = resolvedUrl || fallbackUrl;
		notice.noticeEl.createEl('button', {
			text: '查看页面',
			cls: 'mod-cta'
		}).onclick = () => {
			window.open(targetUrl, '_blank');
		};
	}

	private async resolveConfluencePageUrl(title: string, parentId: string): Promise<string | null> {
		if (!this.settings.confluenceUrl || !this.settings.space) {
			return null;
		}

		try {
			const baseUrl = this.settings.confluenceUrl.replace(/\/$/, '');
			const apiUrl = new URL(`${baseUrl}/rest/api/content`);
			apiUrl.searchParams.set('spaceKey', this.settings.space);
			apiUrl.searchParams.set('title', title);
			apiUrl.searchParams.set('expand', 'ancestors');

			const basicToken = Buffer.from(`${this.settings.username}:${this.settings.password}`).toString('base64');
			const response = await requestUrl({
				url: apiUrl.toString(),
				method: 'GET',
				headers: {
					'Authorization': `Basic ${basicToken}`,
					'Accept': 'application/json'
				}
			});

			if (response.status < 200 || response.status >= 300) {
				this.log(`[Publish to Confluence] resolve URL failed with status ${response.status}`, 'warn');
				return null;
			}

			const results = response.json?.results;
			if (!Array.isArray(results) || results.length === 0) {
				return null;
			}

			const normalizedParent = parentId.toString();
			const matchingResult = results.find((item: any) => {
				if (!item) return false;
				if (item.title !== title) return false;
				if (!Array.isArray(item.ancestors)) return false;
				return item.ancestors.some((ancestor: any) => ancestor?.id === normalizedParent);
			}) || results[0];

			if (matchingResult?.id) {
				return `${baseUrl}/pages/viewpage.action?pageId=${matchingResult.id}`;
			}
		} catch (error) {
			this.log(`[Publish to Confluence] resolve URL error: ${(error as Error).message}`, 'warn');
		}

		return null;
	}

	private async prepareConfluencePublishContent(
		rawContent: string,
		client: ConfluenceClient
	): Promise<{ updatedContent: string; publishContent: string }> {
		const split = this.splitFrontmatterContent(rawContent);
		const titleCache = new Map<string, string | null>();
		const result = await replaceBareKmsLinks(split.body, (pageId, url) => {
			return this.resolveKmsTitleWithCache(pageId, url, client, titleCache);
		});
		const publishBody = await replaceWikiLinksWithKmsUrl(result.content, (noteName) => {
			return this.resolveKmsUrlFromWikiLink(noteName);
		});
		const updatedContent = split.hasFrontmatter ? `${split.frontmatter}${result.content}` : result.content;
		const publishContent = split.hasFrontmatter ? `${split.frontmatter}${publishBody}` : publishBody;
		return { updatedContent, publishContent };
	}

	private async resolveKmsTitleWithCache(
		pageId: string,
		url: string,
		client: ConfluenceClient,
		cache: Map<string, string | null>
	): Promise<string | null> {
		if (cache.has(pageId)) {
			return cache.get(pageId) ?? null;
		}
		try {
			const page = await client.getPageInfoById(pageId);
			const title = page?.title?.trim() || null;
			cache.set(pageId, title);
			return title;
		} catch (error) {
			this.log(`[Publish to Confluence] Failed to resolve title: ${url}`, 'warn');
			cache.set(pageId, null);
			return null;
		}
	}

	private async tryUpdateKmsLinksInNote(file: TFile, rawContent: string, updatedContent: string): Promise<void> {
		if (rawContent === updatedContent) {
			return;
		}
		try {
			await this.app.vault.modify(file, updatedContent);
			this.log('[Publish to Confluence] KMS links updated');
		} catch (error) {
			this.log(`[Publish to Confluence] Failed to update KMS links: ${(error as Error).message}`, 'warn');
		}
	}

	private async resolveKmsUrlFromWikiLink(noteName: string): Promise<string | null> {
		const file = this.findMarkdownFileByName(noteName);
		if (!file) {
			return null;
		}
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const cached = this.normalizeKmsUrl(frontmatter?.kms_url);
		if (cached) {
			return cached;
		}
		try {
			const content = await this.app.vault.read(file);
			return this.extractKmsUrlFromFrontmatter(content);
		} catch (error) {
			this.log(`[Publish to Confluence] Failed to read note: ${file.path}`, 'warn');
			return null;
		}
	}

	private normalizeKmsUrl(value: unknown): string | null {
		if (typeof value !== 'string') {
			return null;
		}
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}

	private findMarkdownFileByName(noteName: string): TFile | null {
		const trimmed = noteName.trim();
		if (!trimmed) {
			return null;
		}
		let lookup = trimmed.replace(/^\.\//, '').replace(/^\//, '');
		if (!lookup.toLowerCase().endsWith('.md')) {
			lookup = `${lookup}.md`;
		}
		const direct = this.app.vault.getFileByPath(lookup);
		if (direct) {
			return direct;
		}
		const baseName = lookup.split('/').pop()?.toLowerCase() || '';
		const files = this.app.vault.getMarkdownFiles();
		return files.find(file => file.name.toLowerCase() === baseName)
			|| files.find(file => file.basename.toLowerCase() === trimmed.toLowerCase())
			|| null;
	}

	private extractKmsUrlFromFrontmatter(content: string): string | null {
		const normalized = content.replace(/\r\n/g, '\n');
		if (!normalized.startsWith('---\n')) {
			return null;
		}
		const endIndex = normalized.indexOf('\n---', 4);
		if (endIndex === -1) {
			return null;
		}
		const frontmatter = normalized.slice(4, endIndex).split('\n');
		for (const line of frontmatter) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}
			if (trimmed.startsWith('kms_url:')) {
				const raw = trimmed.substring('kms_url:'.length).trim();
				const cleaned = raw.replace(/^['"]/, '').replace(/['"]$/, '').trim();
				return cleaned || null;
			}
		}
		return null;
	}

	private splitFrontmatterContent(content: string): { frontmatter: string; body: string; hasFrontmatter: boolean } {
		const normalized = content.replace(/\r\n/g, '\n');
		if (!normalized.startsWith('---\n')) {
			return { frontmatter: '', body: content, hasFrontmatter: false };
		}
		const lines = normalized.split('\n');
		let endLine = -1;
		for (let i = 1; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed === '---' || trimmed === '...') {
				endLine = i;
				break;
			}
		}
		if (endLine === -1) {
			return { frontmatter: '', body: content, hasFrontmatter: false };
		}
		const sliceIndex = this.computeFrontmatterSliceIndex(lines, endLine, normalized.length);
		let frontmatter = normalized.slice(0, sliceIndex);
		let body = normalized.slice(sliceIndex);
		if (content.includes('\r\n')) {
			frontmatter = frontmatter.replace(/\n/g, '\r\n');
			body = body.replace(/\n/g, '\r\n');
		}
		return { frontmatter, body, hasFrontmatter: true };
	}

	private computeFrontmatterSliceIndex(lines: string[], endLine: number, totalLength: number): number {
		let index = 0;
		for (let i = 0; i <= endLine; i++) {
			index += lines[i].length;
			if (i < lines.length - 1) {
				index += 1;
			}
		}
		if (index < totalLength) {
			index += 1;
		}
		return index;
	}

	private requireActiveMarkdownFile(view: MarkdownView): TFile | null {
		const file = view.file;
		if (!file) {
			this.log('[Publish to Confluence] No active file', 'error');
			new Notice('No file is currently open');
			return null;
		}
		return file;
	}

	private ensureConfluenceSettings(): boolean {
		if (this.settings.confluenceUrl && this.settings.username && this.settings.password && this.settings.space) {
			return true;
		}
		this.log('[Publish to Confluence] Missing configuration', 'error');
		new Notice('请先完成 KMS 配置');
		return false;
	}

	private getFileFrontmatter(file: TFile): Record<string, any> | null {
		return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	}

	private resolveConfluenceParentInfo(frontmatter: Record<string, any> | null): {
		parentId: string;
		fallbackUrl: string;
		kmsOpen: boolean;
	} | null {
		const kmsLink = frontmatter?.kms;
		if (!kmsLink || typeof kmsLink !== 'string') {
			this.log('[Publish to Confluence] No KMS URL in frontmatter', 'error');
			new Notice('当前笔记缺少 KMS Front Matter 信息');
			return null;
		}
		const pageIdMatch = kmsLink.match(/pageId=(\d+)/);
		if (!pageIdMatch) {
			this.log('[Publish to Confluence] Could not extract pageId', 'error');
			new Notice('无法从 KMS 链接中提取 pageId');
			return null;
		}
		return {
			parentId: pageIdMatch[1],
			fallbackUrl: kmsLink,
			kmsOpen: this.resolveKmsOpen(frontmatter)
		};
	}

	private resolveKmsOpen(frontmatter: Record<string, any> | null): boolean {
		const raw = frontmatter?.kms_open;
		if (raw === undefined || raw === null) {
			return true;
		}
		if (typeof raw === 'boolean') {
			return raw;
		}
		if (typeof raw === 'number') {
			return raw !== 0;
		}
		if (typeof raw === 'string') {
			const normalized = raw.trim().toLowerCase();
			if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
				return false;
			}
			return true;
		}
		return true;
	}

	private resolveKmsTargetPageId(frontmatter: Record<string, any> | null): string | null {
		const kmsUrl = this.normalizeKmsUrl(frontmatter?.kms_url);
		if (!kmsUrl) {
			return null;
		}
		const match = kmsUrl.match(/[?&]pageId=(\d+)/);
		if (!match) {
			this.log(`[Publish to Confluence] Invalid kms_url, fallback to title matching: ${kmsUrl}`, 'warn');
			return null;
		}
		return match[1];
	}

	private normalizeGitHubRepoUrl(value: unknown): string | null {
		if (typeof value !== 'string') {
			return null;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}
		return trimmed;
	}

	private async applyConfluenceReadRestriction(
		client: ConfluenceClient,
		pageId: string,
		kmsOpen: boolean
	): Promise<void> {
		if (kmsOpen) {
			return;
		}
		try {
			await client.setReadRestrictionToUser(pageId, this.settings.username);
			this.log('[Publish to Confluence] Read restriction applied');
		} catch (error) {
			this.log(`[Publish to Confluence] Failed to apply restriction: ${(error as Error).message}`, 'warn');
		}
	}

	/**
	 * 分享指定文件（添加到队列）
	 */
	async shareFile(file: TFile): Promise<void> {
		this.log(`Adding file share to queue: ${file.path}`);

		// 添加到队列
		const added = this.publishQueue.add({
			type: 'feishu',
			file: file,
			filePath: file.path
		});
		if (!added) {
			if (!this.settings.suppressShareNotices) {
				new Notice('⏳ 当前笔记的飞书发布任务已在队列中...');
			}
			return;
		}

		// 显示排队状态
		if (!this.settings.suppressShareNotices) {
			const queueStatus = this.publishQueue.getStatus();
			if (this.publishQueue.processing) {
				new Notice(queueStatus, 3000);
			} else {
				new Notice('⏳ 已加入发布队列...', 2000);
			}
		}
	}

	/**
	 * 内部方法：实际执行文件分享（由队列调用）
	 */
	private async shareFileInternal(file: TFile): Promise<void> {
		this.log(`Starting file share process for: ${file.path}`);

		// 创建持续状态提示（可抑制）
		const statusNotice = this.settings.suppressShareNotices ? undefined : new Notice('🔄 正在分享到飞书...', 0); // 0表示不自动消失

		try {
			// 检查基本授权状态
			if (!this.settings.accessToken || !this.settings.userInfo) {
				this.log('Authorization required', 'warn');
				statusNotice?.hide();
				new Notice('❌ 请先在设置中完成飞书授权');
				return;
			}

			// 确保文件已保存到磁盘
			this.log('Ensuring file is saved to disk');
			await this.ensureFileSaved(file);

			// 读取文件内容
			this.log('Reading file content');
			const rawContent = await this.app.vault.read(file);

			// 使用Markdown处理器处理内容（包含文件信息和Front Matter处理）
			const processResult = this.markdownProcessor.processCompleteWithFiles(
				rawContent,
				3, // maxDepth
				this.settings.frontMatterHandling,
				this.settings.enableSubDocumentUpload,
				this.settings.enableLocalImageUpload,
				this.settings.enableLocalAttachmentUpload,
				this.settings.titleSource,
				this.settings.codeBlockFilterLanguages || []
			);

			// 根据设置提取文档标题
			const title = this.markdownProcessor.extractTitle(
				file.basename,
				processResult.frontMatter,
				this.settings.titleSource
			);
			this.log(`Processing file with title: ${title}`);

			// 检查是否为更新模式（存在 feishu_url 标记）
			const isUpdateMode = this.checkUpdateMode(processResult.frontMatter);
			let result: ShareResult;
			let urlChanged = false;

			if (isUpdateMode.shouldUpdate) {
				this.log(`Update mode detected for existing document: ${isUpdateMode.feishuUrl}`);
				statusNotice?.setMessage('🔍 检查现有文档可访问性...');

				// 检查现有URL是否可访问
				const urlAccessible = await this.feishuApi.checkDocumentUrlAccessibility(isUpdateMode.feishuUrl!);

				if (urlAccessible.isAccessible) {
					this.log('Existing document is accessible, updating content');
					statusNotice?.setMessage('🔄 正在更新现有文档...');

					// 调用更新现有文档的方法
					result = await this.feishuApi.updateExistingDocument(
						isUpdateMode.feishuUrl!,
						title,
						processResult,
						statusNotice
					);
				} else if (urlAccessible.needsReauth) {
					this.log(`Token needs reauth, will retry after authorization: ${urlAccessible.error}`);
					statusNotice?.setMessage('🔑 需要重新授权，授权后将重试更新...');

					// 直接触发重新授权，不创建完整文档
					const authSuccess = await this.feishuApi.ensureValidTokenWithReauth(statusNotice);

					if (authSuccess) {
						this.log('Authorization completed, retrying original document access');
						statusNotice?.setMessage('🔄 重新检查原文档可访问性...');

						// 授权成功后，重新检查原文档可访问性
						const retryAccessible = await this.feishuApi.checkDocumentUrlAccessibility(isUpdateMode.feishuUrl!);

						if (retryAccessible.isAccessible) {
							this.log('Original document is now accessible after reauth, updating it');
							statusNotice?.setMessage('🔄 正在更新原文档...');

							// 直接更新原文档
							result = await this.feishuApi.updateExistingDocument(
								isUpdateMode.feishuUrl!,
								title,
								processResult,
								statusNotice
							);
						} else {
							this.log(`Original document still not accessible after reauth: ${retryAccessible.error}, creating new document`);
							// 原文档仍不可访问，创建新文档
							result = await this.feishuApi.shareMarkdownWithFiles(title, processResult, statusNotice);
							urlChanged = true;

							if (result.success) {
								this.log(`Document URL changed from ${isUpdateMode.feishuUrl} to ${result.url}`);
							}
						}
					} else {
						throw new Error('重新授权失败，请手动重新授权');
					}
				} else {
					this.log(`Existing document is not accessible: ${urlAccessible.error}, creating new document`);
					statusNotice?.setMessage('📄 原文档不可访问，正在创建新文档...');

					// 原文档不可访问，创建新文档
					result = await this.feishuApi.shareMarkdownWithFiles(title, processResult, statusNotice);
					urlChanged = true;

					if (result.success) {
						this.log(`Document URL changed from ${isUpdateMode.feishuUrl} to ${result.url}`);
					}
				}
			} else {
				this.log('Normal share mode detected, creating new document');

				// 调用API分享（内部会自动检查和刷新token，如果需要重新授权会等待完成）
				result = await this.feishuApi.shareMarkdownWithFiles(title, processResult, statusNotice);
			}

			// 隐藏状态提示
			statusNotice?.hide();

			if (result.success) {
				if (isUpdateMode.shouldUpdate && !urlChanged) {
					this.log(`Document updated successfully: ${result.title}`);

					// 更新模式：只更新feishu_shared_at时间戳
					if (this.settings.enableShareMarkInFrontMatter) {
						try {
							this.log('Updating share timestamp in front matter');
							const updatedContent = this.updateShareTimestamp(rawContent);
							await this.app.vault.modify(file, updatedContent);
							this.log('Share timestamp updated successfully');
						} catch (error) {
							this.log(`Failed to update share timestamp: ${error.message}`, 'warn');
						}
					}
				} else {
					// 新分享模式或URL发生变化的情况
					if (urlChanged) {
						this.log(`Document URL changed, updating front matter: ${result.title}`);
					} else {
						this.log(`File shared successfully: ${result.title}`);
					}

					// 添加完整的分享标记（新分享或URL变化）
					if (this.settings.enableShareMarkInFrontMatter && result.url) {
						try {
							this.log('Adding/updating share mark in front matter');
							const updatedContent = this.markdownProcessor.addShareMarkToFrontMatter(rawContent, result.url);
							await this.app.vault.modify(file, updatedContent);
							this.log('Share mark added/updated successfully');

							// 如果URL发生了变化，显示特殊通知
							if (!this.settings.suppressShareNotices) {
								if (urlChanged && isUpdateMode.shouldUpdate) {
									new Notice(`📄 文档链接已更新（原链接不可访问）\n新链接：${result.url}`, 8000);
								}
							}
						} catch (error) {
							this.log(`Failed to add/update share mark: ${error.message}`, 'warn');
							// 不影响主要的分享成功流程，只记录警告
						}
					}
				}

				this.showSuccessNotification(result);
			} else {
				const operation = isUpdateMode.shouldUpdate ? '更新' : '分享';
				this.log(`${operation} failed: ${result.error}`, 'error');
				new Notice(`❌ ${operation}失败：${result.error}`);
			}

		} catch (error) {
			// 确保隐藏状态提示
			statusNotice?.hide();
			this.handleError(error as Error, '文件分享');
		}
	}



	/**
	 * 确保文件已保存到磁盘
	 * @param file 要检查的文件
	 */
	private async ensureFileSaved(file: TFile): Promise<void> {
		try {
			// 检查文件是否有未保存的修改
			const currentMtime = file.stat.mtime;

			Debug.verbose(`File mtime: ${currentMtime}`);

			// 如果文件最近被修改，等待一小段时间确保保存完成
			const now = Date.now();
			const timeSinceModification = now - currentMtime;

			if (timeSinceModification < 1000) { // 如果1秒内有修改
				Debug.verbose(`File was recently modified (${timeSinceModification}ms ago), waiting for save...`);

				// 等待文件保存
				await new Promise(resolve => setTimeout(resolve, 500));

				// 强制刷新文件缓存
				await this.app.vault.adapter.stat(file.path);

				Debug.verbose(`File save wait completed`);
			}

			// 额外的安全检查：如果当前文件正在编辑，尝试触发保存
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && activeFile.path === file.path) {
				Debug.verbose(`File is currently active, ensuring it's saved`);

				// 使用workspace的方式触发保存
				const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeLeaf && activeLeaf.file?.path === file.path) {
					// 触发编辑器保存
					await activeLeaf.save();
				}

				// 再等待一小段时间
				await new Promise(resolve => setTimeout(resolve, 200));
			}

		} catch (error) {
			Debug.warn('Error ensuring file is saved:', error);
			// 不抛出错误，继续执行
		}
	}

	/**
	 * 检查是否为更新模式
	 * @param frontMatter Front Matter数据
	 * @returns 更新模式检查结果
	 */
	private checkUpdateMode(frontMatter: Record<string, unknown> | null): {shouldUpdate: boolean, feishuUrl?: string} {
		if (!frontMatter) {
			return { shouldUpdate: false };
		}

		// 检查是否存在feishu_url（兼容旧版feishushare标记）
		const rawUrl = frontMatter.feishu_url;
		const feishuUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';

		if (feishuUrl) {
			this.log(`Found Feishu URL marker: ${feishuUrl}`);
			return {
				shouldUpdate: true,
				feishuUrl: feishuUrl
			};
		}

		return { shouldUpdate: false };
	}

	/**
	 * 更新分享时间戳
	 * 基于文本操作，保留原始YAML结构
	 * @param content 原始文件内容
	 * @returns 更新后的文件内容
	 */
	private updateShareTimestamp(content: string): string {
		// 获取东8区时间
		const now = new Date();
		const chinaTime = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
		const yyyy = chinaTime.getUTCFullYear();
		const mm = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(chinaTime.getUTCDate()).padStart(2, '0');
		const HH = String(chinaTime.getUTCHours()).padStart(2, '0');
		const MM = String(chinaTime.getUTCMinutes()).padStart(2, '0');
		const currentTime = `${yyyy}-${mm}-${dd} ${HH}:${MM}`;

		// 检查是否有Front Matter
		if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
			return content; // 没有Front Matter，直接返回
		}

		const lines = content.split('\n');
		let endIndex = -1;

		// 找到Front Matter的结束位置
		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === '---') {
				endIndex = i;
				break;
			}
		}

		if (endIndex === -1) {
			return content; // 没有找到结束标记
		}

		// 查找并更新feishu_shared_at字段
		for (let i = 1; i < endIndex; i++) {
			const line = lines[i];
			const trimmedLine = line.trim();

			if (trimmedLine.startsWith('feishu_shared_at:')) {
				lines[i] = `feishu_shared_at: "${currentTime}"`;
				break;
			}
		}

		return lines.join('\n');
	}

	/**
	 * 检查并刷新token
	 */
	async ensureValidAuth(): Promise<boolean> {
		if (!this.settings.accessToken) {
			return false;
		}

		// 这里可以添加token有效性检查和自动刷新逻辑
		// 暂时简单返回true
		return true;
	}

	/**
	 * 一键发布到所有平台（添加到队列）
	 */
	async publishToAllPlatforms(): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('❌ 没有打开的笔记');
			return;
		}

		this.log('Adding publish to all platforms to queue');

		// 添加到队列
		const added = this.publishQueue.add({
			type: 'all',
			view: activeView,
			filePath: activeView.file?.path
		});
		if (!added) {
			new Notice('⏳ 当前笔记的一键发布任务已在队列中...');
			return;
		}

		// 显示排队状态
		const queueStatus = this.publishQueue.getStatus();
		if (this.publishQueue.processing) {
			new Notice(`⏳ ${queueStatus}`, 3000);
		} else {
			new Notice('⏳ 已加入发布队列...', 2000);
		}
	}

	/**
	 * 内部方法：实际执行一键发布所有平台（串行执行）
	 */
	private async publishToAllPlatformsInternal(view: MarkdownView): Promise<void> {
		this.log('Starting publish to all platforms');

		const activeFile = view.file;
		if (!activeFile) {
			this.log('No active file found', 'warn');
			return;
		}

		// 获取frontmatter
		const frontmatter = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
		if (!frontmatter) {
			new Notice('❌ 当前笔记没有Front Matter信息，无法发布到任何平台');
			return;
		}

		// 检查要发布的平台
		const platforms: string[] = [];
		if (frontmatter.kms) platforms.push('KMS');
		if (frontmatter.feishu) platforms.push('飞书');
		if (frontmatter.notion || frontmatter.notion_url) platforms.push('Notion');
		if (frontmatter.github) platforms.push('GitHub');
		platforms.push('小红书');

		if (platforms.length === 0) {
			new Notice('❌ 当前笔记没有配置任何发布平台（kms / feishu / notion / github / xiaohongshu）');
			return;
		}

		// 开始发布（串行执行，避免并发问题）
		new Notice(`⏳ 开始发布到 ${platforms.join(' 和 ')}...`, 0);
		this.log(`Publishing to platforms: ${platforms.join(', ')}`);

		const results: { platform: string; success: boolean; error?: string }[] = [];

		// 发布到KMS（如果配置了）
		if (frontmatter.kms) {
			try {
				this.log('Publishing to KMS...');
                await this.publishCurrentNoteToConfluence(view);
				results.push({ platform: 'KMS', success: true });
				new Notice('✅ KMS 发布成功', 2000);
			} catch (error) {
				results.push({
					platform: 'KMS',
					success: false,
					error: error.message
				});
				this.log(`KMS 发布失败: ${error.message}`, 'error');
				new Notice(`❌ KMS 发布失败: ${error.message}`, 4000);
			}

			// 平台间延迟，避免触发频率限制
			if (platforms.length > 1) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}

		// 发布到飞书（如果配置了）
		if (frontmatter.feishu) {
			try {
				this.log('Publishing to Feishu...');
                await this.publishCurrentNoteToFeishu(view);
				results.push({ platform: '飞书', success: true });
				new Notice('✅ 飞书发布成功', 2000);
			} catch (error) {
				results.push({
					platform: '飞书',
					success: false,
					error: error.message
				});
				this.log(`飞书 发布失败: ${error.message}`, 'error');
				new Notice(`❌ 飞书 发布失败: ${error.message}`, 4000);
			}
		}

		// 发布到 Notion（如果配置了）
		if (frontmatter.notion || frontmatter.notion_url) {
			try {
				this.log('Publishing to Notion...');
				await this.publishCurrentNoteToNotion(view);
				results.push({ platform: 'Notion', success: true });
				new Notice('✅ Notion 发布成功', 2000);
			} catch (error) {
				results.push({ platform: 'Notion', success: false, error: (error as Error).message });
				this.log(`Notion 发布失败: ${(error as Error).message}`, 'error');
				new Notice(`❌ Notion 发布失败: ${(error as Error).message}`, 4000);
			}

			if (platforms.length > 1) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}

		if (frontmatter.github) {
			try {
				this.log('Publishing to GitHub...');
				await this.publishCurrentNoteToGitHub(view);
				results.push({ platform: 'GitHub', success: true });
				new Notice('✅ GitHub 发布成功', 2000);
			} catch (error) {
				results.push({ platform: 'GitHub', success: false, error: (error as Error).message });
				this.log(`GitHub 发布失败: ${(error as Error).message}`, 'error');
				new Notice(`❌ GitHub 发布失败: ${(error as Error).message}`, 4000);
			}

			if (platforms.length > 1) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}

		try {
			this.log('Publishing to Xiaohongshu...');
			await this.publishCurrentNoteToXiaohongshu(view);
			results.push({ platform: '小红书', success: true });
			new Notice('✅ 小红书发布流程已执行', 2000);
		} catch (error) {
			results.push({ platform: '小红书', success: false, error: (error as Error).message });
			this.log(`小红书 发布失败: ${(error as Error).message}`, 'error');
			new Notice(`❌ 小红书 发布失败: ${(error as Error).message}`, 4000);
		}

		if (platforms.length > 1) {
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		// 显示结果总结
		const successCount = results.filter(r => r.success).length;
		const failCount = results.filter(r => !r.success).length;

		if (failCount === 0) {
			new Notice(`✅ 成功发布到 ${successCount} 个平台`, 5000);
		} else {
			const failedPlatforms = results.filter(r => !r.success).map(r => r.platform).join(', ');
			this.log(`Publish results - Success: ${successCount}, Failed: ${failCount}`, failCount > 0 ? 'warn' : 'info');
			new Notice(`⚠️ 发布完成：${successCount} 个成功，${failCount} 个失败\n失败平台：${failedPlatforms}`, 8000);
		}
	}

	/**
	 * 显示分享成功的通知
	 */
	private showSuccessNotification(result: ShareResult): void {
		if (this.settings.simpleSuccessNotice || !result.url) {
			const titleText = result?.title || '文档';
			const message = SUCCESS_NOTICE_TEMPLATE.replace('{title}', titleText);
			new Notice(message, 5000);
			return;
		}

		// 富通知：带复制与打开按钮
		const message = `✅ 分享成功！文档：${result.title}`;
		const notice = new Notice(message, 8000);

		const buttonContainer = notice.noticeEl.createEl('div', { cls: 'setting-item-control' });

		// 复制按钮
		const copyButton = buttonContainer.createEl('button', {
			text: '📋 复制链接',
			cls: 'mod-cta'
		});
		copyButton.addClass('mod-cta');
		copyButton.onclick = async () => {
			try {
				const urlToCopy = result.url as string;
				await navigator.clipboard.writeText(urlToCopy);
				this.log('URL copied to clipboard');
				copyButton.textContent = '✅ 已复制';
				setTimeout(() => {
					copyButton.textContent = '📋 复制链接';
				}, 2000);
			} catch (error) {
				this.log(`Failed to copy URL: ${(error as Error).message}`, 'error');
				new Notice('❌ 复制失败');
			}
		};

		// 打开按钮
		const openButton = buttonContainer.createEl('button', {
			text: '🔗 打开',
			cls: 'mod-muted'
		});
		openButton.addClass('mod-muted');
		openButton.onclick = () => {
			if (result.url) {
				window.open(result.url, '_blank');
			}
		};
	}

	/**
	 * 统一的错误处理方法
	 */
	private handleError(error: Error, context: string, userMessage?: string): void {
		Debug.error(`${context}:`, error);

		const message = userMessage || `❌ ${context}失败: ${error.message}`;
		new Notice(message);
	}

	/**
	 * 统一的日志记录方法
	 */
	private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
		switch (level) {
			case 'error':
				Debug.error(message);
				break;
			case 'warn':
				Debug.warn(message);
				break;
			default:
				Debug.log(message);
		}
	}

	/**
	 * 执行发布任务（由队列调用）
	 */
	private async executePublishTask(task: PublishTask): Promise<void> {
		try {
			const effectiveView = this.resolveTaskView(task);
			switch (task.type) {
				case 'feishu':
					if (effectiveView) {
						await this.publishCurrentNoteToFeishu(effectiveView);
					} else if (task.file) {
						await this.shareFileInternal(task.file);
					}
					break;
				case 'confluence':
					if (effectiveView) {
						await this.publishCurrentNoteToConfluence(effectiveView);
					}
					break;
				case 'notion':
					if (effectiveView) {
						await this.publishCurrentNoteToNotion(effectiveView);
					}
					break;
				case 'github':
					if (effectiveView) {
						await this.publishCurrentNoteToGitHub(effectiveView);
					}
					break;
				case 'xiaohongshu':
					if (effectiveView) {
						await this.publishCurrentNoteToXiaohongshu(effectiveView);
					}
					break;
				case 'all':
					if (effectiveView) {
						await this.publishToAllPlatformsInternal(effectiveView);
					}
					break;
			}
		} catch (error) {
			this.log(`发布任务执行失败: ${error.message}`, 'error');
		}
	}

	private resolveTaskView(task: PublishTask): MarkdownView | null {
		if (task.filePath) {
			const viewByPath = this.app.workspace.getLeavesOfType('markdown')
				.map(leaf => leaf.view)
				.find(view => view instanceof MarkdownView && view.file?.path === task.filePath);
			if (viewByPath && viewByPath instanceof MarkdownView) {
				return viewByPath;
			}
		}

		if (task.view?.file && (!task.filePath || task.view.file.path === task.filePath)) {
			return task.view;
		}

		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active && (!task.filePath || active.file?.path === task.filePath)) {
			return active;
		}

		return null;
	}
}
