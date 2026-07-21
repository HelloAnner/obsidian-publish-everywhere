import { SecretStorage } from 'obsidian';
import { FeishuAuthState, FeishuSecretBundle } from './feishu-auth-types';

const SECRET_ID = 'feishu-credentials';
/** Marker persisted in data.json meaning "secrets live in app.secretStorage". */
const SECRET_MARKER = 'secret-storage:v1';

/**
 * Keeps OAuth credentials out of plaintext Obsidian settings.
 *
 * Secrets are stored via Obsidian's built-in `app.secretStorage` (the
 * "Keychain" feature, available since Obsidian 1.11.4), which delegates to
 * the OS credential store (macOS Keychain / Windows DPAPI / Linux Secret
 * Service) from Obsidian's main process.
 *
 * Note: `require('electron').safeStorage` cannot be used here — Obsidian
 * plugins run in the renderer process where safeStorage is undefined.
 */
export class FeishuCredentialStore {
	constructor(private readonly getStorage: () => SecretStorage | null | undefined) {}

	assertEncryptionAvailable(): void {
		if (!this.storage()) {
			throw new Error('当前 Obsidian 版本不支持系统安全凭据存储（需要 Obsidian 1.11.4 或更高版本），请升级 Obsidian 后重试');
		}
	}

	encrypt(bundle: FeishuSecretBundle): string {
		this.assertEncryptionAvailable();
		this.storage()!.setSecret(SECRET_ID, JSON.stringify(bundle));
		return SECRET_MARKER;
	}

	decrypt(state: FeishuAuthState | null | undefined): FeishuSecretBundle | null {
		if (!state?.encryptedCredentials) return null;
		if (state.encryptedCredentials !== SECRET_MARKER) {
			// Legacy Electron safeStorage payload from older plugin versions.
			// It cannot be decrypted from the renderer process; require a fresh
			// authorization instead of keeping unusable state around.
			return null;
		}
		const storage = this.storage();
		if (!storage) return null;
		try {
			const text = storage.getSecret(SECRET_ID);
			if (!text) return null;
			const parsed = JSON.parse(text) as FeishuSecretBundle;
			if (!parsed?.appSecret) return null;
			return parsed;
		} catch (_error) {
			return null;
		}
	}

	clear(): void {
		try {
			this.storage()?.setSecret(SECRET_ID, '');
		} catch (_error) {
			// Best effort: secret storage may be unavailable on old versions.
		}
	}

	private storage(): SecretStorage | null {
		const storage = this.getStorage();
		if (!storage || typeof storage.getSecret !== 'function' || typeof storage.setSecret !== 'function') {
			return null;
		}
		return storage;
	}
}
