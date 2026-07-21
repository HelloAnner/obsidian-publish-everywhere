import { App, SecretStorage } from 'obsidian';

/**
 * Thin wrapper over `app.secretStorage` (Obsidian 1.11.4+, the "Keychain"
 * feature), which delegates to the OS credential store from Obsidian's main
 * process. Keeps personal secrets (e.g. the Feishu MCP URL) out of the
 * plaintext data.json.
 *
 * Note: `require('electron').safeStorage` is not an alternative — Obsidian
 * plugins run in the renderer process where safeStorage is undefined.
 */
export class SecretStore {
	constructor(private readonly app: App) {}

	isAvailable(): boolean {
		return !!this.storage();
	}

	get(id: string): string | null {
		const storage = this.storage();
		if (!storage) return null;
		try {
			const value = storage.getSecret(id);
			return value && value.trim() ? value : null;
		} catch (_error) {
			return null;
		}
	}

	set(id: string, value: string): boolean {
		const storage = this.storage();
		if (!storage) return false;
		try {
			storage.setSecret(id, value);
			return true;
		} catch (_error) {
			return false;
		}
	}

	clear(id: string): void {
		try {
			this.storage()?.setSecret(id, '');
		} catch (_error) {
			// Best effort: secret storage may be unavailable on old versions.
		}
	}

	private storage(): SecretStorage | null {
		const storage = this.app.secretStorage as SecretStorage | undefined;
		if (!storage || typeof storage.getSecret !== 'function' || typeof storage.setSecret !== 'function') {
			return null;
		}
		return storage;
	}
}
