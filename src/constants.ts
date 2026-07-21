/**
 * 飞书发布相关常量
 */

import type { FeishuSettings } from './types';

export const DEFAULT_SETTINGS: Partial<FeishuSettings> = {
	feishuAuth: null,

	frontMatterHandling: 'remove',
	codeBlockFilterLanguages: [],
	suppressShareNotices: false,
	simpleSuccessNotice: false,
	llmBaseUrl: '',
	llmModel: '',
	llmApiKey: '',
	xiaohongshuLastStyleSeed: -1,
};

/**
 * 成功通知模板（简单、易于修改）
 * 可用占位符：{title}
 */
export const SUCCESS_NOTICE_TEMPLATE = '✅ 分享成功：{title}';

/**
 * Obsidian Callout 类型到飞书样式的映射表
 */
export const CALLOUT_TYPE_MAPPING: Record<string, { emoji: string; color: string; title: string }> = {
	// 信息类
	'note': { emoji: '📝', color: 'blue', title: '笔记' },
	'info': { emoji: 'ℹ️', color: 'blue', title: '信息' },
	'tip': { emoji: '💡', color: 'green', title: '提示' },
	'hint': { emoji: '💡', color: 'green', title: '提示' },

	// 警告类
	'warning': { emoji: '⚠️', color: 'yellow', title: '警告' },
	'caution': { emoji: '⚠️', color: 'yellow', title: '注意' },
	'attention': { emoji: '⚠️', color: 'yellow', title: '注意' },

	// 错误类
	'error': { emoji: '❌', color: 'red', title: '错误' },
	'danger': { emoji: '⛔', color: 'red', title: '危险' },
	'failure': { emoji: '❌', color: 'red', title: '失败' },
	'fail': { emoji: '❌', color: 'red', title: '失败' },
	'missing': { emoji: '❓', color: 'red', title: '缺失' },

	// 成功类
	'success': { emoji: '✅', color: 'green', title: '成功' },
	'check': { emoji: '✅', color: 'green', title: '检查' },
	'done': { emoji: '✅', color: 'green', title: '完成' },

	// 问题类
	'question': { emoji: '❓', color: 'purple', title: '问题' },
	'help': { emoji: '❓', color: 'purple', title: '帮助' },
	'faq': { emoji: '❓', color: 'purple', title: '常见问题' },

	// 引用类
	'quote': { emoji: '💬', color: 'gray', title: '引用' },
	'cite': { emoji: '📖', color: 'gray', title: '引用' },

	// 抽象类
	'abstract': { emoji: '📄', color: 'cyan', title: '摘要' },
	'summary': { emoji: '📄', color: 'cyan', title: '总结' },
	'tldr': { emoji: '📄', color: 'cyan', title: 'TL;DR' },

	// 示例类
	'example': { emoji: '📋', color: 'purple', title: '示例' },

	// 任务类
	'todo': { emoji: '☑️', color: 'blue', title: '待办' },

	// 默认类型
	'default': { emoji: '📌', color: 'blue', title: '提示' }
};
