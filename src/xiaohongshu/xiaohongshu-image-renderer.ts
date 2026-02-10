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
				case 'recap':
					return this.buildRecapCard(params);
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

		const pointTitle = item.titleOverride !== undefined ? item.titleOverride : point.title;
		const pointArgument = item.argumentOverride !== undefined ? item.argumentOverride : point.argument;
		const pointConclusion = item.conclusionOverride !== undefined ? item.conclusionOverride : point.conclusion;

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

		const pointConclusion = item.conclusionOverride !== undefined ? item.conclusionOverride : point.conclusion;
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
	 * 核心观点汇总卡片 - 重新设计的视觉层次布局
	 */
	private buildRecapCard(params: {
		style: VisualStyle;
		content: XiaohongshuContentStructure;
		index: number;
		total: number;
	}): string {
		const { style, content, index, total } = params;
		const recapPoints = this.deduplicatePoints(content.subPoints);
		const recapConfig = this.getRecapConfig(style, recapPoints.length);

		// 构建汇总项 - 每行一个观点，包含序号、标题、金句
		const itemsY = 320;
		const itemHeight = recapConfig.itemHeight;
		const itemSpacing = recapConfig.itemSpacing;

		const itemSvgs: string[] = [];
		for (let i = 0; i < recapPoints.length; i++) {
			const y = itemsY + i * (itemHeight + itemSpacing);
			itemSvgs.push(this.buildRecapItem({
				style,
				point: recapPoints[i],
				index: i,
				y,
				config: recapConfig
			}));
		}

		return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1440" viewBox="0 0 1080 1440" xmlns="http://www.w3.org/2000/svg">
  <defs>
    ${this.buildDefs(style, index)}
    ${this.buildRecapGradient(style, index)}
  </defs>

  <!-- 背景 -->
  ${this.buildBackground(style, index)}

  <!-- 主卡片 -->
  <rect x="60" y="60" width="960" height="1320" rx="${style.borderRadius}"
        fill="${style.card}" filter="url(#shadow-${index})"
        stroke="${style.border}" stroke-width="1"/>

  <!-- 汇总头部 - 新的视觉设计 -->
  ${this.buildRecapHeader(style, content, recapConfig)}

  <!-- 观点列表 -->
  ${itemSvgs.join('\n')}

  <!-- 底部装饰线 -->
  <line x1="120" y1="1260" x2="960" y2="1260" stroke="${style.border}" stroke-width="1" opacity="0.5"/>
  <text x="540" y="1300" fill="${style.textSecondary}" font-size="22"
        font-family="${style.decorativeFont}" text-anchor="middle" letter-spacing="3">
    ${content.hashtags.slice(0, 4).join(' · ')}
  </text>

  <!-- 页码 -->
  ${this.buildPageNumber(style, index, total)}
</svg>`;
	}

	/**
	 * 构建汇总卡片头部
	 */
	private buildRecapHeader(style: VisualStyle, content: XiaohongshuContentStructure, config: ReturnType<typeof XiaohongshuImageRenderer.prototype.getRecapConfig>): string {
		const headerHeight = 200;
		const accentBar = `
  <!-- 左侧装饰条 -->
  <rect x="60" y="60" width="8" height="${headerHeight}" rx="4" fill="${style.accent}"/>`;

		return `${accentBar}

  <!-- 主标题区 -->
  <text x="120" y="140" fill="${style.accent}" font-size="${style.captionSize}"
        font-family="${style.decorativeFont}" letter-spacing="3">${this.escapeXml(config.headerTag)}</text>
  <text x="120" y="195" fill="${style.textPrimary}" font-size="${Math.max(style.subtitleSize, 40)}"
        font-family="${style.titleFont}" font-weight="600">核心观点</text>

  <!-- 核心金句区 -->
  <rect x="450" y="85" width="510" height="145" rx="${style.borderRadius - 2}"
        fill="${this.hexToRgba(style.accent, config.headerFillOpacity)}" stroke="${style.accent}" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="480" y="130" fill="${style.accent}" font-size="22"
        font-family="${style.decorativeFont}">核心洞察</text>
  <text x="480" y="175" fill="${style.textPrimary}" font-size="26"
        font-family="${style.bodyFont}" font-style="italic">${this.escapeXml(content.coreViewpoint.slice(0, 40))}${content.coreViewpoint.length > 40 ? '...' : ''}</text>`;
	}

	/**
	 * 构建单个汇总项 - 两行布局避免重叠
	 */
	private buildRecapItem(params: {
		style: VisualStyle;
		point: { title: string; argument: string; conclusion: string };
		index: number;
		y: number;
		config: ReturnType<typeof XiaohongshuImageRenderer.prototype.getRecapConfig>;
	}): string {
		const { style, point, index, y, config } = params;
		const num = index + 1;

		// 序号样式
		const numX = 140;
		const numY = y + config.itemHeight / 2;
		const contentX = 200;
		const contentWidth = 740;

		// 处理标题和金句
		const titleText = point.title.trim();
		const conclusionText = point.conclusion.trim();

		// 分区高度：上半区标题，下半区金句
		const titleAreaTop = y + 6;
		const titleAreaHeight = Math.floor(config.itemHeight / 2) - 2;
		const conclusionAreaTop = y + Math.floor(config.itemHeight / 2) + 2;
		const conclusionAreaHeight = config.itemHeight - (conclusionAreaTop - y) - 4;

		// 标题自适应（第一行）
		const titleLayout = this.fitTextToArea({
			text: titleText,
			textWidth: contentWidth - 60,
			textHeight: titleAreaHeight,
			initialFontSize: Math.max(style.bodySize - 2, 24),
			minFontSize: 20,
			charWidthFactor: 1.05
		});

		// 金句自适应（第二行，缩进）
		const conclusionLayout = this.fitTextToArea({
			text: conclusionText,
			textWidth: contentWidth - 110,
			textHeight: conclusionAreaHeight,
			initialFontSize: Math.max(style.bodySize - 4, 22),
			minFontSize: Math.max(config.minFontSize - 1, 16),
			charWidthFactor: Math.max(config.charWidthFactor, 1.18)
		});

		// 根据风格选择不同的序号样式
		const numBadge = this.buildNumBadge(style, num, numX, numY, config);

		// 计算垂直位置（按文本块高度居中，避免换行时下溢）
		const titleBlockHeight = titleLayout.fontSize + Math.max(titleLayout.lines.length - 1, 0) * titleLayout.lineHeight;
		const conclusionBlockHeight = conclusionLayout.fontSize + Math.max(conclusionLayout.lines.length - 1, 0) * conclusionLayout.lineHeight;
		const titleY = Math.round(
			titleAreaTop
			+ Math.max((titleAreaHeight - titleBlockHeight) / 2, 0)
			+ titleLayout.fontSize
		);
		const conclusionY = Math.round(
			conclusionAreaTop
			+ Math.max((conclusionAreaHeight - conclusionBlockHeight) / 2, 0)
			+ conclusionLayout.fontSize
		);

		return `
  <!-- 背景条 - 斑马纹效果 -->
  <rect x="120" y="${y}" width="840" height="${config.itemHeight}" rx="${config.itemRadius}"
        fill="${index % 2 === 0 ? this.hexToRgba(style.accent, config.itemFillOpacity) : this.hexToRgba(style.accent, config.itemFillOpacity * 0.5)}"
        ${config.itemStrokeDash ? `stroke="${style.border}" stroke-width="1" stroke-dasharray="${config.itemStrokeDash}"` : ''}/>

  ${numBadge}

  <!-- 标题 - 第一行 -->
  <text x="${contentX}" y="${titleY}" fill="${style.textPrimary}" font-size="${titleLayout.fontSize}"
        font-family="${style.titleFont}" font-weight="600">
    ${titleLayout.lines.map((line, i) => `<tspan x="${contentX}" dy="${i === 0 ? 0 : titleLayout.lineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
  </text>

  <!-- 金句 - 第二行，缩进 -->
  <text x="${contentX + 24}" y="${conclusionY}" fill="${style.accent}" font-size="${conclusionLayout.fontSize}"
        font-family="${style.bodyFont}" font-style="italic">
    ${conclusionLayout.lines.map((line, i) => `<tspan x="${contentX + 24}" dy="${i === 0 ? 0 : conclusionLayout.lineHeight}">${this.escapeXml(line)}</tspan>`).join('\n    ')}
  </text>`;
	}

	/**
	 * 构建序号徽章 - 根据风格变化
	 */
	private buildNumBadge(style: VisualStyle, num: number, x: number, y: number, config: ReturnType<typeof XiaohongshuImageRenderer.prototype.getRecapConfig>): string {
		switch (style.layout) {
			case 'ink_handwriting':
				return `
  <!-- 中式印章风格 -->
  <rect x="${x - 25}" y="${y - 28}" width="50" height="50" rx="4" fill="${this.hexToRgba(style.accent, 0.15)}" stroke="${style.accent}" stroke-width="2"/>
  <text x="${x}" y="${y + 5}" fill="${style.accent}" font-size="28"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${num}</text>`;

			case 'vintage_journal':
				return `
  <!-- 复古标签风格 -->
  <polygon points="${x - 22},${y - 25} ${x + 22},${y - 25} ${x + 22},${y + 15} ${x},${y + 25} ${x - 22},${y + 15}" fill="${style.accent}" fill-opacity="0.85"/>
  <text x="${x}" y="${y + 2}" fill="${style.card}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${num}</text>`;

			case 'zen_garden':
				return `
  <!-- 禅意圆形 -->
  <circle cx="${x}" cy="${y}" r="28" fill="none" stroke="${style.accent}" stroke-width="2"/>
  <circle cx="${x}" cy="${y}" r="20" fill="${this.hexToRgba(style.accent, 0.1)}"/>
  <text x="${x}" y="${y + 7}" fill="${style.accent}" font-size="24"
        font-family="${style.decorativeFont}" font-weight="500" text-anchor="middle">${num}</text>`;

			case 'night_reading':
				return `
  <!-- 夜间发光效果 -->
  <circle cx="${x}" cy="${y}" r="26" fill="${this.hexToRgba(style.accent, 0.2)}" stroke="${style.accent}" stroke-width="1.5"/>
  <text x="${x}" y="${y + 7}" fill="${style.accent}" font-size="24"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			// ========== 现代多样化系列 ==========
			case 'tech_minimal':
				return `
  <!-- 科技极简 - 六边形 -->
  <polygon points="${x},${y - 28} ${x + 24},${y - 14} ${x + 24},${y + 14} ${x},${y + 28} ${x - 24},${y + 14} ${x - 24},${y - 14}" fill="${style.accent}"/>
  <text x="${x}" y="${y + 6}" fill="${style.card}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			case 'nordic_fresh':
				return `
  <!-- 北欧清新 - 叶子形状 -->
  <ellipse cx="${x}" cy="${y}" rx="28" ry="22" fill="${this.hexToRgba(style.accent, 0.15)}" stroke="${style.accent}" stroke-width="2"/>
  <line x1="${x}" y1="${y - 22}" x2="${x}" y2="${y + 22}" stroke="${style.accent}" stroke-width="1"/>
  <text x="${x}" y="${y + 6}" fill="${style.accent}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			case 'vibrant_coral':
				return `
  <!-- 活力渐变 - 圆角矩形带阴影 -->
  <rect x="${x - 26}" y="${y - 26}" width="52" height="52" rx="16" fill="${style.accent}"/>
  <circle cx="${x + 12}" cy="${y - 12}" r="6" fill="${this.hexToRgba('#FFFFFF', 0.3)}"/>
  <text x="${x}" y="${y + 7}" fill="${style.card}" font-size="24"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${num}</text>`;

			case 'premium_business':
				return `
  <!-- 高端商务 - 金色边框 -->
  <rect x="${x - 24}" y="${y - 24}" width="48" height="48" rx="4" fill="none" stroke="${style.accent}" stroke-width="2"/>
  <rect x="${x - 18}" y="${y - 18}" width="36" height="36" rx="2" fill="${this.hexToRgba(style.accent, 0.12)}"/>
  <text x="${x}" y="${y + 6}" fill="${style.accent}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			case 'nature_wellness':
				return `
  <!-- 清新自然 - 水滴形状 -->
  <circle cx="${x}" cy="${y - 4}" r="26" fill="${this.hexToRgba(style.accent, 0.15)}" stroke="${style.accent}" stroke-width="2"/>
  <circle cx="${x - 8}" cy="${y - 12}" r="4" fill="${this.hexToRgba(style.accent, 0.3)}"/>
  <text x="${x}" y="${y + 5}" fill="${style.accent}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			// ========== 艺术风格系列 ==========
			case 'morandi_gray':
				return `
  <!-- 莫兰迪 - 柔和椭圆 -->
  <ellipse cx="${x}" cy="${y}" rx="30" ry="24" fill="${this.hexToRgba(style.accent, 0.12)}" stroke="${style.accent}" stroke-width="1.5"/>
  <text x="${x}" y="${y + 6}" fill="${style.accent}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="500" text-anchor="middle">${num}</text>`;

			case 'japanese_magazine':
				return `
  <!-- 日系杂志 - 日式图案 -->
  <rect x="${x - 26}" y="${y - 20}" width="52" height="40" fill="${style.accent}"/>
  <circle cx="${x}" cy="${y + 24}" r="8" fill="${this.hexToRgba(style.accent, 0.5)}"/>
  <text x="${x}" y="${y + 6}" fill="${style.card}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			case 'industrial_modern':
				return `
  <!-- 工业风 - 金属质感 -->
  <rect x="${x - 24}" y="${y - 24}" width="48" height="48" fill="${this.hexToRgba(style.accent, 0.2)}" stroke="${style.accent}" stroke-width="3"/>
  <line x1="${x - 24}" y1="${y + 8}" x2="${x + 24}" y2="${y + 8}" stroke="${style.accent}" stroke-width="1"/>
  <text x="${x}" y="${y - 2}" fill="${style.accent}" font-size="20"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${num}</text>`;

			case 'watercolor_art':
				return `
  <!-- 水彩 - 晕染效果 -->
  <circle cx="${x}" cy="${y}" r="28" fill="${this.hexToRgba(style.accent, 0.2)}"/>
  <circle cx="${x - 6}" cy="${y - 6}" r="18" fill="${this.hexToRgba(style.accent, 0.15)}"/>
  <text x="${x}" y="${y + 7}" fill="${style.accent}" font-size="24"
        font-family="${style.decorativeFont}" font-weight="500" text-anchor="middle">${num}</text>`;

			// ========== 技术风格系列 ==========
			case 'terminal_cli':
				return `
  <!-- 终端 - 方括号样式 -->
  <text x="${x - 20}" y="${y + 10}" fill="${style.accent}" font-size="36"
        font-family="${style.decorativeFont}" font-weight="400">[</text>
  <text x="${x + 20}" y="${y + 10}" fill="${style.accent}" font-size="36"
        font-family="${style.decorativeFont}" font-weight="400">]</text>
  <text x="${x}" y="${y + 5}" fill="${style.accent}" font-size="26"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${num}</text>`;

			case 'github_opensource':
				return `
  <!-- GitHub - 徽章样式 -->
  <rect x="${x - 28}" y="${y - 16}" width="56" height="32" rx="16" fill="${style.accent}"/>
  <text x="${x}" y="${y + 5}" fill="${style.card}" font-size="20"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			case 'linear_saas':
				return `
  <!-- Linear - 极简圆角 -->
  <rect x="${x - 22}" y="${y - 22}" width="44" height="44" rx="12" fill="${style.accent}" opacity="0.9"/>
  <text x="${x}" y="${y + 6}" fill="${style.card}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="600" text-anchor="middle">${num}</text>`;

			case 'notion_docs':
				return `
  <!-- Notion - 文档图标样式 -->
  <rect x="${x - 20}" y="${y - 26}" width="40" height="52" rx="4" fill="${this.hexToRgba(style.accent, 0.1)}" stroke="${style.accent}" stroke-width="2"/>
  <line x1="${x - 12}" y1="${y - 10}" x2="${x + 12}" y2="${y - 10}" stroke="${style.accent}" stroke-width="2"/>
  <line x1="${x - 12}" y1="${y + 2}" x2="${x + 8}" y2="${y + 2}" stroke="${style.accent}" stroke-width="2"/>
  <text x="${x}" y="${y + 22}" fill="${style.accent}" font-size="14"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${num}</text>`;

			case 'vscode_editor':
				return `
  <!-- VS Code - 代码行号样式 -->
  <rect x="${x - 28}" y="${y - 18}" width="56" height="36" rx="4" fill="${this.hexToRgba(style.accent, 0.15)}"/>
  <text x="${x}" y="${y + 6}" fill="${style.accent}" font-size="22"
        font-family="${style.decorativeFont}" font-weight="500" text-anchor="middle">${num}</text>`;

			default:
				return `
  <!-- 现代简约徽章 -->
  <rect x="${x - 24}" y="${y - 24}" width="48" height="48" rx="${config.itemRadius}" fill="${style.accent}"/>
  <text x="${x}" y="${y + 7}" fill="${style.card}" font-size="24"
        font-family="${style.decorativeFont}" font-weight="700" text-anchor="middle">${num}</text>`;
		}
	}

	/**
	 * 构建汇总卡片渐变定义
	 */
	private buildRecapGradient(style: VisualStyle, index: number): string {
		return `
    <!-- 汇总卡片渐变 -->
    <linearGradient id="recap-gradient-${index}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${style.accent}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${style.accent}" stop-opacity="0.05"/>
    </linearGradient>`;
	}

	/**
	 * 获取汇总卡片配置 - 适配新的横向列表布局
	 */
	private getRecapConfig(style: VisualStyle, pointCount: number): {
		headerTag: string;
		headerFillOpacity: number;
		itemFillOpacity: number;
		itemRadius: number;
		itemStrokeDash?: string;
		itemHeight: number;
		itemSpacing: number;
		minFontSize: number;
		charWidthFactor: number;
	} {
		// 根据观点数量动态调整行高
		const baseHeight = pointCount <= 3 ? 100 : pointCount <= 5 ? 85 : 70;
		const baseSpacing = pointCount <= 3 ? 20 : pointCount <= 5 ? 14 : 10;

		switch (style.layout) {
			case 'ink_handwriting':
				return {
					headerTag: '墨韵总览',
					headerFillOpacity: 0.12,
					itemFillOpacity: 0.06,
					itemRadius: 8,
					itemStrokeDash: '4,2',
					itemHeight: baseHeight + 10,
					itemSpacing: baseSpacing,
					minFontSize: 18,
					charWidthFactor: 1.05
				};
			case 'vintage_journal':
				return {
					headerTag: '手记索引',
					headerFillOpacity: 0.15,
					itemFillOpacity: 0.08,
					itemRadius: 6,
					itemStrokeDash: '3,2',
					itemHeight: baseHeight + 5,
					itemSpacing: baseSpacing,
					minFontSize: 18,
					charWidthFactor: 1.04
				};
			case 'minimal_paper':
				return {
					headerTag: '重点清单',
					headerFillOpacity: 0.08,
					itemFillOpacity: 0.04,
					itemRadius: 12,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 0.98
				};
			case 'warm_notebook':
				return {
					headerTag: '行动重点',
					headerFillOpacity: 0.15,
					itemFillOpacity: 0.08,
					itemRadius: 14,
					itemHeight: baseHeight + 8,
					itemSpacing: baseSpacing + 4,
					minFontSize: 17,
					charWidthFactor: 1.02
				};
			case 'zen_garden':
				return {
					headerTag: '禅意提纲',
					headerFillOpacity: 0.12,
					itemFillOpacity: 0.06,
					itemRadius: 10,
					itemStrokeDash: '2,3',
					itemHeight: baseHeight + 5,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 1.03
				};
			case 'night_reading':
				return {
					headerTag: '夜读摘要',
					headerFillOpacity: 0.2,
					itemFillOpacity: 0.12,
					itemRadius: 12,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 1.0
				};
			case 'coffee_shop':
				return {
					headerTag: '咖啡笔记',
					headerFillOpacity: 0.15,
					itemFillOpacity: 0.08,
					itemRadius: 10,
					itemHeight: baseHeight + 5,
					itemSpacing: baseSpacing + 2,
					minFontSize: 17,
					charWidthFactor: 1.02
				};

			// ========== 现代多样化系列 ==========
			case 'tech_minimal':
				return {
					headerTag: '技术要点',
					headerFillOpacity: 0.1,
					itemFillOpacity: 0.05,
					itemRadius: 6,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 0.98
				};
			case 'nordic_fresh':
				return {
					headerTag: '自然清单',
					headerFillOpacity: 0.12,
					itemFillOpacity: 0.06,
					itemRadius: 14,
					itemHeight: baseHeight + 5,
					itemSpacing: baseSpacing + 2,
					minFontSize: 17,
					charWidthFactor: 1.02
				};
			case 'vibrant_coral':
				return {
					headerTag: '活力清单',
					headerFillOpacity: 0.15,
					itemFillOpacity: 0.08,
					itemRadius: 16,
					itemHeight: baseHeight + 8,
					itemSpacing: baseSpacing + 4,
					minFontSize: 17,
					charWidthFactor: 1.02
				};
			case 'premium_business':
				return {
					headerTag: '核心摘要',
					headerFillOpacity: 0.18,
					itemFillOpacity: 0.1,
					itemRadius: 4,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 0.98
				};
			case 'nature_wellness':
				return {
					headerTag: '疗愈清单',
					headerFillOpacity: 0.14,
					itemFillOpacity: 0.07,
					itemRadius: 14,
					itemHeight: baseHeight + 5,
					itemSpacing: baseSpacing + 2,
					minFontSize: 17,
					charWidthFactor: 1.02
				};

			// ========== 艺术风格系列 ==========
			case 'morandi_gray':
				return {
					headerTag: '雅致清单',
					headerFillOpacity: 0.12,
					itemFillOpacity: 0.06,
					itemRadius: 8,
					itemStrokeDash: '4,3',
					itemHeight: baseHeight + 3,
					itemSpacing: baseSpacing + 1,
					minFontSize: 17,
					charWidthFactor: 1.01
				};
			case 'japanese_magazine':
				return {
					headerTag: '日杂清单',
					headerFillOpacity: 0.1,
					itemFillOpacity: 0.05,
					itemRadius: 0,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 1.0
				};
			case 'industrial_modern':
				return {
					headerTag: '硬核要点',
					headerFillOpacity: 0.15,
					itemFillOpacity: 0.08,
					itemRadius: 0,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 0.98
				};
			case 'watercolor_art':
				return {
					headerTag: '水彩提纲',
					headerFillOpacity: 0.14,
					itemFillOpacity: 0.07,
					itemRadius: 18,
					itemHeight: baseHeight + 8,
					itemSpacing: baseSpacing + 3,
					minFontSize: 17,
					charWidthFactor: 1.03
				};

			// ========== 技术风格系列 ==========
			case 'terminal_cli':
				return {
					headerTag: '$ summary',
					headerFillOpacity: 0.12,
					itemFillOpacity: 0.06,
					itemRadius: 4,
					itemStrokeDash: '2,2',
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 16,
					charWidthFactor: 0.95
				};
			case 'github_opensource':
				return {
					headerTag: 'README',
					headerFillOpacity: 0.1,
					itemFillOpacity: 0.05,
					itemRadius: 6,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 0.98
				};
			case 'linear_saas':
				return {
					headerTag: 'Summary',
					headerFillOpacity: 0.15,
					itemFillOpacity: 0.08,
					itemRadius: 10,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 0.98
				};
			case 'notion_docs':
				return {
					headerTag: '要点汇总',
					headerFillOpacity: 0.1,
					itemFillOpacity: 0.05,
					itemRadius: 4,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 1.0
				};
			case 'vscode_editor':
				return {
					headerTag: '// TODO',
					headerFillOpacity: 0.12,
					itemFillOpacity: 0.06,
					itemRadius: 4,
					itemStrokeDash: '3,2',
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 16,
					charWidthFactor: 0.95
				};

			default:
				return {
					headerTag: '观点汇总',
					headerFillOpacity: 0.12,
					itemFillOpacity: 0.06,
					itemRadius: 10,
					itemHeight: baseHeight,
					itemSpacing: baseSpacing,
					minFontSize: 17,
					charWidthFactor: 1.0
				};
		}
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
			case 'recap':
				return '核心观点汇总';
			case 'viewpoint':
			case 'argument':
			case 'conclusion':
				return item.titleOverride !== undefined
					? item.titleOverride
					: (content.subPoints[item.pointIndex]?.title || content.coreViewpoint);
			default:
				return content.title;
		}
	}

	private expandImagePlan(imagePlan: ImagePlanItem[], content: XiaohongshuContentStructure): ImagePlanItem[] {
		const expanded: ImagePlanItem[] = [];
		const dedupedContent = {
			...content,
			subPoints: this.deduplicatePoints(content.subPoints)
		};
		const source = imagePlan.length > 0 ? imagePlan : this.buildFallbackPlan(dedupedContent.subPoints.length);

		for (const item of source) {
			if (item.type === 'recap') {
				continue;
			}

			if (item.type === 'viewpoint' || item.type === 'argument' || item.type === 'conclusion') {
				expanded.push(...this.expandPointItem(item, dedupedContent));
				continue;
			}

			expanded.push(item);
		}

		const unique = this.deduplicateExpandedItems(expanded);
		return unique.map((item, index) => ({ ...item, slot: `card_${index + 1}` }));
	}

	private deduplicateExpandedItems(items: ImagePlanItem[]): ImagePlanItem[] {
		const unique: ImagePlanItem[] = [];
		const fingerprints = new Set<string>();
		for (const item of items) {
			const key = this.buildItemFingerprint(item);
			if (fingerprints.has(key)) {
				continue;
			}
			fingerprints.add(key);
			unique.push(item);
		}
		return unique;
	}

	private buildItemFingerprint(item: ImagePlanItem): string {
		return [
			item.type,
			item.pointIndex,
			(item.titleOverride || '').trim(),
			(item.argumentOverride || '').trim(),
			(item.conclusionOverride || '').trim(),
			item.segmentIndex || 0,
			item.segmentTotal || 0
		].join('|');
	}

	/**
	 * 扩展观点项 - 每个观点只生成一张图，取消自动分页
	 */
	private expandPointItem(item: ImagePlanItem, content: XiaohongshuContentStructure): ImagePlanItem[] {
		const point = content.subPoints[item.pointIndex];
		if (!point) {
			return [];
		}

		// 每个观点只生成一张图，不再根据文字长度分页
		return [{
			...item,
			titleOverride: point.title,
			argumentOverride: point.argument,
			conclusionOverride: point.conclusion,
			segmentIndex: 1,
			segmentTotal: 1
		}];
	}

	private buildFallbackPlan(subPointsCount: number): ImagePlanItem[] {
		const plan: ImagePlanItem[] = [{ slot: 'card_1', type: 'cover', pointIndex: -1 }];
		for (let i = 0; i < subPointsCount; i++) {
			plan.push({ slot: `card_${plan.length + 1}`, type: 'viewpoint', pointIndex: i });
		}
		return plan;
	}

	private deduplicatePoints(points: XiaohongshuContentStructure['subPoints']): XiaohongshuContentStructure['subPoints'] {
		const deduped: XiaohongshuContentStructure['subPoints'] = [];
		for (const point of points) {
			const normalized = this.normalizePointText(`${point.title}${point.argument}${point.conclusion}`);
			const duplicated = deduped.some(existing => {
				const existingNormalized = this.normalizePointText(`${existing.title}${existing.argument}${existing.conclusion}`);
				return this.isSamePoint(normalized, existingNormalized);
			});
			if (!duplicated) {
				deduped.push(point);
			}
		}
		return deduped;
	}

	private normalizePointText(text: string): string {
		return text
			.toLowerCase()
			.replace(/观点\s*\d+/g, '')
			.replace(/[\s\p{P}\p{S}]+/gu, '')
			.trim();
	}

	private isSamePoint(a: string, b: string): boolean {
		if (!a || !b) {
			return false;
		}
		if (a.includes(b) || b.includes(a)) {
			return true;
		}
		const short = a.length <= b.length ? a : b;
		const long = a.length <= b.length ? b : a;
		if (short.length >= 8 && long.includes(short.slice(0, 8))) {
			return true;
		}
		return false;
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
