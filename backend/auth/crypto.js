import { createHash, randomBytes } from 'node:crypto';

export function sha256(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
    return randomBytes(bytes).toString('hex');
}
