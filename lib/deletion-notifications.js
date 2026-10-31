'use strict';

const { containsViewOnceWrapper } = require('./message-utils');

const PRIVATE_JID_SUFFIXES = ['@s.whatsapp.net', '@lid'];
const MESSAGE_CACHE_LIMIT = 500;
const MESSAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isPrivateContactJid(jid) {
    return typeof jid === 'string'
        && PRIVATE_JID_SUFFIXES.some(suffix => jid.endsWith(suffix));
}

function containsDisappearingWrapper(content) {
    let current = content;
    for (let i = 0; i < 16 && current; i++) {
        if (current.ephemeralMessage
            || current.messageContextInfo?.expiration
            || current.messageContextInfo?.ephemeralSettingTimestamp) return true;

        const next = current.deviceSentMessage?.message
            || current.documentWithCaptionMessage?.message
            || current.editedMessage?.message?.protocolMessage?.editedMessage;
        if (!next || next === current) break;
        current = next;
    }
    return false;
}

function phoneDigits(value) {
    if (typeof value !== 'string') return '';
    const user = value.split('@')[0].split(':')[0];
    return user.replace(/\D/g, '');
}

function isOwnerMessage(key, ownerJid, resolveLidPhone) {
    if (key.fromMe) return true;

    const ownerDigits = phoneDigits(ownerJid);
    if (!ownerDigits) return false;

    const candidates = [key.participant, key.participantPn, key.senderPn, key.remoteJid];
    return candidates.some(candidate => {
        if (typeof candidate !== 'string') return false;
        if (candidate.endsWith('@lid')) {
            return phoneDigits(resolveLidPhone?.(candidate) || '') === ownerDigits;
        }
        return phoneDigits(candidate) === ownerDigits;
    });
}

function createPrivateMessageCache(options = {}) {
    const now = options.now || Date.now;
    const getOwnerJid = options.getOwnerJid || (() => '');
    const resolveLidPhone = options.resolveLidPhone;
    const messages = new Map();

    function pruneExpired() {
        const expiresBefore = now() - MESSAGE_CACHE_TTL_MS;
        for (const [cacheKey, entry] of messages) {
            if (entry.cachedAt <= expiresBefore) messages.delete(cacheKey);
        }
    }

    function cacheKey(jid, id) {
        return `${jid}:${id}`;
    }

    function remember(message) {
        const key = message?.key;
        const content = message?.message;
        pruneExpired();
        if (!key?.id || !isPrivateContactJid(key.remoteJid) || !content
            || containsViewOnceWrapper(content) || containsDisappearingWrapper(content)
            || isOwnerMessage(key, getOwnerJid(), resolveLidPhone)) return;

        const id = cacheKey(key.remoteJid, key.id);
        messages.delete(id);
        messages.set(id, { message, cachedAt: now() });
        while (messages.size > MESSAGE_CACHE_LIMIT) {
            messages.delete(messages.keys().next().value);
        }
    }

    return {
        bind(ev) {
            ev.on('messages.upsert', ({ messages: incoming }) => {
                if (!Array.isArray(incoming)) return;
                for (const message of incoming) remember(message);
            });
        },
        loadMessage(jid, id) {
            pruneExpired();
            return messages.get(cacheKey(jid, id))?.message || null;
        },
        deleteMessage(jid, id) {
            messages.delete(cacheKey(jid, id));
        },
        get size() {
            pruneExpired();
            return messages.size;
        },
    };
}

function getDeletedKeys(item) {
    if (Array.isArray(item)) return item.map(entry => entry?.key).filter(Boolean);
    if (Array.isArray(item?.keys)) return item.keys;
    return item?.key ? [item.key] : [];
}

function isRevokeUpdate(update) {
    return update?.message === null || update?.message?.protocolMessage?.type === 0;
}

function installPrivateDeletionNotifications(sock, getOwnerJid, options = {}) {
    const now = options.now || Date.now;
    const loadMessage = options.loadMessage || (() => null);
    const deleteMessage = options.deleteMessage || (() => {});
    const isOwnerSender = options.isOwnerSender || (key => key.fromMe);
    const logError = options.logError || (error => console.error(error));
    const handled = new Map();

    async function handleDeletion(key) {
        if (!key?.remoteJid || !key.id || !isPrivateContactJid(key.remoteJid)
            || isOwnerSender(key)) return;

        const dedupeKey = `${key.remoteJid}:${key.id}`;
        const timestamp = now();
        for (const [id, handledAt] of handled) {
            if (timestamp - handledAt > MESSAGE_CACHE_TTL_MS) handled.delete(id);
        }
        if (handled.has(dedupeKey)) return;
        handled.set(dedupeKey, timestamp);
        while (handled.size > 2000) handled.delete(handled.keys().next().value);

        const ownerJid = getOwnerJid();
        if (!isPrivateContactJid(ownerJid) || !phoneDigits(ownerJid)) {
            logError(new Error('Cannot send deletion alert: owner number is not configured'));
            return;
        }

        const original = loadMessage(key.remoteJid, key.id);
        const senderJid = key.participant || key.remoteJid;
        const sender = original?.pushName
            ? `${original.pushName} (${senderJid})`
            : senderJid.endsWith('@s.whatsapp.net')
                ? `+${phoneDigits(senderJid)}`
                : senderJid;
        const deletedAt = new Date(timestamp).toISOString();

        try {
            await sock.sendMessage(ownerJid, {
                text: `🗑️ *Deleted Message*\nSender: ${sender}\nDeleted at (UTC): ${deletedAt}`,
            });
        } catch (error) {
            logError(error);
            return;
        }

        if (!original) return;

        try {
            await sock.sendMessage(ownerJid, { forward: original, force: true });
        } catch (error) {
            logError(error);
        } finally {
            deleteMessage(key.remoteJid, key.id);
        }
    }

    sock.ev.on('messages.update', async updates => {
        for (const { key, update } of updates || []) {
            if (isRevokeUpdate(update)) await handleDeletion(key);
        }
    });

    sock.ev.on('messages.delete', async item => {
        for (const key of getDeletedKeys(item)) await handleDeletion(key);
    });
}

module.exports = {
    createPrivateMessageCache,
    installPrivateDeletionNotifications,
    isOwnerMessage,
    isPrivateContactJid,
};
