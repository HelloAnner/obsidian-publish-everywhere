import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

export class ConfluenceMarkdownConverter {
	async convert(markdown: string): Promise<string> {
		let content = markdown;
		content = stripFrontMatter(content);
		content = preprocessUrls(content);
		content = preProcessMermaid(content);
		content = preProcessFolding(content);

		const html = await markdownToHtml(content);
		let result = html;
		result = postProcessCodeBlocks(result);
		result = postProcessLinks(result);
		result = postProcessMermaid(result);
		result = postProcessFolding(result);
		result = postProcessTables(result);
		result = postProcessMarkHighlights(result);
		result = addTOCMacro(result);

		return result;
	}
}

async function markdownToHtml(markdown: string): Promise<string> {
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeStringify, { allowDangerousHtml: true });

	const file = await processor.process(markdown);
	return String(file);
}

function stripFrontMatter(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const withoutBom = normalized.startsWith('\uFEFF') ? normalized.slice(1) : normalized;
	const lines = withoutBom.split('\n');

	let start = 0;
	while (start < lines.length && lines[start].trim() === '') {
		start++;
	}
	if (start >= lines.length || lines[start].trim() !== '---') {
		return content;
	}

	let end = start + 1;
	while (end < lines.length) {
		const trimmed = lines[end].trim();
		if (trimmed === '---' || trimmed === '...') {
			break;
		}
		end++;
	}
	if (end >= lines.length) {
		return content;
	}

	let next = end + 1;
	if (next < lines.length && lines[next].trim() === '') {
		next++;
	}
	const result = lines.slice(next).join('\n');
	return content.includes('\r\n') ? result.replace(/\n/g, '\r\n') : result;
}

function preprocessUrls(content: string): string {
	return content.replace(/\[(.*?)\]\((.*?)\)/g, (match: string, text: string, url: string) => {
		if (!text || typeof url !== 'string') {
			return match;
		}
		const encoded = url.replace(/&/g, '&amp;');
		return `[${text}](${encoded})`;
	});
}

function preProcessMermaid(content: string): string {
	const re = /```mermaid\s*\n([\s\S]*?)```/g;
	return content.replace(re, (_match: string, mermaidContent: string) => {
		return `MERMAID_PLACEHOLDER:${mermaidContent}:MERMAID_PLACEHOLDER`;
	});
}

function postProcessMermaid(content: string): string {
	const re = /MERMAID_PLACEHOLDER:([\s\S]*?):MERMAID_PLACEHOLDER/g;
	return content.replace(re, (_match: string, mermaidContent: string) => {
		const escaped = escapeCDATA(mermaidContent);
		return (
			`<ac:structured-macro ac:name="markdown">` +
			`<ac:plain-text-body><![CDATA[` +
			'```mermaid\n' +
			escaped +
			'\n```' +
			`]]></ac:plain-text-body>` +
			`</ac:structured-macro>`
		);
	});
}

function preProcessFolding(content: string): string {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];

	let inFold = false;
	let currentTitle = '';
	let foldContent: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const startMatch = /^---([^-\n]+?)---\s*$/.exec(line);
		if (!inFold && startMatch?.[1]) {
			currentTitle = startMatch[1].trim();
			inFold = true;
			foldContent = [];
			continue;
		}

		const endMatch = /^---([^-\n]+?)---\s*$/.exec(line);
		if (inFold && endMatch?.[1] && endMatch[1].trim() === currentTitle) {
			out.push(`FOLD_PLACEHOLDER_TITLE:${currentTitle}:CONTENT:${foldContent.join('\n')}:FOLD_PLACEHOLDER`);
			inFold = false;
			currentTitle = '';
			continue;
		}

		if (inFold) {
			foldContent.push(line);
		} else {
			out.push(line);
		}
	}

	if (inFold) {
		out.push(`---${currentTitle}---`);
		out.push(...foldContent);
	}

	const normalized = out.join('\n');

	// 兼容旧样式：---折叠---
	const lines2 = normalized.split('\n');
	const out2: string[] = [];
	inFold = false;
	foldContent = [];

	for (let i = 0; i < lines2.length; i++) {
		const line = lines2[i];
		if (!inFold && line === '---折叠---') {
			inFold = true;
			foldContent = [];
			continue;
		}
		if (inFold && line === '---折叠---') {
			out2.push(`FOLD_PLACEHOLDER_TITLE:点击展开:CONTENT:${foldContent.join('\n')}:FOLD_PLACEHOLDER`);
			inFold = false;
			continue;
		}
		if (inFold) {
			foldContent.push(line);
		} else {
			out2.push(line);
		}
	}

	if (inFold) {
		out2.push('---折叠---');
		out2.push(...foldContent);
	}

	return content.includes('\r\n') ? out2.join('\n').replace(/\n/g, '\r\n') : out2.join('\n');
}

function postProcessFolding(content: string): string {
	const re = /FOLD_PLACEHOLDER_TITLE:([^:]*?):CONTENT:([\s\S]*?):FOLD_PLACEHOLDER/g;
	return content.replace(re, (match: string, title: string, foldContent: string) => {
		try {
			const nested = markdownToHtmlSyncBestEffort(foldContent);
			const nestedEscaped = escapeCDATA(nested);
			return (
				`<ac:structured-macro ac:name="expand">` +
				`<ac:parameter ac:name="title">${title}</ac:parameter>` +
				`<ac:rich-text-body>${nestedEscaped}</ac:rich-text-body>` +
				`</ac:structured-macro>`
			);
		} catch (_e) {
			return match;
		}
	});
}

function markdownToHtmlSyncBestEffort(markdown: string): string {
	// 同步降级：fold 内内容只需要尽量转为 HTML（避免在 replace 回调里 await）
	// 这里使用最小化处理：只做一次基础转换，不做前置预处理/后置宏替换
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkRehype, { allowDangerousHtml: true })
		.use(rehypeRaw)
		.use(rehypeStringify, { allowDangerousHtml: true });
	return String(processor.processSync(markdown));
}

function postProcessCodeBlocks(content: string): string {
	const reLang = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;
	let out = content.replace(reLang, (_match: string, language: string, code: string) => {
		const decoded = htmlDecode(code);
		const escaped = escapeCDATA(decoded);
		return (
			`<ac:structured-macro ac:name="code">` +
			`<ac:parameter ac:name="language">${language}</ac:parameter>` +
			`<ac:plain-text-body><![CDATA[${escaped}]]></ac:plain-text-body>` +
			`</ac:structured-macro>`
		);
	});

	const reNoLang = /<pre><code>([\s\S]*?)<\/code><\/pre>/g;
	out = out.replace(reNoLang, (_match: string, code: string) => {
		const decoded = htmlDecode(code);
		const escaped = escapeCDATA(decoded);
		return `<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${escaped}]]></ac:plain-text-body></ac:structured-macro>`;
	});

	return out;
}

function postProcessLinks(content: string): string {
	const re = /<a href="([^"]+)"/g;
	return content.replace(re, (_match: string, url: string) => {
		const decoded = url.replace(/&amp;/g, '&');
		const encoded = decoded.replace(/&/g, '&amp;');
		return `<a href="${encoded}"`;
	});
}

function postProcessTables(content: string): string {
	let out = content.replace(/<table>\s*<tr>/g, '<table><tbody><tr>');
	out = out.replace(/<\/tr>\s*<\/table>/g, '</tr></tbody></table>');
	out = out.replace(/<br(?:\s*\/)?>/g, '<br/>');
	return out;
}

function addTOCMacro(content: string): string {
	const toc =
		`<ac:structured-macro ac:name="toc">` +
		`<ac:parameter ac:name="printable">true</ac:parameter>` +
		`<ac:parameter ac:name="style">disc</ac:parameter>` +
		`<ac:parameter ac:name="maxLevel">3</ac:parameter>` +
		`<ac:parameter ac:name="minLevel">1</ac:parameter>` +
		`</ac:structured-macro>`;

	// 通过 Confluence 的 section/column 布局宏把目录放到右侧
	return (
		`<ac:structured-macro ac:name="section">` +
		`<ac:rich-text-body>` +
		`<ac:structured-macro ac:name="column">` +
		`<ac:parameter ac:name="width">75%</ac:parameter>` +
		`<ac:rich-text-body>${content}</ac:rich-text-body>` +
		`</ac:structured-macro>` +
		`<ac:structured-macro ac:name="column">` +
		`<ac:parameter ac:name="width">25%</ac:parameter>` +
		`<ac:rich-text-body>${toc}</ac:rich-text-body>` +
		`</ac:structured-macro>` +
		`</ac:rich-text-body>` +
		`</ac:structured-macro>`
	);
}

function escapeCDATA(content: string): string {
	return content.replace(/]]>/g, ']]&gt;');
}

function htmlDecode(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function postProcessMarkHighlights(content: string): string {
	const re = /<mark([^>]*)>([\s\S]*?)<\/mark>/gi;
	return content.replace(re, (match: string, attrs: string, inner: string) => {
		let styleVal = '';
		const m1 = /style\s*=\s*"([^"]*)"/i.exec(attrs);
		const m2 = /style\s*=\s*'([^']*)'/i.exec(attrs);
		if (m1?.[1]) {
			styleVal = m1[1];
		} else if (m2?.[1]) {
			styleVal = m2[1];
		}

		let bgRaw = '';
		if (styleVal) {
			const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(styleVal);
			if (bg?.[1]) {
				bgRaw = bg[1].trim();
			}
		}

		let rgb = parseColorToRGB(bgRaw);
		if (!rgb) {
			rgb = { r: 255, g: 235, b: 230 };
		}

		const mapped = mapToConfluenceHighlight(rgb.r, rgb.g, rgb.b);
		return `<span style="background-color: ${mapped.bg}; color: ${mapped.text};">${inner}</span>`;
	});
}

function parseColorToRGB(s: string): { r: number; g: number; b: number } | null {
	if (!s) {
		return null;
	}
	let v = s.trim().toLowerCase();
	const imp = v.indexOf('!important');
	if (imp >= 0) {
		v = v.slice(0, imp).trim();
	}

	if (v.startsWith('#')) {
		let hex = v.slice(1);
		if (hex.length === 8) {
			hex = hex.slice(0, 6);
		} else if (hex.length === 4) {
			hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
		} else if (hex.length === 3) {
			hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
		} else if (hex.length !== 6) {
			return null;
		}
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);
		return { r, g, b };
	}

	const rgb = /^rgba?\s*\(\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)/i.exec(v);
	if (rgb) {
		return { r: parseIntClamp(rgb[1]), g: parseIntClamp(rgb[2]), b: parseIntClamp(rgb[3]) };
	}

	return null;
}

function parseIntClamp(s: string): number {
	const v = s.trim();
	if (v.endsWith('%')) {
		const n = parseFloat(v.slice(0, -1));
		if (!Number.isFinite(n)) {
			return 0;
		}
		const pct = Math.max(0, Math.min(100, n));
		return Math.max(0, Math.min(255, Math.round((pct * 255) / 100)));
	}
	const n = parseInt(v, 10);
	if (!Number.isFinite(n)) {
		return 0;
	}
	return Math.max(0, Math.min(255, n));
}

function mapToConfluenceHighlight(r: number, g: number, b: number): { bg: string; text: string } {
	const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
	const text = luminance < 140 ? '#FFFFFF' : '#172B4D';
	const bg = rgbToHex(r, g, b);
	return { bg, text };
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(n: number): string {
	const v = Math.max(0, Math.min(255, Math.round(n)));
	return v.toString(16).padStart(2, '0').toUpperCase();
}
