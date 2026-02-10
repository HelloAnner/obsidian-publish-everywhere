/**
 * 小红书发布相关类型定义
 *
 * @author Anner
 * Created on 2026/2/9
 */

/**
 * 单个子观点结构
 */
export interface SubPoint {
	/** 子观点标题 */
	title: string;
	/** 论据/详细说明 */
	argument: string;
	/** 结论/金句 */
	conclusion: string;
}

/**
 * 小红书内容结构 - 统一的JSON结构
 * 所有风格共用此结构，保证风格一致性
 */
export interface XiaohongshuContentStructure {
	/** 主标题 */
	title: string;
	/** 笔记创建时间 (ISO格式或中文日期) */
	createdAt: string;
	/** 正文内容 (小红书风格的短文) */
	noteText: string;
	/** 核心观点 (一句话概括) */
	coreViewpoint: string;
	/** 子观点列表 (2个及以上) */
	subPoints: SubPoint[];
	/** 标签 (3-6个，不带#) */
	hashtags: string[];
}

/**
 * 图片计划项
 */
export interface ImagePlanItem {
	slot: string;
	type: 'cover' | 'viewpoint' | 'argument' | 'conclusion' | 'recap';
	/** 对应的内容索引 (subPoints的index，-1表示核心观点/cover) */
	pointIndex: number;
	/** 配图建议 */
	attachmentHint?: string;
	/** 分页后覆盖标题 */
	titleOverride?: string;
	/** 分页后覆盖论据 */
	argumentOverride?: string;
	/** 分页后覆盖结论 */
	conclusionOverride?: string;
	/** 同观点分页索引（从1开始） */
	segmentIndex?: number;
	/** 同观点总分页数 */
	segmentTotal?: number;
}

/**
 * LLM返回的完整计划
 */
export interface XiaohongshuLayoutPlan {
	/** 结构化内容 */
	content: XiaohongshuContentStructure;
	/** 图片排版计划（按内容量动态扩展） */
	imagePlan: ImagePlanItem[];
}

/**
 * 渲染后的图片信息
 */
export interface XiaohongshuRenderedImage {
	index: number;
	path: string;
	caption: string;
	styleName: string;
	/** 图片类型 */
	type: ImagePlanItem['type'];
}

/**
 * 发布草稿
 */
export interface XiaohongshuPublishDraft {
	title: string;
	noteText: string;
	hashtags: string[];
	renderedImages: XiaohongshuRenderedImage[];
	styleName: string;
	styleSeed: number;
}

/**
 * 素材准备结果（不含自动发布）
 */
export interface XiaohongshuPublishResult {
	success: boolean;
	error?: string;
	/** 素材输出目录 */
	outputDir?: string;
	/** 生成的草稿信息 */
	draft?: XiaohongshuPublishDraft;
}
