import * as path from 'path';
import * as fs from 'fs';
import { App, TFile } from 'obsidian';
import * as mime from 'mime-types';
import { ConfluenceClient } from './confluence-client';
import { ExcalidrawExporter } from './excalidraw-exporter';

export class ConfluenceImageHandler {
	private readonly app: App;
	private readonly client: ConfluenceClient;
	private readonly sourceFile: TFile;
	private readonly vaultBasePath: string;
	private readonly uploaded: Map<string, string> = new Map();
	private readonly excalidrawExporter: ExcalidrawExporter;

	constructor(params: { app: App; client: ConfluenceClient; sourceFile: TFile; vaultBasePath: string }) {
		this.app = params.app;
		this.client = params.client;
		this.sourceFile = params.sourceFile;
		this.vaultBasePath = params.vaultBasePath;
		this.excalidrawExporter = new ExcalidrawExporter(this.app);
	}

	async processImages(content: string, pageId: string): Promise<string> {
		let out = content;

		out = await this.replaceAsync(out, /<img[^>]*src="([^"]+)"[^>]*\/?>/g, async (match, src) => {
			const alt = this.extractAttr(match, 'alt') ?? '';
			return await this.processImageReference(String(src), alt, pageId);
		});

		out = await this.replaceAsync(out, /!\[(.*?)\]\((.*?)\)/g, async (_match, alt, rawPath) => {
			return await this.processImageReference(String(rawPath), String(alt ?? ''), pageId);
		});

		out = await this.replaceAsync(out, /!\[\[(.*?)\]\]/g, async (_match, rawTarget) => {
			const { filePath, width } = this.parseEmbedTarget(String(rawTarget));
			if (this.isExcalidrawFile(filePath)) {
				return await this.processExcalidrawEmbed(filePath, pageId, width ?? 800);
			}
			if (!this.isImageFile(filePath)) {
				return `![[${rawTarget}]]`;
			}
			return await this.processImageReference(filePath, filePath, pageId, width);
		});

		return out;
	}

	private async processExcalidrawEmbed(rawPath: string, pageId: string, displayWidth: number): Promise<string> {
		const tfile = this.resolveLinkToTFile(rawPath);
		if (!tfile) {
			return '';
		}
		const exported = await this.excalidrawExporter.exportToPng(tfile, { displayWidth, scale: 2 });
		const filename = this.excalidrawExportFilename(tfile.name);
		const url = await this.uploadBytes(pageId, filename, exported.bytes, 'image/png', tfile.path);
		return this.buildImageMacro(url, displayWidth);
	}

	private async processImageReference(imagePath: string, _altText: string, pageId: string, displayWidth?: number): Promise<string> {
		const { fullPath, size } = this.processImagePath(imagePath);
		const width = typeof displayWidth === 'number' ? displayWidth : size;

		if (fullPath.startsWith('http://') || fullPath.startsWith('https://')) {
			return this.buildImageMacro(fullPath, width);
		}

		const fileRef = this.resolveLinkToTFile(fullPath) ?? this.resolveAbsoluteOrVaultFile(fullPath);
		if (!fileRef) {
			return '';
		}

		const upload = await this.readFileBytes(fileRef);
		const url = await this.uploadBytes(pageId, upload.filename, upload.bytes, upload.contentType, upload.cacheKey);
		return this.buildImageMacro(url, width);
	}

	private buildImageMacro(url: string, width?: number): string {
		const escaped = escapeXmlAttr(url);
		if (width && width > 0) {
			return `<ac:image ac:width="${width}"><ri:url ri:value="${escaped}"/></ac:image>`;
		}
		return `<ac:image><ri:url ri:value="${escaped}"/></ac:image>`;
	}

	private processImagePath(imagePath: string): { fullPath: string; size: number } {
		let p = imagePath;
		let size = 0;

		if (p.includes('|')) {
			const parts = p.split('|');
			p = parts[0];
			if (parts.length > 1) {
				const parsed = Number(parts[1]);
				if (Number.isFinite(parsed) && parsed > 0) {
					size = parsed;
				}
			}
		}

		p = p.trim().replace(/\\/g, '/');
		if (p.startsWith('http://') || p.startsWith('https://')) {
			return { fullPath: p, size };
		}

		if (path.isAbsolute(p)) {
			return { fullPath: p, size };
		}

		const baseDir = path.posix.dirname(this.sourceFile.path);
		const candidates = [
			path.posix.join(baseDir, p),
			path.posix.join(baseDir, 'attachments', p),
			path.posix.normalize(path.posix.join(baseDir, p))
		];

		for (const c of candidates) {
			const tfile = this.resolveLinkToTFile(c);
			if (tfile) {
				return { fullPath: tfile.path, size };
			}
			const abs = path.join(this.vaultBasePath, c);
			if (fs.existsSync(abs)) {
				return { fullPath: c, size };
			}
		}

		return { fullPath: path.posix.join(baseDir, p), size };
	}

	private async uploadBytes(pageId: string, filename: string, bytes: Uint8Array, contentType: string, cacheKey: string): Promise<string> {
		const cacheHit = this.uploaded.get(cacheKey);
		if (cacheHit) {
			return cacheHit;
		}

		try {
			const result = await this.client.attachFile({
				pageId,
				filename,
				content: bytes,
				contentType,
				comment: 'Uploaded by obsidian-publish-everywhere'
			});
			const url = this.extractAttachmentUrl(pageId, filename, result);
			this.uploaded.set(cacheKey, url);
			return url;
		} catch (e) {
			const message = (e as Error).message || '';
			if (message.includes('Cannot add a new attachment with same file name')) {
				const existing = await this.findExistingAttachmentUrl(pageId, filename);
				if (existing) {
					this.uploaded.set(cacheKey, existing);
					return existing;
				}
			}
			throw e;
		}
	}

	private extractAttachmentUrl(pageId: string, filename: string, result: any): string {
		const download = result?._links?.download as string | undefined;
		if (download) {
			return this.client.toAbsoluteUrl(download);
		}
		const id = result?.id as string | undefined;
		if (id) {
			return `${this.client.getBaseUrl()}/download/attachments/${encodeURIComponent(pageId)}/${encodeURIComponent(filename)}`;
		}
		return `${this.client.getBaseUrl()}/download/attachments/${encodeURIComponent(pageId)}/${encodeURIComponent(filename)}`;
	}

	private async findExistingAttachmentUrl(pageId: string, filename: string): Promise<string | null> {
		const attachments = await this.client.getAttachments(pageId);
		for (const a of attachments) {
			const title = typeof a?.title === 'string' ? a.title : '';
			if (title !== filename) {
				continue;
			}
			const download = a?._links?.download;
			if (typeof download === 'string' && download) {
				return this.client.toAbsoluteUrl(download);
			}
		}
		return null;
	}

	private parseEmbedTarget(target: string): { filePath: string; width?: number } {
		let raw = target.trim();
		let width: number | undefined;
		const idx = raw.lastIndexOf('|');
		if (idx >= 0) {
			const potential = raw.slice(idx + 1).trim();
			const n = Number(potential);
			if (Number.isFinite(n) && n > 0) {
				width = n;
				raw = raw.slice(0, idx).trim();
			}
		}
		return { filePath: raw, width };
	}

	private extractAttr(tag: string, name: string): string | null {
		const re = new RegExp(`${name}="([^"]*)"`, 'i');
		const m = re.exec(tag);
		return m?.[1] ?? null;
	}

	private isImageFile(p: string): boolean {
		const ext = path.extname(p).toLowerCase();
		return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext);
	}

	private isExcalidrawFile(p: string): boolean {
		return p.toLowerCase().includes('excalidraw') || path.extname(p).toLowerCase() === '.excalidraw';
	}

	private excalidrawExportFilename(originalName: string): string {
		let base = originalName;
		if (base.toLowerCase().endsWith('.excalidraw')) {
			base = base.slice(0, -'.excalidraw'.length);
		}
		return `${base}.png`;
	}

	private resolveLinkToTFile(linkPath: string): TFile | null {
		const normalized = linkPath.replace(/\\/g, '/');
		const direct = this.app.vault.getAbstractFileByPath(normalized);
		if (direct instanceof TFile) {
			return direct;
		}
		const viaCache = this.app.metadataCache.getFirstLinkpathDest(normalized, this.sourceFile.path);
		if (viaCache instanceof TFile) {
			return viaCache;
		}
		return null;
	}

	private resolveAbsoluteOrVaultFile(p: string): { absPath: string; relPath?: string } | null {
		if (path.isAbsolute(p)) {
			return fs.existsSync(p) ? { absPath: p } : null;
		}
		const abs = path.join(this.vaultBasePath, p);
		return fs.existsSync(abs) ? { absPath: abs, relPath: p } : null;
	}

	private async readFileBytes(
		file: TFile | { absPath: string; relPath?: string }
	): Promise<{ bytes: Uint8Array; filename: string; contentType: string; cacheKey: string }> {
		if (file instanceof TFile) {
			const buf = await this.app.vault.readBinary(file);
			const bytes = new Uint8Array(buf);
			const filename = path.posix.basename(file.path);
			const contentType = (mime.lookup(filename) || 'application/octet-stream').toString();
			return { bytes, filename, contentType, cacheKey: file.path };
		}
		const bytes = new Uint8Array(fs.readFileSync(file.absPath));
		const filename = path.basename(file.absPath);
		const contentType = (mime.lookup(filename) || 'application/octet-stream').toString();
		return { bytes, filename, contentType, cacheKey: file.relPath ?? file.absPath };
	}

	private async replaceAsync(
		input: string,
		re: RegExp,
		fn: (match: string, ...groups: string[]) => Promise<string>
	): Promise<string> {
		const matches: Array<{ start: number; end: number; match: string; groups: string[] }> = [];
		let m: RegExpExecArray | null;
		const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
		while ((m = r.exec(input)) !== null) {
			matches.push({ start: m.index, end: m.index + m[0].length, match: m[0], groups: m.slice(1) as string[] });
		}
		if (matches.length === 0) {
			return input;
		}

		const parts: string[] = [];
		let last = 0;
		for (const item of matches) {
			parts.push(input.slice(last, item.start));
			parts.push(await fn(item.match, ...item.groups));
			last = item.end;
		}
		parts.push(input.slice(last));
		return parts.join('');
	}
}

function escapeXmlAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
