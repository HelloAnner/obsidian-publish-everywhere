import * as fs from 'fs';
import * as path from 'path';
import { App, TFile } from 'obsidian';

export class GitHubMarkdownConverter {
	private readonly app: App;
	private readonly sourceFile: TFile;
	private readonly vaultBasePath: string;
	private readonly repoDir: string;
	private readonly imageNameBySource: Map<string, string> = new Map();

	constructor(params: { app: App; sourceFile: TFile; vaultBasePath: string; repoDir: string }) {
		this.app = params.app;
		this.sourceFile = params.sourceFile;
		this.vaultBasePath = params.vaultBasePath;
		this.repoDir = params.repoDir;
	}

	async convert(rawContent: string): Promise<string> {
		let content = stripFrontMatter(rawContent);
		content = convertCallouts(content);
		content = await this.processImages(content);
		content = convertMarkHighlights(content);
		content = convertWikiLinksToText(content);
		return content;
	}

	private async processImages(content: string): Promise<string> {
		let out = content;

		out = await replaceAsync(out, /<img[^>]*src="([^"]+)"[^>]*>/g, async (match, src) => {
			const alt = this.extractAttr(match, 'alt') ?? '';
			const widthRaw = this.extractAttr(match, 'width');
			const width = widthRaw ? Number(widthRaw) : undefined;
			return this.processImageReference(String(src), alt, width);
		});

		out = await replaceAsync(out, /!\[(.*?)\]\((.*?)\)/g, async (_match, alt, rawPath) => {
			return this.processImageReference(String(rawPath), String(alt ?? ''));
		});

		out = await replaceAsync(out, /!\[\[(.*?)\]\]/g, async (_match, rawTarget) => {
			const parsed = this.parseEmbedTarget(String(rawTarget));
			if (!isImageFile(parsed.filePath) && !isRemoteUrl(parsed.filePath)) {
				return `![[${rawTarget}]]`;
			}
			return this.processImageReference(parsed.filePath, '', parsed.width);
		});

		return out;
	}

	private async processImageReference(rawPath: string, altText: string, width?: number): Promise<string> {
		const trimmedPath = normalizeImagePath(rawPath);
		if (!trimmedPath) {
			return '';
		}

		if (isRemoteUrl(trimmedPath)) {
			return this.toMarkdownImage(trimmedPath, altText, width);
		}

		const resolved = this.resolveLocalImage(trimmedPath);
		if (!resolved) {
			return this.toMarkdownImage(trimmedPath, altText, width);
		}

		const targetName = await this.copyImageToRepo(resolved);
		const targetPath = `img/${targetName}`;
		return this.toMarkdownImage(targetPath, altText || path.basename(targetName), width);
	}

	private toMarkdownImage(src: string, altText: string, width?: number): string {
		const alt = escapeMarkdownText(altText || 'image');
		if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
			return `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" width="${Math.floor(width)}" />`;
		}
		return `![${alt}](${src})`;
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

	private resolveLocalImage(ref: string): { sourceKey: string; filename: string; bytes: Uint8Array } | null {
		const tfile = this.resolveLinkToTFile(ref);
		if (tfile && isImageFile(tfile.path)) {
			return {
				sourceKey: tfile.path,
				filename: path.posix.basename(tfile.path),
				bytes: new Uint8Array()
			};
		}

		const absolute = this.resolveAbsoluteOrVaultFile(ref);
		if (absolute && isImageFile(absolute.absPath)) {
			const bytes = new Uint8Array(fs.readFileSync(absolute.absPath));
			return {
				sourceKey: absolute.relPath ?? absolute.absPath,
				filename: path.basename(absolute.absPath),
				bytes
			};
		}

		return null;
	}

	private async copyImageToRepo(resolved: { sourceKey: string; filename: string; bytes: Uint8Array }): Promise<string> {
		const cached = this.imageNameBySource.get(resolved.sourceKey);
		if (cached) {
			return cached;
		}

		let bytes = resolved.bytes;
		if (bytes.length === 0) {
			const file = this.app.vault.getAbstractFileByPath(resolved.sourceKey);
			if (file instanceof TFile) {
				const bin = await this.app.vault.readBinary(file);
				bytes = new Uint8Array(bin);
			} else {
				return resolved.filename;
			}
		}

		const imgDir = path.join(this.repoDir, 'img');
		fs.mkdirSync(imgDir, { recursive: true });

		const safeName = sanitizeFileName(resolved.filename);
		const targetName = await this.allocateTargetName(imgDir, safeName, resolved.sourceKey, bytes);
		const targetPath = path.join(imgDir, targetName);
		fs.writeFileSync(targetPath, Buffer.from(bytes));
		this.imageNameBySource.set(resolved.sourceKey, targetName);
		return targetName;
	}

	private async allocateTargetName(
		imgDir: string,
		safeName: string,
		sourceKey: string,
		bytes: Uint8Array
	): Promise<string> {
		const ext = path.extname(safeName);
		const name = safeName.slice(0, safeName.length - ext.length) || 'image';
		let candidate = safeName;
		let index = 0;
		while (true) {
			const fullPath = path.join(imgDir, candidate);
			if (!fs.existsSync(fullPath)) {
				return candidate;
			}
			const exists = fs.readFileSync(fullPath);
			if (Buffer.compare(exists, Buffer.from(bytes)) === 0) {
				return candidate;
			}
			index += 1;
			candidate = `${name}-${shortHash(sourceKey)}-${index}${ext}`;
		}
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

		const baseDir = path.posix.dirname(this.sourceFile.path);
		const candidates = [
			path.posix.join(baseDir, normalized),
			path.posix.join(baseDir, 'attachments', normalized)
		];
		for (const item of candidates) {
			const f = this.app.vault.getAbstractFileByPath(item);
			if (f instanceof TFile) {
				return f;
			}
		}

		return null;
	}

	private resolveAbsoluteOrVaultFile(p: string): { absPath: string; relPath?: string } | null {
		if (path.isAbsolute(p)) {
			return fs.existsSync(p) ? { absPath: p } : null;
		}
		const rel = p.replace(/\\/g, '/');
		const abs = path.join(this.vaultBasePath, rel);
		if (fs.existsSync(abs)) {
			return { absPath: abs, relPath: rel };
		}
		return null;
	}

	private extractAttr(tag: string, name: string): string | null {
		const re = new RegExp(`${name}="([^"]*)"`, 'i');
		const m = re.exec(tag);
		return m?.[1] ?? null;
	}
}

function stripFrontMatter(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	if (!normalized.startsWith('---\n')) {
		return content;
	}
	const endIndex = normalized.indexOf('\n---', 4);
	if (endIndex === -1) {
		return content;
	}
	const body = normalized.slice(endIndex + 4).replace(/^\n/, '');
	return content.includes('\r\n') ? body.replace(/\n/g, '\r\n') : body;
}

function convertCallouts(content: string): string {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const startMatch = /^>\s*\[!([^\]\n]+)\][+-]?\s*(.*)$/.exec(line);
		if (!startMatch) {
			out.push(line);
			continue;
		}

		const type = (startMatch[1] || '').trim().toLowerCase();
		const title = (startMatch[2] || '').trim();
		const mapped = mapCalloutType(type);
		out.push(`> ${mapped.emoji} **${title || mapped.title}**`);

		let cursor = i + 1;
		while (cursor < lines.length && /^>\s?/.test(lines[cursor])) {
			out.push(lines[cursor]);
			cursor += 1;
		}
		i = cursor - 1;
	}

	return content.includes('\r\n') ? out.join('\n').replace(/\n/g, '\r\n') : out.join('\n');
}

function mapCalloutType(type: string): { emoji: string; title: string } {
	if (type === 'info') {
		return { emoji: 'ℹ️', title: 'Info' };
	}
	if (type === 'tip' || type === 'hint') {
		return { emoji: '💡', title: 'Tip' };
	}
	if (type === 'warning' || type === 'caution' || type === 'danger' || type === 'error') {
		return { emoji: '⚠️', title: 'Warning' };
	}
	if (type === 'success') {
		return { emoji: '✅', title: 'Success' };
	}
	return { emoji: '📝', title: 'Note' };
}

function convertMarkHighlights(content: string): string {
	return content.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, (_match, inner) => `**${String(inner)}**`);
}

function convertWikiLinksToText(content: string): string {
	return content.replace(/\[\[([^\]]+)\]\]/g, (_match, inner) => {
		const raw = String(inner || '').trim();
		if (!raw) {
			return '';
		}
		const parts = raw.split('|');
		if (parts.length > 1) {
			return parts[1].trim() || parts[0].trim();
		}
		const target = parts[0].split('#')[0].trim();
		const name = target.split('/').pop() || target;
		return name.replace(/\.md$/i, '');
	});
}

async function replaceAsync(
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

function normalizeImagePath(raw: string): string {
	let p = String(raw || '').trim();
	p = p.replace(/^<|>$/g, '').trim();
	if (!p) {
		return '';
	}

	const quoted = /^([^\s]+)\s+['"][^'"]*['"]$/.exec(p);
	if (quoted?.[1]) {
		p = quoted[1];
	}

	return p.replace(/\\/g, '/');
}

function sanitizeFileName(name: string): string {
	const replaced = name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
	return replaced || `image-${Date.now()}.png`;
}

function shortHash(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return (hash >>> 0).toString(16).slice(0, 8);
}

function isRemoteUrl(url: string): boolean {
	return url.startsWith('http://') || url.startsWith('https://');
}

function isImageFile(p: string): boolean {
	const ext = path.extname(p).toLowerCase();
	return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext);
}

function escapeHtmlAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeMarkdownText(value: string): string {
	return value.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}
