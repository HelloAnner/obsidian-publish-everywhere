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
	private static readonly FIXED_AI_TAG = 'AI 协助创作';

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
			'原始笔记的内容与观点必须 100% 还原：不得遗漏任何关键观点，不得改变原观点立场，不得弱化原有判断。',
			'生成前请先在内部完成“观点清单抽取”，再逐条映射到 subPoints，确保每条原始核心观点都被覆盖。',
			'所有字段必须在给定字数内完整表达，不允许使用省略号“…”替代关键信息。',
			'每个 subPoint 必须形成“标题→论据→结论”的闭环：论据是标题的详细补充，结论是精华收尾，不得各说各话。',
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
				'    "noteText": "观点型正文，300-600字，围绕图文观点做结构化说明：核心结论、关键依据、执行建议",',
			'    "coreViewpoint": "核心观点，一句话概括全文精华，18-26字",',
			'    "subPoints": [',
			'      {',
			'        "title": "子观点1标题，10-16字",',
			'        "argument": "论据/详细说明，70-120字，必须紧扣标题展开：讲清原因、机制、场景或案例，不得偏题",',
			'        "conclusion": "结论/金句，18-30字，提炼前文精华收尾，不引入新论点"',
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
				'   - noteText: 观点说明文风，300-600字，包含：',
				'       * 开篇直接给核心结论（不要讲个人经历）',
				'       * 中间按图文观点逐条解释依据与因果',
				'       * 结尾给可执行建议或判断标准',
				'       * 必须输出纯文本，不使用 Markdown 标记（如 #、*、-、>、```、[]()）',
				'       * 用“直接结论+可执行建议”的表达，不使用“原笔记/本文/上文/作者在笔记里”等引用来源措辞',
			'   - coreViewpoint: 一句话核心观点，要有洞察力，18-26字',
			'   - subPoints: 3-4个子观点，每个包含：',
			'       * 标题：明确表达观点立场',
			'       * 论据：70-120字详细论述，必须是对标题的补充和展开，讲清“为什么成立、如何落地”',
			'       * 结论：18-30字精华收尾，压缩核心洞察，和标题/论据同向，不重复铺陈',
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
			'2.1 观点还原强约束：原文出现的核心判断、因果关系、方法步骤必须逐条映射，不得合并丢失',
			'3. 面向外部读者：直接输出结论与观点，不出现“原笔记提到/文中提到/作者写道”等来源指代',
			'4. 层次分明：标题亮观点 → 论据讲透彻（案例/对比/引用） → 结论给金句',
			'5. 文风要求：以观点阐述为主，不写故事化叙事，不使用“我今天/昨晚/一路走来”等经历口吻',
			'6. 可包含适量emoji增强可读性',
			'7. 所有文字必须符合小红书平台的调性',
			'8. 不允许出现“…”、“......”、“省略”这类未说完整的表达',
			'10. subPoints 内部逻辑强约束：论据必须补充标题，结论必须收束标题与论据；若论据偏题或结论发散，视为不合格输出',
			'11. 若原始观点数量较多，允许压缩措辞但不允许删观点；宁可增加 subPoints 密度，也不能牺牲覆盖率',
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
			title: '把方法论落成可执行动作',
			createdAt: new Date().toLocaleDateString('zh-CN'),
			noteText: '先明确核心结论，再逐条给出依据与执行建议，才能让观点被完整理解并被实际采用。',
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
			noteText: this.normalizePlainText(this.safeString(rawContent?.noteText, defaultContent.noteText)),
			coreViewpoint: this.safeString(rawContent?.coreViewpoint, defaultContent.coreViewpoint),
			subPoints: this.normalizeSubPoints(rawContent?.subPoints, defaultContent.subPoints),
			hashtags: this.normalizeTags(rawContent?.hashtags)
		};

		// 规范化imagePlan
		// 说明：补全观点用于保证文案覆盖度，但图片只按原始去重后的观点数量生成，
		// 避免尾部补充观点触发“最后几张重复描述”的体验问题。
		const supplemented = this.ensureCoverageBySource(content, sourceMarkdown || '');
		const imagePlan = this.normalizeImagePlan(raw?.imagePlan, content.subPoints.length, attachmentNames);

		return { content: supplemented, imagePlan };
	}

	private safeString(value: unknown, fallback: string): string {
		const str = String(value || '').trim();
		return str || fallback;
	}

	private normalizePlainText(value: string): string {
		return value
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/`([^`]+)`/g, '$1')
			.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/^#{1,6}\s+/gm, '')
			.replace(/^\s*[-*+]\s+/gm, '')
			.replace(/^\s*\d+[\.、\)]\s+/gm, '')
			.replace(/^>+\s?/gm, '')
			.replace(/\*\*(.*?)\*\*/g, '$1')
			.replace(/__(.*?)__/g, '$1')
			.replace(/\*(.*?)\*/g, '$1')
			.replace(/_(.*?)_/g, '$1')
			.replace(/~~(.*?)~~/g, '$1')
			.replace(/<[^>]+>/g, ' ')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/[ \t]{2,}/g, ' ')
			.trim();
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
		const deduped = this.deduplicateSubPoints(points);

		return deduped.length >= 2 ? deduped : fallback;
	}

	private normalizeTags(rawTags: unknown): string[] {
		const baseTags = Array.isArray(rawTags)
			? rawTags.map(item => String(item || '').trim().replace(/^#/, '')).filter(Boolean)
			: ['个人成长', '方法论', '效率'];

		const unique: string[] = [];
		for (const tag of baseTags) {
			if (!unique.includes(tag)) {
				unique.push(tag);
			}
		}

		const fixedTag = LlmService.FIXED_AI_TAG;
		const normalized = unique.filter(tag => tag !== fixedTag).slice(0, 5);
		normalized.push(fixedTag);
		return normalized;
	}

	private normalizeImagePlan(
		rawPlan: unknown,
		subPointsCount: number,
		attachmentNames: string[]
	): ImagePlanItem[] {
		// 始终使用标准化的图片计划，忽略LLM返回的imagePlan（避免重复和混乱）
		const plan: ImagePlanItem[] = [];

		// 第1张：封面
		plan.push({ slot: 'card_1', type: 'cover', pointIndex: -1, attachmentHint: attachmentNames[0] || '' });

		// 第2张起：每个子观点一张图，确保不重复
		const usedIndices = new Set<number>();
		for (let i = 0; i < subPointsCount; i++) {
			if (usedIndices.has(i)) {
				continue;
			}
			plan.push({
				slot: `card_${plan.length + 1}`,
				type: 'viewpoint',
				pointIndex: i,
				attachmentHint: attachmentNames[i + 1] || attachmentNames[0] || ''
			});
			usedIndices.add(i);
		}

		return plan;
	}

	private normalizeImageType(type: unknown): ImagePlanItem['type'] {
		const value = String(type || '').trim();
		const validTypes: ImagePlanItem['type'][] = ['cover', 'viewpoint', 'argument', 'conclusion', 'recap'];
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
		const dedupedSubPoints = this.deduplicateSubPoints(content.subPoints);
		const keyPoints = this.extractSourceKeyPoints(sourceMarkdown);
		if (keyPoints.length === 0) {
			return {
				...content,
				subPoints: dedupedSubPoints
			};
		}

		const existingTexts = [
			content.title,
			content.coreViewpoint,
			content.noteText,
			...dedupedSubPoints.flatMap(item => [
				item.title,
				item.argument,
				item.conclusion,
				`${item.title} ${item.argument} ${item.conclusion}`
			])
		];
		const supplementLimit = this.calculateSupplementLimit(dedupedSubPoints.length);
		const additional: XiaohongshuContentStructure['subPoints'] = [];

		for (const point of keyPoints) {
			if (additional.length >= supplementLimit) {
				break;
			}

			const normalizedPoint = this.normalizeSupplementPoint(point);
			if (!normalizedPoint) {
				continue;
			}
			if (!this.shouldSupplementPoint(normalizedPoint)) {
				continue;
			}
			if (this.isCoveredByExisting(normalizedPoint, existingTexts)) {
				continue;
			}

			additional.push({
				title: this.buildSupplementTitle(normalizedPoint),
				argument: normalizedPoint.length >= 24
					? normalizedPoint
					: `围绕“${normalizedPoint}”补充场景、因果和行动建议，确保信息完整可执行。`,
				conclusion: normalizedPoint.length >= 20
					? normalizedPoint.slice(0, 30)
					: `把“${normalizedPoint}”做实，形成稳定结果。`
			});
			existingTexts.push(normalizedPoint);
		}

		if (additional.length === 0) {
			return {
				...content,
				subPoints: dedupedSubPoints
			};
		}

		return {
			...content,
			subPoints: this.deduplicateSubPoints([...dedupedSubPoints, ...additional])
		};
	}

	private calculateSupplementLimit(existingCount: number): number {
		const maxByCount = Math.max(5 - existingCount, 0);
		return Math.min(maxByCount, 2);
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
				const normalized = this.normalizeKeyPoint(heading[1]);
				if (this.isValidKeyPoint(normalized)) {
					points.push(normalized);
				}
				continue;
			}

			const bullet = text.match(/^[-*+]\s+(.+)$/);
			if (bullet && bullet[1]) {
				const normalized = this.normalizeKeyPoint(bullet[1]);
				if (this.isValidKeyPoint(normalized)) {
					points.push(normalized);
				}
				continue;
			}

			const ordered = text.match(/^\d+[\.、\)]\s+(.+)$/);
			if (ordered && ordered[1]) {
				const normalized = this.normalizeKeyPoint(ordered[1]);
				if (this.isValidKeyPoint(normalized)) {
					points.push(normalized);
				}
				continue;
			}

			const blockQuote = text.match(/^>+\s*(.+)$/);
			if (blockQuote && blockQuote[1]) {
				const normalized = this.normalizeKeyPoint(blockQuote[1]);
				if (this.isValidKeyPoint(normalized)) {
					points.push(normalized);
				}
			}
		}

		return Array.from(new Set(points.filter(Boolean))).slice(0, 12);
	}

	private normalizeKeyPoint(raw: string): string {
		return raw
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&[a-z]+;/gi, ' ')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/`+/g, '')
			.replace(/\*+/g, '')
			.replace(/^[>\s]+/, '')
			.replace(/^[:：\-\s]+|[:：\-\s]+$/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private isValidKeyPoint(text: string): boolean {
		if (!text) {
			return false;
		}
		if (text.length < 10) {
			return false;
		}
		if (/https?:\/\//i.test(text)) {
			return false;
		}
		if (/<[^>]*>/.test(text)) {
			return false;
		}
		if (/style\s*=|class\s*=|<\/?mark/i.test(text)) {
			return false;
		}
		const comparable = this.normalizeCompareText(text);
		if (comparable.length < 8) {
			return false;
		}
		return true;
	}

	private normalizeSupplementPoint(point: string): string {
		const normalized = point.replace(/\s+/g, ' ').trim();
		if (!normalized) {
			return '';
		}

		if (normalized.length <= 80) {
			return normalized;
		}

		const segments = normalized
			.split(/[。！？；]/)
			.map(item => item.trim())
			.filter(item => item.length >= 10);

		if (segments.length === 0) {
			return normalized.slice(0, 80);
		}

		let combined = '';
		for (const segment of segments) {
			const candidate = combined ? `${combined}。${segment}` : segment;
			if (candidate.length > 80 && combined) {
				break;
			}
			combined = candidate;
			if (combined.length >= 36) {
				break;
			}
		}

		return combined || normalized.slice(0, 80);
	}

	private shouldSupplementPoint(point: string): boolean {
		if (point.length < 16) {
			return false;
		}
		if (/[？?]$/.test(point)) {
			return false;
		}
		if (/^(为什么|为何|怎么|如何)/.test(point)) {
			return false;
		}
		return true;
	}

	private buildSupplementTitle(point: string): string {
		const cleaned = point
			.replace(/[“”"'‘’]/g, '')
			.replace(/[。！？；:：]+$/g, '')
			.trim();

		const sentence = cleaned
			.split(/[。！？；]/)
			.map(item => item.trim())
			.find(Boolean) || cleaned;

		if (sentence.length <= 24) {
			return sentence;
		}

		const clauses = sentence.split(/[，、,]/).map(item => item.trim()).filter(Boolean);
		if (clauses.length > 1) {
			let composed = '';
			for (const clause of clauses) {
				const next = composed ? `${composed}，${clause}` : clause;
				if (next.length > 24 && composed) {
					break;
				}
				composed = next;
			}
			if (composed.length >= 10) {
				return composed;
			}
		}

		return sentence.slice(0, 24);
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
			if (short.length >= 6 && base.includes(short)) {
				return true;
			}

			const normalizedBase = this.normalizeCompareText(base);
			const normalizedCandidate = this.normalizeCompareText(normalized);
			return this.isHighlySimilar(normalizedBase, normalizedCandidate);
		});
	}

	private deduplicateSubPoints(points: XiaohongshuContentStructure['subPoints']): XiaohongshuContentStructure['subPoints'] {
		const deduped: XiaohongshuContentStructure['subPoints'] = [];
		for (const point of points) {
			const text = `${point.title} ${point.argument} ${point.conclusion}`;
			const normalized = this.normalizeCompareText(text);
			const duplicated = deduped.some(existing => {
				const existingText = `${existing.title} ${existing.argument} ${existing.conclusion}`;
				return this.isHighlySimilar(this.normalizeCompareText(existingText), normalized);
			});
			if (!duplicated) {
				deduped.push(point);
			}
		}
		return deduped;
	}

	private normalizeCompareText(text: string): string {
		return text
			.toLowerCase()
			.replace(/^\s*[（(]?[0-9一二三四五六七八九十]+[）)]?\s*[.、\-—_:：]*/g, '')
			.replace(/观点\s*\d+/g, '')
			.replace(/[\s\p{P}\p{S}]+/gu, '')
			.trim();
	}

	private isHighlySimilar(a: string, b: string): boolean {
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

		const aSet = new Set(a.split(''));
		const bSet = new Set(b.split(''));
		let overlap = 0;
		for (const c of aSet) {
			if (bSet.has(c)) {
				overlap += 1;
			}
		}
		const union = new Set([...aSet, ...bSet]).size;
		if (union === 0) {
			return false;
		}
		return overlap / union >= 0.72;
	}
}
