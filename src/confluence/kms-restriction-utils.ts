/**
 * KMS 权限限制工具
 *
 * @author Anner
 * @since 12.0
 * Created on 2026/2/4
 */

export interface ConfluenceRestrictionPayload {
	operation: string;
	restrictions: {
		user?: Array<{ type: string; username: string }>;
		group?: Array<{ type: string; name: string }>;
	};
}

export function buildReadRestrictionPayload(username: string): ConfluenceRestrictionPayload[] {
	const trimmed = username.trim();
	return [
		{
			operation: 'read',
			restrictions: {
				user: [{ type: 'known', username: trimmed }],
				group: []
			}
		}
	];
}
