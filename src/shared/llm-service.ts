/**
 * 大模型公共模块：统一请求配置的大模型接口，供小红书等渠道复用
 *
 * @author Anner
 * Created on 2026/2/9
 */

import { requestUrl } from 'obsidian';
import type { AutomationSharedSettings } from '../types';
import type { XiaohongshuLayoutPlan, XiaohongshuContentStructure, ImagePlanItem } from '../xiaohongshu/xiaohongshu-types';
import type { XiaohongshuStylePreset } from '../xiaohongshu/xiaohongshu-style-presets';

export class LlmService {
	private readonly settings: AutomationSharedSettings;

	constructor(settings: AutomationSharedSettings) {
		this.settings = settings;
	}

	async createXiaohongshuPlan(
		markdown: string,
		attachmentNames: string[],
		stylePreset: XiaohongshuStylePreset,
		noteDate?: string,
		noteTitle?: string
	): Promise<XiaohongshuLayoutPlan> {
		const baseUrl = this.settings.llmBaseUrl.trim();
		const model = this.settings.llmModel.trim();
		const apiKey = this.settings.llmApiKey.trim();

		if (!baseUrl || !model || !apiKey) {
			throw new Error('LLM config missing: please configure URL / model / api key first.');
		}

		const endpoint = this.normalizeEndpoint(baseUrl);
		const prompt = this.buildPrompt(markdown, attachmentNames, stylePreset, noteDate, noteTitle);

		const response = await requestUrl({
			url: endpoint,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model,
				messages: [
					{
						role: 'system',
						content: '你是一个专业的小红书内容创作者助手，擅长将笔记内容转化为结构化的图文内容。输出必须使用统一的JSON结构。'
					},
					{
						role: 'user',
						content: prompt
					}
				],
				temperature: 0.7,
				max_tokens: 2000
			})
		});

		const json = response.json as any;
		const content = this.extractMessageContent(json);
		const parsed = this.safeParseJson(content);
		return this.normalizePlan(parsed, attachmentNames, noteTitle, markdown);
	}

	private normalizeEndpoint(url: string): string {
		const trimmed = url.replace(/\/$/, '');
		if (trimmed.endsWith('/chat/completions')) {
			return trimmed;
		}
		return `${trimmed}/chat/completions`;
	}

	private extractMessageContent(json: any): string {
		const content = json?.choices?.[0]?.message?.content;
		if (typeof content !== 'string' || !content.trim()) {
			throw new Error('LLM response empty.');
		}
		return content;
	}

	private safeParseJson(raw: string): any {
		// 预处理：修复 LLM 常见的 JSON 格式问题
		let cleaned = raw;

		// 提取 fenced code block
		const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
		if (fenced && fenced[1]) {
			cleaned = fenced[1];
		}

		// 修复未加引号的 #hashtag（如 [#标签1, #标签2] -> ["#标签1", "#标签2"]）
		cleaned = cleaned.replace(/,\s*#([^,\]"]+)/g, ', "#$1"');
		cleaned = cleaned.replace(/\[\s*#([^,\]"]+)/g, '["#$1"');

		try {
			return JSON.parse(cleaned);
		} catch (_error) {
			throw new Error(`LLM response is not valid JSON: ${cleaned.substring(0, 100)}...`);
		}
	}

	/**
	 * 构建Prompt - 使用统一的JSON结构
	 */
	private buildPrompt(
		markdown: string,
		attachmentNames: string[],
		stylePreset: XiaohongshuStylePreset,
		noteDate?: string,
		noteTitle?: string
	): string {
		const attachmentText = attachmentNames.length > 0
			? attachmentNames.join('、')
			: '无可用附件图片';

		const dateHint = noteDate || '从笔记内容中提取或留空';
		const preferredTitle = (noteTitle || '').trim() || '未提供';

		return [
			'将以下素材提炼为面向外部读者的小红书图文内容，输出必须符合指定的JSON结构。',
			'核心目标是对输入信息做无损覆盖：关键观点必须全部保留，可在此基础上适度扩充案例和解释。',
			'所有字段必须在给定字数内完整表达，不允许使用省略号“…”替代关键信息。',
			'',
			`【指定风格】${stylePreset.name}`,
			`【风格描述】${stylePreset.promptStyle}`,
			`【优先标题】${preferredTitle}`,
			`【笔记时间】${dateHint}`,
			'',
			'【输出JSON结构要求】',
			'{',
			'  "content": {',
			'    "title": "主标题，16-20字，抓人眼球",',
			'    "createdAt": "笔记创建时间，如 2026年2月6日",',
			'    "noteText": "小红书风格的正文，300-600字，真诚有故事感，包含个人场景、思考过程、行动建议",',
			'    "coreViewpoint": "核心观点，一句话概括全文精华，18-26字",',
			'    "subPoints": [',
			'      {',
			'        "title": "子观点1标题，10-16字",',
			'        "argument": "论据/详细说明，70-120字，深入分析原因、背景、案例，讲透彻",',
			'        "conclusion": "结论/金句，18-30字，有洞察力和记忆点"',
			'      }',
			'      // 共3-4个子观点，每个观点都要有充实的论述',
			'    ],',
			'    "hashtags": ["标签1", "标签2", "标签3", "标签4", "标签5", "标签6"] // 4-6个，不带#',
			'  },',
			'  "imagePlan": [',
			'    // 第1张：封面图 - 展示标题、核心观点、正文摘要',
			'    { "slot": "card_1", "type": "cover", "pointIndex": -1, "attachmentHint": "" },',
			'    // 第2张：核心观点详解 - 深入阐述核心观点',
			'    { "slot": "card_2", "type": "viewpoint", "pointIndex": 0, "attachmentHint": "" },',
			'    // 第3张：第二个子观点',
			'    { "slot": "card_3", "type": "viewpoint", "pointIndex": 1, "attachmentHint": "" },',
			'    // 后续图片：继续输出更多子观点，直到关键信息覆盖完整',
			'    { "slot": "card_4", "type": "viewpoint", "pointIndex": 2, "attachmentHint": "" }',
			'  ]',
			'}',
			'',
			'【字段说明】',
			'1. content: 内容结构',
			'   - title: 主标题，醒目有力，能概括全文；优先使用【优先标题】作为标题，最多只做轻微润色，不要偏离原题',
			'   - createdAt: 从笔记中提取的时间，格式统一为"YYYY年M月D日"',
			'   - noteText: 小红书正文风格，300-600字，包含：',
			'       * 开篇引入（个人场景/问题）',
			'       * 中间展开（2-3个要点）',
			'       * 结尾行动号召或感悟',
			'       * 用“直接结论+可执行建议”的表达，不使用“原笔记/本文/上文/作者在笔记里”等引用来源措辞',
			'   - coreViewpoint: 一句话核心观点，要有洞察力，18-26字',
			'   - subPoints: 3-4个子观点，每个包含：',
			'       * 标题：明确表达观点立场',
			'       * 论据：70-120字详细论述，可包含案例、对比、数据，但不要提及内容来源',
			'       * 结论：18-30字金句收尾，有传播价值',
			'   - hashtags: 4-6个标签，覆盖主题关键词',
			'',
			'2. imagePlan: 图片排版计划（按信息量动态扩展）',
			'   - slot: 卡片编号',
			'   - type: 图片类型 (cover-封面, viewpoint-观点)',
			'   - pointIndex: 对应subPoints的索引，-1表示封面',
			'   - attachmentHint: 配图建议，从附件列表中选择',
			'',
			'【内容要求 - 重要】',
			'1. 标题优先：必须优先使用【优先标题】，仅允许轻微润色，不得另起完全不同的新标题',
			'2. 信息无损：原素材中的关键观点必须全部体现在 subPoints 中，不得遗漏，可扩充但不能替换原意',
			'3. 面向外部读者：直接输出结论与观点，不出现“原笔记提到/文中提到/作者写道”等来源指代',
			'4. 层次分明：标题亮观点 → 论据讲透彻（案例/对比/引用） → 结论给金句',
			'5. 真诚有料：像资深博主分享干货，不是AI罗列要点',
			'6. 可包含适量emoji增强可读性',
			'7. 所有文字必须符合小红书平台的调性',
			'8. 不允许出现“…”、“......”、“省略”这类未说完整的表达',
			'',
			'【可用附件图片】',
			attachmentText,
			'',
			'【参考素材】',
			'---',
			markdown,
			'---'
		].join('\n');
	}

	/**
	 * 规范化LLM返回的计划
	 */
	private normalizePlan(raw: any, attachmentNames: string[], noteTitle?: string, sourceMarkdown?: string): XiaohongshuLayoutPlan {
		const rawContent = raw?.content || raw;

		// 构建默认内容
		const defaultContent: XiaohongshuContentStructure = {
			title: '今天我把一个方法论真正用起来了',
			createdAt: new Date().toLocaleDateString('zh-CN'),
			noteText: '把注意力收回来，把行动压缩到今天，很多焦虑就会慢慢退场。',
			coreViewpoint: '行动是缓解焦虑最好的解药',
			subPoints: [
				{
					title: '聚焦当下',
					argument: '人的注意力有限，同时追求多个目标只会分散精力，导致一事无成。',
					conclusion: '一次只做一件事，反而效率更高。'
				},
				{
					title: '立即行动',
					argument: '想太多而不行动会陷入内耗，小步快跑才能快速验证想法。',
					conclusion: '先完成再完美，行动治愈焦虑。'
				}
			],
			hashtags: ['个人成长', '方法论', '效率']
		};

		// 规范化content
		const content: XiaohongshuContentStructure = {
			title: this.normalizeTitle(rawContent?.title, defaultContent.title, noteTitle),
			createdAt: this.safeString(rawContent?.createdAt, defaultContent.createdAt),
			noteText: this.safeString(rawContent?.noteText, defaultContent.noteText),
			coreViewpoint: this.safeString(rawContent?.coreViewpoint, defaultContent.coreViewpoint),
			subPoints: this.normalizeSubPoints(rawContent?.subPoints, defaultContent.subPoints),
			hashtags: this.normalizeTags(rawContent?.hashtags)
		};

		// 规范化imagePlan
		const supplemented = this.ensureCoverageBySource(content, sourceMarkdown || '');
		const imagePlan = this.normalizeImagePlan(raw?.imagePlan, supplemented.subPoints.length, attachmentNames);

		return { content: supplemented, imagePlan };
	}

	private safeString(value: unknown, fallback: string): string {
		const str = String(value || '').trim();
		return str || fallback;
	}

	private normalizeTitle(rawTitle: unknown, fallback: string, noteTitle?: string): string {
		const preferred = (noteTitle || '').trim();
		const generated = this.safeString(rawTitle, fallback);
		if (!preferred) {
			return generated;
		}

		if (!generated) {
			return preferred;
		}

		if (generated.includes(preferred) || preferred.includes(generated)) {
			return generated;
		}

		return preferred;
	}

	private normalizeSubPoints(raw: unknown, fallback: XiaohongshuContentStructure['subPoints']): XiaohongshuContentStructure['subPoints'] {
		if (!Array.isArray(raw) || raw.length === 0) {
			return fallback;
		}

		const points = raw.slice(0, 12).map((item: any): XiaohongshuContentStructure['subPoints'][0] => ({
			title: this.safeString(item?.title, '核心观点'),
			argument: this.safeString(item?.argument, '深入思考，找到问题的本质。'),
			conclusion: this.safeString(item?.conclusion, '行动是最好的答案。')
		}));

		return points.length >= 2 ? points : fallback;
	}

	private normalizeTags(rawTags: unknown): string[] {
		if (!Array.isArray(rawTags)) {
			return ['个人成长', '方法论', '效率'];
		}

		const tags = rawTags
			.map(item => String(item || '').trim().replace(/^#/, ''))
			.filter(Boolean)
			.slice(0, 6);

		if (tags.length === 0) {
			return ['个人成长', '方法论', '效率'];
		}

		return tags;
	}

	private normalizeImagePlan(
		rawPlan: unknown,
		subPointsCount: number,
		attachmentNames: string[]
	): ImagePlanItem[] {
		const hasCover = !Array.isArray(rawPlan) || rawPlan.some((item: any) => this.normalizeImageType(item?.type) === 'cover');
		const plan: ImagePlanItem[] = [];

		if (hasCover) {
			plan.push({ slot: 'card_1', type: 'cover', pointIndex: -1, attachmentHint: attachmentNames[0] || '' });
		}

		for (let i = 0; i < subPointsCount; i++) {
			plan.push({
				slot: `card_${plan.length + 1}`,
				type: 'viewpoint',
				pointIndex: i,
				attachmentHint: attachmentNames[i + 1] || attachmentNames[0] || ''
			});
		}

		return plan;
	}

	private normalizeImageType(type: unknown): ImagePlanItem['type'] {
		const value = String(type || '').trim();
		const validTypes: ImagePlanItem['type'][] = ['cover', 'viewpoint', 'argument', 'conclusion'];
		if (validTypes.includes(value as ImagePlanItem['type'])) {
			return value as ImagePlanItem['type'];
		}
		return 'viewpoint';
	}

	private normalizeAttachmentHint(rawHint: unknown, attachmentNames: string[]): string {
		const hint = String(rawHint || '').trim();
		if (!hint) {
			return '';
		}
		const matched = attachmentNames.find(item => item.includes(hint) || hint.includes(item));
		return matched || '';
	}

	private ensureCoverageBySource(content: XiaohongshuContentStructure, sourceMarkdown: string): XiaohongshuContentStructure {
		const keyPoints = this.extractSourceKeyPoints(sourceMarkdown);
		if (keyPoints.length === 0) {
			return content;
		}

		const existingTexts = content.subPoints.map(item => `${item.title} ${item.argument} ${item.conclusion}`);
		const additional = keyPoints
			.filter(point => !this.isCoveredByExisting(point, existingTexts))
			.map(point => ({
				title: point.length > 16 ? point.slice(0, 16) : point,
				argument: point.length >= 24
					? point
					: `围绕“${point}”补充场景、因果和行动建议，确保信息完整可执行。`,
				conclusion: point.length >= 20 ? point.slice(0, 30) : `把“${point}”做实，形成稳定结果。`
			}));

		if (additional.length === 0) {
			return content;
		}

		return {
			...content,
			subPoints: [...content.subPoints, ...additional]
		};
	}

	private extractSourceKeyPoints(markdown: string): string[] {
		if (!markdown.trim()) {
			return [];
		}

		const cleanedMarkdown = markdown.replace(/```[\s\S]*?```/g, '');
		const lines = cleanedMarkdown.split(/\r?\n/);
		const points: string[] = [];

		for (const line of lines) {
			const text = line.trim();
			if (!text) {
				continue;
			}

			const heading = text.match(/^#{1,6}\s+(.+)$/);
			if (heading && heading[1]) {
				points.push(this.normalizeKeyPoint(heading[1]));
				continue;
			}

			const bullet = text.match(/^[-*+]\s+(.+)$/);
			if (bullet && bullet[1]) {
				points.push(this.normalizeKeyPoint(bullet[1]));
				continue;
			}

			const ordered = text.match(/^\d+[\.、\)]\s+(.+)$/);
			if (ordered && ordered[1]) {
				points.push(this.normalizeKeyPoint(ordered[1]));
			}
		}

		if (points.length === 0) {
			const plain = cleanedMarkdown
				.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
				.replace(/[`*_>#-]/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			const sentences = plain.split(/[。！？；\n]/).map(item => item.trim()).filter(item => item.length >= 12);
			points.push(...sentences.slice(0, 8).map(item => this.normalizeKeyPoint(item)));
		}

		return Array.from(new Set(points.filter(Boolean))).slice(0, 16);
	}

	private normalizeKeyPoint(raw: string): string {
		return raw
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/`+/g, '')
			.replace(/\*+/g, '')
			.replace(/^[:：\-\s]+|[:：\-\s]+$/g, '')
			.trim();
	}

	private isCoveredByExisting(candidate: string, existingTexts: string[]): boolean {
		const normalized = candidate.trim();
		if (!normalized) {
			return true;
		}

		return existingTexts.some(text => {
			const base = text.trim();
			if (!base) {
				return false;
			}
			if (base.includes(normalized) || normalized.includes(base)) {
				return true;
			}
			const short = normalized.slice(0, Math.min(10, normalized.length));
			return short.length >= 6 && base.includes(short);
		});
	}
}
