import { App, TFile, normalizePath } from 'obsidian';
import { LocalFileInfo, MarkdownProcessResult, ProcessContext, FrontMatterData, CalloutInfo, NotionProcessContext } from './types';
import { Debug } from './debug';
import { CALLOUT_TYPE_MAPPING } from './constants';

/**
 * Markdown 内容处理器
 * 负责处理 Obsidian 中的 Markdown 内容，使其适合在飞书中显示
 */
export class MarkdownProcessor {
	private localFiles: LocalFileInfo[] = [];
	private calloutBlocks: CalloutInfo[] = [];
	private highlightIdCounter = 0;
	private readonly HIGHLIGHT_START_PREFIX = '!!OB_HL_START_';
	private readonly HIGHLIGHT_END_PREFIX = '!!OB_HL_END_';
	private readonly DEFAULT_HIGHLIGHT_COLOR = 3; // 飞书默认浅黄色
	private app: App;

	constructor(app: App) {
		this.app = app;
	}
	/**
	 * 处理 Markdown 内容
	 * @param content 原始 Markdown 内容
	 * @returns 处理后的 Markdown 内容
	 */
	process(content: string): string {
		let processedContent = content;

		// 处理各种 Obsidian 特有语法
		processedContent = this.processWikiLinks(processedContent);
		processedContent = this.processBlockReferences(processedContent);
		processedContent = this.processTags(processedContent);
		processedContent = this.processEmbeds(processedContent);
		processedContent = this.processImages(processedContent);
		processedContent = this.cleanupWhitespace(processedContent);

		return processedContent;
	}

	/**
	 * 处理 Wiki 链接 [[link]]
	 */
	private processWikiLinks(content: string, context?: ProcessContext): string {
		// 匹配 [[link]] 或 [[link|display]]
		return content.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (match, link, _, display) => {
			// 检查是否为文件引用（有文件扩展名）
			if (this.isFileReference(link)) {
				// 根据设置决定是否处理文件
				const isImage = this.isImageFile(link);
				const shouldProcess = isImage
					? (context?.enableLocalImageUpload !== false)
					: (context?.enableLocalAttachmentUpload !== false);

				if (shouldProcess) {
					const placeholder = this.generatePlaceholder();
					const fileInfo: LocalFileInfo = {
						originalPath: link,
						fileName: this.extractFileName(link),
						placeholder: placeholder,
						isImage: isImage,
						altText: display || link
					};
					this.localFiles.push(fileInfo);
					return placeholder;
				} else {
					// 如果设置禁用了文件上传，保持原始链接
					return match; // 保持原有的 [[link|display]] 格式
				}
			} else {
				// 检查是否为双链引用的markdown文件
				const linkedFile = this.findLinkedMarkdownFile(link);
				if (linkedFile && context && context.enableSubDocumentUpload !== false) {
					// 检查是否已经处理过此文件（防止循环引用）
					const normalizedPath = normalizePath(linkedFile.path);
					if (context.processedFiles.has(normalizedPath)) {
						Debug.warn(`⚠️ Circular reference detected for file: ${normalizedPath}`);
						const displayText = display || link;
						return `📝 ${displayText} (循环引用)`;
					}

					// 检查递归深度
					if (context.currentDepth >= context.maxDepth) {
						Debug.warn(`⚠️ Max depth reached for file: ${normalizedPath}`);
						const displayText = display || link;
						return `📝 ${displayText} (深度限制)`;
					}

					// 创建子文档占位符
					const placeholder = this.generatePlaceholder();
					const fileInfo: LocalFileInfo = {
						originalPath: linkedFile.path,
						fileName: linkedFile.basename,
						placeholder: placeholder,
						isImage: false,
						isSubDocument: true,
						altText: display || link
					};
					this.localFiles.push(fileInfo);
					return placeholder;
				} else {
					// 普通的Wiki链接，保持原有逻辑
					const displayText = display || link;
					return `📝 ${displayText}`;
				}
			}
		});
	}

	/**
	 * 处理块引用 [[file#^block]]
	 */
	private processBlockReferences(content: string): string {
		// 匹配块引用
		return content.replace(/\[\[([^#\]]+)#\^([^\]]+)\]\]/g, (match, file, block) => {
			return `📝 ${file} (块引用: ${block})`;
		});
	}

	/**
	 * 处理标签 #tag
	 */
	private processTags(content: string): string {
		// 保持标签原样，但确保格式正确
		return content.replace(/#([a-zA-Z0-9_\u4e00-\u9fff]+)/g, (match, tag) => {
			return `#${tag}`;
		});
	}

	/**
	 * 处理嵌入内容 ![[file]]
	 */
	private processEmbeds(content: string, context?: ProcessContext): string {
		// 匹配嵌入语法，生成占位符
		return content.replace(/!\[\[([^\]]+)\]\]/g, (match, rawTarget) => {
			const { path: file, width } = this.parseEmbedTarget(rawTarget);
			// 根据设置决定是否处理文件
			const isImage = this.isImageFile(file);
			const shouldProcess = isImage
				? (context?.enableLocalImageUpload !== false)
				: (context?.enableLocalAttachmentUpload !== false);

			if (shouldProcess) {
				const placeholder = this.generatePlaceholder();
				const fileInfo: LocalFileInfo = {
					originalPath: file,
					fileName: this.extractFileName(file),
					placeholder: placeholder,
					isImage: isImage,
					altText: file,
					displayWidth: isImage ? width : undefined
				};
				this.localFiles.push(fileInfo);
				return placeholder;
			} else {
				// 如果设置禁用了文件上传，保持原有格式
				return match; // 保持原有的 ![[file]] 格式
			}
		});
	}

	/**
	 * 处理图片链接
	 */
	private processImages(content: string, context?: ProcessContext): string {
		// 处理本地图片路径，生成占位符
		return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawSrc) => {
			const { path: src, width } = this.parseImageSource(rawSrc);
			// 如果是网络图片，保持原样
			if (src.startsWith('http://') || src.startsWith('https://')) {
				return match;
			}

			// 根据设置决定是否处理本地图片
			if (context?.enableLocalImageUpload !== false) {
				// 如果是本地图片，生成占位符
				const placeholder = this.generatePlaceholder();
				const altText = alt || '图片';
				const fileInfo: LocalFileInfo = {
					originalPath: src,
					fileName: this.extractFileName(src),
					placeholder: placeholder,
					isImage: true,
					altText: altText,
					displayWidth: width
				};
				this.localFiles.push(fileInfo);
				return placeholder;
			} else {
				// 如果设置禁用了图片上传，保持原有格式
				return match; // 保持原有的 ![alt](src) 格式
			}
		});
	}

	private parseEmbedTarget(target: string): { path: string; width?: number } {
		let path = target.trim();
		let width: number | undefined;
		const pipeIndex = path.lastIndexOf('|');
		if (pipeIndex !== -1) {
			const potential = path.substring(pipeIndex + 1).trim();
			const parsedWidth = this.parseDisplayWidth(potential);
			if (parsedWidth) {
				width = parsedWidth;
				path = path.substring(0, pipeIndex).trim();
			}
		}

		return { path, width };
	}

	private parseImageSource(rawSrc: string): { path: string; width?: number } {
		let path = rawSrc.trim();
		let width: number | undefined;
		const pipeIndex = path.lastIndexOf('|');
		if (pipeIndex !== -1) {
			const potential = path.substring(pipeIndex + 1).trim();
			const parsedWidth = this.parseDisplayWidth(potential);
			if (parsedWidth) {
				width = parsedWidth;
				path = path.substring(0, pipeIndex).trim();
			}
		}
		return { path, width };
	}

	private parseDisplayWidth(value?: string): number | undefined {
		if (!value) return undefined;
		const simple = value.match(/^(\d+)(?:px)?$/i);
		if (simple) {
			const width = parseInt(simple[1], 10);
			return width > 0 ? width : undefined;
		}
		const ratio = value.match(/^(\d+)\s*x\s*(\d+)(?:px)?$/i);
		if (ratio) {
			const width = parseInt(ratio[1], 10);
			return width > 0 ? width : undefined;
		}
		return undefined;
	}

	/**
	 * 处理普通链接，确保特殊协议链接保持可点击状态
	 */
	private processLinks(content: string): string {
		// 处理普通的 [text](url) 格式链接
		return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
			// 检查是否为 Obsidian 协议链接
			if (url.startsWith('obsidian://')) {
				// 简单地去掉中括号，保留文本和URL
				// 格式：文本(obsidian://...)
				return `${text}(${url})`;
			}

			// 其他链接保持原样
			return match;
		});
	}

	/**
	 * 清理多余的空白字符
	 */
	private cleanupWhitespace(content: string): string {
		// 移除多余的空行（超过2个连续换行）
		content = content.replace(/\n{3,}/g, '\n\n');
		
		// 移除行尾空格
		content = content.replace(/[ \t]+$/gm, '');
		
		// 确保文件末尾有且仅有一个换行
		content = content.replace(/\s+$/, '\n');
		
		return content;
	}

	/**
	 * 处理 Obsidian 特有的代码块语法
	 */
	private processCodeBlocks(content: string, context?: ProcessContext): string {
		// 根据设置过滤指定语言的 fenced code block；未命中则保持原样
		const list = (context?.codeBlockFilterLanguages || []).map(s => s.toLowerCase());
		if (list.length === 0) {
			return content;
		}

		// 支持 ``` 或 ~~~ 的围栏代码块，提取 info string 首段语言名
		const fencedRegex = /(^|\n)(```|~~~)\s*([^\n]*)\n([\s\S]*?)\n\2\s*(?=\n|$)/g;
		return content.replace(fencedRegex, (full, leading, fence, info, body) => {
			const lang = (info || '').trim().split(/\s+/)[0].toLowerCase();
			if (lang && list.includes(lang)) {
				// 命中过滤语言，整段移除
				return leading || '';
			}
			return full;
		});
	}



	/**
	 * 处理 Obsidian 的高亮语法
	 */

	/**
	 * 处理 Obsidian 的高亮语法
	 */
	private processHighlights(content: string): string {
		if (!content) {
			return content;
		}

		let transformed = content;

		// 处理 <mark> 标签（含颜色样式）
		const markRegex = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
		transformed = transformed.replace(markRegex, (_, attrs, inner) => {
			return this.wrapHighlightPlaceholder(inner, this.extractHighlightColor(attrs));
		});

		// 处理 Obsidian 原生 ==text== 语法
		const equalsRegex = /==([\s\S]+?)==/g;
		transformed = transformed.replace(equalsRegex, (_, inner) => {
			return this.wrapHighlightPlaceholder(inner, this.DEFAULT_HIGHLIGHT_COLOR);
		});

		return transformed;
	}

	/**
	 * 将文本包裹为高亮占位符，等待飞书端二次处理
	 */
	private wrapHighlightPlaceholder(text: string, color: number = this.DEFAULT_HIGHLIGHT_COLOR): string {
		const colorValue = Number.isFinite(color) ? color : this.DEFAULT_HIGHLIGHT_COLOR;
		const highlightId = this.generateHighlightId();
		const startToken = `${this.HIGHLIGHT_START_PREFIX}${colorValue}_${highlightId}!!`;
		const endToken = `${this.HIGHLIGHT_END_PREFIX}${highlightId}!!`;
		return `${startToken}${text}${endToken}`;
	}

	/**
	 * 生成唯一的高亮标识，避免占位符冲突
	 */
	private generateHighlightId(): string {
		this.highlightIdCounter += 1;
		return `${Date.now().toString(36)}_${this.highlightIdCounter.toString(36)}`;
	}

	/**
	 * 根据 <mark> 标签属性推断颜色
	 */
	private extractHighlightColor(attrText: string): number {
		if (!attrText) {
			return this.DEFAULT_HIGHLIGHT_COLOR;
		}

		const styleMatch = attrText.match(/style\s*=\s*["']([^"']+)["']/i);
		if (styleMatch) {
			const styleValue = styleMatch[1];
			const bgMatch = styleValue.match(/background(?:-color)?\s*:\s*([^;]+)/i);
			if (bgMatch) {
				const mapped = this.mapCssColorToFeishu(bgMatch[1].trim());
				if (mapped) {
					return mapped;
				}
			}
		}

		const dataColorMatch = attrText.match(/data-color\s*=\s*["']([^"']+)["']/i);
		if (dataColorMatch) {
			const mapped = this.mapColorNameToFeishu(dataColorMatch[1].trim().toLowerCase());
			if (mapped) {
				return mapped;
			}
		}

		return this.DEFAULT_HIGHLIGHT_COLOR;
	}

	/**
	 * 将 CSS 颜色值映射为飞书高亮颜色编号
	 */
	private mapCssColorToFeishu(colorValue: string): number {
		if (!colorValue) {
			return this.DEFAULT_HIGHLIGHT_COLOR;
		}

		const normalized = colorValue.trim().toLowerCase();
		const namedColor = this.mapColorNameToFeishu(normalized);
		if (namedColor) {
			return namedColor;
		}

		const hexMatch = normalized.match(/^#([0-9a-f]{3,8})$/i);
		if (hexMatch) {
			const rgb = this.parseHexColor(hexMatch[1]);
			if (rgb) {
				return this.mapRgbToFeishuColor(rgb.r, rgb.g, rgb.b);
			}
		}

		const rgbMatch = normalized.match(/rgba?\(([^)]+)\)/i);
		if (rgbMatch) {
			const rgb = this.parseRgbColor(rgbMatch[1]);
			if (rgb) {
				return this.mapRgbToFeishuColor(rgb.r, rgb.g, rgb.b);
			}
		}

		return this.DEFAULT_HIGHLIGHT_COLOR;
	}

	/**
	 * 处理常见的颜色名称
	 */
	private mapColorNameToFeishu(name: string): number | null {
		const map: Record<string, number> = {
			'yellow': 3,
			'gold': 3,
			'orange': 2,
			'brown': 2,
			'red': 1,
			'pink': 1,
			'magenta': 1,
			'green': 4,
			'lime': 4,
			'teal': 5,
			'cyan': 5,
			'blue': 5,
			'navy': 5,
			'purple': 6,
			'violet': 6,
			'indigo': 6,
			'gray': 7,
			'grey': 7,
			'silver': 7,
			'white': 7,
			'black': 7
		};

		return map[name] ?? null;
	}

	/**
	 * HEX 颜色转 RGB
	 */
	private parseHexColor(hex: string): { r: number; g: number; b: number } | null {
		if (!hex) return null;
		let value = hex;
		if (value.length === 3 || value.length === 4) {
			value = value.split('').map(ch => ch + ch).join('');
		}
		if (value.length !== 6 && value.length !== 8) {
			return null;
		}
		const r = parseInt(value.substring(0, 2), 16);
		const g = parseInt(value.substring(2, 4), 16);
		const b = parseInt(value.substring(4, 6), 16);
		return { r, g, b };
	}

	/**
	 * RGB/ RGBA 字符串转 RGB
	 */
	private parseRgbColor(value: string): { r: number; g: number; b: number } | null {
		const parts = value.split(',').map(part => part.trim());
		if (parts.length < 3) {
			return null;
		}

		const parseComponent = (input: string): number => {
			if (input.endsWith('%')) {
				return Math.round(parseFloat(input) * 2.55);
			}
			return parseInt(input, 10);
		};

		const r = Math.min(255, Math.max(0, parseComponent(parts[0])));
		const g = Math.min(255, Math.max(0, parseComponent(parts[1])));
		const b = Math.min(255, Math.max(0, parseComponent(parts[2])));
		return { r, g, b };
	}

	/**
	 * RGB 转换为飞书颜色编号
	 */
	private mapRgbToFeishuColor(r: number, g: number, b: number): number {
		const { h, s, l } = this.rgbToHsl(r, g, b);
		return this.mapHslToFeishuColor(h, s, l);
	}

	/**
	 * RGB 转 HSL，方便根据色相分类
	 */
	private rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
		const rNorm = r / 255;
		const gNorm = g / 255;
		const bNorm = b / 255;
		const max = Math.max(rNorm, gNorm, bNorm);
		const min = Math.min(rNorm, gNorm, bNorm);
		let h = 0;
		let s = 0;
		const l = (max + min) / 2;

		const delta = max - min;
		if (delta !== 0) {
			s = delta / (1 - Math.abs(2 * l - 1));
			s = Number.isFinite(s) ? s : 0;
			s = Math.max(0, Math.min(1, s));

			switch (max) {
				case rNorm:
					h = ((gNorm - bNorm) / delta) % 6;
					break;
				case gNorm:
					h = (bNorm - rNorm) / delta + 2;
					break;
				default:
					h = (rNorm - gNorm) / delta + 4;
			}
			h *= 60;
			if (h < 0) {
				h += 360;
			}
		}

		return { h, s, l };
	}

	/**
	 * 根据 HSL 归类为飞书支持的背景色编号
	 */
	private mapHslToFeishuColor(h: number, s: number, l: number): number {
		if (s < 0.15 || l > 0.92 || l < 0.12) {
			return 7; // 更接近灰度
		}
		if (h < 15 || h >= 345) {
			return 1; // 红/粉
		}
		if (h < 45) {
			return 2; // 橙
		}
		if (h < 75) {
			return 3; // 黄
		}
		if (h < 170) {
			return 4; // 绿
		}
		if (h < 250) {
			return 5; // 蓝/青
		}
		if (h < 320) {
			return 6; // 紫
		}
		return 1;
	}

	/**
	 * 处理 Obsidian Callout 块
	 * 使用占位符机制，在飞书中创建真正的高亮块（Callout Block）
	 */
	private processCallouts(content: string): string {
		// 改进的正则表达式，支持折叠语法和更复杂的内容
		// 格式：> [!TYPE]- 或 > [!TYPE] 标题（可选）
		// 后续行：> 内容（可能包含空行）
		const calloutRegex = /^>\s*\[!([^\]]+)\](-?)\s*([^\n]*)\n((?:(?:>[^\n]*|)\n?)*?)(?=\n(?!>)|$)/gm;

		return content.replace(calloutRegex, (match, type, foldable, title, body) => {
			// 获取 callout 类型（转为小写，移除可能的折叠标记）
			const calloutType = type.toLowerCase().trim();
			Debug.log(`🎨 Processing Callout: type="${calloutType}", foldable="${foldable}", title="${title}"`);

			// 从映射表中获取样式信息，如果没有找到则使用默认样式
			const styleInfo = CALLOUT_TYPE_MAPPING[calloutType] || CALLOUT_TYPE_MAPPING['default'];
			Debug.log(`🎨 Style mapping: emoji="${styleInfo.emoji}", color="${styleInfo.color}", title="${styleInfo.title}"`);

			// 处理标题（如果有的话）
			let calloutTitle = title.trim() || styleInfo.title;

			// 转义标题中的 Markdown 特殊字符，避免格式冲突
			calloutTitle = this.escapeMarkdownInTitle(calloutTitle);

			// 处理内容，移除每行开头的 > 符号，保持原有的格式结构
			const lines = body.split('\n');
			const processedLines = lines
				.map((line: string) => {
					// 移除开头的 > 符号，但保持其他格式
					if (line.startsWith('>')) {
						return line.replace(/^>\s?/, '');
					}
					return line; // 保持空行
				})
				.filter((line: string, index: number, arr: string[]) => {
					// 移除末尾的连续空行，但保持中间的空行
					if (line === '' && index === arr.length - 1) {
						return false;
					}
					return true;
				});

			let calloutContent = processedLines.join('\n');
			calloutContent = this.processHighlights(calloutContent);

			// 生成占位符
			const placeholder = this.generatePlaceholder();
			Debug.log(`🔗 Generated placeholder: ${placeholder}`);

			// 创建 Callout 信息
			const calloutInfo: CalloutInfo = {
				placeholder: placeholder,
				type: calloutType,
				title: calloutTitle,
				content: calloutContent,
				foldable: foldable === '-',
				backgroundColor: this.mapColorToFeishu(styleInfo.color, 'background'),
				borderColor: this.mapColorToFeishu(styleInfo.color, 'border'),
				textColor: this.mapColorToFeishu(styleInfo.color, 'text'),
				emojiId: this.mapEmojiToFeishu(styleInfo.emoji)
			};

			Debug.log(`📦 Created CalloutInfo:`, JSON.stringify(calloutInfo, null, 2));

			// 存储 Callout 信息
			this.calloutBlocks.push(calloutInfo);
			Debug.log(`📚 Total callout blocks: ${this.calloutBlocks.length}`);

			return placeholder;
		});
	}

	/**
	 * 处理标题中的特殊字符，避免与外层粗体标记冲突
	 */
	private escapeMarkdownInTitle(title: string): string {
		// 只处理可能与外层 ** 冲突的字符
		// 将 ** 替换为单个 * 以避免冲突，其他字符保持原样
		return title.replace(/\*\*/g, '*');
	}

	/**
	 * 将颜色映射到飞书的颜色枚举值
	 */
	private mapColorToFeishu(color: string, type: 'background' | 'border' | 'text'): number {
		const colorMap: Record<string, { background: number; border: number; text: number }> = {
			'red': { background: 1, border: 1, text: 1 },      // 浅红色/红色
			'orange': { background: 2, border: 2, text: 2 },   // 浅橙色/橙色
			'yellow': { background: 3, border: 3, text: 3 },   // 浅黄色/黄色
			'green': { background: 4, border: 4, text: 4 },    // 浅绿色/绿色
			'blue': { background: 5, border: 5, text: 5 },     // 浅蓝色/蓝色
			'purple': { background: 6, border: 6, text: 6 },   // 浅紫色/紫色
			'gray': { background: 7, border: 7, text: 7 },     // 中灰色/灰色
			'cyan': { background: 5, border: 5, text: 5 }      // 青色映射为蓝色
		};

		return colorMap[color]?.[type] || colorMap['blue'][type];
	}

	/**
	 * 将表情符号映射到飞书支持的表情ID
	 */
	private mapEmojiToFeishu(emoji: string): string {
		const emojiMap: Record<string, string> = {
			'📝': 'memo',
			'ℹ️': 'information_source',
			'💡': 'bulb',
			'⚠️': 'warning',
			'❌': 'x',
			'⛔': 'no_entry',
			'❓': 'question',
			'✅': 'white_check_mark',
			'💬': 'speech_balloon',
			'📖': 'book',
			'📄': 'page_facing_up',
			'📋': 'clipboard',
			'☑️': 'ballot_box_with_check',
			'📌': 'pushpin'
		};

		return emojiMap[emoji] || 'pushpin'; // 默认使用图钉图标
	}

	/**
	 * 完整处理（包含所有功能）
	 */
	processComplete(content: string): string {
		let processedContent = content;

		// 按顺序处理各种语法
		// 注意：此处没有传上下文，代码块过滤只在带上下文的流程中生效
		processedContent = this.processWikiLinks(processedContent);
		processedContent = this.processBlockReferences(processedContent);
		processedContent = this.processEmbeds(processedContent);
		processedContent = this.processImages(processedContent);
		processedContent = this.processLinks(processedContent); // 处理普通链接
		processedContent = this.processTags(processedContent);
		processedContent = this.processHighlights(processedContent);
		processedContent = this.processCodeBlocks(processedContent);
		processedContent = this.cleanupWhitespace(processedContent);

		return processedContent;
	}

	/**
	 * 完整处理并返回文件信息（新方法）
	 */
	processCompleteWithFiles(
		content: string,
		maxDepth: number = 3,
		frontMatterHandling: 'remove' | 'keep-as-code' = 'remove',
		enableSubDocumentUpload: boolean = true,
		enableLocalImageUpload: boolean = true,
		enableLocalAttachmentUpload: boolean = true,
		titleSource: 'filename' | 'frontmatter' = 'filename',
		codeBlockFilterLanguages: string[] = []
	): MarkdownProcessResult {
		// 重置本地文件和结构化占位符
		this.localFiles = [];
		this.calloutBlocks = [];
		this.highlightIdCounter = 0;

		// 处理 Front Matter
		const { content: processedContent, frontMatter } = this.processFrontMatter(content, frontMatterHandling);

		// 创建处理上下文
		const context: ProcessContext = {
			maxDepth: maxDepth,
			currentDepth: 0,
			processedFiles: new Set<string>(),
			enableSubDocumentUpload,
			enableLocalImageUpload,
			enableLocalAttachmentUpload,
			codeBlockFilterLanguages,
			frontMatterHandling,
			titleSource
		};

		const finalContent = this.processCompleteWithContext(processedContent, context);

		return {
			content: finalContent,
			localFiles: [...this.localFiles],
			calloutBlocks: [...this.calloutBlocks],
			frontMatter: frontMatter,
			extractedTitle: frontMatter?.title || null
		};
	}

	/**
	 * 生成占位符
	 */
	private generatePlaceholder(): string {
		const timestamp = Date.now();
		const randomId = Math.random().toString(36).substring(2, 8);
		// 使用更抽象的标识符，避免文件相关关键词被飞书误识别
		return `__OB_CONTENT_${timestamp}_${randomId}__`;
	}

	/**
	 * 从路径中提取文件名
	 */
	private extractFileName(path: string): string {
		// 移除路径分隔符，获取文件名
		const fileName = path.split(/[/\\]/).pop() || path;
		return fileName;
	}

	/**
	 * 判断是否为文件引用（有文件扩展名）
	 */
	private isFileReference(path: string): boolean {
		// 检查是否包含文件扩展名
		const fileName = this.extractFileName(path);
		return fileName.includes('.') && fileName.lastIndexOf('.') > 0;
	}

	/**
	 * 判断是否为图片文件
	 */
	private isImageFile(fileName: string): boolean {
		const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
		const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
		return imageExtensions.includes(ext);
	}

	/**
	 * 获取收集到的本地文件信息
	 */
	getLocalFiles(): LocalFileInfo[] {
		return [...this.localFiles];
	}

	/**
	 * 获取收集到的 Callout 块信息
	 */
	getCalloutBlocks(): CalloutInfo[] {
		return [...this.calloutBlocks];
	}

	/**
	 * 清空本地文件信息
	 */
	clearLocalFiles(): void {
		this.localFiles = [];
		this.calloutBlocks = [];
	}

	/**
	 * 查找双链引用的Markdown文件
	 */
	private findLinkedMarkdownFile(linkText: string): TFile | null {
		try {
			// 清理链接文本
			let cleanLink = linkText.trim();

			// 移除可能的路径前缀
			cleanLink = cleanLink.replace(/^\.\//, '').replace(/^\//, '');

			// 如果没有扩展名，尝试添加.md
			if (!cleanLink.includes('.')) {
				cleanLink = cleanLink + '.md';
			}

			// 规范化路径
			const normalizedPath = normalizePath(cleanLink);

			// 首先尝试直接路径匹配
			let file = this.app.vault.getFileByPath(normalizedPath);

			if (!file) {
				// 如果直接路径不匹配，尝试按文件名查找
				const fileName = normalizedPath.split('/').pop()?.toLowerCase();
				if (fileName) {
					const allFiles = this.app.vault.getMarkdownFiles();
					file = allFiles.find(f => f.name.toLowerCase() === fileName) || null;
				}
			}

			if (!file) {
				// 最后尝试模糊匹配（不包含扩展名的情况）
				const baseName = linkText.trim().toLowerCase();
				const allFiles = this.app.vault.getMarkdownFiles();
				file = allFiles.find(f => f.basename.toLowerCase() === baseName) || null;
			}

			if (file) {
				Debug.log(`✅ Found linked markdown file: "${linkText}" -> "${file.path}"`);
			} else {
				Debug.log(`❌ Linked markdown file not found: "${linkText}"`);
			}

			return file;
		} catch (error) {
			Debug.error(`Error finding linked file for "${linkText}":`, error);
			return null;
		}
	}

	/**
	 * 处理子文档内容（带递归控制）
	 */
	async processSubDocument(
		file: TFile,
		context: ProcessContext,
		frontMatterHandling: 'remove' | 'keep-as-code' = 'remove',
		titleSource: 'filename' | 'frontmatter' = 'filename'
	): Promise<MarkdownProcessResult> {
		try {
			// 添加到已处理文件集合
			const normalizedPath = normalizePath(file.path);
			context.processedFiles.add(normalizedPath);

			// 读取文件内容
			const content = await this.app.vault.read(file);

			// 处理 Front Matter（与主文档保持一致）
			const { content: processedContent, frontMatter } = this.processFrontMatter(content, frontMatterHandling);

			// 提取标题（与主文档保持一致）
			const extractedTitle = this.extractTitle(file.basename, frontMatter, titleSource);

			// 创建子上下文
			const subContext: ProcessContext = {
				...context,
				currentDepth: context.currentDepth + 1
			};

			// 重置本地文件列表（为子文档处理）
			const originalFiles = [...this.localFiles];
			this.localFiles = [];

			// 处理子文档内容
			const finalContent = this.processCompleteWithContext(processedContent, subContext);

			// 获取子文档的文件列表
			const subDocumentFiles = [...this.localFiles];

			// 恢复原始文件列表
			this.localFiles = originalFiles;

			return {
				content: finalContent,
				localFiles: subDocumentFiles,
				frontMatter: frontMatter,
				extractedTitle: extractedTitle
			};
		} catch (error) {
			Debug.error(`Error processing sub-document ${file.path}:`, error);
			return {
				content: `❌ 无法读取子文档: ${file.basename}`,
				localFiles: [],
				frontMatter: null,
				extractedTitle: null
			};
		}
	}

	/**
	 * 带上下文的完整处理方法
	 */
	private processCompleteWithContext(content: string, context?: ProcessContext): string {
		let processedContent = content;

		// 按顺序处理各种语法
		processedContent = this.processCodeBlocks(processedContent, context); // 先做代码块过滤
		processedContent = this.processCallouts(processedContent); // 先处理 Callout，因为它们是块级元素
		processedContent = this.processWikiLinks(processedContent, context);
		processedContent = this.processBlockReferences(processedContent);
		processedContent = this.processEmbeds(processedContent, context);
		processedContent = this.processImages(processedContent, context);
		processedContent = this.processLinks(processedContent); // 处理普通链接，确保特殊协议链接保持可点击
		processedContent = this.processTags(processedContent);
		processedContent = this.processHighlights(processedContent);
		processedContent = this.cleanupWhitespace(processedContent);

		return processedContent;
	}

	/**
	 * 解析 YAML Front Matter
	 * @param content 原始内容
	 * @returns 解析结果，包含 Front Matter 数据和剩余内容
	 */
	private parseFrontMatter(content: string): { frontMatter: FrontMatterData | null, content: string } {
		// 检查是否以 --- 开头
		if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
			return { frontMatter: null, content };
		}

		// 查找结束的 ---
		const lines = content.split('\n');
		let endIndex = -1;

		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === '---') {
				endIndex = i;
				break;
			}
		}

		if (endIndex === -1) {
			// 没有找到结束标记，不是有效的 Front Matter
			return { frontMatter: null, content };
		}

		// 提取 YAML 内容
		const yamlContent = lines.slice(1, endIndex).join('\n');
		const remainingContent = lines.slice(endIndex + 1).join('\n');

		try {
			// 简单的 YAML 解析（仅支持基本的 key: value 格式）
			const frontMatter = this.parseSimpleYaml(yamlContent);
			return { frontMatter, content: remainingContent };
		} catch (error) {
			Debug.warn('Failed to parse Front Matter:', error);
			return { frontMatter: null, content };
		}
	}

	/**
	 * 简单的 YAML 解析器（仅支持基本的 key: value 格式）
	 * @param yamlContent YAML 内容
	 * @returns 解析后的对象
	 */
	private parseSimpleYaml(yamlContent: string): FrontMatterData {
		const result: FrontMatterData = {};
		const lines = yamlContent.split('\n');

		for (const line of lines) {
			const trimmedLine = line.trim();
			if (!trimmedLine || trimmedLine.startsWith('#')) {
				continue; // 跳过空行和注释
			}

			const colonIndex = trimmedLine.indexOf(':');
			if (colonIndex === -1) {
				continue; // 跳过无效行
			}

			const key = trimmedLine.substring(0, colonIndex).trim();
			let value = trimmedLine.substring(colonIndex + 1).trim();

			// 移除引号
			if ((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}

			result[key] = value;
		}

		return result;
	}

	/**
	 * 根据设置处理 Front Matter
	 * @param content 原始内容
	 * @param frontMatterHandling 处理方式
	 * @returns 处理后的内容和 Front Matter 数据
	 */
	processFrontMatter(content: string, frontMatterHandling: 'remove' | 'keep-as-code'): {
		content: string,
		frontMatter: FrontMatterData | null
	} {
		const { frontMatter, content: contentWithoutFrontMatter } = this.parseFrontMatter(content);

		if (!frontMatter) {
			return { content, frontMatter: null };
		}

		if (frontMatterHandling === 'remove') {
			return { content: contentWithoutFrontMatter, frontMatter };
		} else {
			// 保留为代码块
			const yamlLines = content.split('\n');
			let endIndex = -1;

			for (let i = 1; i < yamlLines.length; i++) {
				if (yamlLines[i].trim() === '---') {
					endIndex = i;
					break;
				}
			}

			if (endIndex !== -1) {
				const yamlContent = yamlLines.slice(1, endIndex).join('\n');
				const codeBlock = '```yaml\n' + yamlContent + '\n```\n\n';
				return {
					content: codeBlock + contentWithoutFrontMatter,
					frontMatter
				};
			}
		}

		return { content: contentWithoutFrontMatter, frontMatter };
	}

	/**
	 * 根据设置提取文档标题
	 * @param fileName 文件名（不含扩展名）
	 * @param frontMatter Front Matter 数据
	 * @param titleSource 标题来源设置
	 * @returns 提取的标题
	 */
	extractTitle(
		fileName: string,
		frontMatter: FrontMatterData | null,
		titleSource: 'filename' | 'frontmatter'
	): string {
		if (titleSource === 'frontmatter' && frontMatter?.title) {
			// 优先使用 Front Matter 中的 title
			return frontMatter.title;
		}

		// 回退到文件名
		return fileName;
	}

	/**
	 * 在文件内容中添加或更新分享标记到 Front Matter
	 * 基于文本操作，保留原始YAML结构
	 * @param content 原始文件内容
	 * @param shareUrl 分享链接
	 * @returns 更新后的文件内容
	 */
	addShareMarkToFrontMatter(content: string, shareUrl: string): string {
		// 获取东8区时间并格式化为 YYYY-MM-DD HH:mm
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
				// 没有Front Matter，创建新的
				const newFrontMatter = [
					'---',
					`feishu_url: "${shareUrl}"`,
					`feishu_shared_at: "${currentTime}"`,
					'---',
					''
				].join('\n');
				return newFrontMatter + content;
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
			// 没有找到结束标记，不是有效的Front Matter
			return content;
		}

		// 分离Front Matter和内容
			let frontMatterLines = lines.slice(0, endIndex + 1); // 包含开始和结束的---
			const contentLines = lines.slice(endIndex + 1);

			// 在Front Matter中查找并更新/添加飞书相关字段
			const fieldsToUpdate: { [key: string]: string } = {
				'feishu_url': `"${shareUrl}"`,
				'feishu_shared_at': `"${currentTime}"`
			};

		// 记录哪些字段已经存在
		const existingFields = new Set<string>();

		// 遍历Front Matter行，更新已存在的字段
			const processedLines: string[] = [frontMatterLines[0]];
			for (let i = 1; i < frontMatterLines.length - 1; i++) { // 跳过开始和结束的---
				const originalLine = frontMatterLines[i];
				const trimmedLine = originalLine.trim();

				if (trimmedLine && !trimmedLine.startsWith('#')) {
					const colonIndex = trimmedLine.indexOf(':');
					if (colonIndex !== -1) {
						const key = trimmedLine.substring(0, colonIndex).trim();

						if (key === 'feishushare') {
							// 移除旧的 feishushare 标记
							continue;
						}

						if (fieldsToUpdate.hasOwnProperty(key)) {
							processedLines.push(`${key}: ${fieldsToUpdate[key]}`);
							existingFields.add(key);
							continue;
						}
					}
				}

				processedLines.push(originalLine);
			}
			processedLines.push(frontMatterLines[frontMatterLines.length - 1]);
			frontMatterLines = processedLines;

		// 添加不存在的字段（在最后一个---之前）
		const newFields: string[] = [];
		for (const [key, value] of Object.entries(fieldsToUpdate)) {
			if (!existingFields.has(key)) {
				newFields.push(`${key}: ${value}`);
			}
		}

		if (newFields.length > 0) {
			// 在最后的---之前插入新字段
			frontMatterLines.splice(frontMatterLines.length - 1, 0, ...newFields);
		}

		// 重新组合内容
		return [...frontMatterLines, ...contentLines].join('\n');
	}

	addOrUpdateKmsFrontmatter(content: string, kmsUrl: string, kmsOpen: boolean): string {
		if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
			const newFrontMatter = [
				'---',
				`kms_open: ${kmsOpen ? 'true' : 'false'}`,
				`kms_url: "${kmsUrl}"`,
				'---',
				''
			].join('\n');
			return newFrontMatter + content;
		}

		const lines = content.split('\n');
		let endIndex = -1;

		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === '---') {
				endIndex = i;
				break;
			}
		}

		if (endIndex === -1) {
			return content;
		}

		const frontMatterLines = lines.slice(0, endIndex + 1);
		const contentLines = lines.slice(endIndex + 1);
		let kmsUpdated = false;
		let kmsOpenUpdated = false;

		for (let i = 1; i < frontMatterLines.length - 1; i++) {
			const trimmedLine = frontMatterLines[i].trim();
			if (!trimmedLine || trimmedLine.startsWith('#')) continue;
			const colonIndex = trimmedLine.indexOf(':');
			if (colonIndex === -1) continue;
			const key = trimmedLine.substring(0, colonIndex).trim();
			if (key === 'kms_url') {
				frontMatterLines[i] = `kms_url: "${kmsUrl}"`;
				kmsUpdated = true;
				continue;
			}
			if (key === 'kms_open') {
				frontMatterLines[i] = `kms_open: ${kmsOpen ? 'true' : 'false'}`;
				kmsOpenUpdated = true;
			}
		}

		if (!kmsUpdated) {
			frontMatterLines.splice(frontMatterLines.length - 1, 0, `kms_url: "${kmsUrl}"`);
		}

		if (!kmsOpenUpdated) {
			frontMatterLines.splice(frontMatterLines.length - 1, 0, `kms_open: ${kmsOpen ? 'true' : 'false'}`);
		}

		return [...frontMatterLines, ...contentLines].join('\n');
	}

	// ==================== Notion 特定处理方法（迁移至 Notion API 服务） ====================

	/**
	 * 处理 Notion Callout 语法 [>INFO: 内容]
	 */
	private processNotionCallouts(content: string): string {
		// 匹配 Notion style callouts
		const calloutPattern = /^\[>([A-Z]+):\s*(.*)/gm;

		return content.replace(calloutPattern, (match, type, calloutContent) => {
			const iconMap: Record<string, string> = {
				'INFO': '💡',
				'WARNING': '⚠️',
				'ERROR': '❌',
				'SUCCESS': '✅',
				'NOTE': '📝',
				'TIP': '💡',
				'IMPORTANT': '⭐',
				'QUESTION': '❓',
				'HELP': '🆘'
			};

			const emoji = iconMap[type.toUpperCase()] || '📝';
			const placeholder = this.generatePlaceholder();

			const calloutInfo: CalloutInfo = {
				placeholder,
				type: type.toLowerCase(),
				title: type.charAt(0) + type.slice(1).toLowerCase(),
				content: calloutContent.trim(),
				foldable: false,
				backgroundColor: 1, // 默认颜色
				borderColor: 1,
				textColor: 1,
				emojiId: emoji
			};

			this.calloutBlocks.push(calloutInfo);
			return `📱 ${type}: ${calloutContent.trim()} (Notion Callout)`;
		});
	}

	/**
	 * 处理 Notion 特定的表格格式
	 */
	private processNotionTables(content: string): string {
		// Notion 支持更好的表格语法
		// 这里可以添加特定的表格处理逻辑
		return content;
	}

	/**
	 * 处理 Notion 分栏语法
	 */
	private processNotionColumns(content: string): string {
		// 匹配分栏语法 ---|---
		const columnPattern = /\|---\|---/g;

		return content.replace(columnPattern, '\n|---分栏开始---|\n');
	}

	/**
	 * 处理 Notion 特定的引用语法
	 */
	private processNotionQuotes(content: string): string {
		let processedContent = content;

		// 处理多层引用为 Notion 兼容格式
		// 处理 ">> 引用语法
		processedContent = processedContent.replace(/^>>\s+(.+)$/gm, '> $1');

		// 处理多层引用
		const levels = ['>>>', '>>', '>'];
		for (let i = 0; i < levels.length; i++) {
			const pattern = new RegExp(`^${levels[i]}\\s+(.+)$`, 'gm');
			const replacement = '>'.repeat(i + 1) + ' $1';
			processedContent = processedContent.replace(pattern, replacement);
		}

		return processedContent;
	}

	/**
	 * 处理 Notion 特定的列表语法
	 */
	private processNotionLists(content: string): string {
		let processedContent = content;

		// 处理待办事项 - [ ] 和 - [x]
		processedContent = processedContent.replace(/^-\s+\[([ x])\]\s+(.+)$/gm, (match, status, text) => {
			const checked = status === 'x';
			const placeholder = this.generatePlaceholder();
			const fileInfo: LocalFileInfo = {
				originalPath: '',
				fileName: '',
				placeholder,
				isImage: false,
				isCallout: false,
				altText: `${checked ? '✅' : '⬜'} ${text.trim()}`
			};
			this.localFiles.push(fileInfo);
			return `${checked ? '✅' : '⬜'} ${text.trim()} (Todo)`;
		});

		// 处理折叠列表 - [ ] 和 - [x]
		processedContent = processedContent.replace(/^-\s+\[([ x])\]\s+(.+)$/gm, (match, status, text) => {
			const checked = status === 'x';
			return `${checked ? '✅' : '⬜'} ${text.trim()}`;
		});

		return processedContent;
	}

	/**
	 * 处理 Notion 特定的代码块语法
	 */
	private processNotionCodeBlocks(content: string): string {
		// 支持更多的代码块语言
		const enhancedLanguages = [
			'javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'go', 'rust',
			'html', 'css', 'scss', 'sass', 'json', 'xml', 'yaml', 'yml',
			'markdown', 'latex', 'sql', 'bash', 'shell', 'powershell', 'dockerfile',
			'react', 'svelte', 'nextjs', 'nodejs', 'express',
			'figma', 'sketch', 'xd', 'photoshop', 'illustrator', 'indesign',
			'notion', 'airtable', 'coda', 'slack', 'discord', 'github'
		];

		// 检查并增强代码块
		return content.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, language, code) => {
			const detectedLanguage = this.detectLanguage(code, language);
			const enhancedLanguage = enhancedLanguages.includes(detectedLanguage) ? detectedLanguage : (language || '');
			return `\`\`\`${enhancedLanguage}\n${code}\n\`\`\``;
		});
	}

	/**
	 * 检测编程语言
	 */
	private detectLanguage(code: string, suggested?: string): string {
		if (suggested) return suggested;

		// 简单的语言检测逻辑
		if (code.includes('def ') && code.includes(':')) return 'python';
		if (code.includes('function ') && code.includes('{')) return 'javascript';
		if (code.includes('public class ') && code.includes('package ')) return 'java';
		if (code.includes('#include') && code.includes('int main(')) return 'cpp';
		if (code.includes('FROM ') && code.includes('RUN ')) return 'dockerfile';
		if (code.includes('import React ') && code.includes('export')) return 'react';
		if (code.includes('---') && code.includes('...')) return 'yaml';

		return 'text';
	}

	/**
	 * 处理 Notion 特定的图片语法
	 */
	private processNotionImages(content: string): string {
		// 支持 Notion 特定的图片语法，如图片尺寸调整
		return content.replace(/!\[\[([^\]]+)\]\]\(([^)]+)\)/g, (match, caption, url) => {
			const placeholder = this.generatePlaceholder();
			const fileInfo: LocalFileInfo = {
				originalPath: url,
				fileName: this.extractFileName(url),
				placeholder,
				isImage: true,
				isCallout: false,
				altText: caption || '',
				displayWidth: undefined,
				originalWidth: undefined,
				originalHeight: undefined
			};
			this.localFiles.push(fileInfo);
			return `🖼️ ${caption || url} (Notion Image)`;
		});
	}

	/**
	 * 处理 Notion 特定的链接语法
	 */
	private processNotionLinks(content: string): string {
		// 处理 Notion 特定的链接语法，如页面链接
		return content.replace(/\[([^\]]+)\]\(notion:\/\/([a-zA-Z0-9-]+)\)/g, (match, text, pageId) => {
			return `📝 ${text} (Notion Page: ${pageId})`;
		});
	}

	/**
	 * 生成 Notion 兼容内容的页面属性
	 */
	generateNotionProperties(
		frontMatter: FrontMatterData | null,
		context?: NotionProcessContext
	): Record<string, any> {
		const properties: Record<string, any> = {};

		// 基础标题属性
		if (frontMatter?.title) {
			properties[context?.pageTitleProperty || 'Name'] = {
				title: [{ text: { content: frontMatter.title } }]
			};
		}

		// 标签属性
		if (frontMatter?.tags) {
			const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags :
							typeof frontMatter.tags === 'string' ? frontMatter.tags.split(',') : [];

			properties[context?.pageTagsProperty || 'Tags'] = {
				multi_select: tags.map(tag => ({
					name: tag
				}))
			};
		}

		// 状态属性
		if (frontMatter?.status) {
			properties[context?.pageStatusProperty || 'Status'] = {
				select: {
					name: frontMatter.status
				}
			};
		}

		// 其他自定义属性
		if (frontMatter) {
			for (const [key, value] of Object.entries(frontMatter)) {
				if (['title', 'tags', 'status'].includes(key)) continue;

				if (typeof value === 'string') {
					properties[key] = {
						rich_text: [{ text: { content: value } }]
					};
				} else if (typeof value === 'number') {
					properties[key] = {
						number: value
					};
				} else if (typeof value === 'boolean') {
					properties[key] = {
						checkbox: value
					};
				} else if (Array.isArray(value)) {
					properties[key] = {
						multi_select: value.map(item => ({
							name: String(item)
						}))
					};
				} else if (typeof value === 'object' && value !== null) {
					properties[key] = {
						rich_text: [{ text: { content: JSON.stringify(value) } }]
					};
				}
			}
		}

		return properties;
	}

	/**
	 * 清理 Notion 不支持的内容
	 */
    cleanupForNotion(content: string): string {
        let cleanedContent = content;

        // 移除潜在不安全或不支持的 HTML 标签（使用非贪婪匹配）
        cleanedContent = cleanedContent.replace(/<script[\s\S]*?<\/script>/gi, '');
        cleanedContent = cleanedContent.replace(/<style[\s\S]*?<\/style>/gi, '');

        // 清理多余的空行
        cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');

        // 清理行首行尾空格
        cleanedContent = cleanedContent.replace(/^\s+|\s+$/gm, '');

        return cleanedContent.trim();
    }
}
