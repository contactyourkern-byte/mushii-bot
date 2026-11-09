'use strict';

const UNDECRYPTABLE_LOG_THRESHOLD = 10;
const MESSAGE_STALE_AFTER_MS = 5 * 60 * 1000;
const PENDING_CIPHERTEXT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_CIPHERTEXT_LIMIT = 2000;

function trackUndecryptableMessage(state = {}, logger = () => {}) {
    const count = Number(state.count || 0) + 1;

    if (count >= UNDECRYPTABLE_LOG_THRESHOLD) {
        logger(count);
        return { count: 0, thresholdReached: true };
    }

    return { count, thresholdReached: false };
}

function messageIdentity(key, resolveLidPhone) {
    if (!key?.id || !key?.remoteJid) return '';
    const jid = key.remoteJid;
    const normalized = jid.split(':')[0];

    if (jid.endsWith('@lid')) {
        let mappedPhone = '';
        try {
            mappedPhone = resolveLidPhone?.(jid)
                || resolveLidPhone?.(normalized)
                || resolveLidPhone?.(`${normalized}@lid`)
                || '';
        } catch { /* keep the native LID identity */ }
        const digits = String(mappedPhone).split('@')[0].split(':')[0].replace(/\D/g, '');
        return digits ? `phone:${digits}:${key.id}` : `lid:${normalized}:${key.id}`;
    }

    if (jid.endsWith('@s.whatsapp.net')) {
        const digits = normalized.split('@')[0].replace(/\D/g, '');
        return digits ? `phone:${digits}:${key.id}` : `${normalized}:${key.id}`;
    }

    return `${normalized}:${key.id}`;
}

function createPendingCiphertextTracker(options = {}) {
    const now = options.now || Date.now;
    const resolveLidPhone = options.resolveLidPhone;
    const ttlMs = options.ttlMs ?? PENDING_CIPHERTEXT_TTL_MS;
    const limit = options.limit ?? PENDING_CIPHERTEXT_LIMIT;
    const pending = new Map();

    function prune() {
        const cutoff = now() - ttlMs;
        for (const [identity, receivedAt] of pending) {
            if (receivedAt <= cutoff) pending.delete(identity);
        }
    }

    return {
        mark(key) {
            const identity = messageIdentity(key, resolveLidPhone);
            if (!identity) return false;
            prune();
            pending.delete(identity);
            pending.set(identity, now());
            while (pending.size > limit) pending.delete(pending.keys().next().value);
            return true;
        },
        has(key) {
            const identity = messageIdentity(key, resolveLidPhone);
            if (!identity) return false;
            prune();
            return pending.has(identity);
        },
        clear(key) {
            const identity = messageIdentity(key, resolveLidPhone);
            if (!identity) return false;
            return pending.delete(identity);
        },
        get size() {
            prune();
            return pending.size;
        },
    };
}

function shouldSkipStaleMessage(options = {}) {
    const {
        timestamp = 0,
        now = Date.now(),
        type,
        hasContent = false,
        isCiphertextStub = false,
        wasPendingCiphertext = false,
        staleAfterMs = MESSAGE_STALE_AFTER_MS,
    } = options;

    const isStale = Number(timestamp) > 0 && now - Number(timestamp) > staleAfterMs;
    if (!isStale) return false;

    // Keep history append events filtered, but never discard a ciphertext placeholder,
    // a successful retry of a previously seen placeholder, or a live notify delivery.
    return !isCiphertextStub
        && !wasPendingCiphertext
        && !(type === 'notify' && hasContent);
}

module.exports = {
    UNDECRYPTABLE_LOG_THRESHOLD,
    MESSAGE_STALE_AFTER_MS,
    PENDING_CIPHERTEXT_TTL_MS,
    trackUndecryptableMessage,
    createPendingCiphertextTracker,
    shouldSkipStaleMessage,
};
