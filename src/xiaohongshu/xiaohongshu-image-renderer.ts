/**
 * 小红书图片渲染器 - 使用纯 SVG text 元素，统一输出稳定排版
 *
 * @author Anner
 * Created on 2026/2/9
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { App, TFile } from 'obsidian';
import type { XiaohongshuLayoutPlan, XiaohongshuRenderedImage, XiaohongshuContentStructure, ImagePlanItem } from './xiaohongshu-types';
import type { XiaohongshuStylePreset } from './xiaohongshu-style-presets';

type VisualStyle = XiaohongshuStylePreset;

/**
 * 图文渲染引擎 - 纯 SVG text 实现
 */
export class XiaohongshuImageRenderer {
	private readonly app: App;
	private readonly vaultBasePath: string;

	constructor(app: App, vaultBasePath: string) {
		this.app = app;
		this.vaultBasePath = vaultBasePath;
	}

	async render(plan: XiaohongshuLayoutPlan, sourceFile: TFile, stylePreset: XiaohongshuStylePreset): Promise<XiaohongshuRenderedImage[]> {
		const attachments = await this.collectAttachmentImages(sourceFile);
		const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-xiaohongshu-'));
		const images: XiaohongshuRenderedImage[] = [];

		const { content } = plan;
		const list = this.expandImagePlan(plan.imagePlan, content);

		for (let i = 0; i < list.length; i++) {
			const item = list[i];
			const attachmentPath = this.pickAttachmentPath(item.attachmentHint, attachments, i);
			const filePath = path.join(outputDir, `xhs-card-${i + 1}.svg`);

			const svg = this.buildCardSvg({
				style: stylePreset,
				content,
				item,
				index: i,
				total: list.length,
				attachmentPath
			});

			await fs.writeFile(filePath, svg, 'utf8');

			images.push({
				index: i + 1,
				path: filePath,
				caption: this.getCardCaption(item, content),
				styleName: stylePreset.name,
				type: item.type
			});
		}

		return images;
	}

	private buildCardSvg(params: {
		style: VisualStyle;
		content: XiaohongshuContentStructure;
		item: ImagePlanItem;
		index: number;
		total: number;
		attachmentPath: string | null;
	}): string {
		const { item } = params;

		switch (item.type) {
			case 'cover':
				return this.buildCoverCard(params);
			case 'viewpoint':
				return this.buildViewpointCard(params);
			case 'argument':
				return this.buildArgumentCard(params);
			case 'conclusion':
				return this.buildConclusionCard(params);
			default:
				return this.buildViewpointCard(params);
		}
	}

	/**
	 * 封面卡片
	 */
	private buildCoverCard(params: {
		style: VisualStyle;
		content: XiaohongshuContentStructure;
		index: number;
		total: number;
	}): string {
		const { style, content, index, total } = params;
		const { title, createdAt, coreViewpoint } = content;

		// 标题分行
		const titleLines = this.wrapTextLines(title, 12, 3);
		const titleY = 380;
		const titleLineHeight = style.titleSize * 1.4;

		// 核心观点分行（自动缩字号，保证完整表达不截断）
		const viewpointLayout = this.fitTextToArea({
			text: coreViewpoint,
			textWidth: 740,
			textHeight: 160,
			initialFontSize: Math.max(Math.min(style.subtitleSize - 4, 36), 28),
			minFontSize: 22,
			charWidthFactor: 1.08
		});
		const viewpointFontSize = viewpointLayout.fontSize;
		const viewpointLineHeight = viewpointLayout.lineHeight;
		const viewpointLines = viewpointLayout.lines;
		const viewpointTextAreaTop = 820;
		const viewpointTextAreaHeight = 160;
		const viewpointBlockHeight = viewpointFontSize + Math.max(viewpointLines.length - 1, 0) * viewpointLineHeight;
		const viewpointY = Math.round(
			viewpointTextAreaTop
			+ Math.max((viewpointTextAreaHeight - viewpointBlockHeight) / 2, 0)
			+ viewpointFontSize
		);

		return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1440" viewBox="0 0 1080 1440" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${this.buildDefs(style, index)}
  </defs>

  <!-- 背景 -->
  ${this.buildBackground(style, index)}

  <!-- 主卡片 -->
  <rect x="60" y="60" width="960" height="1320" rx="${style.borderRadius}"
        fill="${style.card}" filter="url(#shadow-${index})"
        stroke="${style.border}" stroke-width="1"/>

  <!-- 装饰元素 -->
  ${this.buildDecorations(style, 'cover')}

  <!-- 日期 -->
  <text x="120" y="160" fill="${style.textSecondary}" font-size="${style.captionSize}"
        font-family="${style.decorativeFont}" letter-spacing="2">${this.escapeXml(createdAt)}</text>

  <!-- 分隔线 -->
  <line x1="120" y1="200" x2="960" y2="200" stroke="${style.border}" stroke-width="2" stroke-dasharray="8,4"/>

  <!-- 主标题 -->
  <text x="540" y="${titleY}" fill="${style.textPrimary}" font-size="${style.titleSize}"
        font-family="${style.titleFont}" font-weight="600" text-anchor="middle">
    ${titleLines.map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : titleLineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
  </text>

  <!-- 核心观点区域 -->
  <rect x="140" y="720" width="800" height="280" rx="${Math.max(style.borderRadius - 4, 4)}"
        fill="${this.hexToRgba(style.accent, 0.08)}" stroke="${style.accent}" stroke-width="2"/>

  <text x="180" y="780" fill="${style.accent}" font-size="${style.captionSize}"
        font-family="${style.decorativeFont}" letter-spacing="3">核心观点</text>

	  <!-- 核心观点文字 -->
	  <text x="540" y="${viewpointY}" fill="${style.textPrimary}" font-size="${viewpointFontSize}"
	        font-family="${style.bodyFont}" text-anchor="middle" font-style="italic">
	    ${viewpointLines.map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : viewpointLineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
	  </text>

  <!-- 页码 -->
  ${this.buildPageNumber(style, index, total)}

  <!-- 底部标签 -->
  <text x="540" y="1320" fill="${style.textSecondary}" font-size="22"
        font-family="${style.decorativeFont}" text-anchor="middle" letter-spacing="4">
    ${content.hashtags.slice(0, 3).join(' · ')}
  </text>
</svg>`;
	}

	/**
	 * 观点卡片
	 */
	private buildViewpointCard(params: {
		style: VisualStyle;
		content: XiaohongshuContentStructure;
		item: ImagePlanItem;
		index: number;
		total: number;
	}): string {
		const { style, content, item, index, total } = params;
		const point = content.subPoints[item.pointIndex] || content.subPoints[0];

		if (!point) {
			throw new Error(`观点索引越界: ${item.pointIndex}`);
		}

		const pointTitle = item.titleOverride || point.title;
		const pointArgument = item.argumentOverride || point.argument;
		const pointConclusion = item.conclusionOverride || point.conclusion;

		// 标题分行
		const titleLines = this.wrapTextLines(pointTitle, 18, 2);
		const titleY = 300;
		const titleLineHeight = style.subtitleSize * 1.5;

		// 论据分行（自动缩字号，完整展示）
		const argumentLayout = this.fitTextToArea({
			text: pointArgument,
			textWidth: 760,
			textHeight: 250,
			initialFontSize: Math.max(style.bodySize - 4, 24),
			minFontSize: 18,
			charWidthFactor: 1.02
		});
		const argumentLines = argumentLayout.lines;
		const argumentY = 600;
		const argumentFontSize = argumentLayout.fontSize;
		const argumentLineHeight = argumentLayout.lineHeight;

		// 结论分行（自动缩字号，完整展示）
		const conclusionLayout = this.fitTextToArea({
			text: pointConclusion,
			textWidth: 720,
			textHeight: 145,
			initialFontSize: Math.floor(style.bodySize * 1.05),
			minFontSize: 20,
			charWidthFactor: 1.05
		});
		const conclusionLines = conclusionLayout.lines;
		const conclusionY = 1030;
		const conclusionFontSize = conclusionLayout.fontSize;
		const conclusionLineHeight = conclusionLayout.lineHeight;

		return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1440" viewBox="0 0 1080 1440" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${this.buildDefs(style, index)}
  </defs>

  <!-- 背景 -->
  ${this.buildBackground(style, index)}

  <!-- 主卡片 -->
  <rect x="60" y="60" width="960" height="1320" rx="${style.borderRadius}"
        fill="${style.card}" filter="url(#shadow-${index})"
        stroke="${style.border}" stroke-width="1"/>

  <!-- 装饰元素 -->
  ${this.buildDecorations(style, 'viewpoint')}

  <!-- 序号标识 -->
  <circle cx="140" cy="150" r="40" fill="${style.accent}" fill-opacity="0.15"/>
  <text x="140" y="162" fill="${style.accent}" font-size="36"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${item.pointIndex + 1}</text>

  <!-- 观点标签 -->
  <text x="200" y="160" fill="${style.accent}" font-size="${style.captionSize}"
        font-family="${style.decorativeFont}" letter-spacing="3">观点 ${item.pointIndex + 1}</text>

  <!-- 主标题 -->
  <text x="120" y="${titleY}" fill="${style.textPrimary}" font-size="${style.subtitleSize}"
        font-family="${style.titleFont}" font-weight="600">
    ${titleLines.map((line, i) => `<tspan x="120" dy="${i === 0 ? 0 : titleLineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
  </text>

  <!-- 论据区域 -->
  <rect x="120" y="480" width="840" height="400" rx="${Math.max(style.borderRadius - 4, 4)}"
        fill="${this.hexToRgba(style.textSecondary, 0.05)}"/>

  <text x="160" y="540" fill="${style.textSecondary}" font-size="${style.captionSize}"
        font-family="${style.decorativeFont}" letter-spacing="2">论据</text>

	  <!-- 论据文字 -->
	  <text x="160" y="${argumentY}" fill="${style.textPrimary}" font-size="${argumentFontSize}"
	        font-family="${style.bodyFont}">
	    ${argumentLines.map((line, i) => `<tspan x="160" dy="${i === 0 ? 0 : argumentLineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
	  </text>

	  <!-- 结论区域 -->
	  <rect x="120" y="900" width="840" height="260" rx="${Math.max(style.borderRadius - 4, 4)}"
	        fill="${this.hexToRgba(style.accent, 0.1)}" stroke="${style.accent}" stroke-width="1" stroke-dasharray="4,2"/>

	  <text x="160" y="960" fill="${style.accent}" font-size="${style.captionSize}"
	        font-family="${style.decorativeFont}" letter-spacing="2">结论</text>

	  <!-- 结论文字 -->
	  <text x="540" y="${conclusionY}" fill="${style.textPrimary}" font-size="${conclusionFontSize}"
	        font-family="${style.titleFont}" font-weight="500" text-anchor="middle">
	    ${conclusionLines.map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : conclusionLineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
	  </text>

  <!-- 页码 -->
  ${this.buildPageNumber(style, index, total)}
</svg>`;
	}

	/**
	 * 论据卡片 - 复用观点卡片布局
	 */
	private buildArgumentCard(params: {
		style: VisualStyle;
		content: XiaohongshuContentStructure;
		item: ImagePlanItem;
		index: number;
		total: number;
	}): string {
		return this.buildViewpointCard(params);
	}

	/**
	 * 结论卡片 - 强调金句
	 */
	private buildConclusionCard(params: {
		style: VisualStyle;
		content: XiaohongshuContentStructure;
		item: ImagePlanItem;
		index: number;
		total: number;
	}): string {
		const { style, content, item, index, total } = params;
		const point = content.subPoints[item.pointIndex] || content.subPoints[0];

		if (!point) {
			throw new Error(`结论索引越界: ${item.pointIndex}`);
		}

		const pointConclusion = item.conclusionOverride || point.conclusion;
		const conclusionLines = this.wrapTextLines(pointConclusion, 10, 4);
		const conclusionY = 600;
		const conclusionLineHeight = style.subtitleSize * 1.8;

		return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1440" viewBox="0 0 1080 1440" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${this.buildDefs(style, index)}
  </defs>

  <!-- 背景 -->
  ${this.buildBackground(style, index)}

  <!-- 主卡片 -->
  <rect x="60" y="60" width="960" height="1320" rx="${style.borderRadius}"
        fill="${style.card}" filter="url(#shadow-${index})"
        stroke="${style.border}" stroke-width="1"/>

  <!-- 大引号装饰 -->
  <text x="120" y="280" fill="${this.hexToRgba(style.accent, 0.3)}" font-size="200"
        font-family="${style.decorativeFont}">"</text>
  <text x="920" y="1200" fill="${this.hexToRgba(style.accent, 0.3)}" font-size="200"
        font-family="${style.decorativeFont}" text-anchor="end">"</text>

  <!-- 结论文字 -->
  <text x="540" y="${conclusionY}" fill="${style.textPrimary}" font-size="${style.subtitleSize}"
        font-family="${style.titleFont}" font-weight="600" text-anchor="middle">
    ${conclusionLines.map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : conclusionLineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
  </text>

  <!-- 相关观点 -->
  <text x="540" y="1100" fill="${style.textSecondary}" font-size="${style.captionSize}"
        font-family="${style.bodyFont}" text-anchor="middle">—— ${this.escapeXml(point.title)}</text>

  <!-- 页码 -->
  ${this.buildPageNumber(style, index, total)}
</svg>`;
	}

	/**
	 * 构建SVG定义
	 */
	private buildDefs(style: VisualStyle, index: number): string {
		return `
    <!-- 阴影滤镜 -->
    <filter id="shadow-${index}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity="0.12"/>
    </filter>

    <!-- 纹理图案 -->
    ${style.hasTexture ? `
    <pattern id="texture-${index}" patternUnits="userSpaceOnUse" width="100" height="100">
      <rect width="100" height="100" fill="${style.background}"/>
      <circle cx="25" cy="25" r="1" fill="${this.hexToRgba(style.textSecondary, 0.1)}"/>
      <circle cx="75" cy="75" r="1" fill="${this.hexToRgba(style.textSecondary, 0.1)}"/>
      <circle cx="50" cy="0" r="0.5" fill="${this.hexToRgba(style.textSecondary, 0.05)}"/>
      <circle cx="0" cy="50" r="0.5" fill="${this.hexToRgba(style.textSecondary, 0.05)}"/>
    </pattern>` : ''}
    `;
	}

	private buildBackground(style: VisualStyle, index: number): string {
		if (style.hasTexture) {
			return `<rect width="1080" height="1440" fill="url(#texture-${index})"/>`;
		}
		return `<rect width="1080" height="1440" fill="${style.background}"/>`;
	}

	private buildDecorations(style: VisualStyle, type: string): string {
		const decorations: string[] = [];

		if (style.quoteStyle === 'chinese' && type === 'cover') {
			decorations.push(`
  <!-- 中式装饰角 -->
  <path d="M60 120 Q60 60 120 60" stroke="${style.accent}" stroke-width="2" fill="none" opacity="0.5"/>
  <path d="M960 60 Q1020 60 1020 120" stroke="${style.accent}" stroke-width="2" fill="none" opacity="0.5"/>
  <path d="M1020 1320 Q1020 1380 960 1380" stroke="${style.accent}" stroke-width="2" fill="none" opacity="0.5"/>
  <path d="M120 1380 Q60 1380 60 1320" stroke="${style.accent}" stroke-width="2" fill="none" opacity="0.5"/>
`);
		} else if (style.quoteStyle === 'line' && type === 'cover') {
			decorations.push(`
  <!-- 线条装饰 -->
  <line x1="120" y1="1320" x2="960" y2="1320" stroke="${style.accent}" stroke-width="1" opacity="0.3"/>
`);
		}

		if (type === 'cover') {
			decorations.push(`
  <!-- 印章装饰 -->
  <rect x="900" y="1180" width="80" height="80" rx="4" fill="${this.hexToRgba(style.accent, 0.15)}" stroke="${style.accent}" stroke-width="2"/>
  <text x="940" y="1230" fill="${style.accent}" font-size="28"
        font-family="${style.decorativeFont}" text-anchor="middle">精选</text>
`);
		}

		return decorations.join('\n');
	}

	private buildPageNumber(style: VisualStyle, index: number, total: number): string {
		return `
  <!-- 页码 -->
  <text x="960" y="1380" fill="${style.textSecondary}" font-size="24"
        font-family="${style.decorativeFont}" text-anchor="end">${index + 1} / ${total}</text>
`;
	}

	private getCardCaption(item: ImagePlanItem, content: XiaohongshuContentStructure): string {
		switch (item.type) {
			case 'cover':
				return content.title;
			case 'viewpoint':
			case 'argument':
			case 'conclusion':
				return item.titleOverride || content.subPoints[item.pointIndex]?.title || content.coreViewpoint;
			default:
				return content.title;
		}
	}

	private expandImagePlan(imagePlan: ImagePlanItem[], content: XiaohongshuContentStructure): ImagePlanItem[] {
		const expanded: ImagePlanItem[] = [];
		const source = imagePlan.length > 0 ? imagePlan : this.buildFallbackPlan(content.subPoints.length);

		for (const item of source) {
			if (item.type === 'viewpoint' || item.type === 'argument' || item.type === 'conclusion') {
				expanded.push(...this.expandPointItem(item, content));
				continue;
			}

			expanded.push(item);
		}

		return expanded.map((item, index) => ({ ...item, slot: `card_${index + 1}` }));
	}

	private expandPointItem(item: ImagePlanItem, content: XiaohongshuContentStructure): ImagePlanItem[] {
		const point = content.subPoints[item.pointIndex];
		if (!point) {
			return [];
		}

		const argumentSegments = this.splitByVisualCapacity(point.argument, 760, 250, 18, 1.02);
		const conclusionSegments = this.splitByVisualCapacity(point.conclusion, 720, 145, 20, 1.05);
		const segmentTotal = Math.max(argumentSegments.length, conclusionSegments.length, 1);
		const results: ImagePlanItem[] = [];

		for (let i = 0; i < segmentTotal; i++) {
			results.push({
				...item,
				titleOverride: segmentTotal > 1 ? `${point.title}（${i + 1}/${segmentTotal}）` : point.title,
				argumentOverride: argumentSegments[i] || argumentSegments[argumentSegments.length - 1] || point.argument,
				conclusionOverride: conclusionSegments[i] || conclusionSegments[conclusionSegments.length - 1] || point.conclusion,
				segmentIndex: i + 1,
				segmentTotal
			});
		}

		return results;
	}

	private buildFallbackPlan(subPointsCount: number): ImagePlanItem[] {
		const plan: ImagePlanItem[] = [{ slot: 'card_1', type: 'cover', pointIndex: -1 }];
		for (let i = 0; i < subPointsCount; i++) {
			plan.push({ slot: `card_${plan.length + 1}`, type: 'viewpoint', pointIndex: i });
		}
		return plan;
	}

	private splitByVisualCapacity(
		text: string,
		textWidth: number,
		textHeight: number,
		minFontSize: number,
		charWidthFactor: number
	): string[] {
		const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
		if (!normalized) {
			return [''];
		}

		const fontSize = minFontSize;
		const lineHeight = fontSize * 1.45;
		const linesPerPage = Math.max(Math.floor((textHeight - fontSize) / lineHeight) + 1, 2);
		const maxChars = this.estimateCharsPerLine(textWidth, fontSize, charWidthFactor);
		const lines = this.wrapTextLines(normalized, maxChars, 0);
		if (lines.length <= linesPerPage) {
			return [normalized];
		}

		const segments: string[] = [];
		for (let i = 0; i < lines.length; i += linesPerPage) {
			segments.push(lines.slice(i, i + linesPerPage).join(''));
		}
		return segments;
	}

	private async collectAttachmentImages(sourceFile: TFile): Promise<Array<{ name: string; absolutePath: string }>> {
		const content = await this.app.vault.read(sourceFile);
		const matches = Array.from(content.matchAll(/!\[.*?\]\(([^)]+)\)|!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g));
		const paths = matches
			.map(match => (match[1] || match[2] || '').trim())
			.filter(Boolean)
			.filter(item => !item.startsWith('http://') && !item.startsWith('https://'));

		const unique = Array.from(new Set(paths));
		const list: Array<{ name: string; absolutePath: string }> = [];

		for (const rel of unique) {
			const cleaned = rel.split('|')[0].trim();
			const abs = this.resolveVaultPath(sourceFile.path, cleaned);
			if (!abs) {
				continue;
			}
			list.push({ name: path.basename(cleaned), absolutePath: abs });
		}

		return list;
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
			const stat = require('fs').statSync(filePath);
			return !!stat && stat.isFile();
		} catch (_error) {
			return false;
		}
	}

	private pickAttachmentPath(
		hint: string | undefined,
		attachments: Array<{ name: string; absolutePath: string }>,
		index: number
	): string | null {
		if (attachments.length === 0) {
			return null;
		}

		if (hint) {
			const matched = attachments.find(item => item.name.includes(hint) || hint.includes(item.name));
			if (matched) {
				return matched.absolutePath;
			}
		}

		return attachments[index % attachments.length].absolutePath;
	}

	private escapeXml(value: string): string {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	/**
	 * 文本换行：按字符数分割并修复行首标点，不做省略号截断
	 */
	private wrapTextLines(text: string, maxChars: number, maxLines = 0): string[] {
		const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/[\t ]+/g, ' ').trim();
		if (!normalized) {
			return [''];
		}

		const result: string[] = [];
		let current = '';

		for (const char of normalized) {
			if (char === '\n') {
				if (current) {
					result.push(current.trim());
					current = '';
				}
				continue;
			}

			if (current.length >= maxChars) {
				result.push(current.trim());
				current = '';
			}
			current += char;
		}

		if (current) {
			result.push(current.trim());
		}

		const mergedPunctuation = this.mergeLeadingPunctuation(result.filter(Boolean), maxChars);
		if (maxLines <= 0 || mergedPunctuation.length <= maxLines) {
			return mergedPunctuation.length > 0 ? mergedPunctuation : [''];
		}

		// 业务要求：图文内容不能出现省略号，优先完整表达观点
		return mergedPunctuation;
	}

	private mergeLeadingPunctuation(lines: string[], maxChars: number): string[] {
		if (lines.length <= 1) {
			return lines;
		}

		const output = [...lines];
		const punctuations = new Set(['，', '。', '、', '！', '？', '；', '：', ')', '）', ']', '】', '”', '’', ',', '.', '!', '?', ';', ':']);

		for (let i = 1; i < output.length; i++) {
			const current = output[i];
			if (!current) {
				continue;
			}

			const head = current[0];
			if (!punctuations.has(head)) {
				continue;
			}

			if (output[i - 1].length >= maxChars) {
				continue;
			}

			output[i - 1] += head;
			output[i] = current.slice(1).trimStart();
		}

		return output.filter(Boolean);
	}

	/**
	 * 按文本区域宽度估算每行可承载字符数
	 */
	private estimateCharsPerLine(textWidth: number, fontSize: number, charWidthFactor = 1): number {
		const estimatedCharWidth = Math.max(fontSize * charWidthFactor, 1);
		return Math.max(Math.floor(textWidth / estimatedCharWidth), 8);
	}

	/**
	 * 在指定区域内自适应文字大小，优先完整展示文本
	 */
	private fitTextToArea(params: {
		text: string;
		textWidth: number;
		textHeight: number;
		initialFontSize: number;
		minFontSize: number;
		charWidthFactor: number;
	}): { lines: string[]; fontSize: number; lineHeight: number } {
		const {
			text,
			textWidth,
			textHeight,
			initialFontSize,
			minFontSize,
			charWidthFactor
		} = params;

		for (let fontSize = initialFontSize; fontSize >= minFontSize; fontSize -= 1) {
			const lineHeight = fontSize * 1.45;
			const maxChars = this.estimateCharsPerLine(textWidth, fontSize, charWidthFactor);
			const lines = this.wrapTextLines(text, maxChars, 0);
			const blockHeight = fontSize + Math.max(lines.length - 1, 0) * lineHeight;
			if (blockHeight <= textHeight) {
				return { lines, fontSize, lineHeight };
			}
		}

		const minLineHeight = minFontSize * 1.45;
		const minChars = this.estimateCharsPerLine(textWidth, minFontSize, charWidthFactor);
		return {
			lines: this.wrapTextLines(text, minChars, 0),
			fontSize: minFontSize,
			lineHeight: minLineHeight
		};
	}

	private hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
}
