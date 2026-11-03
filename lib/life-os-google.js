'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const TOKEN_PATH = path.join(__dirname, '..', 'data', 'life-os-google.json');
const REDIRECT_URI = 'http://127.0.0.1:8765';
const SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.send',
];
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';

let pending = null;
let lastAuth = { status: 'not_connected', message: 'Google account is not connected.' };
let accessToken = '';
let accessExpiresAt = 0;

function config() {
    return {
        clientId: String(process.env.LIFE_OS_GOOGLE_CLIENT_ID || '').trim(),
        clientSecret: String(process.env.LIFE_OS_GOOGLE_CLIENT_SECRET || '').trim(),
    };
}

function requireClient() {
    const c = config();
    if (!c.clientId || !c.clientSecret) {
        throw new Error('Google connection is not configured. Add LIFE_OS_GOOGLE_CLIENT_ID and LIFE_OS_GOOGLE_CLIENT_SECRET to the private config.env, then restart MUSHII.');
    }
    return c;
}

function readTokens() {
    try {
        const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        if (!data || typeof data.refresh_token !== 'string' || !data.refresh_token) return null;
        return data;
    } catch { return null; }
}

function writeTokens(tokens) {
    const directory = path.dirname(TOKEN_PATH);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const previous = readTokens() || {};
    const next = {
        refresh_token: tokens.refresh_token || previous.refresh_token || '',
        scope: tokens.scope || previous.scope || SCOPES.join(' '),
        token_type: tokens.token_type || previous.token_type || 'Bearer',
        updated_at: new Date().toISOString(),
    };
    if (!next.refresh_token) throw new Error('Google did not issue a refresh token. Disconnect the app in Google Account permissions and connect again.');
    const temporary = TOKEN_PATH + '.' + process.pid + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
        fs.renameSync(temporary, TOKEN_PATH);
    } finally {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    accessToken = String(tokens.access_token || '');
    accessExpiresAt = Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000;
}

async function tokenRequest(body) {
    const response = await fetch(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google OAuth token request failed (' + response.status + ').');
    return payload;
}

async function exchangeCode(code, verifier) {
    const c = requireClient();
    const tokens = await tokenRequest({
        code,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: verifier,
    });
    writeTokens(tokens);
    lastAuth = { status: 'connected', message: 'Google Drive upload and Gmail send permissions are connected.' };
    return lastAuth;
}

function beginOAuth() {
    if (pending) return { authorizationUrl: pending.authorizationUrl, redirectUri: REDIRECT_URI, alreadyPending: true };
    const c = requireClient();
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
        client_id: c.clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
    }).toString();

    const item = { state, verifier, authorizationUrl: url.toString(), server: null, timeout: null };
    const server = http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url || '/', REDIRECT_URI);
        if (requestUrl.pathname !== '/') {
            res.writeHead(404).end('Not found.');
            return;
        }
        const incomingState = requestUrl.searchParams.get('state') || '';
        if (!incomingState || incomingState.length !== state.length
            || !crypto.timingSafeEqual(Buffer.from(incomingState), Buffer.from(state))) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Invalid OAuth state. You can close this page.');
            lastAuth = { status: 'failed', message: 'Google authorization state did not match.' };
            return;
        }
        if (requestUrl.searchParams.has('error')) {
            const error = requestUrl.searchParams.get('error') || 'Google authorization cancelled.';
            lastAuth = { status: 'failed', message: 'Google authorization was not completed: ' + error.slice(0, 120) };
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Authorization was not completed. Return to WhatsApp and check .life google status.');
            closePending();
            return;
        }
        const code = requestUrl.searchParams.get('code') || '';
        if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Missing authorization code.');
            return;
        }
        try {
            await exchangeCode(code, verifier);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
                .end('<!doctype html><meta name="viewport" content="width=device-width"><title>MUSHII connected</title><h2>MUSHII Life OS connected</h2><p>You can close this page and return to WhatsApp.</p>');
        } catch (error) {
            lastAuth = { status: 'failed', message: error.message.slice(0, 220) };
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
                .end('Google connection failed. Return to WhatsApp and check .life google status.');
        } finally { closePending(); }
    });
    server.on('error', error => {
        lastAuth = { status: 'failed', message: 'OAuth callback server error: ' + error.message };
        closePending();
    });
    server.listen(8765, '127.0.0.1');
    item.server = server;
    item.timeout = setTimeout(() => {
        lastAuth = { status: 'expired', message: 'Google authorization link expired. Run .life google connect again.' };
        closePending();
    }, 10 * 60 * 1000);
    if (typeof item.timeout.unref === 'function') item.timeout.unref();
    pending = item;
    lastAuth = { status: 'waiting_for_consent', message: 'Open the Google authorization link on this phone and approve the requested permissions.' };
    try {
        execFile('termux-open-url', [url.toString()], { timeout: 5000 }, error => {
            if (error) console.warn('[LifeOS] Could not auto-open Google consent URL; send the link to the owner.');
        });
    } catch { /* The URL is also returned to the owner through WhatsApp. */ }
    return { authorizationUrl: url.toString(), redirectUri: REDIRECT_URI, alreadyPending: false };
}

function closePending() {
    if (!pending) return;
    if (pending.timeout) clearTimeout(pending.timeout);
    const server = pending.server;
    pending = null;
    if (server && server.listening) server.close();
}

function getStatus() {
    const tokens = readTokens();
    const connected = Boolean(tokens && tokens.refresh_token);
    return {
        ...lastAuth,
        ...(connected && lastAuth.status === 'not_connected'
            ? { status: 'connected', message: 'Google refresh token is saved on this device.' }
            : {}),
        connected,
        callbackPending: Boolean(pending),
    };
}

async function getAccessToken() {
    if (accessToken && Date.now() < accessExpiresAt - 60000) return accessToken;
    const tokens = readTokens();
    if (!tokens) throw new Error('Google is not connected. Use .life google connect first.');
    const c = requireClient();
    const fresh = await tokenRequest({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
    });
    accessToken = fresh.access_token;
    accessExpiresAt = Date.now() + Math.max(60, Number(fresh.expires_in) || 3600) * 1000;
    return accessToken;
}

async function googleFetch(url, options = {}) {
    const token = await getAccessToken();
    const response = await fetch(url, {
        ...options,
        headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) },
        signal: options.signal || AbortSignal.timeout(30000),
    });
    if (!response.ok) {
        const message = (await response.text()).slice(0, 500);
        throw new Error('Google API request failed (' + response.status + '): ' + message);
    }
    return response;
}

async function uploadBackup(buffer, filename) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > 8 * 1024 * 1024) {
        throw new RangeError('Encrypted Life OS backup must be between 1 byte and 8 MB.');
    }
    const safeName = String(filename || 'mushii-life-os-backup.json.enc').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const boundary = 'mushii_' + crypto.randomBytes(16).toString('hex');
    const metadata = Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
        + JSON.stringify({ name: safeName, description: 'Encrypted MUSHII Life OS personal data backup' }) + '\r\n'
        + '--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n', 'utf8');
    const trailer = Buffer.from('\r\n--' + boundary + '--', 'utf8');
    const body = Buffer.concat([metadata, buffer, trailer]);
    const response = await googleFetch(DRIVE_API + '/files?uploadType=multipart&fields=id,name,createdTime,size', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary, 'Content-Length': String(body.length) },
        body,
    });
    return response.json();
}

async function listBackups() {
    const query = "name contains 'mushii-life-os-' and trashed = false";
    const params = new URLSearchParams({
        q: query,
        pageSize: '20',
        orderBy: 'createdTime desc',
        fields: 'files(id,name,createdTime,size)',
    });
    const response = await googleFetch(DRIVE_API + '/files?' + params.toString());
    const payload = await response.json();
    return Array.isArray(payload.files) ? payload.files : [];
}

async function downloadBackup(fileId) {
    if (!/^[a-zA-Z0-9_-]{10,200}$/.test(String(fileId || ''))) throw new TypeError('Invalid Google Drive backup ID.');
    const response = await googleFetch(DRIVE_API + '/files/' + encodeURIComponent(fileId) + '?alt=media');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) throw new RangeError('Downloaded backup is larger than 8 MB.');
    return buffer;
}

function base64Url(value) {
    return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sendEmail({ to, subject, text }) {
    const recipient = String(to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new TypeError('Configure LIFE_OS_EMAIL_TO with a valid recipient email address.');
    const cleanSubject = String(subject || 'MUSHII Life OS').replace(/[\r\n]+/g, ' ').slice(0, 160);
    const body = String(text || '').slice(0, 12000);
    const message = [
        'To: ' + recipient,
        'Subject: ' + cleanSubject,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) || []).join('\\r\\n'),
    ].join('\r\n');
    const response = await googleFetch(GMAIL_API + '/users/me/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: base64Url(message) }),
    });
    return response.json();
}

function disconnect() {
    closePending();
    accessToken = '';
    accessExpiresAt = 0;
    try { fs.unlinkSync(TOKEN_PATH); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    lastAuth = { status: 'not_connected', message: 'Google account disconnected from MUSHII on this device.' };
    return true;
}

module.exports = {
    SCOPES,
    REDIRECT_URI,
    beginOAuth,
    getStatus,
    getAccessToken,
    uploadBackup,
    listBackups,
    downloadBackup,
    sendEmail,
    disconnect,
    __test: { tokenRequest, writeTokens, readTokens, closePending },
};
