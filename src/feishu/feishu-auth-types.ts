export type FeishuBrand = 'feishu';

/** Non-secret authentication metadata persisted in Obsidian's data.json. */
export interface FeishuAuthState {
	version: 1;
	brand: FeishuBrand;
	appId: string;
	encryptedCredentials: string;
	connected: boolean;
	userOpenId?: string;
	userName?: string;
	scope?: string;
	connectedAt?: number;
}

/** Secrets kept in Obsidian's secretStorage; data.json only stores a marker. */
export interface FeishuSecretBundle {
	appSecret: string;
	accessToken?: string;
	refreshToken?: string;
	accessTokenExpiresAt?: number;
	refreshTokenExpiresAt?: number;
}

export interface FeishuConnectionStatus {
	connected: boolean;
	hasPersonalApp: boolean;
	userName?: string;
	userOpenId?: string;
	scope?: string;
}

export type FeishuAuthProgress = (message: string) => void;
