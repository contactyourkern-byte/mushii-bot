'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COOLDOWN_MS = 30 * 60 * 1000;
const STATE_PATH = path.join(__dirname, '../data/away-mode.json');

const GREETING_REPLY = [
    'Hey there! 👋 Muraho neza!',
    '',
    'Thanks for reaching out. Iragena is not online right now,',
    'ariko ubutumwa bwawe arabubona kandi azagusubiza namara kugaruka. 😊'
].join('\n');

const DEFAULT_REPLY = [
    '✨ MUSHII ENTERTAINMENT ✨',
    '',
    'Hey! 👋 Iragena is not online right now.',
    '',
    'Ariko ntugire ikibazo! You can still enjoy MUSHII',
    'while waiting:',
    '',
    '🎵 .play <song name> — Play your favourite music.',
    '',
    '😂 .joke — Get a random joke.',
    '',
    '🧩 .riddle — Challenge your brain.',
    '',
    '💎 Type .menu to explore all MUSHII features.',
    '',
    'Enjoy your time! ❤️'
].join('\n');

function isGreeting(text) {
    return /\b(?:hi|hello|hey|muraho|amakuru|mwaramutse|waramutse|mwiriwe|uraho|bite|good\s+morning|good\s+evening)\b/i
        .test(String(text || ''));
}

function responseFor(text) {
    return isGreeting(text) ? GREETING_REPLY : DEFAULT_REPLY;
}

function isCommandMessage(text, prefixSetting, plugins) {
    if (/^(?:hey\s+)?(?:mushii|agent)(?:\s*[,!:.\-]\s*|\s+|$)/i.test(String(text || '').trim())) {
        return true;
    }

    const rawPrefix = (prefixSetting || '.').trim();
    const noPrefixMode = !rawPrefix || ['none', 'false'].includes(rawPrefix.toLowerCase());
    const anyPrefixMode = rawPrefix.toLowerCase() === 'any';
    const prefixes = !noPrefixMode && !anyPrefixMode
        ? rawPrefix.split(',').map(prefix => prefix.trim()).filter(Boolean).sort((a, b) => b.length - a.length)
        : [];
    let commandText = '';

    if (noPrefixMode) {
        commandText = String(text || '').trim();
    } else if (anyPrefixMode) {
        const first = text?.[0];
        if (first && !/^[a-zA-Z0-9\u00C0-\u024F\s]/.test(first)) {
            commandText = text.slice(1).trim();
        }
    } else {
        const prefix = prefixes.find(candidate => text?.startsWith(candidate));
        if (prefix) commandText = text.slice(prefix.length).trim();
    }

    if (!commandText) return false;
    if (/^(?:hey\s+)?(?:mushii|agent)(?:\s*[,!:.\-]\s*|\s+|$)/i.test(commandText)) return true;

    const command = commandText.split(/\s+/)[0].toLowerCase();
    return plugins.some(plugin => plugin.commands?.includes(command));
}

function readState(filePath, now) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            || typeof parsed.enabled !== 'boolean'
            || !parsed.lastReplies || typeof parsed.lastReplies !== 'object' || Array.isArray(parsed.lastReplies)) {
            throw new Error('Auto Reply state file has an invalid format');
        }

        const lastReplies = {};
        for (const [sender, timestamp] of Object.entries(parsed.lastReplies)) {
            if (Number.isFinite(timestamp) && timestamp <= now() && timestamp > now() - COOLDOWN_MS) {
                lastReplies[sender] = timestamp;
            }
        }
        return { enabled: parsed.enabled, lastReplies };
    } catch (error) {
        if (error.code === 'ENOENT') return { enabled: false, lastReplies: {} };
        throw error;
    }
}

function createAutoReply(options = {}) {
    const filePath = options.filePath || STATE_PATH;
    const now = options.now || Date.now;
    const state = readState(filePath, now);
    const pending = new Set();

    function persist() {
        const directory = path.dirname(filePath);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
        try {
            fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
            fs.renameSync(tempPath, filePath);
        } finally {
            try {
                fs.unlinkSync(tempPath);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }

    return {
        isEnabled() {
            return state.enabled;
        },

        setEnabled(enabled) {
            if (typeof enabled !== 'boolean') throw new TypeError('Auto Reply state must be a boolean');
            const previous = state.enabled;
            state.enabled = enabled;
            try {
                persist();
            } catch (error) {
                state.enabled = previous;
                throw error;
            }
        },

        async replyToMessage({ jid, sender = jid, text, isGroup, isOwner, fromMe, isProtocolMessage, send }) {
            const privateJid = typeof jid === 'string'
                && ['@s.whatsapp.net', '@lid', '@c.us'].some(suffix => jid.endsWith(suffix));
            if (!state.enabled || !privateJid || isGroup || isOwner || fromMe || isProtocolMessage) return false;
            if (typeof send !== 'function') throw new TypeError('Auto Reply requires a send callback');

            const timestamp = now();
            const previous = state.lastReplies[sender];
            if (pending.has(sender) || (Number.isFinite(previous) && timestamp - previous < COOLDOWN_MS)) {
                return false;
            }

            pending.add(sender);
            state.lastReplies[sender] = timestamp;
            try {
                persist();
            } catch (error) {
                if (previous === undefined) delete state.lastReplies[sender];
                else state.lastReplies[sender] = previous;
                pending.delete(sender);
                throw error;
            }

            try {
                const result = await send({ text: responseFor(text) });
                if (result === null) {
                    if (previous === undefined) delete state.lastReplies[sender];
                    else state.lastReplies[sender] = previous;
                    persist();
                    return false;
                }
                return true;
            } catch (error) {
                if (previous === undefined) delete state.lastReplies[sender];
                else state.lastReplies[sender] = previous;
                try {
                    persist();
                } catch (persistError) {
                    throw new AggregateError([error, persistError], 'Auto Reply failed and its cooldown could not be restored');
                }
                throw error;
            } finally {
                pending.delete(sender);
            }
        }
    };
}

module.exports = {
    COOLDOWN_MS,
    DEFAULT_REPLY,
    GREETING_REPLY,
    createAutoReply,
    isCommandMessage,
    isGreeting,
    responseFor
};
