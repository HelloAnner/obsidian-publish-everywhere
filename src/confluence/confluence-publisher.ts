import { App, TFile } from 'obsidian';
import { ConfluenceClient } from './confluence-client';
import { ConfluenceMarkdownConverter } from './markdown-to-confluence';
import { ConfluenceImageHandler } from './confluence-image-handler';

export interface ConfluencePublishResult {
	pageId: string;
	pageUrl: string;
}

export class ConfluencePublisher {
	private readonly app: App;
	private readonly client: ConfluenceClient;
	private readonly markdownConverter: ConfluenceMarkdownConverter;
	private readonly vaultBasePath: string;

	constructor(params: { app: App; client: ConfluenceClient; vaultBasePath: string }) {
		this.app = params.app;
		this.client = params.client;
		this.vaultBasePath = params.vaultBasePath;
		this.markdownConverter = new ConfluenceMarkdownConverter();
	}

	async publishMarkdownFile(params: {
		file: TFile;
		title: string;
		parentPageId: string;
		rawContent?: string;
	}): Promise<ConfluencePublishResult> {
		const raw = params.rawContent ?? (await this.app.vault.read(params.file));
		const storageHtml = await this.markdownConverter.convert(raw);

		const existing = await this.client.findPageInParent(params.title, params.parentPageId);
		const attachmentPageId = existing ? existing.id : params.parentPageId;

		const imageHandler = new ConfluenceImageHandler({
			app: this.app,
			client: this.client,
			sourceFile: params.file,
			vaultBasePath: this.vaultBasePath
		});
		const contentWithImages = await imageHandler.processImages(storageHtml, attachmentPageId);

		let pageId: string;
		if (existing) {
			await this.client.updatePage({ pageId: existing.id, title: params.title, bodyStorage: contentWithImages });
			pageId = existing.id;
		} else {
			const created = await this.client.createPage({
				title: params.title,
				bodyStorage: contentWithImages,
				parentPageId: params.parentPageId
			});
			pageId = created.id;
		}

		return { pageId, pageUrl: this.client.buildPageUrl(pageId) };
	}
}
