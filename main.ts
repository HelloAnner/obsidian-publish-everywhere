import { exec } from 'child_process';
import { App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TextComponent } from 'obsidian';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ConfluencePublisherSettings {
	confluenceUrl: string;
	username: string;
	password: string;
	space: string;
	md2kmsPath: string;
}

const DEFAULT_SETTINGS: ConfluencePublisherSettings = {
	confluenceUrl: '',
	username: '',
	password: '',
	space: '',
	md2kmsPath: ''
}

interface ProcessResult {
	stdout: string;
	stderr: string;
}

export default class ConfluencePublisher extends Plugin {
	settings: ConfluencePublisherSettings;

	async onload() {
		await this.loadSettings();

		// Add the publish command
		this.addCommand({
			id: 'publish-to-confluence',
			name: 'Publish current note to Confluence',
			checkCallback: (checking: boolean) => {
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					if (!checking) {
						this.publishCurrentNote(markdownView);
					}
					return true;
				}
				return false;
			}
		});

		// Add the settings tab
		this.addSettingTab(new ConfluencePublisherSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async publishCurrentNote(view: MarkdownView) {
		const file = view.file;
		if (!file) {
			console.error('[Publish to Confluence] Error: No file is currently open');
			new Notice('No file is currently open');
			return;
		}

		// Check if settings are configured
		if (!this.settings.confluenceUrl || !this.settings.username ||
			!this.settings.password || !this.settings.space || !this.settings.md2kmsPath) {
			console.error('[Publish to Confluence] Error: Missing configuration', {
				hasUrl: !!this.settings.confluenceUrl,
				hasUsername: !!this.settings.username,
				hasPassword: !!this.settings.password,
				hasSpace: !!this.settings.space,
				hasMd2kmsPath: !!this.settings.md2kmsPath
			});
			new Notice('Please configure all settings first');
			return;
		}

		// Get frontmatter
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;

		if (!frontmatter?.kms) {
			console.error('[Publish to Confluence] Error: No KMS URL found in frontmatter');
			new Notice('No KMS URL found in frontmatter');
			return;
		}

		// Extract pageId from KMS URL
		const pageIdMatch = frontmatter.kms.match(/pageId=(\d+)/);
		if (!pageIdMatch) {
			console.error('[Publish to Confluence] Error: Could not extract pageId from KMS URL:', frontmatter.kms);
			new Notice('Could not extract pageId from KMS URL');
			return;
		}
		const parentId = pageIdMatch[1];

		// Get the absolute path of the file
		const vaultPath = (this.app.vault.adapter as any).basePath;
		const absoluteFilePath = path.join(vaultPath, file.path);

		try {
			// Get the title from the file name (without extension)
			const title = file.basename;

			// Show publishing start message
			new Notice('⏳ 页面发布中...');

			const command = `"${this.settings.md2kmsPath}" --url "${this.settings.confluenceUrl}" --username "${this.settings.username}" --password "${this.settings.password}" --space "${this.settings.space}" --title "${title}" --parent "${parentId}" "${absoluteFilePath}"`;
			console.log('[Publish to Confluence] Executing command:', command.replace(this.settings.password, '********'));

			let processOutput = '';
			let processError = '';

			// Create a promise that resolves when the process ends
			const processPromise = new Promise<ProcessResult>((resolve, reject) => {
				const childProcess = exec(command, {
					maxBuffer: 1024 * 1024 * 10 // 10MB buffer
				});

				childProcess.stdout?.on('data', (data) => {
					processOutput += data;
				});

				childProcess.stderr?.on('data', (data) => {
					processError += data;
				});

				childProcess.on('error', (error) => {
					console.error('[Publish to Confluence] Process error:', error);
					reject(error);
				});

				childProcess.on('exit', (code) => {
					console.log('[Publish to Confluence] Process exited with code:', code);
					if (code === 0) {
						resolve({ stdout: processOutput, stderr: processError });
					} else {
						reject(new Error(processError || `Process exited with code ${code}`));
					}
				});
			});

			// Wait for the process to complete
			await processPromise;

			// Show success message
			const notice = new Notice('✅ 已成功创建页面');
			notice.noticeEl.createEl('button', {
				text: '查看页面',
				cls: 'mod-cta'
			}).onclick = () => {
				window.open(frontmatter.kms, '_blank');
			};

		} catch (error) {
			// Show error message with the tool's output
			new Notice(error.message);
		}
	}
}

class ConfluencePublisherSettingTab extends PluginSettingTab {
	plugin: ConfluencePublisher;

	constructor(app: App, plugin: ConfluencePublisher) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Confluence Publisher Settings' });

		new Setting(containerEl)
			.setName('Confluence URL')
			.setDesc('Your Confluence instance URL')
			.addText(text => text
				.setPlaceholder('https://your-domain.atlassian.net')
				.setValue(this.plugin.settings.confluenceUrl)
				.onChange(async (value: string) => {
					this.plugin.settings.confluenceUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username')
			.setDesc('Your Confluence username/email')
			.addText(text => text
				.setPlaceholder('your.email@domain.com')
				.setValue(this.plugin.settings.username)
				.onChange(async (value: string) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password/Token')
			.setDesc('Your Confluence password or API token')
			.addText((text: TextComponent) => {
				text.setPlaceholder('Enter your password or API token')
					.setValue(this.plugin.settings.password)
					.inputEl.type = 'password';
				text.onChange(async (value: string) => {
					this.plugin.settings.password = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Space')
			.setDesc('Your Confluence space key')
			.addText(text => text
				.setPlaceholder('SPACEKEY')
				.setValue(this.plugin.settings.space)
				.onChange(async (value: string) => {
					this.plugin.settings.space = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('md2kms Path')
			.setDesc('Full path to your md2kms executable')
			.addText(text => text
				.setPlaceholder('/path/to/md2kms')
				.setValue(this.plugin.settings.md2kmsPath)
				.onChange(async (value: string) => {
					this.plugin.settings.md2kmsPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
