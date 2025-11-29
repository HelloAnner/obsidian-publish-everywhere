/**
 * Markdown → Notion Blocks 转换器
 * 使用 remark 解析 Markdown，并生成 Notion API 可用的 Block 数组。
 * 覆盖：标题/段落/加粗/斜体/链接/列表/引用/代码块/表格/分割线/图片/附件。
 */

import { NotionBlock, NotionRichText } from './types';
import { Debug } from './debug';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';

export interface ConvertOptions {
    // 将本地资源路径转成 Notion 文件上传 id 的解析器（由调用方注入）
    // 可携带额外元信息（例如图片宽度）以便在上传前进行处理（压缩/缩放）
    resolveLocalAsset?: (src: string, meta?: { width?: number }) => Promise<{ kind: 'image' | 'file'; uploadId: string; caption?: string } | null>;
}

// 将纯文本与内联样式转为 Notion RichText
function textToRichText(nodes: any[]): NotionRichText[] {
    const rich: NotionRichText[] = [];
    const pushRun = (content: string, annotations?: Partial<NotionRichText['annotations']>, href?: string) => {
        if (!content) return;
        rich.push({
            type: 'text',
            text: { content, ...(href ? { link: { url: href } } : {}) },
            annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: 'default',
                ...annotations,
            },
            plain_text: content,
            href,
        });
    };

    // 将 '==text==' 语法拆分为高亮与普通片段
    const pushText = (content: string, annotations?: Partial<NotionRichText['annotations']>, href?: string) => {
        if (!content) return;
        const parts = content.split(/(==[\s\S]+?==)/g);
        for (const seg of parts) {
            if (!seg) continue;
            if (seg.startsWith('==') && seg.endsWith('==')) {
                const inner = seg.slice(2, -2);
                pushRun(inner, { ...annotations, color: 'yellow_background' }, href);
            } else {
                pushRun(seg, annotations, href);
            }
        }
    };

    const walk = (n: any, ann?: Partial<NotionRichText['annotations']>, linkHref?: string) => {
        switch (n.type) {
            case 'text':
                pushText(n.value, ann, linkHref);
                break;
            case 'html': {
                const v = String(n.value || '');
                // 简单处理 <mark>..</mark>
                const replaced = v.replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==');
                pushText(replaced, ann, linkHref);
                break;
            }
            case 'emphasis':
                n.children?.forEach((c: any) => walk(c, { ...ann, italic: true }, linkHref));
                break;
            case 'strong':
                n.children?.forEach((c: any) => walk(c, { ...ann, bold: true }, linkHref));
                break;
            case 'inlineCode':
                pushText(n.value, { ...ann, code: true }, linkHref);
                break;
            case 'delete':
                n.children?.forEach((c: any) => walk(c, { ...ann, strikethrough: true }, linkHref));
                break;
            case 'link':
                n.children?.forEach((c: any) => walk(c, ann, n.url));
                break;
            default:
                if (Array.isArray(n.children)) n.children.forEach((c: any) => walk(c, ann, linkHref));
        }
    };

    nodes.forEach((n) => walk(n));
    return rich.length ? rich : [{ type: 'text', text: { content: '' }, plain_text: '', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }];
}

// 构建一个 block 基础对象帮助函数
function baseBlock(): any { return {}; }

export async function convertMarkdownToBlocks(markdown: string, options: ConvertOptions = {}): Promise<NotionBlock[]> {
    // 支持 Obsidian 图片语法：![[image.png|500]] 或 [image.png|500]
    const normalizeObsidianImages = (md: string): string => {
        if (!md) return md;
        // 1) ![[attachments/1.png|500]] → ![attachments/1.png|500](attachments/1.png)
        md = md.replace(/!\[\[([^\]\n]+?)(?:\|(\d{2,4}))?\]\]/g,
            (_m, name, w) => `![${name}${w ? '|' + w : ''}](${name})`);
        // 2) [attachments/1.png|500]（非标准，但兼容）→ ![attachments/1.png|500](attachments/1.png)
        md = md.replace(/(?<!\!)\[([^\]\n]+?\.(?:png|jpe?g|gif|bmp|webp|svg|avif))(?:\|(\d{2,4}))?\]/gi,
            (_m, name, w) => `![${name}${w ? '|' + w : ''}](${name})`);
        return md;
    };

    markdown = normalizeObsidianImages(markdown);
    const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
    const blocks: NotionBlock[] = [] as any;

    // 列表栈（处理嵌套）
    const listStack: { ordered: boolean; items: NotionBlock[] }[] = [];

    async function flushList() {
        if (!listStack.length) return;
        const list = listStack.pop()!;
        blocks.push(...list.items);
    }

    const handlers: Record<string, (node: any) => Promise<void>> = {
        heading: async (node) => {
            await flushList();
            const depth = Math.max(1, Math.min(3, node.depth || 1));
            const b: any = baseBlock();
            b.type = `heading_${depth}`;
            b[`heading_${depth}`] = { rich_text: textToRichText(node.children || []), color: 'default', is_toggleable: false };
            blocks.push(b);
        },
        paragraph: async (node) => {
            await flushList();
            const b: any = baseBlock();
            b.type = 'paragraph';
            b.paragraph = { rich_text: textToRichText(node.children || []), color: 'default' };
            // 若为空段落则忽略
            const txt = toString(node).trim();
            if (txt.length === 0) return;
            blocks.push(b);
        },
        list: async (node) => {
            listStack.push({ ordered: !!node.ordered, items: [] });
        },
        listItem: async (node) => {
            const top = listStack[listStack.length - 1];
            const textChildren = (node.children || []).filter((c: any) => c.type !== 'list');
            const b: any = baseBlock();
            if (node.checked === true || node.checked === false) {
                b.type = 'to_do';
                b.to_do = { rich_text: textToRichText(textChildren), checked: !!node.checked, color: 'default' };
            } else if (top?.ordered) {
                b.type = 'numbered_list_item';
                b.numbered_list_item = { rich_text: textToRichText(textChildren), color: 'default' };
            } else {
                b.type = 'bulleted_list_item';
                b.bulleted_list_item = { rich_text: textToRichText(textChildren), color: 'default' };
            }
            top?.items.push(b);
            // 处理子列表
            const childList = (node.children || []).find((c: any) => c.type === 'list');
            if (childList) await handlers.list(childList);
        },
        blockquote: async (node) => {
            await flushList();
            // 识别 Obsidian 的 callout 格式：> [!TYPE] Title 可选
            const raw = toString(node).trim();
            const m = raw.match(/^\[!([A-Z]+)\][-+]?\s*(.*)$/i);
            if (m) {
                const typ = (m[1] || 'note').toLowerCase();
                const title = m[2] || typ;
                const iconMap: Record<string, string> = {
                    info: '💡', note: '📝', tip: '💡', hint: '💡',
                    warning: '⚠️', caution: '⚠️', attention: '⚠️',
                    error: '❌', danger: '⛔', failure: '❌', fail: '❌',
                    success: '✅', check: '✅', done: '✅',
                    question: '❓', help: '🆘', quote: '💬', default: '📌'
                };
                const colorMap: Record<string, string> = {
                    info: 'blue_background', note: 'gray_background', tip: 'green_background', hint: 'green_background',
                    warning: 'yellow_background', caution: 'yellow_background', attention: 'yellow_background',
                    error: 'red_background', danger: 'red_background', failure: 'red_background', fail: 'red_background',
                    success: 'green_background', check: 'green_background', done: 'green_background',
                    question: 'purple_background', help: 'purple_background', quote: 'gray_background', default: 'blue_background'
                };
                const b: any = baseBlock();
                b.type = 'callout';
                const body = raw.replace(/^\[![^\]]+\][-+]?\s*/, '');
                b.callout = {
                    rich_text: textToRichText([{ type: 'text', value: title ? `${title} ` : '' }, { type: 'text', value: body }]),
                    icon: { type: 'emoji', emoji: iconMap[typ] || iconMap.default },
                    color: colorMap[typ] || colorMap.default,
                };
                blocks.push(b);
                return;
            }
            // 普通引用
            const b: any = baseBlock();
            b.type = 'quote';
            b.quote = { rich_text: textToRichText(node.children || []), color: 'default' };
            blocks.push(b);
        },
        code: async (node) => {
            await flushList();
            const b: any = baseBlock();
            b.type = 'code';
            b.code = { rich_text: [{ type: 'text', text: { content: (node.value || '').toString() }, plain_text: node.value || '', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }], language: (node.lang || 'plain text').toLowerCase(), caption: [] };
            blocks.push(b);
        },
        thematicBreak: async () => {
            await flushList();
            const b: any = baseBlock();
            b.type = 'divider';
            b.divider = {};
            blocks.push(b);
        },
        table: async (node) => {
            await flushList();
            const rows = node.children || [];
            const width = rows[0]?.children?.length || 1;
            const tableBlock: any = baseBlock();
            tableBlock.type = 'table';
            tableBlock.table = { table_width: width, has_column_header: true, has_row_header: false, children: [] };
            for (const r of rows) {
                const row: any = baseBlock();
                row.type = 'table_row';
                const cells: NotionRichText[][] = [];
                for (const c of r.children || []) {
                    cells.push(textToRichText(c.children || []));
                }
                row.table_row = { cells };
                tableBlock.table.children.push(row);
            }

            // 增强的表格恢复：当 remark 解析的行数不足时，基于源码片段恢复表格
            try {
                const pos = (node as any)?.position;
                if (pos && typeof pos.start?.offset === 'number' && typeof pos.end?.offset === 'number') {
                    const recovered = recoverPipeTableRowsAroundPosition(markdown, pos, width);
                    Debug.log(`[Notion] [MD->Notion] table fallback: astRows=${rows?.length ?? 0}, recoveredRows=${recovered.length}, width=${width}`);

                    // 如果恢复的行数更多，使用恢复的行
                    if (recovered.length > tableBlock.table.children.length) {
                        tableBlock.table.children = recovered;
                    }
                }
                // 二次兜底：若仍然只有表头（<=1行），尝试基于表头文本在整篇Markdown中全局恢复
                if ((tableBlock.table.children?.length || 0) <= 1) {
                    const headerTexts = (tableBlock.table.children?.[0]?.table_row?.cells || [])
                        .map((cell: any[]) => (cell?.[0]?.plain_text ?? '').trim());
                    const globalRecovered = recoverPipeTableRowsGlobally(markdown, width, headerTexts);
                    Debug.log(`[Notion] [MD->Notion] global table recovery: headerCells=${JSON.stringify(headerTexts)}, recoveredRows=${globalRecovered.length}`);
                    if (globalRecovered.length > tableBlock.table.children.length) {
                        tableBlock.table.children = globalRecovered;
                    }
                }
            } catch (error) {
                Debug.warn(`[Notion] [MD->Notion] Table recovery failed: ${error}`);
            }
            blocks.push(tableBlock);
        },
        image: async (node) => {
            await flushList();
            const url: string = node.url || '';
            const captionText = node.alt || '';
            // 从 alt 解析宽度（形如 name|500），默认 500，限制范围 [300, 1200]
            const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
            const widthFromAlt = (() => {
                const m = /\|(\d{2,4})\s*$/.exec(captionText || '');
                if (!m) return undefined;
                const w = parseInt(m[1], 10);
                if (!Number.isFinite(w)) return undefined;
                return clamp(w, 300, 1200);
            })();
            const preferredWidth = widthFromAlt ?? 500;
            const captionStripped = (captionText || '').replace(/\|(\d{2,4})\s*$/, '').trim();
            const b: any = baseBlock();
            b.type = 'image';
            b.image = { type: 'external', external: { url }, caption: captionStripped ? [{ type: 'text', text: { content: captionStripped }, plain_text: captionStripped, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }] : [] };

            // 本地资源（非 http/https）
            if (!/^https?:\/\//i.test(url) && options.resolveLocalAsset) {
                const resolved = await options.resolveLocalAsset(url, { width: preferredWidth });
                if (resolved && resolved.kind === 'image') {
                    b.image = { type: 'file_upload', file_upload: { id: resolved.uploadId }, caption: b.image.caption };
                }
            }
            blocks.push(b);
        },
        link: async (_node) => {
            // 由 paragraph/heading 的 textToRichText 处理
        },
    } as const;

    // 主遍历
    for (const node of (tree as any).children || []) {
        const fn = (handlers as any)[node.type];
        if (fn) await fn(node);
        else if (node.type === 'listItem' || node.type === 'list') await (handlers as any)[node.type](node);
        else {
            // 其他类型作为段落处理
            const b: any = baseBlock();
            b.type = 'paragraph';
            b.paragraph = { rich_text: textToRichText(node.children || []), color: 'default' };
            const txt = toString(node).trim();
            if (txt.length) blocks.push(b);
        }
    }

    await flushList();

    // 归一化，确保满足 Notion 校验：
    // - 每个块都有 object: 'block'
    // - table 块必须包含 children（即使空数组）
    // - table_row 必须包含 table_row.cells 数组
    // - 段落/标题/引用等 rich_text 至少是空数组
    const norm = (arr: any[]): any[] => arr.map(b => normalizeBlock(b));

    function normalizeBlock(b: any): any {
        if (!b || typeof b !== 'object') return b;
        b.object = 'block';
        switch (b.type) {
            case 'paragraph':
                ensureRichText(b, 'paragraph');
                break;
            case 'heading_1':
            case 'heading_2':
            case 'heading_3':
                ensureRichText(b, b.type);
                break;
            case 'quote':
                ensureRichText(b, 'quote');
                break;
            case 'to_do':
                if (!b.to_do) b.to_do = { rich_text: [], checked: false, color: 'default' };
                if (!Array.isArray(b.to_do.rich_text)) b.to_do.rich_text = [];
                if (typeof b.to_do.checked !== 'boolean') b.to_do.checked = false;
                if (!b.to_do.color) b.to_do.color = 'default';
                break;
            case 'bulleted_list_item':
                ensureRichText(b, 'bulleted_list_item');
                break;
            case 'numbered_list_item':
                ensureRichText(b, 'numbered_list_item');
                break;
            case 'code':
                if (!b.code) b.code = { rich_text: [], language: 'plain text', caption: [] };
                if (!Array.isArray(b.code.rich_text)) b.code.rich_text = [];
                if (!b.code.language) b.code.language = 'plain text';
                if (!Array.isArray(b.code.caption)) b.code.caption = [];
                break;
            case 'image':
                if (!b.image) b.image = { type: 'external', external: { url: '' }, caption: [] };
                if (!Array.isArray(b.image.caption)) b.image.caption = [];
                break;
            case 'file':
                if (!b.file) b.file = { type: 'external', external: { url: '' }, caption: [] };
                if (!Array.isArray(b.file.caption)) b.file.caption = [];
                break;
            case 'callout':
                if (!b.callout) b.callout = { rich_text: [], color: 'default' };
                if (!Array.isArray(b.callout.rich_text)) b.callout.rich_text = [];
                if (!b.callout.color) b.callout.color = 'default';
                break;
            case 'divider':
                b.divider = {};
                break;
            case 'table':
                if (!b.table) b.table = { table_width: 1, has_column_header: true, has_row_header: false, children: [] };
                if (!Array.isArray(b.table.children)) b.table.children = [];
                b.table.children = b.table.children.map((row: any) => normalizeBlock(row));
                // 确保顶层没有 children，防止歧义
                if ('children' in b) delete b.children;
                break;
            case 'table_row':
                if (!b.table_row) b.table_row = { cells: [] };
                if (!Array.isArray(b.table_row.cells)) b.table_row.cells = [];
                break;
        }
        return b;
    }

    function ensureRichText(b: any, key: string) {
        if (!b[key]) b[key] = { rich_text: [], color: 'default' };
        if (!Array.isArray(b[key].rich_text)) b[key].rich_text = [];
        if (!b[key].color) b[key].color = 'default';
    }

    return norm(blocks) as NotionBlock[];
}

// 基于 Markdown 源码片段恢复 pipe 表格的行（用于 remark 在极端场景下仅解析出表头的兜底）
function recoverPipeTableRowsFromMarkdown(segment: string, expectedWidth: number): any[] {
    // 简单、稳健的 pipe 表格解析：
    // - 允许前后有空白；
    // - 第2行作为分隔行（---/:-: 等）；
    // - 之后连续以 '|' 开头或包含多 '|' 的行视为数据行；
    // - 单元格使用未转义的竖线分割，去除首尾 '|' 与空白；
    const lines = segment.split(/\r?\n/);
    if (lines.length < 2) return [];

    // 找到分隔行位置（容错：可能有空白行）
    let headerIndex = 0;
    let sepIndex = -1;
    for (let i = headerIndex + 1; i < Math.min(lines.length, headerIndex + 5); i++) {
        const ln = lines[i].trim();
        if (!ln) continue;
        // 标准对齐行匹配
        if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(ln)) { sepIndex = i; break; }
        // 容错：至少包含3个 '-' 且含有 '|'
        if (ln.includes('|') && /-{3,}/.test(ln)) { sepIndex = i; break; }
    }
    if (sepIndex === -1) return [];

    const result: any[] = [];
    for (let i = headerIndex; i < lines.length; i++) {
        if (i === sepIndex) continue; // 跳过分隔行
        const raw = lines[i];
        if (!raw || !/[|]/.test(raw)) {
            // 遇到明显不是表格行的行，认为表格结束
            if (i > sepIndex) break;
            continue;
        }

        // 按未转义的 | 分割（支持首尾 |）
        const cells = splitByUnescapedPipes(raw).map(s => s.trim());
        if (cells.length === 0) continue;
        // 去掉首尾空单元格（由首尾 | 产生）
        if (cells[0] === '') cells.shift();
        if (cells.length && cells[cells.length - 1] === '') cells.pop();

        // 若列数与预期不一致，进行简单对齐（截断/补空）
        const width = expectedWidth || cells.length || 1;
        if (cells.length > width) cells.length = width;
        while (cells.length < width) cells.push('');

        // 构建 Notion table_row（仅以纯文本兜底；复杂内联语法在此兜底中不做二次解析）
        const row: any = { object: 'block', type: 'table_row', table_row: { cells: cells.map(txt => [{
            type: 'text',
            text: { content: txt },
            plain_text: txt,
            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }]) } };
        result.push(row);
    }

    // 至少包含表头与一行数据才算恢复有效
    return result.length >= 2 ? result : result;
}

// 从整篇 markdown 的位置附近恢复 pipe 表格，兼容没有分隔符行的表格
function recoverPipeTableRowsAroundPosition(markdown: string, pos: any, expectedWidth: number): any[] {
    const lines = markdown.split(/\r?\n/);
    const start = Math.max(0, (pos?.start?.line ?? 1) - 1);

    // 找到表头行
    let headerIndex = start;
    while (headerIndex < lines.length && !/[|]/.test(lines[headerIndex])) headerIndex++;
    if (headerIndex >= lines.length) return [];

    // 尝试找到分隔行
    let sepIndex = -1;
    for (let i = headerIndex + 1; i < Math.min(lines.length, headerIndex + 10); i++) {
        const ln = lines[i]?.trim();
        if (!ln) continue;

        // 检查是否是分隔行
        if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(ln) || (ln.includes('|') && /-{3,}/.test(ln))) {
            sepIndex = i;
            break;
        }

        // 如果没有分隔行，但下一行看起来像表格数据行，则直接开始收集数据
        if (ln.includes('|') && !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(ln)) {
            // 这可能是没有分隔符行的表格
            sepIndex = headerIndex; // 将表头行作为分隔行
            break;
        }

        // 若很快遇到非表格样式，则失败
        if (!ln.includes('|')) break;
    }

    // 如果没有找到分隔行，但表头后面有表格数据行，直接收集
    if (sepIndex === -1) {
        // 检查表头后面是否有表格数据行
        let hasTableData = false;
        for (let i = headerIndex + 1; i < Math.min(lines.length, headerIndex + 5); i++) {
            const ln = lines[i]?.trim();
            if (ln && ln.includes('|') && !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(ln)) {
                hasTableData = true;
                break;
            }
        }

        if (hasTableData) {
            sepIndex = headerIndex; // 将表头行作为分隔行
        } else {
            return [];
        }
    }

    const collected: string[] = [];
    // 包含表头行
    collected.push(lines[headerIndex] ?? '');

    // 收集数据行
    const dataStartIndex = sepIndex === headerIndex ? headerIndex + 1 : sepIndex + 1;
    for (let i = dataStartIndex; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln) break;

        // 检查是否是表格行（包含竖线且不是分隔行）
        const isTableRow = ln.includes('|') && !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(ln.trim());

        if (isTableRow) {
            collected.push(ln);
        } else {
            // 遇到非表格行，停止收集
            break;
        }
    }

    return buildRowsFromRawLines(collected, expectedWidth);
}

function splitByUnescapedPipes(line: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let escaped = false;
    let inCode = false; // 简易处理反引号内的管道
    let wikiDepth = 0;  // 处理 [[...|...]] 中的竖线
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const next = line[i+1];
        if (escaped) { cur += ch; escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '`') { inCode = !inCode; cur += ch; continue; }
        // 处理 Obsidian/Wiki 链接 [[...|...]]
        if (ch === '[' && next === '[') { wikiDepth++; cur += ch; continue; }
        if (ch === ']' && next === ']') { wikiDepth = Math.max(0, wikiDepth - 1); cur += ch; continue; }
        if (ch === '|' && !inCode && wikiDepth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    parts.push(cur);
    return parts;
}

function buildRowsFromRawLines(lines: string[], expectedWidth: number): any[] {
    const rows: any[] = [];
    if (!lines.length) return rows;
    for (const raw of lines) {
        if (!raw) continue;
        // 忽略典型的分隔行
        const isSep = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(raw.trim());
        if (isSep) continue;
        const cells = splitByUnescapedPipes(raw).map(s => s.trim());
        if (cells.length === 0) continue;
        if (cells[0] === '') cells.shift();
        if (cells.length && cells[cells.length - 1] === '') cells.pop();
        const width = expectedWidth || cells.length || 1;
        if (cells.length > width) cells.length = width;
        while (cells.length < width) cells.push('');
        const row: any = { object: 'block', type: 'table_row', table_row: { cells: cells.map(txt => [{
            type: 'text', text: { content: txt }, plain_text: txt,
            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
        }]) } };
        rows.push(row);
    }
    return rows;
}

// 全局恢复：根据表头文本在整篇 Markdown 中寻找匹配的 pipe 表格并恢复
function recoverPipeTableRowsGlobally(markdown: string, expectedWidth: number, expectedHeader: string[]): any[] {
    try {
        if (!expectedHeader || expectedHeader.length === 0) return [];
        const lines = markdown.split(/\r?\n/);
        // 归一化比较（去空白）
        const norm = (s: string) => (s || '').replace(/\s+/g, '');
        const expected = expectedHeader.map(norm);

        const segments: string[][] = [];
        let cur: string[] = [];
        const isSep = (ln: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test((ln || '').trim());
        const isRow = (ln: string) => !!ln && ln.includes('|');

        for (const ln of lines) {
            if (isRow(ln)) cur.push(ln); else { if (cur.length) { segments.push(cur); cur = []; } }
        }
        if (cur.length) segments.push(cur);

        for (const seg of segments) {
            if (seg.length === 0) continue;
            const headerLine = isSep(seg[0]) && seg.length > 1 ? seg[1] : seg[0];
            if (!headerLine) continue;
            let headerCells = splitByUnescapedPipes(headerLine).map(s => s.trim());
            if (headerCells[0] === '') headerCells.shift();
            if (headerCells.length && headerCells[headerCells.length - 1] === '') headerCells.pop();
            while (headerCells.length < expectedWidth) headerCells.push('');
            if (headerCells.length > expectedWidth) headerCells.length = expectedWidth;

            const normalized = headerCells.map(norm);
            const match = normalized.length === expected.length && normalized.every((v, i) => v === expected[i]);
            if (!match) continue;

            // 命中：用这个段落恢复
            return buildRowsFromRawLines(seg, expectedWidth);
        }
    } catch { /* ignore */ }
    return [];
}
