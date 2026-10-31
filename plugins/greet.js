'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fmt } = require('../lib/theme');

const DATA_PATH = path.join(__dirname, '../data/greet.json');
const REPLY_LIMIT_PATH = path.join(__dirname, '../data/greet-reply-limits.json');
const REPLY_LIMIT = 3;
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

const GREETING_VARIANTS = [
    '😄 Nta kurambirwa hano, sha — hitamo icyo ukunda!',
    '😄 Bite, twishimane! Hitamo command imwe dutangire.',
    '😄 Niba urambiwe, MUSHII iragukiza! Hitamo kimwe!'
];

const COMMAND_LABELS = [
    ['menu', '.menu - View the full MUSHII menu'],
    ['joke', '.joke - Get a funny joke'],
    ['truth', '.truth - Truth questions'],
    ['dare', '.dare - Fun dare challenges'],
    ['riddle', '.riddle - Brain teasers'],
    ['ship', '.ship - Love compatibility'],
    ['play', '.play song name - Search and play music']
];

function loadData() {
    try {
        if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    } catch { /* Existing greeting configuration remains optional. */ }
    return {};
}

function saveData(data) {
    try {
        const dir = path.dirname(DATA_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    } catch { /* Existing greeting configuration remains optional. */ }
}

let greetData = loadData();

function recentReplyTimes(history, jid, now = Date.now()) {
    const recent = (history.get(jid) || []).filter(timestamp => timestamp > now - REPLY_WINDOW_MS);
    if (recent.length) history.set(jid, recent);
    else history.delete(jid);
    return recent;
}

function createReplyLimiter(options = {}) {
    const filePath = options.filePath || REPLY_LIMIT_PATH;
    const now = options.now || Date.now;
    const logError = options.logError || (error => console.error('[Greeting] Reply-limit persistence failed:', error.message));
    const history = new Map();
    const pending = new Map();
    let storageHealthy = true;
    let sequence = 0;

    try {
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const timestamp = now();
        for (const [jid, times] of Object.entries(saved || {})) {
            if (!Array.isArray(times)) continue;
            const recent = times.filter(value => Number.isFinite(value)
                && value <= timestamp
                && value > timestamp - REPLY_WINDOW_MS);
            if (recent.length) history.set(jid, recent);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    function pruneHistory(timestamp = now()) {
        for (const jid of history.keys()) recentReplyTimes(history, jid, timestamp);
    }

    function persist() {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
        try {
            fs.writeFileSync(tempPath, JSON.stringify(Object.fromEntries(history)), { mode: 0o600 });
            fs.renameSync(tempPath, filePath);
        } finally {
            try { fs.unlinkSync(tempPath); } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }

    function getPending(jid) {
        if (!pending.has(jid)) pending.set(jid, new Set());
        return pending.get(jid);
    }

    return {
        reserve(jid) {
            if (!storageHealthy) return null;
            const recent = recentReplyTimes(history, jid, now());
            const reservations = getPending(jid);
            if (recent.length + reservations.size >= REPLY_LIMIT) return null;
            const reservation = { jid, id: ++sequence };
            reservations.add(reservation.id);
            return reservation;
        },
        commit(reservation) {
            if (!reservation) return false;
            const reservations = pending.get(reservation.jid);
            if (!reservations?.delete(reservation.id)) return false;
            if (reservations.size === 0) pending.delete(reservation.jid);

            const timestamp = now();
            const recent = recentReplyTimes(history, reservation.jid, timestamp);
            recent.push(timestamp);
            history.set(reservation.jid, recent);
            pruneHistory(timestamp);
            try {
                persist();
                return true;
            } catch (error) {
                storageHealthy = false;
                logError(error);
                return false;
            }
        },
        release(reservation) {
            if (!reservation) return;
            const reservations = pending.get(reservation.jid);
            reservations?.delete(reservation.id);
            if (reservations?.size === 0) pending.delete(reservation.jid);
        },
        recent(jid) {
            return recentReplyTimes(history, jid, now());
        }
    };
}

const replyLimiter = createReplyLimiter();

function isPrivateJid(jid) {
    return typeof jid === 'string'
        && ['@s.whatsapp.net', '@lid', '@c.us'].some(suffix => jid.endsWith(suffix));
}

function buildGreeting(availableCommands, random = Math.random) {
    const commands = availableCommands instanceof Set
        ? availableCommands
        : new Set(availableCommands || []);
    const commandLines = COMMAND_LABELS
        .filter(([command]) => commands.has(command))
        .map(([, label]) => label);
    const variantIndex = Math.min(
        GREETING_VARIANTS.length - 1,
        Math.max(0, Math.floor(random() * GREETING_VARIANTS.length))
    );

    return [
        '💜 Heyyy! Welcome to MUSHII!',
        "😂 Bite se? What's up?",
        "🎮 Bored? Let's have some fun!",
        GREETING_VARIANTS[variantIndex],
        '',
        'Available commands:',
        ...(commandLines.length ? commandLines : ['Ask the owner to check the entertainment command setup.']),
        '',
        'MUSHII — Your Entertainment Bestie! 💜'
    ].join('\n');
}

function sanitizeCustomGreeting(text, availableCommands) {
    const commands = availableCommands instanceof Set ? availableCommands : new Set(availableCommands || []);
    return String(text || '').replace(/\.([a-z][a-z0-9_-]*)/gi, (match, name) =>
        commands.has(name.toLowerCase()) ? match : name
    );
}

function createAutoGreeting(options = {}) {
    const limiter = options.limiter || replyLimiter;
    const nowRandom = options.random || Math.random;
    const enabled = options.enabled || (() => greetData['__enabled__'] !== false);
    const getCustomGreeting = options.getCustomGreeting || (() => '');
    const logError = options.logError || (error => console.error('[Greeting] Automatic reply failed:', error.message));

    return async (sock, message, _text, context = {}) => {
        const jid = context.jid || message?.key?.remoteJid;
        if (!isPrivateJid(jid) || context.isGroup || message?.key?.fromMe || context.isOwner) return;
        if (!enabled()) return;

        const reservation = limiter.reserve(jid);
        if (!reservation) return;

        const availableCommands = context.availableCommands || new Set();
        const greeting = buildGreeting(availableCommands, nowRandom);
        const customGreeting = sanitizeCustomGreeting(
            getCustomGreeting(),
            availableCommands
        ).trim();
        const text = customGreeting
            ? `${greeting.slice(0, greeting.lastIndexOf('\n\nMUSHII —'))}\n\n💬 ${customGreeting}\n\nMUSHII — Your Entertainment Bestie! 💜`
            : greeting;

        try {
            const result = await sock.sendMessage(jid, { text }, { quoted: message });
            if (!result) {
                limiter.release(reservation);
                return;
            }
            limiter.commit(reservation);
        } catch (error) {
            limiter.release(reservation);
            logError(error);
        }
    };
}

function getGreetText() {
    const ownerNum = (process.env.OWNER_NUMBER || global.botNum || '').replace(/\D/g, '');
    const ownerJid = ownerNum ? `${ownerNum}@s.whatsapp.net` : null;
    return greetData['__text__']
        || (ownerJid && greetData[ownerJid])
        || Object.values(greetData).find(value => typeof value === 'string')
        || null;
}

const autoGreeting = createAutoGreeting({ getCustomGreeting: getGreetText });

module.exports = {
    commands:    ['setgreet', 'getgreet', 'delgreet', 'greeton', 'greetoff'],
    description: 'Send up to three automatic greetings per contact per rolling 24 hours',
    permission:  'owner',
    group:       false,
    private:     true,

    async run(sock, message, args, ctx) {
        const { reply } = ctx;
        const cmd = ctx.command;

        if (cmd === 'greeton') {
            greetData['__enabled__'] = true;
            saveData(greetData);
            return reply(fmt('✅ *MUSHII automatic greetings enabled!*'));
        }

        if (cmd === 'greetoff') {
            greetData['__enabled__'] = false;
            saveData(greetData);
            return reply(fmt('❌ *MUSHII automatic greetings disabled.*'));
        }

        if (cmd === 'setgreet') {
            const text = args.join(' ').trim();
            if (!text) {
                return reply(fmt('📝 *Usage:* `.setgreet <personal note>`\n\nYour note appears alongside the standard MUSHII entertainment welcome.'));
            }
            greetData['__text__'] = text;
            if (greetData['__enabled__'] !== false) greetData['__enabled__'] = true;
            saveData(greetData);
            return reply(fmt('✅ *Personal greeting note saved.*'));
        }

        if (cmd === 'getgreet') {
            const text = getGreetText();
            return reply(fmt(
                `📝 *MUSHII Automatic Greeting*\n\n` +
                `${text ? `Personal note: _"${text}"_\n\n` : ''}` +
                `Status: ${greetData['__enabled__'] === false ? '❌ OFF' : '✅ ON'}\n` +
                `Limit: 3 successful replies per contact per rolling 24 hours\n\n` +
                `• \`.greeton\` / \`.greetoff\` — toggle\n` +
                `• \`.setgreet <note>\` — set an optional personal note\n` +
                `• \`.delgreet\` — delete the note`
            ));
        }

        if (cmd === 'delgreet') {
            const text = getGreetText();
            if (!text) return reply(fmt('❌ No personal greeting note to delete.'));
            delete greetData['__text__'];
            Object.keys(greetData).forEach(key => {
                if (key !== '__enabled__' && key !== '__text__') delete greetData[key];
            });
            saveData(greetData);
            return reply(fmt('✅ *Personal greeting note deleted.*'));
        }
    },

    onMessage: autoGreeting,
    __test: {
        buildGreeting,
        createAutoGreeting,
        createReplyLimiter,
        recentReplyTimes,
        REPLY_LIMIT,
        REPLY_WINDOW_MS
    }
};
