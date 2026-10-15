/**
 * Resolve the public site URL for magic links / bot API calls.
 * Prefer APP_PUBLIC_URL when it is a real (non-localhost) URL.
 * Fall back to common host platform envs, then the request Host.
 * Localhost is only used when that is what the env intentionally says
 * (or nothing else is available in development).
 */

function stripTrailingSlash(url) {
    return String(url || '').trim().replace(/\/$/, '');
}

export function isLocalhostUrl(url) {
    if (!url) return false;
    return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(String(url));
}

function platformPublicUrl() {
    if (process.env.RENDER_EXTERNAL_URL) {
        return stripTrailingSlash(process.env.RENDER_EXTERNAL_URL);
    }
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        return `https://${stripTrailingSlash(process.env.RAILWAY_PUBLIC_DOMAIN)}`;
    }
    if (process.env.FLY_APP_NAME) {
        return `https://${process.env.FLY_APP_NAME}.fly.dev`;
    }
    if (process.env.VERCEL_URL) {
        const host = stripTrailingSlash(process.env.VERCEL_URL).replace(
            /^https?:\/\//i,
            ''
        );
        return `https://${host}`;
    }
    return '';
}

function urlFromRequest(req) {
    if (!req?.get) return '';
    const proto = String(
        req.get('x-forwarded-proto') || req.protocol || 'https'
    )
        .split(',')[0]
        .trim();
    const host = String(req.get('x-forwarded-host') || req.get('host') || '')
        .split(',')[0]
        .trim();
    if (!host || isLocalhostUrl(host)) return '';
    return stripTrailingSlash(`${proto}://${host}`);
}

/**
 * @param {import('express').Request | null | undefined} [req]
 */
export function getAppPublicUrl(req) {
    const envUrl = stripTrailingSlash(process.env.APP_PUBLIC_URL || '');

    // Explicit public APP_PUBLIC_URL wins
    if (envUrl && !isLocalhostUrl(envUrl)) return envUrl;

    const platform = platformPublicUrl();
    if (platform && !isLocalhostUrl(platform)) return platform;

    const fromReq = urlFromRequest(req);
    if (fromReq) return fromReq;

    // Intentional local env (or missing) — localhost only as last resort
    if (envUrl) return envUrl;

    if (process.env.NODE_ENV === 'production') {
        console.warn(
            '[appPublicUrl] APP_PUBLIC_URL is unset or localhost in production — magic links may be wrong'
        );
    }
    return 'http://localhost:3000';
}
