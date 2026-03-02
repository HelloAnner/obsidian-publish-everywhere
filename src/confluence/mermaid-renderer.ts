import { nodeRequest } from './node-http';

/**
 * Mermaid 渲染器：统一渲染风格，输出 PNG
 */
export class MermaidRenderer {
	private static readonly MINIMAL_INIT_DIRECTIVE =
		'%%{init: {"theme":"base","themeVariables":{"background":"#FFFFFF","primaryColor":"#EAF2FF","primaryTextColor":"#111827","primaryBorderColor":"#CBD5E1","secondaryColor":"#F8FAFC","tertiaryColor":"#FFFFFF","lineColor":"#64748B","fontFamily":"-apple-system, BlinkMacSystemFont, \\"PingFang SC\\", \\"Microsoft YaHei\\", sans-serif","fontSize":"16px","clusterBkg":"#F8FAFC","clusterBorder":"#CBD5E1"}}}%%';

	/**
	 * 渲染 mermaid 为 PNG 二进制
	 *
	 * @param source mermaid 源码
	 */
	async renderToPng(source: string): Promise<Uint8Array> {
		const sourceWithTheme = this.applyMinimalTheme(source);
		const response = await nodeRequest({
			url: 'https://kroki.io/mermaid/png',
			method: 'POST',
			headers: {
				Accept: 'image/png',
				'Content-Type': 'text/plain; charset=utf-8'
			},
			body: Buffer.from(sourceWithTheme, 'utf8')
		});
		if (response.status < 200 || response.status >= 300) {
			const body = response.body.toString('utf8');
			throw new Error(`Render mermaid failed: HTTP ${response.status} ${body}`.trim());
		}
		return new Uint8Array(response.body);
	}

	private applyMinimalTheme(source: string): string {
		const normalized = source.trim();
		if (!normalized) {
			return normalized;
		}
		// 用户已显式配置 init 时，尊重原有主题定义
		if (/%%\s*\{\s*init:/i.test(normalized)) {
			return normalized;
		}
		return `${MermaidRenderer.MINIMAL_INIT_DIRECTIVE}\n${normalized}`;
	}
}
