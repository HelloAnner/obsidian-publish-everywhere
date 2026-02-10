/**
 * 小红书素材准备器：组合 LLM 和图片渲染，输出到 Downloads 目录
 *
 * @author Anner
 * Created on 2026/2/9
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import type { App, TFile } from 'obsidian';
import { Debug } from '../debug';
import { LlmService } from '../shared/llm-service';
import { XiaohongshuImageRenderer } from './xiaohongshu-image-renderer';
import type { XiaohongshuPublishResult, XiaohongshuRenderedImage } from './xiaohongshu-types';
import type { FeishuSettings } from '../types';
import { getXiaohongshuStyleBySeed, XIAOHONGSHU_STYLE_PRESETS } from './xiaohongshu-style-presets';

export type XiaohongshuProgressReporter = (message: string) => void;

export class XiaohongshuPublisher {
	private readonly app: App;
	private readonly settings: FeishuSettings;
	private readonly vaultBasePath: string;
	private readonly llmService: LlmService;
	private readonly imageRenderer: XiaohongshuImageRenderer;

	constructor(params: { app: App; settings: FeishuSettings; vaultBasePath: string }) {
		this.app = params.app;
		this.settings = params.settings;
		this.vaultBasePath = params.vaultBasePath;
		this.llmService = new LlmService(this.settings);
		this.imageRenderer = new XiaohongshuImageRenderer(this.app, params.vaultBasePath);
	}

	/**
	 * 准备小红书素材：生成文案和图片，输出到 Downloads 目录
	 */
	async prepareMaterials(
		file: TFile,
		markdown: string,
		onProgress?: XiaohongshuProgressReporter
	): Promise<XiaohongshuPublishResult> {
		const report = (message: string): void => {
			onProgress?.(message);
		};

		report('正在选择随机风格...');
		const styleSeed = this.nextStyleSeed(this.settings.xiaohongshuLastStyleSeed);
		const stylePreset = getXiaohongshuStyleBySeed(styleSeed);
		report(`已选择风格：${stylePreset.name}`);

		try {
			report('正在提取附件引用并准备提示词...');
			const attachmentNames = await this.extractAttachmentNames(markdown);
			report(`附件提取完成（${attachmentNames.length}项），开始调用大模型生成文案...`);
			const plan = await this.llmService.createXiaohongshuPlan(
				markdown,
				attachmentNames,
				stylePreset,
				undefined,
				file.basename
			);
			report('文案生成完成，正在渲染图片...');
			const renderedImages = await this.imageRenderer.render(plan, file, stylePreset);
			const exportedImages: XiaohongshuRenderedImage[] = [];
			const styleName = renderedImages[0]?.styleName || 'Unknown Style';
			report(`图片渲染完成（${renderedImages.length}张），正在导出 PNG...`);

			// 准备输出目录：~/Downloads/xiaohongshu-{文件名}-{时间戳}
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const safeFileName = file.basename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
			const outputDirName = `xiaohongshu-${safeFileName}-${timestamp}`;
			const outputDir = path.join(os.homedir(), 'Downloads', outputDirName);

			// 创建输出目录
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}

			// 转换 SVG 为 PNG 并保存
			for (let i = 0; i < renderedImages.length; i++) {
				const img = renderedImages[i];
				const destPath = path.join(outputDir, `${i + 1}.png`);
				try {
					await this.convertSvgToPng(img.path, destPath);
				} catch (error) {
					const fallbackSvgPath = path.join(outputDir, `${i + 1}.svg`);
					fs.copyFileSync(img.path, fallbackSvgPath);
					throw new Error(`${(error as Error).message}；已输出调试文件：${path.basename(fallbackSvgPath)}`);
				}
				exportedImages.push({
					...img,
					path: destPath
				});
				report(`已转换图片 ${i + 1}/${renderedImages.length}`);
			}

			const sourceImageCount = await this.appendSourceImagesAsPng(
				file,
				markdown,
				outputDir,
				exportedImages,
				styleName,
				report
			);
			if (sourceImageCount > 0) {
				report(`已追加笔记原图 ${sourceImageCount} 张`);
			}

			// 生成文案文件
			const copyText = this.formatCopyText(plan.content.title, plan.content.noteText, plan.content.hashtags, exportedImages);
			const copyFilePath = path.join(outputDir, '文案.txt');
			fs.writeFileSync(copyFilePath, copyText, 'utf8');

			report('素材准备完成！');
			this.settings.xiaohongshuLastStyleSeed = styleSeed;

			return {
				success: true,
				outputDir,
				draft: {
					title: plan.content.title,
					noteText: plan.content.noteText,
					hashtags: plan.content.hashtags,
					renderedImages: exportedImages,
					styleName,
					styleSeed
				}
			};
		} catch (error) {
			const message = (error as Error).message;
			report(`流程异常：${message}`);
			Debug.error('[Xiaohongshu] prepare materials failed', error);
			return {
				success: false,
				error: message
			};
		}
	}

	/**
	 * 使用浏览器 Canvas 将 SVG 转换为 PNG
	 */
	private async convertSvgToPng(svgPath: string, pngPath: string): Promise<void> {
		const svg = fs.readFileSync(svgPath, 'utf8');
		const png = await this.renderSvgToPngBuffer(svg, svgPath);
		if (!png || png.length === 0) {
			throw new Error(`SVG 转 PNG 失败: ${path.basename(svgPath)}（空输出）`);
		}
		fs.writeFileSync(pngPath, png);
	}

	/**
	 * 在渲染进程内用 Canvas 光栅化 SVG，避免系统命令依赖
	 */
	private renderSvgToPngBuffer(svg: string, svgPath: string): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			if (typeof document === 'undefined' || typeof Image === 'undefined') {
				reject(new Error('当前环境不支持 Canvas 渲染（缺少 document/Image）'));
				return;
			}

			const canvas = document.createElement('canvas');
			canvas.width = 1080;
			canvas.height = 1440;
			const context = canvas.getContext('2d');
			if (!context) {
				reject(new Error('无法创建 Canvas 2D 上下文'));
				return;
			}

			const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
			const objectUrl = URL.createObjectURL(blob);
			const image = new Image();

			image.onload = () => {
				try {
					context.clearRect(0, 0, canvas.width, canvas.height);
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					const dataUrl = canvas.toDataURL('image/png');
					const base64 = dataUrl.split(',')[1] || '';
					if (!base64) {
						reject(new Error(`Canvas 导出空数据: ${path.basename(svgPath)}`));
						return;
					}
					resolve(Buffer.from(base64, 'base64'));
				} catch (error) {
					reject(new Error(`Canvas 绘制失败: ${(error as Error).message}`));
				} finally {
					URL.revokeObjectURL(objectUrl);
				}
			};

			image.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error(`浏览器无法解码 SVG: ${path.basename(svgPath)}`));
			};

			image.src = objectUrl;
		});
	}

	/**
	 * 格式化文案文本
	 */
	private formatCopyText(title: string, noteText: string, hashtags: string[], renderedImages: XiaohongshuRenderedImage[]): string {
		const lines: string[] = [];
		lines.push('【标题】');
		lines.push(title);
		lines.push('');
		lines.push('【正文】');
		lines.push(noteText);
		lines.push('');
		lines.push('【配图文案】');
		if (renderedImages.length === 0) {
			lines.push('（无）');
		} else {
			renderedImages.forEach((item) => {
				lines.push(`${path.basename(item.path)}：${item.caption}`);
			});
		}
		lines.push('');
		lines.push('【标签】');
		lines.push(hashtags.map(tag => `#${tag}`).join(' '));
		return lines.join('\n');
	}

	private async extractAttachmentNames(markdown: string): Promise<string[]> {
		const matches = Array.from(markdown.matchAll(/!\[.*?\]\(([^)]+)\)|!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g));
		return Array.from(new Set(matches
			.map(match => (match[1] || match[2] || '').trim())
			.filter(Boolean)
			.map(item => item.split('/').pop() || item)));
	}

	private async appendSourceImagesAsPng(
		sourceFile: TFile,
		markdown: string,
		outputDir: string,
		exportedImages: XiaohongshuRenderedImage[],
		styleName: string,
		report: XiaohongshuProgressReporter
	): Promise<number> {
		const attachments = this.collectAttachmentFiles(sourceFile.path, markdown);
		if (attachments.length === 0) {
			return 0;
		}
		const selected = this.selectPreferredSourceAttachment(attachments);
		if (!selected) {
			return 0;
		}

		const imageIndex = exportedImages.length + 1;
		const destPath = path.join(outputDir, `${imageIndex}.png`);
		await this.convertAttachmentToPng(selected.absolutePath, destPath);
		if (this.isDuplicatePng(destPath, exportedImages)) {
			fs.unlinkSync(destPath);
			report('检测到原图与已生成图片重复，已跳过追加');
			return 0;
		}
		exportedImages.push({
			index: imageIndex,
			path: destPath,
			caption: `原图：${selected.name}`,
			styleName,
			type: 'viewpoint'
		});
		report(`已追加原图 1/1`);
		return 1;
	}

	private collectAttachmentFiles(notePath: string, markdown: string): Array<{ name: string; absolutePath: string }> {
		const matches = Array.from(markdown.matchAll(/!\[.*?\]\(([^)]+)\)|!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g));
		const refs = matches
			.map(match => (match[1] || match[2] || '').trim())
			.filter(Boolean)
			.map(item => item.split('|')[0].trim())
			.filter(item => !item.startsWith('http://') && !item.startsWith('https://'));

		const unique = Array.from(new Set(refs));
		const files: Array<{ name: string; absolutePath: string }> = [];

		for (const item of unique) {
			const absolutePath = this.resolveVaultPath(notePath, item);
			if (!absolutePath || !this.isSupportedImageFile(absolutePath)) {
				continue;
			}
			files.push({ name: path.basename(item), absolutePath });
		}

		return files;
	}

	private async convertAttachmentToPng(sourcePath: string, destPath: string): Promise<void> {
		const ext = path.extname(sourcePath).toLowerCase();
		if (ext === '.png') {
			fs.copyFileSync(sourcePath, destPath);
			return;
		}

		if (ext === '.svg') {
			await this.convertSvgToPng(sourcePath, destPath);
			return;
		}

		const mime = this.getImageMimeType(ext);
		const bytes = fs.readFileSync(sourcePath);
		const png = await this.renderBinaryImageToPngBuffer(bytes, mime, sourcePath);
		if (!png || png.length === 0) {
			throw new Error(`附件转 PNG 失败: ${path.basename(sourcePath)}（空输出）`);
		}
		fs.writeFileSync(destPath, png);
	}

	private renderBinaryImageToPngBuffer(bytes: Buffer, mime: string, sourcePath: string): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			if (typeof document === 'undefined' || typeof Image === 'undefined') {
				reject(new Error('当前环境不支持附件图片转 PNG（缺少 document/Image）'));
				return;
			}

			const blob = new Blob([bytes], { type: mime });
			const objectUrl = URL.createObjectURL(blob);
			const image = new Image();

			image.onload = () => {
				try {
					const width = image.naturalWidth || image.width;
					const height = image.naturalHeight || image.height;
					if (!width || !height) {
						reject(new Error(`附件图片尺寸无效: ${path.basename(sourcePath)}`));
						return;
					}

					const canvas = document.createElement('canvas');
					canvas.width = width;
					canvas.height = height;
					const context = canvas.getContext('2d');
					if (!context) {
						reject(new Error('无法创建 Canvas 2D 上下文（附件图片）'));
						return;
					}

					context.clearRect(0, 0, width, height);
					context.drawImage(image, 0, 0, width, height);
					const dataUrl = canvas.toDataURL('image/png');
					const base64 = dataUrl.split(',')[1] || '';
					if (!base64) {
						reject(new Error(`附件导出空数据: ${path.basename(sourcePath)}`));
						return;
					}

					resolve(Buffer.from(base64, 'base64'));
				} catch (error) {
					reject(new Error(`附件绘制失败: ${(error as Error).message}`));
				} finally {
					URL.revokeObjectURL(objectUrl);
				}
			};

			image.onerror = () => {
				URL.revokeObjectURL(objectUrl);
				reject(new Error(`浏览器无法解码附件图片: ${path.basename(sourcePath)}`));
			};

			image.src = objectUrl;
		});
	}

	private getImageMimeType(ext: string): string {
		switch (ext) {
			case '.jpg':
			case '.jpeg':
				return 'image/jpeg';
			case '.webp':
				return 'image/webp';
			case '.gif':
				return 'image/gif';
			case '.bmp':
				return 'image/bmp';
			case '.svg':
				return 'image/svg+xml';
			default:
				return 'image/png';
		}
	}

	private resolveVaultPath(notePath: string, target: string): string | null {
		const targetPath = target.replace(/^\//, '');
		const direct = path.join(this.vaultBasePath, targetPath);
		const noteDir = path.dirname(notePath);
		const relative = path.join(this.vaultBasePath, noteDir, targetPath);

		if (this.existsSyncSafe(direct)) {
			return direct;
		}
		if (this.existsSyncSafe(relative)) {
			return relative;
		}
		return null;
	}

	private existsSyncSafe(filePath: string): boolean {
		try {
			const stat = fs.statSync(filePath);
			return !!stat && stat.isFile();
		} catch (_error) {
			return false;
		}
	}

	private isSupportedImageFile(filePath: string): boolean {
		const ext = path.extname(filePath).toLowerCase();
		return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'].includes(ext);
	}

	private selectPreferredSourceAttachment(
		attachments: Array<{ name: string; absolutePath: string }>
	): { name: string; absolutePath: string } | null {
		if (attachments.length === 0) {
			return null;
		}

		const normal = attachments.filter(item => !this.looksLikeGeneratedImage(item));
		if (normal.length > 0) {
			return normal[0];
		}

		return attachments[0];
	}

	private looksLikeGeneratedImage(item: { name: string; absolutePath: string }): boolean {
		const filename = item.name.toLowerCase();
		const fullpath = item.absolutePath.toLowerCase();
		if (/^\d+\s*[._-]?/.test(filename)) {
			return true;
		}
		if (/xhs|xiaohongshu|xhs-card|_md5/.test(filename)) {
			return true;
		}
		if (fullpath.includes('/downloads/xiaohongshu-')) {
			return true;
		}
		return false;
	}

	private isDuplicatePng(newImagePath: string, exportedImages: XiaohongshuRenderedImage[]): boolean {
		if (!fs.existsSync(newImagePath)) {
			return false;
		}
		const newHash = this.computeFileSha1(newImagePath);
		if (!newHash) {
			return false;
		}

		for (const image of exportedImages) {
			if (!fs.existsSync(image.path)) {
				continue;
			}
			const oldHash = this.computeFileSha1(image.path);
			if (oldHash && oldHash === newHash) {
				return true;
			}
		}

		return false;
	}

	private computeFileSha1(filePath: string): string | null {
		try {
			const data = fs.readFileSync(filePath);
			return createHash('sha1').update(data).digest('hex');
		} catch (_error) {
			return null;
		}
	}

	private nextStyleSeed(previous: number): number {
		const max = XIAOHONGSHU_STYLE_PRESETS.length;
		const next = Math.floor(Math.random() * max);
		if (next !== previous) {
			return next;
		}
		return (next + 1) % max;
	}
}
