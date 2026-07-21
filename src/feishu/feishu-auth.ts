import { requestUrl } from 'obsidian';
import { FeishuCredentialStore } from './feishu-credential-store';
import { FEISHU_ENDPOINTS, FEISHU_PUBLISH_SCOPES } from './feishu-endpoints';
import {
	FeishuAuthProgress,
	FeishuAuthState,
	FeishuConnectionStatus,
	FeishuSecretBundle,
} from './feishu-auth-types';

const ACCESS_TOKEN_REFRESH_AHEAD_MS = 5 * 60 * 1000;
const DEFAULT_ACCESS_TOKEN_SECONDS = 7200;
const DEFAULT_REFRESH_TOKEN_SECONDS = 7 * 24 * 60 * 60;

interface AppRegistrationStart {
	deviceCode: string;
	verificationUrl: string;
	expiresIn: number;
	interval: number;
}

interface AppRegistrationResult {
	appId: string;
	appSecret: string;
}

interface DeviceAuthorizationStart {
	deviceCode: string;
	verificationUrl: string;
	expiresIn: number;
	interval: number;
}

interface DeviceTokenResult {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	refreshExpiresIn: number;
	scope: string;
}

interface FeishuAuthServiceOptions {
	getState: () => FeishuAuthState | null | undefined;
	saveState: (state: FeishuAuthState | null) => Promise<void>;
}

/**
 * PersonalAgent registration and OAuth Device Flow, reimplemented from the
 * MIT-licensed larksuite/cli authentication flow. No CLI process or MCP is used.
 */
export class FeishuAuthService {
	private readonly credentialStore = new FeishuCredentialStore();
	private readonly getStateValue: () => FeishuAuthState | null | undefined;
	private readonly saveStateValue: (state: FeishuAuthState | null) => Promise<void>;
	private connectPromise: Promise<FeishuConnectionStatus> | null = null;
	private refreshPromise: Promise<string> | null = null;
	private operationGeneration = 0;

	constructor(options: FeishuAuthServiceOptions) {
		this.getStateValue = options.getState;
		this.saveStateValue = options.saveState;
	}

	getStatus(): FeishuConnectionStatus {
		const state = this.getStateValue();
		return {
			connected: !!state?.connected,
			hasPersonalApp: !!state?.appId && !!state?.encryptedCredentials,
			userName: state?.userName,
			userOpenId: state?.userOpenId,
			scope: state?.scope,
		};
	}

	isConnected(): boolean {
		return this.getStatus().connected;
	}

	async connect(progress: FeishuAuthProgress = () => undefined): Promise<FeishuConnectionStatus> {
		if (this.connectPromise) return this.connectPromise;
		const generation = ++this.operationGeneration;
		const pending = this.runConnect(generation, progress);
		this.connectPromise = pending;
		try {
			return await pending;
		} finally {
			if (this.connectPromise === pending) this.connectPromise = null;
		}
	}

	cancelPendingOperations(): void {
		this.operationGeneration++;
	}

	async logout(): Promise<void> {
		this.cancelPendingOperations();
		const state = this.getStateValue();
		if (!state) return;
		const bundle = this.credentialStore.decrypt(state);
		if (!bundle) {
			await this.saveStateValue(null);
			return;
		}
		const appOnly: FeishuSecretBundle = { appSecret: bundle.appSecret };
		await this.saveStateValue({
			version: 1,
			brand: 'feishu',
			appId: state.appId,
			encryptedCredentials: this.credentialStore.encrypt(appOnly),
			connected: false,
		});
	}

	async resetConnection(): Promise<void> {
		this.cancelPendingOperations();
		await this.saveStateValue(null);
	}

	async getValidAccessToken(forceRefresh = false): Promise<string> {
		const state = this.getStateValue();
		const bundle = this.credentialStore.decrypt(state);
		if (!state?.appId || !state.connected || !bundle?.accessToken) {
			throw new Error('飞书尚未连接，请先在插件设置中点击“连接飞书”');
		}

		const expiresAt = bundle.accessTokenExpiresAt || 0;
		if (!forceRefresh && Date.now() < expiresAt - ACCESS_TOKEN_REFRESH_AHEAD_MS) {
			return bundle.accessToken;
		}
		return this.refreshAccessToken();
	}

	async refreshAccessToken(): Promise<string> {
		if (this.refreshPromise) return this.refreshPromise;
		const pending = this.doRefreshAccessToken();
		this.refreshPromise = pending;
		try {
			return await pending;
		} finally {
			if (this.refreshPromise === pending) this.refreshPromise = null;
		}
	}

	private async runConnect(generation: number, progress: FeishuAuthProgress): Promise<FeishuConnectionStatus> {
		this.credentialStore.assertEncryptionAvailable();
		let state = this.getStateValue();
		let bundle = this.credentialStore.decrypt(state);

		if (!state?.appId || !bundle?.appSecret) {
			progress('正在创建个人飞书连接…');
			const start = await this.beginAppRegistration();
			this.assertActive(generation);
			progress('浏览器已打开，请确认配置个人连接…');
			await this.openExternal(start.verificationUrl);
			const registered = await this.pollAppRegistration(start, generation, progress);
			bundle = { appSecret: registered.appSecret };
			state = {
				version: 1,
				brand: 'feishu',
				appId: registered.appId,
				encryptedCredentials: this.credentialStore.encrypt(bundle),
				connected: false,
			};
			// Persist the personal client before the second browser step so a denied
			// OAuth grant does not create another PersonalAgent on the next attempt.
			await this.saveStateValue(state);
		}

		this.assertActive(generation);
		progress('正在申请最小文档权限…');
		const authorization = await this.beginDeviceAuthorization(state.appId, bundle.appSecret);
		this.assertActive(generation);
		progress('浏览器已打开，请确认文档授权…');
		await this.openExternal(authorization.verificationUrl);
		const token = await this.pollDeviceToken(
			authorization,
			state.appId,
			bundle.appSecret,
			generation,
			progress,
		);
		this.assertActive(generation);
		progress('正在确认飞书账号…');
		const user = await this.getUserInfo(token.accessToken);
		const now = Date.now();
		const completedBundle: FeishuSecretBundle = {
			appSecret: bundle.appSecret,
			accessToken: token.accessToken,
			refreshToken: token.refreshToken,
			accessTokenExpiresAt: now + token.expiresIn * 1000,
			refreshTokenExpiresAt: now + token.refreshExpiresIn * 1000,
		};
		const completed: FeishuAuthState = {
			version: 1,
			brand: 'feishu',
			appId: state.appId,
			encryptedCredentials: this.credentialStore.encrypt(completedBundle),
			connected: true,
			userOpenId: user.openId,
			userName: user.name,
			scope: token.scope,
			connectedAt: now,
		};
		await this.saveStateValue(completed);
		progress('飞书连接成功');
		return this.getStatus();
	}

	private async beginAppRegistration(): Promise<AppRegistrationStart> {
		const payload = await this.formRequest(FEISHU_ENDPOINTS.appRegistration, {
			action: 'begin',
			archetype: 'PersonalAgent',
			auth_method: 'client_secret',
			request_user_info: 'open_id tenant_brand',
		});
		this.throwOAuthError(payload, '创建个人飞书连接失败');
		const deviceCode = stringValue(payload.device_code);
		const userCode = stringValue(payload.user_code);
		if (!deviceCode || !userCode) throw new Error('创建个人飞书连接失败：响应缺少 device_code');
		const verificationUrl = stringValue(payload.verification_uri_complete)
			|| `${FEISHU_ENDPOINTS.open}/page/cli?user_code=${encodeURIComponent(userCode)}`;
		return {
			deviceCode,
			verificationUrl,
			expiresIn: positiveNumber(payload.expire_in ?? payload.expires_in, 600),
			interval: positiveNumber(payload.interval, 5),
		};
	}

	private async pollAppRegistration(
		start: AppRegistrationStart,
		generation: number,
		progress: FeishuAuthProgress,
	): Promise<AppRegistrationResult> {
		const deadline = Date.now() + start.expiresIn * 1000;
		let interval = start.interval;
		let waitBeforePoll = false;
		while (Date.now() < deadline) {
			this.assertActive(generation);
			if (waitBeforePoll) await this.sleep(interval * 1000, generation);
			waitBeforePoll = true;
			let payload: any;
			try {
				payload = await this.formRequest(FEISHU_ENDPOINTS.appRegistration, {
					action: 'poll',
					device_code: start.deviceCode,
				});
			} catch (_error) {
				interval = Math.min(interval + 1, 60);
				progress('网络波动，继续等待个人连接确认…');
				continue;
			}

			const tenantBrand = stringValue(payload?.user_info?.tenant_brand);
			if (tenantBrand && tenantBrand !== 'feishu') {
				throw new Error('当前账号属于 Lark 国际版，本插件目前只支持飞书');
			}
			const appId = stringValue(payload.client_id);
			const appSecret = stringValue(payload.client_secret);
			if (!payload.error && appId && appSecret) return { appId, appSecret };
			const error = stringValue(payload.error);
			if (!error || error === 'authorization_pending') continue;
			if (error === 'slow_down') {
				interval = Math.min(interval + 5, 60);
				continue;
			}
			if (error === 'access_denied') throw new Error('你取消了个人飞书连接');
			if (error === 'expired_token' || error === 'invalid_grant') break;
			this.throwOAuthError(payload, '创建个人飞书连接失败');
		}
		throw new Error('个人飞书连接已过期，请重新点击连接');
	}

	private async beginDeviceAuthorization(appId: string, appSecret: string): Promise<DeviceAuthorizationStart> {
		const authorization = `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`;
		const payload = await this.formRequest(
			FEISHU_ENDPOINTS.deviceAuthorization,
			{
				client_id: appId,
				scope: FEISHU_PUBLISH_SCOPES.join(' '),
			},
			{ Authorization: authorization },
		);
		this.throwOAuthError(payload, '发起飞书文档授权失败');
		const deviceCode = stringValue(payload.device_code);
		const verificationUrl = stringValue(payload.verification_uri_complete)
			|| stringValue(payload.verification_uri);
		if (!deviceCode || !verificationUrl) throw new Error('发起飞书文档授权失败：响应不完整');
		return {
			deviceCode,
			verificationUrl,
			expiresIn: positiveNumber(payload.expires_in, 240),
			interval: positiveNumber(payload.interval, 5),
		};
	}

	private async pollDeviceToken(
		start: DeviceAuthorizationStart,
		appId: string,
		appSecret: string,
		generation: number,
		progress: FeishuAuthProgress,
	): Promise<DeviceTokenResult> {
		const deadline = Date.now() + start.expiresIn * 1000;
		let interval = start.interval;
		while (Date.now() < deadline) {
			await this.sleep(interval * 1000, generation);
			let payload: any;
			try {
				payload = await this.formRequest(FEISHU_ENDPOINTS.token, {
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
					device_code: start.deviceCode,
					client_id: appId,
					client_secret: appSecret,
				});
			} catch (_error) {
				interval = Math.min(interval + 1, 60);
				progress('网络波动，继续等待文档授权…');
				continue;
			}
			const accessToken = stringValue(payload.access_token);
			if (!payload.error && accessToken) {
				return {
					accessToken,
					refreshToken: stringValue(payload.refresh_token),
					expiresIn: positiveNumber(payload.expires_in, DEFAULT_ACCESS_TOKEN_SECONDS),
					refreshExpiresIn: positiveNumber(payload.refresh_token_expires_in, DEFAULT_REFRESH_TOKEN_SECONDS),
					scope: stringValue(payload.scope) || FEISHU_PUBLISH_SCOPES.join(' '),
				};
			}
			const error = stringValue(payload.error);
			if (error === 'authorization_pending') continue;
			if (error === 'slow_down') {
				interval = Math.min(interval + 5, 60);
				continue;
			}
			if (error === 'access_denied') throw new Error('你取消了飞书文档授权');
			if (error === 'expired_token' || error === 'invalid_grant') break;
			this.throwOAuthError(payload, '飞书文档授权失败');
		}
		throw new Error('飞书文档授权已过期，请重新点击连接');
	}

	private async getUserInfo(accessToken: string): Promise<{ openId: string; name: string }> {
		const response = await requestUrl({
			url: FEISHU_ENDPOINTS.userInfo,
			method: 'GET',
			headers: { Authorization: `Bearer ${accessToken}` },
			throw: false,
		});
		const payload = parsePayload(response.text, response.json);
		if (response.status < 200 || response.status >= 300 || Number(payload.code || 0) !== 0) {
			throw new Error(`获取飞书用户信息失败：${stringValue(payload.msg) || `HTTP ${response.status}`}`);
		}
		const data = payload.data || {};
		const openId = stringValue(data.open_id) || stringValue(data.user_id);
		if (!openId) throw new Error('获取飞书用户信息失败：响应缺少用户标识');
		return { openId, name: stringValue(data.name) || '飞书用户' };
	}

	private async doRefreshAccessToken(): Promise<string> {
		const state = this.getStateValue();
		const bundle = this.credentialStore.decrypt(state);
		if (!state?.appId || !bundle?.appSecret || !bundle.refreshToken) {
			throw new Error('飞书登录已失效，请在插件设置中重新授权');
		}
		if (Date.now() >= (bundle.refreshTokenExpiresAt || 0)) {
			await this.markDisconnected(state, bundle.appSecret);
			throw new Error('飞书登录已过期，请在插件设置中重新授权');
		}

		const payload = await this.formRequest(FEISHU_ENDPOINTS.token, {
			grant_type: 'refresh_token',
			refresh_token: bundle.refreshToken,
			client_id: state.appId,
			client_secret: bundle.appSecret,
		});
		try {
			this.throwOAuthError(payload, '刷新飞书登录失败');
		} catch (error) {
			const oauthError = stringValue(payload.error);
			if (oauthError === 'invalid_grant' || oauthError === 'invalid_token') {
				await this.markDisconnected(state, bundle.appSecret);
			}
			throw error;
		}
		const accessToken = stringValue(payload.access_token);
		if (!accessToken) throw new Error('刷新飞书登录失败：响应缺少 access_token');
		const now = Date.now();
		const refreshExpiresIn = Number(payload.refresh_token_expires_in || 0);
		const refreshed: FeishuSecretBundle = {
			appSecret: bundle.appSecret,
			accessToken,
			refreshToken: stringValue(payload.refresh_token) || bundle.refreshToken,
			accessTokenExpiresAt: now + positiveNumber(payload.expires_in, DEFAULT_ACCESS_TOKEN_SECONDS) * 1000,
			refreshTokenExpiresAt: refreshExpiresIn > 0
				? now + refreshExpiresIn * 1000
				: bundle.refreshTokenExpiresAt,
		};
		await this.saveStateValue({
			...state,
			encryptedCredentials: this.credentialStore.encrypt(refreshed),
			connected: true,
			scope: stringValue(payload.scope) || state.scope,
		});
		return accessToken;
	}

	private async markDisconnected(state: FeishuAuthState, appSecret: string): Promise<void> {
		await this.saveStateValue({
			version: 1,
			brand: 'feishu',
			appId: state.appId,
			encryptedCredentials: this.credentialStore.encrypt({ appSecret }),
			connected: false,
		});
	}

	private async formRequest(url: string, values: Record<string, string>, extraHeaders: Record<string, string> = {}): Promise<any> {
		const body = Object.entries(values)
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join('&');
		const response = await requestUrl({
			url,
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				...extraHeaders,
			},
			body,
			throw: false,
		});
		const payload = parsePayload(response.text, response.json);
		if (response.status < 200 || response.status >= 300) {
			const detail = stringValue(payload.error_description) || stringValue(payload.msg) || stringValue(payload.error);
			throw new Error(detail || `飞书认证请求失败：HTTP ${response.status}`);
		}
		return payload;
	}

	private throwOAuthError(payload: any, prefix: string): void {
		const code = Number(payload?.code || 0);
		const error = stringValue(payload?.error);
		if (!error && code === 0) return;
		const description = stringValue(payload?.error_description)
			|| stringValue(payload?.msg)
			|| error
			|| `错误码 ${code}`;
		throw new Error(`${prefix}：${description}`);
	}

	private async openExternal(url: string): Promise<void> {
		if (!/^https:\/\//i.test(url)) throw new Error('飞书返回了不安全的授权地址');
		// Electron is a runtime external in Obsidian desktop.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const shell = require('electron').shell;
		await shell.openExternal(url);
	}

	private assertActive(generation: number): void {
		if (generation !== this.operationGeneration) throw new Error('飞书连接操作已取消');
	}

	private async sleep(ms: number, generation: number): Promise<void> {
		const step = Math.min(ms, 500);
		let remaining = ms;
		while (remaining > 0) {
			this.assertActive(generation);
			await new Promise(resolve => setTimeout(resolve, Math.min(step, remaining)));
			remaining -= step;
		}
	}
}

function parsePayload(text: string, json: any): any {
	if (json && typeof json === 'object') return json;
	try {
		return JSON.parse(text || '{}');
	} catch (_error) {
		return {};
	}
}

function stringValue(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function positiveNumber(value: unknown, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
