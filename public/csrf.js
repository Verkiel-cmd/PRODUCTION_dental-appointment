import config from '../Auth_section/config.js';

let csrfToken = null;

async function getCsrfToken() {
    if (csrfToken) return csrfToken;

    const response = await fetch(`${config.API_URL}/csrf-token`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
    });

    if (!response.ok) {
        throw new Error(`Could not get CSRF token (HTTP ${response.status})`);
    }

    const data = await response.json();

    if (!data.csrfToken) {
        throw new Error('CSRF token was missing from the response');
    }

    csrfToken = data.csrfToken;
    return csrfToken;
}

export function resetCsrfToken() {
    csrfToken = null;
}

export async function csrfFetch(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        headers.set('X-CSRF-Token', await getCsrfToken());
    }

    const baseUrl = config.API_URL.replace(/\/+$/, '');
    const requestPath = path.startsWith('/') ? path : `/${path}`;

    return fetch(`${baseUrl}${requestPath}`, {
        ...options,
        method,
        headers,
        credentials: 'include'
    });
}