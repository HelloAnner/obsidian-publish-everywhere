export const FEISHU_ENDPOINTS = {
	open: 'https://open.feishu.cn',
	accounts: 'https://accounts.feishu.cn',
	appRegistration: 'https://accounts.feishu.cn/oauth/v1/app/registration',
	deviceAuthorization: 'https://accounts.feishu.cn/oauth/v1/device_authorization',
	token: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
	userInfo: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
} as const;

/**
 * Narrow scopes used by the KMS-compatible publish flow. All are marked as
 * recommended scopes by larksuite/cli's permission registry.
 */
export const FEISHU_PUBLISH_SCOPES = [
	'docx:document:create',
	'docx:document:write_only',
	'docx:document:readonly',
	'wiki:node:retrieve',
	'offline_access',
] as const;
