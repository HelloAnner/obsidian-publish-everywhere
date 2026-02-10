/**
 * 小红书风格预设 - 统一JSON结构，不同视觉风格
 * 所有风格使用相同的content结构，只改变颜色、字体、装饰元素
 *
 * @author Anner
 * Created on 2026/2/9
 */

export type XiaohongshuLayoutVariant =
	// 古风/手写系列
	| 'ink_handwriting'
	| 'vintage_journal'
	| 'minimal_paper'
	| 'warm_notebook'
	| 'zen_garden'
	| 'night_reading'
	| 'coffee_shop'
	// 现代多样化系列
	| 'tech_minimal'
	| 'nordic_fresh'
	| 'vibrant_coral'
	| 'premium_business'
	| 'nature_wellness'
	// 艺术风格系列
	| 'morandi_gray'
	| 'japanese_magazine'
	| 'industrial_modern'
	| 'watercolor_art'
	// 技术风格系列
	| 'terminal_cli'
	| 'github_opensource'
	| 'linear_saas'
	| 'notion_docs'
	| 'vscode_editor';

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
 * 现代字体栈 - 简约现代风格
 * 优先级：系统UI字体 > 通用无衬线
 */
const MODERN_FONTS = {
	// 标题用：几何无衬线
	title: 'SF Pro Display, -apple-system, BlinkMacSystemFont, Inter, PingFang SC, Microsoft YaHei, sans-serif',
	// 正文用：易读无衬线
	body: 'SF Pro Text, -apple-system, BlinkMacSystemFont, Inter, PingFang SC, Microsoft YaHei, sans-serif',
	// 装饰用：等宽或特殊
	decorative: 'SF Mono, Menlo, Monaco, Consolas, PingFang SC, monospace'
};

/**
 * 风格预设列表
 * 21种精心设计的视觉风格，统一的JSON结构
 * - 古风手写系列(7种)：墨韵、复古、极简、手账、禅意、夜读、咖啡
 * - 现代多样化系列(5种)：科技、北欧、活力、商务、自然
 * - 艺术风格系列(4种)：莫兰迪、日系、工业、水彩
 * - 技术风格系列(5种)：终端、GitHub、Linear、Notion、VS Code
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
	},

	// ========== 现代多样化系列 ==========

	{
		// 风格8：科技极简风 - 现代科技感
		id: 'tech-minimal',
		name: '科技极简风',
		layout: 'tech_minimal',
		promptStyle: '像科技产品的说明书：简洁、理性、专业。用冷静的蓝灰色调，传达可信赖的专业内容。',
		background: '#F8FAFC',
		card: '#FFFFFF',
		textPrimary: '#0F172A',
		textSecondary: '#475569',
		accent: '#3B82F6',
		border: '#E2E8F0',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'line',
		hasTexture: false,
		borderRadius: 8
	},
	{
		// 风格9：北欧清新风 - 自然简约
		id: 'nordic-fresh',
		name: '���欧清新风',
		layout: 'nordic_fresh',
		promptStyle: '像北欧家居杂志：自然、温暖、舒适。用大地色系和留白，营造hygge式的阅读体验。',
		background: '#F5F7F4',
		card: '#FFFFFF',
		textPrimary: '#2D3B36',
		textSecondary: '#4A5B53',
		accent: '#5A9A7A',
		border: '#D4DDD8',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 70,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'none',
		hasTexture: false,
		borderRadius: 12
	},
	{
		// 风格10：活力渐变风 - 活泼有活力
		id: 'vibrant-coral',
		name: '活力渐变风',
		layout: 'vibrant_coral',
		promptStyle: '像小红书爆款笔记：活泼、有趣、正能量。用珊瑚粉和暖色调，传递积极向上的生活态度。',
		background: '#FFF5F5',
		card: '#FFFBFB',
		textPrimary: '#1F2937',
		textSecondary: '#4B5563',
		accent: '#F43F5E',
		border: '#FECDD3',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'none',
		hasTexture: false,
		borderRadius: 16
	},
	{
		// 风格11：高端商务风 - 专业沉稳
		id: 'premium-business',
		name: '高端商务风',
		layout: 'premium_business',
		promptStyle: '像商业杂志的深度报道：专业、沉稳、有格调。深蓝配金色，彰显品质与洞察力。',
		background: '#0F172A',
		card: '#1E293B',
		textPrimary: '#F8FAFC',
		textSecondary: '#CBD5E1',
		accent: '#D4AF37',
		border: '#334155',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 70,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'western',
		hasTexture: false,
		borderRadius: 4
	},
	{
		// 风格12：清新自然风 - 舒适疗愈
		id: 'nature-wellness',
		name: '清新自然风',
		layout: 'nature_wellness',
		promptStyle: '像森林浴的体验：清新、舒适、疗愈。薄荷绿与大地色，让阅读成为一场心灵放松。',
		background: '#F0FDF4',
		card: '#FAFFFE',
		textPrimary: '#14532D',
		textSecondary: '#374151',
		accent: '#10B981',
		border: '#BBF7D0',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'none',
		hasTexture: false,
		borderRadius: 12
	},

	// ========== 艺术风格系列 ==========

	{
		// 风格13：莫兰迪色系 - 高级灰调
		id: 'morandi-gray',
		name: '莫兰迪色系',
		layout: 'morandi_gray',
		promptStyle: '像莫兰迪的静物画：高级、克制、有质感。用灰调和柔和的色彩，传达优雅从容的品味。',
		background: '#E8E4E1',
		card: '#F2EFEC',
		textPrimary: '#4A4543',
		textSecondary: '#7A7573',
		accent: '#9B8B7A',
		border: '#D5D0CB',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'line',
		hasTexture: false,
		borderRadius: 6
	},
	{
		// 风格14：日系杂志风 - 清新文艺
		id: 'japanese-magazine',
		name: '日系杂志风',
		layout: 'japanese_magazine',
		promptStyle: '像日本生活杂志：清新、文艺、治愈。用留白和简洁的排版，营造小确幸的阅读感受。',
		background: '#FFFEF9',
		card: '#FFFFFF',
		textPrimary: '#2C2C2C',
		textSecondary: '#6B6B6B',
		accent: '#E8927C',
		border: '#F0EBE3',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 66,
		subtitleSize: 38,
		bodySize: 30,
		captionSize: 22,
		quoteStyle: 'chinese',
		hasTexture: false,
		borderRadius: 0
	},
	{
		// 风格15：工业风 - 硬朗现代
		id: 'industrial-modern',
		name: '工业风',
		layout: 'industrial_modern',
		promptStyle: '像工业设计展览：硬朗、现代、有力量。用深色和高对比，传达专业果断的态度。',
		background: '#1A1A1A',
		card: '#262626',
		textPrimary: '#FFFFFF',
		textSecondary: '#A3A3A3',
		accent: '#F59E0B',
		border: '#404040',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 72,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'line',
		hasTexture: false,
		borderRadius: 0
	},
	{
		// 风格16：水彩风 - 柔和艺术
		id: 'watercolor-art',
		name: '水彩风',
		layout: 'watercolor_art',
		promptStyle: '像水彩画的留白：柔和、艺术、有意境。用淡雅的色彩和渐变，营造诗意的阅读氛围。',
		background: '#F8FAFC',
		card: '#FFFFFF',
		textPrimary: '#334155',
		textSecondary: '#64748B',
		accent: '#06B6D4',
		border: '#E0F2FE',
		titleFont: HANDWRITING_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: HANDWRITING_FONTS.decorative,
		titleSize: 70,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'chinese',
		hasTexture: true,
		borderRadius: 16
	},

	// ========== 技术风格系列 ==========

	{
		// 风格17：终端风格 - 程序员极客范
		id: 'terminal-cli',
		name: '终端风格',
		layout: 'terminal_cli',
		promptStyle: '像黑客的终端界面：极客、硬核、专业。黑底绿字的经典风格，传递技术深度和专业性。',
		background: '#0D1117',
		card: '#161B22',
		textPrimary: '#C9D1D9',
		textSecondary: '#8B949E',
		accent: '#3FB950',
		border: '#30363D',
		titleFont: MODERN_FONTS.decorative,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'line',
		hasTexture: false,
		borderRadius: 8
	},
	{
		// 风格18：GitHub风格 - 开源社区
		id: 'github-opensource',
		name: 'GitHub风格',
		layout: 'github_opensource',
		promptStyle: '像GitHub的README：专业、开放、可信赖。简洁明了的设计语言，传递开源协作精神。',
		background: '#FFFFFF',
		card: '#F6F8FA',
		textPrimary: '#24292F',
		textSecondary: '#57606A',
		accent: '#0969DA',
		border: '#D0D7DE',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'line',
		hasTexture: false,
		borderRadius: 6
	},
	{
		// 风格19：Linear风格 - 现代SaaS
		id: 'linear-saas',
		name: 'Linear风格',
		layout: 'linear_saas',
		promptStyle: '像Linear的产品界面：极简、精致、现代。黑白为主的高级感，传递专业产品力。',
		background: '#000000',
		card: '#18181B',
		textPrimary: '#FAFAFA',
		textSecondary: '#A1A1AA',
		accent: '#5E5CE6',
		border: '#27272A',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 70,
		subtitleSize: 42,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'none',
		hasTexture: false,
		borderRadius: 12
	},
	{
		// 风格20：Notion风格 - 文档工具
		id: 'notion-docs',
		name: 'Notion风格',
		layout: 'notion_docs',
		promptStyle: '像Notion的文档页面：清爽、专注、高效。让内容成为主角，传递知识管理的专业感。',
		background: '#FFFFFF',
		card: '#F7F6F3',
		textPrimary: '#37352F',
		textSecondary: '#787774',
		accent: '#EB5757',
		border: '#E3E2E0',
		titleFont: MODERN_FONTS.title,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'none',
		hasTexture: false,
		borderRadius: 4
	},
	{
		// 风格21：VS Code风格 - 代码编辑器
		id: 'vscode-editor',
		name: 'VS Code风格',
		layout: 'vscode_editor',
		promptStyle: '像VS Code的编辑器界面：开发者友好、专业护眼。深色主题配语法高亮色，传递编程美学。',
		background: '#1E1E1E',
		card: '#252526',
		textPrimary: '#D4D4D4',
		textSecondary: '#858585',
		accent: '#569CD6',
		border: '#3C3C3C',
		titleFont: MODERN_FONTS.decorative,
		bodyFont: MODERN_FONTS.body,
		decorativeFont: MODERN_FONTS.decorative,
		titleSize: 68,
		subtitleSize: 40,
		bodySize: 32,
		captionSize: 24,
		quoteStyle: 'line',
		hasTexture: false,
		borderRadius: 4
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

/**
 * 随机获取一个风格预设
 * 每次调用返回不同的随机风格
 */
export function getRandomXiaohongshuStyle(): XiaohongshuStylePreset {
	const randomIndex = Math.floor(Math.random() * XIAOHONGSHU_STYLE_PRESETS.length);
	return XIAOHONGSHU_STYLE_PRESETS[randomIndex];
}

/**
 * 获取所有风格预设
 */
export function getAllXiaohongshuStyles(): XiaohongshuStylePreset[] {
	return [...XIAOHONGSHU_STYLE_PRESETS];
}

/**
 * 获取风格总数
 */
export function getXiaohongshuStyleCount(): number {
	return XIAOHONGSHU_STYLE_PRESETS.length;
}
