import { neon } from '@neondatabase/serverless';

let sql = null;

export function isDbConfigured() {
    return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set');
    }
    if (!sql) {
        sql = neon(process.env.DATABASE_URL);
    }
    return sql;
}
