import { App, TFile } from 'obsidian';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { GitHubMarkdownConverter } from './markdown-to-github';

const COMMIT_MESSAGE = '更新 readme 文档, 来自 obsidian-publish-everywhere 插件';

export interface GitHubPublishResult {
	repoUrl: string;
	branch: string;
	updated: boolean;
}

export class GitHubPublisher {
	private readonly app: App;
	private readonly vaultBasePath: string;

	constructor(params: { app: App; vaultBasePath: string }) {
		this.app = params.app;
		this.vaultBasePath = params.vaultBasePath;
	}

	async publishMarkdownFile(params: { file: TFile; repoUrl: string; rawContent?: string }): Promise<GitHubPublishResult> {
		const repo = parseGitHubRepo(params.repoUrl);
		const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obsidian-publish-everywhere-'));

		try {
			await this.cloneRepository(repo, tempDir);
			const branch = await this.resolveDefaultBranch(tempDir);
			await this.ensureCommitIdentity(tempDir);
			await this.writeReadmeAndAssets(tempDir, params.file, params.rawContent);

			const changed = await this.hasRepositoryChanges(tempDir);
			if (!changed) {
				return { repoUrl: repo.httpUrl, branch, updated: false };
			}

			await this.runGitCommand(['add', '-A'], tempDir);
			await this.runGitCommand(['commit', '-m', COMMIT_MESSAGE], tempDir);
			await this.runGitCommand(['push', 'origin', branch], tempDir);

			return { repoUrl: repo.httpUrl, branch, updated: true };
		} finally {
			await fs.promises.rm(tempDir, { recursive: true, force: true });
		}
	}

	private async cloneRepository(repo: GitHubRepoInfo, tempDir: string): Promise<void> {
		await this.runGitCommand(['clone', repo.sshUrl, tempDir], process.cwd());
	}

	private async resolveDefaultBranch(repoDir: string): Promise<string> {
		const ref = await this.runGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoDir);
		const trimmed = ref.stdout.trim();
		const match = /^refs\/remotes\/origin\/(.+)$/.exec(trimmed);
		if (match?.[1]) {
			return match[1];
		}
		return 'main';
	}

	private async ensureCommitIdentity(repoDir: string): Promise<void> {
		await this.runGitCommand(['config', 'user.name', 'obsidian-publish-everywhere'], repoDir);
		await this.runGitCommand(['config', 'user.email', 'obsidian-publish-everywhere@local'], repoDir);
	}

	private async writeReadmeAndAssets(repoDir: string, file: TFile, rawContent?: string): Promise<void> {
		const content = rawContent ?? (await this.app.vault.read(file));
		const converter = new GitHubMarkdownConverter({
			app: this.app,
			sourceFile: file,
			vaultBasePath: this.vaultBasePath,
			repoDir
		});
		const markdown = await converter.convert(content);
		const readmePath = path.join(repoDir, 'README.md');
		await fs.promises.writeFile(readmePath, markdown, 'utf8');
	}

	private async hasRepositoryChanges(repoDir: string): Promise<boolean> {
		const status = await this.runGitCommand(['status', '--porcelain'], repoDir);
		return status.stdout.trim().length > 0;
	}

	private async runGitCommand(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
		return await new Promise((resolve, reject) => {
			const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';

			child.stdout.on('data', (chunk) => {
				stdout += String(chunk);
			});
			child.stderr.on('data', (chunk) => {
				stderr += String(chunk);
			});

			child.on('error', (error) => {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					reject(new Error('Git command not found. Please install git.'));
					return;
				}
				reject(error);
			});

			child.on('close', (code) => {
				if (code === 0) {
					resolve({ stdout, stderr });
					return;
				}

				const output = `${stdout}\n${stderr}`;
				if (isSshAuthError(output)) {
					reject(new Error('GitHub SSH authentication failed. Please check local SSH keys.'));
					return;
				}

				reject(new Error(`git ${args.join(' ')} failed: ${output.trim()}`));
			});
		});
	}
}

interface GitHubRepoInfo {
	owner: string;
	repo: string;
	httpUrl: string;
	sshUrl: string;
}

function parseGitHubRepo(rawUrl: string): GitHubRepoInfo {
	const trimmed = String(rawUrl || '').trim();
	if (!trimmed) {
		throw new Error('GitHub repository URL is empty');
	}

	let owner = '';
	let repo = '';

	const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed);
	if (httpsMatch) {
		owner = httpsMatch[1];
		repo = httpsMatch[2];
	}

	const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed);
	if (!owner && sshMatch) {
		owner = sshMatch[1];
		repo = sshMatch[2];
	}

	if (!owner || !repo) {
		throw new Error(`Invalid GitHub repository URL: ${trimmed}`);
	}

	return {
		owner,
		repo,
		httpUrl: `https://github.com/${owner}/${repo}`,
		sshUrl: `git@github.com:${owner}/${repo}.git`
	};
}

function isSshAuthError(output: string): boolean {
	const text = output.toLowerCase();
	return text.includes('permission denied (publickey)') || text.includes('could not read from remote repository');
}
