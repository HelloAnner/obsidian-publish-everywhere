import { Notice, TFile, MarkdownView } from 'obsidian';

/**
 * 发布任务类型
 */
export interface PublishTask {
	type: 'feishu' | 'confluence' | 'notion' | 'github' | 'all';
	file?: TFile;
	view?: MarkdownView;
}

/**
 * 发布队列管理器
 * 实现串行发布控制，避免并发导致的页面错乱问题
 */
export class PublishQueue {
	private queue: PublishTask[] = [];
	private isProcessing = false;

	/**
	 * 添加任务到队列
	 */
	add(task: PublishTask): void {
		this.queue.push(task);
		this.processNext();
	}

	/**
	 * 处理队列中的下一个任务
	 */
	private async processNext(): Promise<void> {
		// 如果正在处理或队列为空，直接返回
		if (this.isProcessing || this.queue.length === 0) {
			return;
		}

		// 标记为处理中
		this.isProcessing = true;

		// 取出第一个任务
		const task = this.queue.shift();
		if (!task) {
			this.isProcessing = false;
			return;
		}

		try {
			// 执行任务（由外部传入的实际执行函数）
			await this.executeTask(task);
		} catch (error) {
			console.error('发布任务执行失败:', error);
		} finally {
			// 标记为处理完成
			this.isProcessing = false;

			// 如果有待处理任务，继续处理下一个（延迟500ms避免频率限制）
			if (this.queue.length > 0) {
				setTimeout(() => {
					this.processNext();
				}, 500);
			}
		}
	}

	/**
	 * 执行任务（具体实现由外部插件类提供）
	 */
    protected async executeTask(task: PublishTask): Promise<void> {
        // 这个方法会在插件主类中被覆盖
        throw new Error('executeTask 方法未实现');
    }

	/**
	 * 清空队列
	 */
	clear(): void {
		this.queue = [];
	}

	/**
	 * 获取队列长度
	 */
	get length(): number {
		return this.queue.length;
	}

	/**
	 * 是否正在处理中
	 */
	get processing(): boolean {
		return this.isProcessing;
	}

	/**
	 * 获取队列状态（用于显示给用户）
	 */
	getStatus(): string {
		if (this.isProcessing && this.queue.length > 0) {
			return `发布中（队列中还有 ${this.queue.length} 个任务）`;
		} else if (this.isProcessing) {
			return '发布中';
		} else if (this.queue.length > 0) {
			return `排队中（共 ${this.queue.length} 个任务）`;
		}
		return '就绪';
	}
}

/**
 * 带执行回调的发布队列
 */
export class CallbackPublishQueue extends PublishQueue {
	private executeCallback: (task: PublishTask) => Promise<void>;

	constructor(executeCallback: (task: PublishTask) => Promise<void>) {
		super();
		this.executeCallback = executeCallback;
	}

	/**
	 * 执行任务（调用外部提供的回调函数）
	 */
	protected async executeTask(task: PublishTask): Promise<void> {
		await this.executeCallback(task);
	}
}
