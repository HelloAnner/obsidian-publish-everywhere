import { FeishuAuthState, FeishuSecretBundle } from './feishu-auth-types';

/**
 * Keeps OAuth credentials out of plaintext Obsidian settings. On macOS,
 * Electron safeStorage delegates encryption to the user's system Keychain.
 */
export class FeishuCredentialStore {
	assertEncryptionAvailable(): void {
		const safeStorage = this.safeStorage();
		if (!safeStorage?.isEncryptionAvailable?.()) {
			throw new Error('当前系统无法使用安全凭据存储，已停止飞书授权，避免明文保存 Token');
		}
	}

	encrypt(bundle: FeishuSecretBundle): string {
		this.assertEncryptionAvailable();
		const encrypted = this.safeStorage().encryptString(JSON.stringify(bundle));
		return Buffer.from(encrypted).toString('base64');
	}

	decrypt(state: FeishuAuthState | null | undefined): FeishuSecretBundle | null {
		if (!state?.encryptedCredentials) return null;
		this.assertEncryptionAvailable();
		try {
			const encrypted = Buffer.from(state.encryptedCredentials, 'base64');
			const text = this.safeStorage().decryptString(encrypted);
			const parsed = JSON.parse(text) as FeishuSecretBundle;
			if (!parsed?.appSecret) return null;
			return parsed;
		} catch (_error) {
			throw new Error('无法解密飞书凭据；可能是系统钥匙串已变化，请重置飞书连接');
		}
	}

	private safeStorage(): any {
		try {
			// Electron is a runtime external in Obsidian desktop.
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			return require('electron').safeStorage;
		} catch (_error) {
			return null;
		}
	}
}
