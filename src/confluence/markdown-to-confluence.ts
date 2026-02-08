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
		content = preProcessCallouts(content);

		const html = await markdownToHtml(content);
		let result = html;
		result = postProcessCodeBlocks(result);
		result = postProcessLinks(result);
		result = postProcessMermaid(result);
		result = postProcessFolding(result);
		result = postProcessTables(result);
		result = postProcessMarkHighlights(result);
		result = postProcessCallouts(result);
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

function preProcessCallouts(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');
	const out: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const startMatch = /^>\s*\[!([^\]\n]+)\][+-]?\s*(.*)$/.exec(line);
		if (!startMatch) {
			out.push(line);
			continue;
		}

		const calloutType = (startMatch[1] || '').trim().toLowerCase();
		const calloutTitle = (startMatch[2] || '').trim();
		const bodyLines: string[] = [];

		let cursor = i + 1;
		while (cursor < lines.length && /^>\s?/.test(lines[cursor])) {
			bodyLines.push(lines[cursor].replace(/^>\s?/, ''));
			cursor += 1;
		}

		const calloutBody = bodyLines.join('\n').trimEnd();
		const encodedType = encodeURIComponent(calloutType);
		const encodedTitle = encodeURIComponent(calloutTitle);
		const encodedBody = encodeURIComponent(calloutBody);
		out.push(`CALLOUT_PLACEHOLDER_TYPE:${encodedType}:TITLE:${encodedTitle}:CONTENT:${encodedBody}:CALLOUT_PLACEHOLDER`);

		i = cursor - 1;
	}

	return content.includes('\r\n') ? out.join('\n').replace(/\n/g, '\r\n') : out.join('\n');
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

function postProcessCallouts(content: string): string {
	const re = /CALLOUT_PLACEHOLDER_TYPE:([^:]*?):TITLE:([^:]*?):CONTENT:([^:]*?):CALLOUT_PLACEHOLDER/g;
	return content.replace(re, (match: string, encodedType: string, encodedTitle: string, encodedBody: string) => {
		try {
			const calloutType = decodeURIComponent(encodedType || '').trim().toLowerCase();
			const rawTitle = decodeURIComponent(encodedTitle || '').trim();
			const rawBody = decodeURIComponent(encodedBody || '').trim();

			const mappedMacro = mapCalloutMacro(calloutType);
			const title = rawTitle || mappedMacro.defaultTitle;
			const bodyMarkdown = rawBody || rawTitle;
			const nested = bodyMarkdown ? markdownToHtmlSyncBestEffort(bodyMarkdown) : '<p></p>';
			const nestedProcessed = postProcessMarkHighlights(postProcessTables(postProcessLinks(nested)));
			const nestedEscaped = escapeCDATA(nestedProcessed);
			const titleParam = title
				? `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>`
				: '';

			return (
				`<ac:structured-macro ac:name="${mappedMacro.macroName}">` +
				titleParam +
				`<ac:rich-text-body>${nestedEscaped}</ac:rich-text-body>` +
				`</ac:structured-macro>`
			);
		} catch (_e) {
			return match;
		}
	});
}

function mapCalloutMacro(calloutType: string): { macroName: string; defaultTitle: string } {
	const type = (calloutType || '').toLowerCase();
	if (type === 'info') {
		return { macroName: 'info', defaultTitle: '信息' };
	}
	if (type === 'tip' || type === 'hint') {
		return { macroName: 'tip', defaultTitle: '提示' };
	}
	if (type === 'warning' || type === 'caution' || type === 'danger' || type === 'error') {
		return { macroName: 'warning', defaultTitle: '警告' };
	}
	if (type === 'success') {
		return { macroName: 'note', defaultTitle: '成功' };
	}
	if (type === 'question' || type === 'help' || type === 'faq') {
		return { macroName: 'note', defaultTitle: '说明' };
	}
	return { macroName: 'note', defaultTitle: '提示' };
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
	out = out.replace(/<hr(?![^>]*\/>)([^>]*)>/g, '<hr$1/>');
	return out;
}

function addTOCMacro(content: string): string {
	const toc =
		`<p>` +
		`<ac:structured-macro ac:name="easy-heading-free" ac:schema-version="1">` +
		`<ac:parameter ac:name="selector">h1,h2,h3,h4,h5,h6</ac:parameter>` +
		`<ac:parameter ac:name="navigationExpandOption">expand-all-by-default</ac:parameter>` +
		`</ac:structured-macro>` +
		`</p>`;
	return `${toc}${content}`;
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

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
