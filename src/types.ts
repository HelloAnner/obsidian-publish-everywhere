/**
 * 飞书分享插件类型定义
 */

/**
 * 文档标题来源选项
 */
export type TitleSource = 'filename' | 'frontmatter';

/**
 * Front Matter 处理方式选项
 */
export type FrontMatterHandling = 'remove' | 'keep-as-code';

/**
 * 链接分享权限类型
 */
export type LinkSharePermission = 'tenant_readable' | 'tenant_editable' | 'anyone_readable' | 'anyone_editable';

/**
 * 目标类型：云空间或知识库
 */
export type TargetType = 'drive' | 'wiki';

/**
 * 父页面/父文件夹位置信息
 */
export interface ParentLocation {
	type: 'wiki' | 'drive';
	spaceId?: string;
	nodeToken?: string;
	folderId?: string;
	host?: string;
}

/**
 * Notion 父页面解析结果
 */
export interface NotionParentLocation {
	parsed: boolean;
	pageId?: string;
	error?: string;
}

/**
 * 知识库空间信息
 */
export interface WikiSpace {
	space_id: string;
	name: string;
	description?: string;
	space_type: string;
	visibility: string;
}

/**
 * 知识库节点信息
 */
export interface WikiNode {
	space_id: string;
	node_token: string;
	obj_token: string;
	obj_type: string;
	parent_node_token?: string;
	title: string;
	has_child: boolean;
	node_type?: string;
	creator?: string;
	owner?: string;
}

export interface FeishuSettings {
	appId: string;
	appSecret: string;
	callbackUrl: string;
	accessToken: string;
	refreshToken: string;
	userInfo: FeishuUserInfo | null;

	// 新增：目标类型选择
	targetType: TargetType;

	// 云空间设置（原有）
	defaultFolderId: string;
	defaultFolderName: string;

	titleSource: TitleSource;
	frontMatterHandling: FrontMatterHandling;
	// 新增：链接分享设置
	enableLinkShare: boolean;
	linkSharePermission: LinkSharePermission;
	// 新增：内容处理设置
	enableSubDocumentUpload: boolean;
	enableLocalImageUpload: boolean;
	enableLocalAttachmentUpload: boolean;
	// 新增：代码块过滤（多选，命中则移除）
	codeBlockFilterLanguages: string[];
	// 新增：分享标记设置
	enableShareMarkInFrontMatter: boolean;
	// 新增：通知抑制设置（取消分享状态通知）
	suppressShareNotices: boolean;
	// 新增：简洁成功通知（仅一行提示）
	simpleSuccessNotice: boolean;
}

export interface FeishuUserInfo {
	name: string;
	avatar_url: string;
	email: string;
	user_id: string;
}

export interface FeishuOAuthResponse {
	code: number;
	msg?: string;
	// v1 API格式
	data?: {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		token_type: string;
	};
	// v2 API格式（直接在根级别）
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	// v2 API错误格式
	error?: string;
	error_description?: string;
}

export interface FeishuApiError {
	code: number;
	msg: string;
}

export interface ShareResult {
	success: boolean;
	url?: string;
	title?: string;
	error?: string;
	sourceFileToken?: string; // 源文件token，用于临时文档清理
}

export interface FeishuFileUploadResponse {
	code: number;
	msg: string;
	data: {
		file_token: string;
	};
}

export interface FeishuDocCreateResponse {
	code: number;
	msg: string;
	data: {
		document: {
			document_id: string;
			revision_id: number;
			title: string;
		};
	};
}

export interface FeishuFolderListResponse {
	code: number;
	msg: string;
	data: {
		files: Array<{
			token: string;
			name: string;
			type: string;
			parent_token: string;
			url: string;
			created_time: string;
			modified_time: string;
		}>;
		has_more: boolean;
		page_token: string;
	};
}

/**
 * 知识库空间列表响应
 */
export interface WikiSpaceListResponse {
	code: number;
	msg: string;
	data: {
		items: WikiSpace[];
		page_token?: string;
		has_more: boolean;
	};
}

/**
 * 知识库节点列表响应
 */
export interface WikiNodeListResponse {
	code: number;
	msg: string;
	data: {
		items: WikiNode[];
		page_token?: string;
		has_more: boolean;
	};
}

/**
 * 移动文档到知识库响应
 */
export interface MoveDocToWikiResponse {
	code: number;
	msg: string;
	data: {
		wiki_token?: string;
		task_id?: string;
		applied?: boolean;
	};
}

/**
 * 本地文件信息
 */
export interface LocalFileInfo {
	originalPath: string;
	fileName: string;
	placeholder: string;
	isImage: boolean;
	isSubDocument?: boolean;  // 新增：标识是否为子文档（双链引用的md文件）
	isCallout?: boolean;      // 新增：标识是否为 Callout 块
	altText?: string;
	displayWidth?: number;    // 新增：图片目标宽度（像素）
	originalWidth?: number;   // 新增：图片原始宽度
	originalHeight?: number;  // 新增：图片原始高度
}

/**
 * Callout 块信息
 */
export interface CalloutInfo {
	placeholder: string;
	type: string;
	title: string;
	content: string;
	foldable: boolean;
	backgroundColor?: number; // 1-15，对应飞书高亮块背景色
	borderColor?: number;     // 1-7，对应飞书高亮块边框色
	textColor?: number;       // 1-7，对应飞书高亮块文字颜色
	emojiId?: string;         // 表情图标
}

/**
 * Front Matter 解析结果
 */
export interface FrontMatterData {
	title?: string;
	[key: string]: any;
}

/**
 * Markdown处理结果
 */
export interface MarkdownProcessResult {
	content: string;
	localFiles: LocalFileInfo[];
	calloutBlocks?: CalloutInfo[];  // 新增：Callout 块信息
	frontMatter: FrontMatterData | null;
	extractedTitle: string | null;
}

/**
 * 子文档处理结果
 */
export interface SubDocumentResult {
	success: boolean;
	documentToken?: string;
	url?: string;
	title?: string;
	error?: string;
}

/**
 * 处理上下文（用于控制递归深度和防止循环引用）
 */
export interface ProcessContext {
	maxDepth: number;
	currentDepth: number;
	processedFiles: Set<string>; // 防止循环引用
	parentDocumentId?: string;   // 父文档ID，用于建立关联
	// 内容处理设置
	enableSubDocumentUpload?: boolean;
	enableLocalImageUpload?: boolean;
	enableLocalAttachmentUpload?: boolean;
	// 代码块过滤设置：命中语言则移除对应 fenced code block
	codeBlockFilterLanguages?: string[];
	// Front Matter 处理设置
	frontMatterHandling?: 'remove' | 'keep-as-code';
	titleSource?: 'filename' | 'frontmatter';
}

/**
 * 飞书文档块响应
 */
export interface FeishuDocBlocksResponse {
	code: number;
	msg: string;
	data: {
		items: Array<{
			block_id: string;
			block_type: number;
			parent_id: string;
			children: string[];
			text?: {
				elements: Array<{
					text_run?: {
						content: string;
					};
				}>;
			};
		}>;
		has_more: boolean;
		page_token: string;
	};
}

/**
 * 飞书块创建响应
 */
export interface FeishuBlockCreateResponse {
	code: number;
	msg: string;
	data: {
		children: Array<{
			block_id: string;
			block_type: number;
			children?: string[];
		}>;
	};
}

/**
 * 占位符块信息
 */
export interface PlaceholderBlock {
	blockId: string;
	parentId: string;
	index: number;
	placeholder: string;
	fileInfo?: LocalFileInfo;     // 文件信息（可选，用于文件/图片）
	calloutInfo?: CalloutInfo;    // Callout 信息（可选，用于 Callout 块）
}

// ==================== Notion 相关类型定义 ====================

/**
 * Notion 设置
 */
export interface NotionSettings {
    // API 认证（与设置面板字段保持一致）
    notionApiToken: string;

    // 工作空间设置
    notionWorkspaceId?: string;
    notionWorkspaceName?: string;

    // 目标数据库设置
    notionTargetDatabaseId?: string;
    notionTargetDatabaseName?: string;

    // 内容处理设置
    enableNotionSubDocumentUpload: boolean;
    enableNotionImageUpload: boolean;
    enableNotionAttachmentUpload: boolean;

    // 页面属性映射
    notionPageTitleProperty?: string;
    notionPageTagsProperty?: string;
    notionPageStatusProperty?: string;

    // 发布选项
    notionCreateNewIfNotExists: boolean;
    notionUpdateExistingPages: boolean;

    // Notion 特定设置
    notionDefaultPageIcon?: string;
    notionDefaultPageCover?: string;

    // 父页面解析（从 frontmatter.notion 解析）
    notionParentUrl?: string;

    // 内容转换选项
    notionFrontMatterHandling?: 'remove' | 'keep-as-code';
    notionCodeBlockLanguages?: string[];

    // 发布行为控制
    notionEnableShareMarkInFrontMatter?: boolean;
    notionSuppressShareNotices?: boolean;
    notionSimpleSuccessNotice?: boolean;
}

/**
 * Notion 用户信息
 */
export interface NotionUserInfo {
	id: string;
	name?: string;
	avatar_url?: string;
	person?: {
		email: string;
	};
}

/**
 * Notion 页面对象
 */
export interface NotionPage {
	object: 'page';
	id: string;
	created_time: string;
	created_by: NotionUserInfo;
	last_edited_time: string;
	last_edited_by: NotionUserInfo;
	cover?: any;
	icon?: any;
	parent: {
		type: 'workspace' | 'page_id' | 'database_id';
		workspace?: boolean;
		page_id?: string;
		database_id?: string;
	};
	archived: boolean;
	properties: Record<string, any>;
	url: string;
	public_url?: string;
}

/**
 * Notion 数据库对象
 */
export interface NotionDatabase {
	object: 'database';
	id: string;
	created_time: string;
	created_by: NotionUserInfo;
	last_edited_time: string;
	last_edited_by: NotionUserInfo;
	cover?: any;
	icon?: any;
	parent: {
		type: 'workspace' | 'page_id' | 'database_id';
		workspace?: boolean;
		page_id?: string;
		database_id?: string;
	};
	archived: boolean;
	is_inline?: boolean;
	properties: Record<string, any>;
	title: Array<{
		type: 'text';
		text: {
			content: string;
			link?: any;
		};
		annotations?: any;
		plain_text: string;
		href?: any;
	}>;
	description?: Array<{
		type: 'text';
		text: {
			content: string;
			link?: any;
		};
		annotations?: any;
		plain_text: string;
		href?: any;
	}>;
	url: string;
}

/**
 * Notion 块对象基础类型
 */
export interface NotionBlockBase {
	object: 'block';
	id: string;
	created_time: string;
	created_by: NotionUserInfo;
	last_edited_time: string;
	last_edited_by: NotionUserInfo;
	has_children: boolean;
	archived: boolean;
	parent: {
		type: 'workspace' | 'page_id' | 'database_id';
		workspace?: boolean;
		page_id?: string;
		database_id?: string;
	};
}

/**
 * Notion 不同类型的块
 */
export interface NotionTextBlock extends NotionBlockBase {
	type: 'paragraph';
	paragraph: {
		rich_text: NotionRichText[];
		color: string;
	};
}

export interface NotionHeading1Block extends NotionBlockBase {
	type: 'heading_1';
	heading_1: {
		rich_text: NotionRichText[];
		color: string;
		is_toggleable: boolean;
	};
}

export interface NotionHeading2Block extends NotionBlockBase {
	type: 'heading_2';
	heading_2: {
		rich_text: NotionRichText[];
		color: string;
		is_toggleable: boolean;
	};
}

export interface NotionHeading3Block extends NotionBlockBase {
	type: 'heading_3';
	heading_3: {
		rich_text: NotionRichText[];
		color: string;
		is_toggleable: boolean;
	};
}

export interface NotionBulletListItemBlock extends NotionBlockBase {
	type: 'bulleted_list_item';
	bulleted_list_item: {
		rich_text: NotionRichText[];
		color: string;
	};
}

export interface NotionNumberedListItemBlock extends NotionBlockBase {
	type: 'numbered_list_item';
	numbered_list_item: {
		rich_text: NotionRichText[];
		color: string;
	};
}

export interface NotionToDoBlock extends NotionBlockBase {
	type: 'to_do';
	to_do: {
		rich_text: NotionRichText[];
		checked: boolean;
		color: string;
	};
}

export interface NotionCodeBlock extends NotionBlockBase {
	type: 'code';
	code: {
		rich_text: NotionRichText[];
		language: string;
		caption: NotionRichText[];
	};
}

export interface NotionQuoteBlock extends NotionBlockBase {
	type: 'quote';
	quote: {
		rich_text: NotionRichText[];
		color: string;
	};
}

export interface NotionCalloutBlock extends NotionBlockBase {
	type: 'callout';
	callout: {
		rich_text: NotionRichText[];
		icon?: {
			type: 'emoji' | 'external' | 'file';
			emoji?: string;
			external?: { url: string };
			file?: { url: string; expiry_time: string };
		};
		color: string;
	};
}

export interface NotionImageBlock extends NotionBlockBase {
    type: 'image';
    image: {
        // 2024+：Notion 支持 file_upload 作为图片来源
        type: 'external' | 'file' | 'file_upload';
        external?: { url: string };
        file?: { url: string; expiry_time?: string };
        file_upload?: { id: string };
        caption: NotionRichText[];
    };
}

export interface NotionFileBlock extends NotionBlockBase {
    type: 'file';
    file: {
        type: 'external' | 'file' | 'file_upload';
        external?: { url: string };
        file?: { url: string; expiry_time?: string };
        file_upload?: { id: string };
        caption: NotionRichText[];
    };
}

/**
 * Notion 分割线块（用于 ---）
 */
export interface NotionDividerBlock extends NotionBlockBase {
    type: 'divider';
    divider: Record<string, never>;
}

export interface NotionTableBlock extends NotionBlockBase {
	type: 'table';
	table: {
		table_width: number;
		has_column_header: boolean;
		has_row_header: boolean;
	};
}

export interface NotionTableRowBlock extends NotionBlockBase {
	type: 'table_row';
	table_row: {
		cells: NotionRichText[][];
	};
}

export type NotionBlock =
    | NotionTextBlock
    | NotionHeading1Block
    | NotionHeading2Block
    | NotionHeading3Block
    | NotionBulletListItemBlock
    | NotionNumberedListItemBlock
    | NotionToDoBlock
    | NotionCodeBlock
    | NotionQuoteBlock
    | NotionCalloutBlock
    | NotionImageBlock
    | NotionFileBlock
    | NotionTableBlock
    | NotionTableRowBlock
    | NotionDividerBlock;

/**
 * Notion 富文本
 */
export interface NotionRichText {
	type: 'text';
	text: {
		content: string;
		link?: {
			url: string;
		};
	};
	annotations?: {
		bold: boolean;
		italic: boolean;
		strikethrough: boolean;
		underline: boolean;
		code: boolean;
		color: string;
	};
	plain_text: string;
	href?: string;
}

/**
 * Notion API 响应基础结构
 */
export interface NotionApiResponse<T = any> {
	object: string;
	results?: T[];
	next_cursor?: string;
	has_more?: boolean;
}

/**
 * Notion 搜索结果
 */
export interface NotionSearchResult {
	object: 'list';
	results: Array<NotionPage | NotionDatabase>;
	next_cursor?: string;
	has_more: boolean;
}

/**
 * Notion 文件上传响应
 */
export interface NotionFileUploadResponse {
    object: 'file_upload';
    id: string;
    created_time?: string;
    last_edited_time?: string;
    status?: 'pending' | 'uploaded' | 'failed' | 'expired';
    filename?: string;
    content_type?: string;
    content_length?: number;
}

/**
 * Notion 发布结果
 */
export interface NotionPublishResult {
	success: boolean;
	pageId?: string;
	url?: string;
	title?: string;
	error?: string;
	updatedExisting?: boolean;
}

/**
 * Notion 处理上下文
 */
export interface NotionProcessContext {
	apiToken: string;
	targetDatabaseId?: string;
	workspaceId?: string;
	pageTitleProperty?: string;
	pageTagsProperty?: string;
	pageStatusProperty?: string;
	createNewIfNotExists: boolean;
	updateExistingPages: boolean;
	defaultPageIcon?: string;
	defaultPageCover?: string;

	// 新增：内容转换选项
	frontMatterHandling?: 'remove' | 'keep-as-code';
	codeBlockLanguages?: string[];

	// 新增：父页面信息
	parentPageId?: string;
}
