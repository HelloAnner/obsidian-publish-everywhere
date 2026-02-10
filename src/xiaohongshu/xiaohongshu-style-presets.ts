/**
 * 小红书风格预设 - 统一JSON结构，不同视觉风格
 * 所有风格使用相同的content结构，只改变颜色、字体、装饰元素
 *
 * @author Anner
 * Created on 2026/2/9
 */

export type XiaohongshuLayoutVariant =
	| 'ink_handwriting'
	| 'vintage_journal'
	| 'minimal_paper'
	| 'warm_notebook'
	| 'zen_garden'
	| 'night_reading'
	| 'coffee_shop';

/**
 * 风格预设接口
 * 所有风格共用相同的content结构，通过视觉元素区分
 */
export interface XiaohongshuStylePreset {
	id: string;
	name: string;
	layout: XiaohongshuLayoutVariant;
	/** 给LLM的风格描述 */
	promptStyle: string;

	// 颜色系统
	/** 背景色 */
	background: string;
	/** 卡片底色 */
	card: string;
	/** 主文字颜色 */
	textPrimary: string;
	/** 次要文字颜色 */
	textSecondary: string;
	/** 强调色/装饰色 */
	accent: string;
	/** 边框/分隔线颜色 */
	border: string;

	// 字体系统 - 统一使用手写风格字体
	/** 标题字体 */
	titleFont: string;
	/** 正文字体 */
	bodyFont: string;
	/** 装饰字体(日期、标签等) */
	decorativeFont: string;

	// 字号系统
	/** 主标题字号 */
	titleSize: number;
	/** 副标题字号 */
	subtitleSize: number;
	/** 正文字号 */
	bodySize: number;
	/** 注释字号 */
	captionSize: number;

	// 装饰元素
	/** 引用符号样式 */
	quoteStyle: 'none' | 'chinese' | 'western' | 'line';
	/** 是否有纹理背景 */
	hasTexture: boolean;
	/** 圆角大小 */
	borderRadius: number;
}

/**
 * 手写字体栈 - 跨平台兼容
 * 优先级：精美手写体 > 系统手写体 > 通用无衬线
 */
const HANDWRITING_FONTS = {
	// 标题用：优雅手写体 (字体名称不加引号，避免SVG中引号嵌套)
	title: 'LXGW WenKai, LXGWWenKai-Regular, 霞鹜文楷, ZCOOL XiaoWei, 站酷小薇体, Ma Shan Zheng, 马善政楷书, Kaiti SC, STKaiti, BiauKai, cursive',
	// 正文用：自然手写体
	body: 'LXGW WenKai Screen, LXGWWenKaiScreen-Regular, 霞鹜文楷屏幕阅读版, Noto Serif SC, Source Han Serif SC, Songti SC, STSong, PingFang SC, Microsoft YaHei, serif',
	// 装饰用：艺术手写体
	decorative: 'ZCOOL KuaiLe, 站酷快乐体, ZCOOL QingKe HuangYou, 站酷庆科黄油体, Ma Shan Zheng, Kaiti SC, STKaiti, cursive'
};

/**
 * 风格预设列表
 * 7种精心设计的视觉风格，统一的JSON结构
 */
export const XIAOHONGSHU_STYLE_PRESETS: XiaohongshuStylePreset[] = [
	{
		// 风格1：墨韵手札 - 中国传统水墨风格
		id: 'ink-handwriting',
		name: '墨韵手札',
		layout: 'ink_handwriting',
		promptStyle: '像一封手写书信：文字有温度，观点有力量。用中国传统的留白美学，营造沉静思考的阅读氛围。',
		background: '#F5F0E8',
		card: '#FDFBF7',
		textPrimary: '#2C2C2C',
		textSecondary: '#5A5A5A',
		accent: '#8B4513',
		border: '#D4C4B0',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: HANDWRITING_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 72,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'chinese',
		hasTexture: true,
		borderRadius: 8
	},
	{
		// 风格2：旧日手记 - 复古日记本风格
		id: 'vintage-journal',
		name: '旧日手记',
		layout: 'vintage_journal',
		promptStyle: '像翻开的旧日记本：泛黄的纸张，温暖的故事。带有时间沉淀的质感，让人想静静读完。',
		background: '#E8DFD0',
		card: '#F5F0E6',
		textPrimary: '#4A3C2E',
		textSecondary: '#7A6B5A',
		accent: '#A67C52',
		border: '#C4B8A8',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: HANDWRITING_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 30,
		captionSize: 22,
		quoteStyle: 'western',
		hasTexture: true,
		borderRadius: 4
	},
	{
		// 风格3：素笺笔记 - 极简白纸风格
		id: 'minimal-paper',
		name: '素笺笔记',
		layout: 'minimal_paper',
		promptStyle: '像一张干净的白纸：极简、纯粹、专注内容。用最少的元素，传达最清晰的观点。',
		background: '#FAFAFA',
		card: '#FFFFFF',
		textPrimary: '#1A1A1A',
		textSecondary: '#6B6B6B',
		accent: '#0066CC',
		border: '#E0E0E0',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: HANDWRITING_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 70,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'line',
		hasTexture: false,
		borderRadius: 12
	},
	{
		// 风格4：暖手账本 - 温馨手账风格
		id: 'warm-notebook',
		name: '暖手账本',
		layout: 'warm_notebook',
		promptStyle: '像温暖的手账页面：柔和的色彩，亲切的文字。像闺蜜间的悄悄话，温暖而有力量。',
		background: '#FFF8F0',
		card: '#FFFDF9',
		textPrimary: '#3D3D3D',
		textSecondary: '#7A7A7A',
		accent: '#E67E22',
		border: '#F0D5C5',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: HANDWRITING_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'chinese',
		hasTexture: true,
		borderRadius: 16
	},
	{
		// 风格5：禅意园景 - 东方禅意风格
		id: 'zen-garden',
		name: '禅意园景',
		layout: 'zen_garden',
		promptStyle: '像禅意庭院的一角：留白、宁静、深远。用东方的克制美学，呈现深思熟虑的观点。',
		background: '#E8E6E1',
		card: '#F5F4F2',
		textPrimary: '#3A3A3A',
		textSecondary: '#6B6B6B',
		accent: '#5A7A6A',
		border: '#C5C9C2',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: HANDWRITING_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 70,
		subtitleSize: 40,
		bodySize: 30,
		captionSize: 22,
		quoteStyle: 'chinese',
		hasTexture: true,
		borderRadius: 6
	},
	{
		// 风格6：夜读时光 - 深色护眼风格
		id: 'night-reading',
		name: '夜读时光',
		layout: 'night_reading',
		promptStyle: '像深夜的台灯下：温暖的灯光，安静的阅读。深色背景搭配暖色文字，适合沉静的思考。',
		background: '#1E1E2E',
		card: '#2D2D44',
		textPrimary: '#E8E6E3',
		textSecondary: '#A0A0B0',
		accent: '#F4A261',
		border: '#3D3D5C',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: HANDWRITING_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 70,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'western',
		hasTexture: false,
		borderRadius: 12
	},
	{
		// 风格7：咖啡时光 - 咖啡馆随笔风格
		id: 'coffee-shop',
		name: '咖啡时光',
		layout: 'coffee_shop',
		promptStyle: '像咖啡馆里的随笔：随性、慵懒、有味道。像午后阳光下的阅读时光，惬意而有收获。',
		background: '#F0EBE3',
		card: '#F7F4F0',
		textPrimary: '#3D3229',
		textSecondary: '#6B5D4F',
		accent: '#8B6F4E',
		border: '#D9CFC2',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: HANDWRITING_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 30,
		captionSize: 22,
		quoteStyle: 'western',
		hasTexture: true,
		borderRadius: 8
	}
];

/**
 * 根据种子获取风格预设
 */
export function getXiaohongshuStyleBySeed(seed: number): XiaohongshuStylePreset {
	const index = Math.abs(seed) % XIAOHONGSHU_STYLE_PRESETS.length;
	return XIAOHONGSHU_STYLE_PRESETS[index];
}

/**
 * 根据ID获取风格预设
 */
export function getXiaohongshuStyleById(id: string): XiaohongshuStylePreset | undefined {
	return XIAOHONGSHU_STYLE_PRESETS.find(style => style.id === id);
}
