import { createHash, randomBytes } from 'node:crypto';

export function generateEditorToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashEditorToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
