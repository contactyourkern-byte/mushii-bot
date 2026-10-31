'use strict';

/**
 * lib/statusManager.js
 * Status@broadcast handler for gifted-baileys (npm:gifted-baileys@^2.5.8)
 *
 * Root-cause fix (confirmed from Heroku logs):
 *   statusJidList must contain @s.whatsapp.net (phone) JIDs, NOT @lid JIDs.
 *   gifted-baileys exposes m.key.participantPn for exactly this purpose.
 *   Previous code used m.key.participant (@lid) → WhatsApp silently rejected it.
 */

const config = require('../config');

// ─── Per-process dedup set ─────────────────────────────────────────────────────
// Prevents triple-processing when Bad MAC errors cause the same status to be
// retransmitted 2-3 times within the same session (seen in Heroku logs).
const _seenIds = new Set();

// ─── Message-type unwrapper ────────────────────────────────────────────────────
function unwrapStatus(m) {
    let inner = { ...(m.message || {}) };
    if (inner.ephemeralMessage)  inner = { ...(inner.ephemeralMessage.message  || inner) };

    const ORDER = [
        'imageMessage', 'videoMessage', 'audioMessage',
        'extendedTextMessage', 'conversation', 'stickerMessage',
        'documentMessage', 'reactionMessage',
    ];
    const msgType = ORDER.find(k => inner[k]) || Object.keys(inner)[0] || 'unknown';
    return { inner, msgType };
}

// ─── Resolve the phone JID from a status key ──────────────────────────────────
// gifted-baileys puts the @s.whatsapp.net JID in key.participantPn when the
// sender is a LID-migrated account. Always prefer that over key.participant.
function normalizePhoneJid(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (raw.endsWith('@lid') || raw.endsWith('@g.us') || raw.endsWith('@newsletter')) return null;
    const local = raw.split('@')[0];
    const digits = local.replace(/\D/g, '');
    return digits.length >= 7 ? digits + '@s.whatsapp.net' : null;
}

function resolvePhoneJid(key = {}) {
    // Prefer phone-number JIDs supplied directly by newer WhatsApp message keys.
    for (const candidate of [key.participantPn, key.senderPn, key.participant]) {
        const phone = normalizePhoneJid(candidate);
        if (phone) return phone;
    }

    // LID-to-phone mappings may be stored as either full JIDs or bare phone digits.
    const lid = key.participant || key.senderLid || '';
    if (!lid) return null;
    const normalized = String(lid).split(':')[0].split('@')[0];
    const lidKeys = [...new Set([String(lid), normalized, normalized + '@lid'])];

    for (const candidate of lidKeys) {
        const mapped = global.lidJidMap?.get(candidate)
            || global.lidPhoneCache?.get(candidate);
        const phone = normalizePhoneJid(mapped);
        if (phone) return phone;
    }
    return null;
}

function getEffectiveStatusFlags() {
    const flags = global.autoStatusFlags || {};
    return {
        seen: flags.seen !== null && flags.seen !== undefined
            ? Boolean(flags.seen) : Boolean(config.AUTO_STATUS_SEEN),
        react: flags.react !== null && flags.react !== undefined
            ? Boolean(flags.react) : Boolean(config.AUTO_STATUS_REACT),
    };
}

// ─── Main handler ──────────────────────────────────────────────────────────────
async function handleStatusBroadcast(sock, m, saveMedia) {
    try {
        const statusId    = m.key.id;
        const participant = m.key.participant || m.key.participantPn || m.key.senderPn;   // may be @lid or phone JID

        // Skip own status echoes (participant is absent when it is our own post)
        if (!statusId || !participant) return;

        // ── Dedup: skip if we already handled this status ID this session ───
        if (_seenIds.has(statusId)) {
            console.log(`[StatusMgr] ⏭️  Duplicate status skipped: ${statusId}`);
            return;
        }
        _seenIds.add(statusId);
        // Prevent unbounded growth — keep only the last 500 IDs
        if (_seenIds.size > 500) {
            const oldest = _seenIds.values().next().value;
            _seenIds.delete(oldest);
        }

        const { inner, msgType } = unwrapStatus(m);

        // THE fix: use the phone JID (participantPn) not the LID for all delivery
        const phoneJid = resolvePhoneJid(m.key);
        const botRaw   = sock.user?.id || global.botJid || '';
        const botPhone = normalizePhoneJid(botRaw) || normalizePhoneJid(global.botNum);
        const statusFlags = getEffectiveStatusFlags();

        console.log('[StatusMgr] >>> id=' + statusId + ' participant=' + participant + ' phoneJid=' + (phoneJid || 'unresolved') + ' type=' + msgType);
        console.log('[StatusMgr] settings view=' + statusFlags.seen + ' react=' + statusFlags.react + ' reply=' + config.AUTO_STATUS_REPLY);

        // ── 1. Auto View ───────────────────────────────────────────────────────
        if (statusFlags.seen) {
            let viewDone = false;

            // sendReceipt is the correct gifted-baileys API for status read receipts
            try {
                await sock.sendReceipt('status@broadcast', participant, [statusId], 'read');
                console.log('[StatusMgr] ✅ VIEW OK via sendReceipt');
                viewDone = true;
            } catch (e1) {
                console.warn(`[StatusMgr] sendReceipt failed: ${e1.message}`);
            }

            // Fallback to readMessages if sendReceipt is not available
            if (!viewDone) {
                try {
                    await sock.readMessages([{
                        remoteJid:   'status@broadcast',
                        id:          statusId,
                        participant: participant,
                        fromMe:      false,
                    }]);
                    console.log('[StatusMgr] ✅ VIEW OK via readMessages');
                    viewDone = true;
                } catch (e2) {
                    console.warn(`[StatusMgr] readMessages failed: ${e2.message}`);
                }
            }

            if (!viewDone) console.error('[StatusMgr] ❌ VIEW FAILED — all methods exhausted');
        }

        // ── 2. Auto React ──────────────────────────────────────────────────────
        if (statusFlags.react) {
            const emojis = (config.CUSTOM_REACT_EMOJIS || '❤️,🔥,💯,😍,👏')
                .split(',').map(value => value.trim()).filter(Boolean);
            const randomEmoji = emojis.length
                ? emojis[Math.floor(Math.random() * emojis.length)]
                : '❤️';

            // Status reactions require phone-number JIDs in the recipient list.
            // Never pass an unresolved @lid value to statusJidList.
            const statusJidList = [...new Set([phoneJid, botPhone].filter(Boolean))];
            if (!phoneJid || !botPhone) {
                console.warn('[StatusMgr] REACT SKIPPED: phone JID unresolved (sender=' + Boolean(phoneJid) + ', bot=' + Boolean(botPhone) + '). Check contacts/LID mapping.');
            } else {
                console.log('[StatusMgr] REACT emoji=' + randomEmoji + ' statusJidList=' + JSON.stringify(statusJidList));

                try {
                    await sock.sendMessage(
                        'status@broadcast',
                        {
                            react: {
                                text: randomEmoji,
                                key: m.key, // gifted-baileys requires the original status key
                            },
                        },
                        { statusJidList }
                    );
                    console.log('[StatusMgr] REACT sendMessage resolved');
                } catch (e) {
                    console.error('[StatusMgr] REACT FAILED: ' + e.message);
                }
            }
        }

        // ── 3. Auto Reply ──────────────────────────────────────────────────────
        if (config.AUTO_STATUS_REPLY && !m.key.fromMe) {
            // Send reply to the phone JID, not the LID
            const replyTo = phoneJid || participant;
            try {
                await sock.sendMessage(
                    replyTo,
                    {
                        text: config.AUTO_STATUS_MSG || 'Seen by MUSHII 💖',
                        contextInfo: {
                            stanzaId:      statusId,
                            participant:   replyTo,
                            quotedMessage: inner,
                        },
                    }
                );
                console.log('[StatusMgr] ✅ REPLY sent OK');
            } catch (e) {
                console.warn(`[StatusMgr] ⚠️ REPLY failed: ${e.message}`);
            }
        }

        // ── 4. Status Saver ────────────────────────────────────────────────────
        if (config.Status_Saver === 'true' && typeof saveMedia === 'function') {
            try {
                const displayJid   = phoneJid || participant;
                const userName     = await sock.getName?.(displayJid) || displayJid.split('@')[0];
                const header       = 'AUTO STATUS SAVER';
                let   caption      = `${header}\n\n*🩵 Status From:* ${userName}`;

                switch (msgType) {
                    case 'imageMessage':
                    case 'videoMessage':
                        if (inner[msgType]?.caption) caption += `\n*🩵 Caption:* ${inner[msgType].caption}`;
                        await saveMedia({ message: inner }, msgType, sock, caption);
                        break;
                    case 'audioMessage':
                        caption += '\n*🩵 Audio Status*';
                        await saveMedia({ message: inner }, msgType, sock, caption);
                        break;
                    case 'extendedTextMessage':
                        caption = `${header}\n\n${inner.extendedTextMessage?.text || ''}`;
                        await sock.sendMessage(sock.user.id, { text: caption });
                        break;
                    default:
                        console.warn(`[StatusMgr] ℹ️ No saver handler for type: ${msgType}`);
                        break;
                }

                if (config.STATUS_REPLY === 'true') {
                    const replyMsg = config.STATUS_MSG || 'MUSHII 💖 viewed your status';
                    await sock.sendMessage(phoneJid || participant, { text: replyMsg });
                }

                console.log(`[StatusMgr] ✅ Status saved: ${statusId}`);
            } catch (e) {
                console.error(`[StatusMgr] ❌ Save failed: ${e.message}`);
            }
        }

    } catch (e) {
        console.error(`[StatusMgr] ❌ Handler error: ${e.message}\n${e.stack}`);
    }
}

// ─── Runtime flag setter (used by autostatus.js plugin) ───────────────────────
function getAutoStatusSettings() {
    const flags = getEffectiveStatusFlags();
    return {
        autoviewStatus:   String(flags.seen),
        autoLikeStatus:   String(flags.react),
        autoReplyStatus:  resolve(null,        config.AUTO_STATUS_REPLY),
        statusReplyText:  config.AUTO_STATUS_MSG      || 'Seen by MUSHII 💖',
        statusLikeEmojis: config.CUSTOM_REACT_EMOJIS  || '❤️,🔥,💯,😍,👏',
        statusSaver:      String(config.Status_Saver  || 'false'),
        statusSaverReply: String(config.STATUS_REPLY  || 'false'),
        statusSaverMsg:   config.STATUS_MSG           || 'MUSHII 💖 viewed your status',
    };
}

module.exports = { handleStatusBroadcast, getAutoStatusSettings, unwrapStatus };
