import * as http from 'http';
import * as https from 'https';

export interface NodeHttpResponse {
	status: number;
	headers: Record<string, string>;
	body: Buffer;
}

export async function nodeRequest(params: {
	url: string;
	method: string;
	headers?: Record<string, string>;
	body?: Buffer;
	timeoutMs?: number;
}): Promise<NodeHttpResponse> {
	const u = new URL(params.url);
	const lib = u.protocol === 'http:' ? http : https;
	const timeoutMs = params.timeoutMs ?? 30_000;

	return await new Promise((resolve, reject) => {
		const req = lib.request(
			{
				protocol: u.protocol,
				hostname: u.hostname,
				port: u.port ? Number(u.port) : undefined,
				path: `${u.pathname}${u.search}`,
				method: params.method,
				headers: params.headers
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
				res.on('end', () => {
					const headers: Record<string, string> = {};
					for (const [k, v] of Object.entries(res.headers)) {
						if (typeof v === 'string') {
							headers[k.toLowerCase()] = v;
						} else if (Array.isArray(v)) {
							headers[k.toLowerCase()] = v.join(', ');
						}
					}
					resolve({ status: res.statusCode || 0, headers, body: Buffer.concat(chunks) });
				});
			}
		);

		req.on('error', reject);
		req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
		if (params.body) {
			req.write(params.body);
		}
		req.end();
	});
}

