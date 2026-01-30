import { App, TFile } from 'obsidian';

export interface ExcalidrawExportResult {
	bytes: Uint8Array;
	displayWidth: number;
}

export class ExcalidrawExporter {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	async exportToPng(file: TFile, opts?: { displayWidth?: number; scale?: number }): Promise<ExcalidrawExportResult> {
		const displayWidth = opts?.displayWidth ?? 800;
		const scale = opts?.scale ?? 2;

		const ea = this.getExcalidrawAutomateApi();
		try {
			const scene = await ea.getSceneFromFile(file);
			if (!scene?.elements || !Array.isArray(scene.elements)) {
				throw new Error('无法从 Excalidraw 文件读取场景数据');
			}

			ea.clear();
			if (ea.elementsDict && typeof ea.elementsDict === 'object') {
				for (const key of Object.keys(ea.elementsDict)) {
					delete ea.elementsDict[key];
				}
			}

			for (const el of scene.elements as any[]) {
				if (el?.id && ea.elementsDict) {
					ea.elementsDict[String(el.id)] = el;
				}
			}

			const theme = (scene.appState as any)?.theme;
			const exportSettings = ea.getExportSettings(true, true);
			const loader = ea.getEmbeddedFilesLoader(theme === 'dark');
			const dataUrl: string = await ea.createPNGBase64(undefined, scale, exportSettings, loader, theme, 0);

			const bytes = this.dataUrlToBytes(dataUrl);
			return { bytes, displayWidth };
		} finally {
			if (typeof ea.destroy === 'function') {
				ea.destroy();
			}
		}
	}

	private getExcalidrawAutomateApi(): any {
		const w = window as unknown as any;
		const ea = w?.ExcalidrawAutomate;
		if (!ea || typeof ea.getAPI !== 'function') {
			throw new Error('未检测到 Excalidraw 插件（ExcalidrawAutomate.getAPI 不可用）');
		}
		try {
			return ea.getAPI();
		} catch (e) {
			return ea.getAPI(this.app);
		}
	}

	private dataUrlToBytes(dataUrl: string): Uint8Array {
		const comma = dataUrl.indexOf(',');
		const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
		return Uint8Array.from(Buffer.from(base64, 'base64'));
	}
}
