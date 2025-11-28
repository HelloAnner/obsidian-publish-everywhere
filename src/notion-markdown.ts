/**
 * Markdown → Notion Blocks 转换器
 * 使用 remark 解析 Markdown，并生成 Notion API 可用的 Block 数组。
 * 覆盖：标题/段落/加粗/斜体/链接/列表/引用/代码块/表格/分割线/图片/附件。
 */

import { NotionBlock, NotionRichText } from './types';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';

export interface ConvertOptions {
    // 将本地资源路径转成 Notion 文件上传 id 的解析器（由调用方注入）
    resolveLocalAsset?: (src: string) => Promise<{ kind: 'image' | 'file'; uploadId: string; caption?: string } | null>;
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
            blocks.push(tableBlock);
        },
        image: async (node) => {
            await flushList();
            const url: string = node.url || '';
            const captionText = node.alt || '';
            const b: any = baseBlock();
            b.type = 'image';
            b.image = { type: 'external', external: { url }, caption: captionText ? [{ type: 'text', text: { content: captionText }, plain_text: captionText, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' } }] : [] };

            // 本地资源（非 http/https）
            if (!/^https?:\/\//i.test(url) && options.resolveLocalAsset) {
                const resolved = await options.resolveLocalAsset(url);
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
