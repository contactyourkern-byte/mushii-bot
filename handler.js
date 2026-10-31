'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getStr, getActiveTheme } = require('./lib/theme');
const { extractMessageText, unwrapMessageContent, containsViewOnceWrapper } = require('./lib/message-utils');
const { recordUser } = require('./lib/database');
const { isCommandMessage } = require('./lib/auto-reply');

let isJidGroup, areJidsSameUser, jidNormalizedUser, normalizeMessageContent;
try {
    ({ isJidGroup, areJidsSameUser, jidNormalizedUser, normalizeMessageContent } = require('@whiskeysockets/baileys'));
} catch {
    isJidGroup            = (jid) => typeof jid === 'string' && jid.endsWith('@g.us');
    jidNormalizedUser     = (jid) => (jid || '').replace(/:[^@]+@/, '@');
    areJidsSameUser       = (a, b) => jidNormalizedUser(a) === jidNormalizedUser(b);
    normalizeMessageContent = (c) => c;
}

// Extract the bare phone-number string from any JID format
function jidToNum(jid) {
    if (!jid) return '';
    return jidNormalizedUser(jid).split('@')[0].replace(/\D/g, '');
}

// True when two phone numbers refer to the same subscriber.
// Handles missing country codes by comparing the last 9 significant digits.
function sameNumber(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const minLen = Math.min(a.length, b.length);
    const tail   = Math.min(minLen, 9);
    return tail >= 6 && a.slice(-tail) === b.slice(-tail);
}

// ─── Permission constants ────────────────────────────────────────────────────
const PERM = {
    PUBLIC: 'public',
    ADMIN:  'admin',
    OWNER:  'owner'
};

// ─── Group metadata cache (5 min TTL) ───────────────────────────────────────
const groupCache = new Map();
const GROUP_CACHE_TTL = 5 * 60 * 1000;

async function getCachedGroupMetadata(sock, jid) {
    const hit = groupCache.get(jid);
    if (hit && Date.now() < hit.expiry) return hit.metadata;
    try {
        const metadata = await sock.groupMetadata(jid);
        groupCache.set(jid, { metadata, expiry: Date.now() + GROUP_CACHE_TTL });
        return metadata;
    } catch {
        return null;
    }
}

// Invalidate cache when group membership changes
function bindGroupCacheInvalidation(sock) {
    sock.ev.on('group-participants.update', ({ id }) => groupCache.delete(id));
}

const sendTimestamps = [];
const MAX_SENDS_PER_MIN = 30;

async function safeSend(sock, jid, content, opts = {}) {
    if (!jid || !sock?.sendMessage) return null;

    // Reject obviously invalid JIDs.  Valid DM suffixes: @s.whatsapp.net, @lid, @c.us
    // Valid group suffix: @g.us.  Anything else (e.g. a bare phone number) is rejected.
    const validSuffix = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')
        || jid.endsWith('@g.us') || jid.endsWith('@c.us') || jid.endsWith('@newsletter');
    if (!validSuffix) {
        console.error(`❌ SEND ABORTED — invalid JID "${jid}" (must end @s.whatsapp.net / @lid / @g.us)`);
        return null;
    }

    const isLidDm  = jid.endsWith('@lid');
    const _preview = (content?.text || content?.caption || '[media]').toString().slice(0, 60);
    const _to      = jid.split('@')[0];

    // Rate limit + jitter
    const now = Date.now();
    while (sendTimestamps.length && now - sendTimestamps[0] > 60000) sendTimestamps.shift();
    if (sendTimestamps.length >= MAX_SENDS_PER_MIN) {
        const wait = 60000 - (now - sendTimestamps[0]);
        await new Promise(r => setTimeout(r, Math.min(wait, 3000)));
    }
    const jitter = Math.floor(Math.random() * 400) + 100;
    await new Promise(r => setTimeout(r, jitter));
    sendTimestamps.push(Date.now());

    // @lid DM: establish the outbound E2E session (prekeys) before sending.
    // Without this, Baileys queues the message but WA drops it silently because
    // the bot has no registered send-session for that LID account.
    // Use m.key.remoteJid directly — never reconstruct or remap to @s.whatsapp.net here.
    if (isLidDm && typeof sock.assertSessions === 'function') {
        try { await sock.assertSessions([jid], false); } catch { /* non-fatal */ }
    }

    // Attempt 1 — primary: m.key.remoteJid as-is, full opts (quoted + contextInfo)
    try {
        const result = await sock.sendMessage(jid, content, opts);
        console.log(`✉️  OUT  to=${_to}  "${_preview}"`);
        return result;
    } catch (err) {
        console.error(`❌ SEND FAILED (attempt 1)  to=${jid}: ${err.message}`);
    }

    // Attempt 2 — strip quoted reply.
    // WhatsApp Business messages carry a messageContextInfo wrapper that Baileys
    // embeds when building the quoted context; WA Business servers reject it.
    // Also strip newsletter forwardedNewsletterMessageInfo from content contextInfo.
    if (opts.quoted) {
        const { quoted: _q, ...optsNoQuote } = opts;
        const safeContent = { ...content };
        if (safeContent.contextInfo?.forwardedNewsletterMessageInfo) {
            const { forwardedNewsletterMessageInfo: _n, ...ci } = safeContent.contextInfo;
            safeContent.contextInfo = Object.keys(ci).length ? ci : undefined;
        }
        try {
            const result = await sock.sendMessage(jid, safeContent, optsNoQuote);
            console.log(`✉️  OUT (no-quote retry)  to=${_to}  "${_preview}"`);
            return result;
        } catch (err2) {
            console.error(`❌ SEND FAILED (attempt 2 no-quote)  to=${jid}: ${err2.message}`);
        }
    }

    // Attempt 3 — plain text, zero opts
    if (content?.text || content?.caption) {
        const plainText = content.text || content.caption;
        try {
            const result = await sock.sendMessage(jid, { text: plainText });
            console.log(`✉️  OUT (plain fallback)  to=${_to}  "${_preview}"`);
            return result;
        } catch (err3) {
            console.error(`❌ SEND FAILED (attempt 3 plain)  to=${jid}: ${err3.message}`);
        }
    }

    return null;
}

// Kept as an empty context for compatibility with existing plugin calls.
const GLOBAL_CONTEXT_INFO = {};

function withNewsletterContext(jid, content) {
    return content;
}

function installNewsletterForwarding(sock) {
    return sock;
}

// ─── Plugin loader ───────────────────────────────────────────────────────────
const plugins = [];
const pluginDir = path.join(__dirname, 'plugins');

function loadPlugins() {
    if (!fs.existsSync(pluginDir)) return;
    const files = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js'));

    for (const file of files) {
        const pluginPath = path.join(pluginDir, file);
        try {
            delete require.cache[require.resolve(pluginPath)];
            const plugin = require(pluginPath);

            // Support array exports (e.g. module.exports = [plugin1, plugin2, ...])
            const mods = Array.isArray(plugin) ? plugin : [plugin];

            for (const mod of mods) {
                if (!mod) continue;
                if (!mod.commands && mod.name) mod.commands = [mod.name];
                if (!mod.run && typeof mod.handler === 'function') mod.run = mod.handler;

                if (Array.isArray(mod.commands) && mod.commands.length && typeof mod.run === 'function') {
                    plugins.push(mod);
                } else {
                    if (mods.length === 1) console.warn(`[Plugin] Skipped: ${file} — missing commands or run/handler`);
                }
            }
        } catch (err) {
            console.error(`[Plugin] Error loading ${file}: ${err.message}`);
        }
    }
    console.log(`[Plugin] ✅ ${plugins.length} plugins loaded successfully`);
}

loadPlugins();

// ─── Connection handlers ─────────────────────────────────────────────────────
function setupConnectionHandlers(sock) {
    installNewsletterForwarding(sock);
    bindGroupCacheInvalidation(sock);
    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') console.log('[Handler] WhatsApp connection open.');
    });
    sock.ev.on('group-participants.update', async (update) => {
        for (const p of plugins) {
            if (typeof p.onGroupParticipantsUpdate !== 'function') continue;
            try { await p.onGroupParticipantsUpdate(sock, update); } catch { /* ignore */ }
        }
    });
    sock.ev.on('group.join-request', async (update) => {
        for (const p of plugins) {
            if (typeof p.onJoinRequest !== 'function') continue;
            try { await p.onJoinRequest(sock, update); } catch { /* ignore */ }
        }
    });
}

// ─── Command predictor ───────────────────────────────────────────────────────
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
    );
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[m][n];
}

function predictCommand(typed, allPlugins) {
    const flat = [];
    for (const plugin of allPlugins)
        for (const cmd of (plugin.commands || []))
            flat.push({ cmd, plugin });

    // 1. Unambiguous prefix match (typed ≥ 3 chars, matches exactly one command)
    if (typed.length >= 3) {
        const hits = flat.filter(({ cmd }) => cmd.startsWith(typed));
        if (hits.length === 1)
            return { plugin: hits[0].plugin, match: hits[0].cmd, confidence: 'prefix' };
        if (hits.length > 1)
            return { matches: [...new Set(hits.map(h => h.cmd))], confidence: 'ambiguous' };
    }

    // 2. Fuzzy match via Levenshtein distance
    //    threshold = 1 for short commands (≤4 chars), 2 for longer ones
    let best = null, bestDist = Infinity;
    for (const { cmd, plugin } of flat) {
        const dist = levenshtein(typed, cmd);
        const threshold = typed.length <= 4 ? 1 : 2;
        if (dist <= threshold && dist < bestDist) {
            best = { plugin, match: cmd, confidence: dist === 1 ? 'typo' : 'fuzzy' };
            bestDist = dist;
        }
    }
    return best;
}

// ─── Main message handler ────────────────────────────────────────────────────
function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

async function handleMessages(sock, message) {
    try {
        // normalizeMessageContent unwraps WhatsApp Business / multi-device wrappers:
        // ephemeralMessage, viewOnceMessage, documentWithCaptionMessage, editedMessage, etc.
        // Without this, Business accounts often have msg.conversation === undefined even
        // though the text is buried one level deeper inside a wrapper field.
        const rawMsg = message.message;
        if (!rawMsg) return;
        if (containsViewOnceWrapper(rawMsg)) return;

        const _normalized = (typeof normalizeMessageContent === 'function'
            ? normalizeMessageContent(rawMsg)
            : rawMsg) || rawMsg;
        const msg = unwrapMessageContent(_normalized) || _normalized;


        // jid  = the chat to respond to — always m.key.remoteJid, NEVER reconstructed.
        // Valid suffixes: @s.whatsapp.net (regular WA), @lid (Business / privacy DM),
        // @g.us (group).  Do NOT remap @lid to @s.whatsapp.net here — safeSend handles
        // session establishment and phone-JID fallback automatically.
        const jid    = message.key.remoteJid;
        // from = the individual who typed the command.
        // For fromMe private messages participant is undefined and jid is the
        // recipient — not the sender.  Correct this so ctx.from always refers
        // to the actual sender (bot's own JID when fromMe, participant when in
        // a group, or the remote JID for incoming private messages).
        const _botOwnJid = global.botJid || '';
        const from = message.key.participant
            || (message.key.fromMe && !isJidGroup(jid) ? (_botOwnJid || jid) : jid);
        // sender = chat JID for responses (matches legacy plugin expectation of m.key.remoteJid)
        const sender = jid;
        if (!jid || !from) return;

        // ── Auto-presence: fire instantly on every incoming message ──────────
        if (!message.key.fromMe && (config.AUTO_TYPING || config.AUTO_RECORDING)) {
            const presenceType = config.AUTO_RECORDING ? 'recording' : 'composing';
            try { await sock.sendPresenceUpdate(presenceType, jid); } catch { /* non-fatal */ }
        }

        // isGroup: @g.us = group, @s.whatsapp.net / @lid / @c.us = DM
        const isGroup = isJidGroup(jid);

        // ── Multi-prefix parser ──────────────────────────────────────────────
        // PREFIX env var supports:
        //   '.'          → only dot prefix
        //   '.,!,/,?'    → comma-separated list — any of them works
        //   'any'        → any single leading non-alphanumeric/non-space char
        //   '' / 'none'  → no prefix needed (bare command words are matched)
        const rawPrefix   = (config.PREFIX || '.').trim();
        const noPrefixMode  = !rawPrefix || rawPrefix.toLowerCase() === 'none' || rawPrefix.toLowerCase() === 'false';
        const anyPrefixMode = rawPrefix.toLowerCase() === 'any';
        const prefixList    = (!noPrefixMode && !anyPrefixMode)
            ? rawPrefix.split(',').map(p => p.trim()).filter(Boolean)
            : [];
        // primary prefix used in help text / plugin output
        const prefix = prefixList[0] || (anyPrefixMode ? '.' : '');

        // ── Extract text ─────────────────────────────────────────────────────
        // Walk through all known message types — WhatsApp Business and newer
        // WA versions wrap content differently. Order: most specific → most generic.
        let text = extractMessageText(rawMsg, normalizeMessageContent);
        // Interactive menu replies carry stable IDs instead of typed commands.
        // Translate MUSHII menu actions, then reuse the normal dispatcher.
            if (/^mushii:menu$/i.test(text)) text = 'menu';

        // Database persistence is deliberately fire-and-forget. A database
        // outage must never delay or block normal WhatsApp message handling.
        recordUser({
            jid: from,
            displayName: message.pushName || '',
            isGroup,
            metadata: { chatJid: jid, hasText: Boolean(text), fromMe: Boolean(message.key.fromMe) }
        }).catch(() => {});

        const awayPlugin = plugins.find(p => p.commands?.includes('away')
            && typeof p.isAwayEnabled === 'function'
            && typeof p.handleAutoReply === 'function');
        const autoReplyEnabled = awayPlugin?.isAwayEnabled() || false;
        const configuredOwnerNumberForHandoff = ((process.env.OWNER_NUMBER || '').trim()
            || (typeof config.OWNER_NUMBER === 'string' ? config.OWNER_NUMBER.trim() : '')).replace(/\D/g, '');
        const ownerNumberForAway = configuredOwnerNumberForHandoff
            || String(global.botNum || '').replace(/\D/g, '');
        const bareSenderLid = from.endsWith('@lid') ? from.split(':')[0].split('@')[0] : '';
        const lidPhoneForAway = bareSenderLid ? (
            global.lidPhoneCache?.get(bareSenderLid)
            || global.lidPhoneCache?.get(`${bareSenderLid}@lid`)
            || global.lidPhoneCache?.get(from)
            || ''
        ) : '';
        const senderNumberForAway = jidToNum(lidPhoneForAway || from);
        const botNumberForAway = String(global.botNum || '').replace(/\D/g, '');
        const botLidForAway = jidNormalizedUser(global.botLid || '');
        const senderNormForAway = jidNormalizedUser(from);
        const sudoUsersForAway = global.sudoUsers
            && typeof global.sudoUsers[Symbol.iterator] === 'function'
            ? [...global.sudoUsers]
            : [];
        const sudoForAway = global.sudoUsers?.has(from)
            || global.sudoUsers?.has(senderNormForAway)
            || (senderNumberForAway && sudoUsersForAway.some(user =>
                sameNumber(String(user).replace(/@.*/, '').replace(/\D/g, ''), senderNumberForAway)));
        const ownerForAway = message.key.fromMe
            || (botLidForAway && senderNormForAway === botLidForAway)
            || (senderNumberForAway && ownerNumberForAway
                && sameNumber(senderNumberForAway, ownerNumberForAway))
            || (senderNumberForAway && botNumberForAway
                && sameNumber(senderNumberForAway, botNumberForAway))
            || sudoForAway;
        const privateJidForAway = typeof jid === 'string'
            && ['@s.whatsapp.net', '@lid', '@c.us'].some(suffix => jid.endsWith(suffix));
        const eligibleConversationMessage = autoReplyEnabled && awayPlugin
            && Boolean(String(text || '').trim())
            && privateJidForAway && !isGroup
            && !isCommandMessage(text, config.PREFIX, plugins)
            && !msg.protocolMessage && !rawMsg.protocolMessage;

        // Keep a short, in-memory transcript per private contact while AI Auto Reply
        // is enabled. This records incoming and owner's manual outgoing messages.
        if (eligibleConversationMessage) {
            try { awayPlugin.recordConversationMessage(message, text); }
            catch (error) { console.warn('[Auto Reply] Conversation memory skipped:', error.message); }
        }

        if (eligibleConversationMessage && !ownerForAway && !message.key.fromMe) {
            try {
                await awayPlugin.handleAutoReply(sock, message, text, {
                    jid,
                    from,
                    isGroup,
                    isOwner: false,
                    isProtocolMessage: false,
                    safeSend: (content, opts) => safeSend(sock, jid, content, opts),
                    notifyOwner: async ({ reason }) => {
                        if (!configuredOwnerNumberForHandoff) throw new Error('OWNER_NUMBER is not configured');
                        const ownerJid = configuredOwnerNumberForHandoff + '@s.whatsapp.net';
                        const notice = [
                            '🧑‍💼 *MUSHII AI — HUMAN HANDOFF*',
                            '',
                            'Contact: ' + (message.pushName || from),
                            'Message: ' + String(text || '').slice(0, 900),
                            reason ? 'Reason: ' + reason : '',
                            '',
                            'Please open this contact and reply manually.'
                        ].filter(Boolean).join('\n');
                        const sent = await safeSend(sock, ownerJid, { text: notice });
                        if (sent === null) throw new Error('Could not deliver the owner handoff notice');
                        return sent;
                    }
                });
            } catch (error) {
                console.error('[Auto Reply] Automatic reply failed:', error.message);
            }
        }

        // ── AFK auto-reply (fires before prefix check, not for owner's own messages) ──
        if (!message.key.fromMe && !isGroup) {
            const afkPlugin = plugins.find(p => p.commands?.includes('afk') && typeof p.isAfk === 'function');
            if (afkPlugin?.isAfk() && !autoReplyEnabled) {
                const { reason, since } = afkPlugin.getAfkData();
                const th = getActiveTheme()?.global || {};
                await safeSend(sock, jid, {
                    text: [
                        `🤖 *${th.botName || 'MUSHII'}*`,
                        ``,
                        `${th.greet2 ? `_${th.greet2}!_` : `_Hey!_`} My owner is currently *AFK*.`,
                        `📝 *Reason:* ${reason}`,
                        `⏱ *Away for:* ${formatDuration(Date.now() - since)}`,
                        ``,
                        `_${th.footer || th.botName || 'MUSHII'}_`
                    ].join('\n'),
                }, { quoted: message });
                return;
            }
        }

        // ── Anti-link (group only, bot must be admin) ────────────────────────
        if (isGroup && !message.key.fromMe) {
            const antilinkOn = config.ANTILINK || global.antilinkGroups?.has(jid);
            if (antilinkOn) {
                const URL_REGEX = /(?:https?:\/\/|www\.)\S+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|gg|me|ly|co|app|xyz|info|tv|link|shop|live|club|online|site|store|pro|in|ng|ke|tz|ug|za|uk)\b(?:\/\S*)?/gi;
                if (URL_REGEX.test(text)) {
                    try {
                        await sock.sendMessage(jid, { delete: message.key });
                    } catch (e) {
                        console.error('[Antilink] delete failed:', e.message);
                    }
                    return;
                }
            }
        }

        // ── onMessage hooks — fired for ALL messages (not just commands) ────────
        // Tracking and auto-reply only for other people's messages (not the bot's own).
        if (!message.key.fromMe) {
            if (typeof global.trackMessage === 'function') try { global.trackMessage(jid, from); } catch {}
            if (typeof global.addXP === 'function') {
                try { global.addXP(jid, from); } catch {}
            }
            if (!isGroup && typeof global.checkAutoReply === 'function') {
                try {
                    const autoReply = global.checkAutoReply(from);
                    if (autoReply) {
                        await safeSend(sock, jid, { text: `💤 *Auto-Reply:*\n\n${autoReply}` }, { quoted: message });
                    }
                } catch {}
            }
        }
        // Plugin hooks retain group protections; passive replies are guarded by their owning plugins.
        for (const p of plugins) {
            if (typeof p.onMessage !== 'function') continue;
            try {
                await p.onMessage(sock, message, text, {
                    jid, sender, from, isGroup,
                    isOwner,
                    availableCommands: new Set(plugins.flatMap(plugin => plugin.commands || [])),
                    contextInfo: isGroup ? {} : GLOBAL_CONTEXT_INFO
                });
            } catch { /* ignore plugin onMessage errors */ }
        }


        // ── Detect which prefix was used (or if no prefix needed) ──────────────
        let usedPrefix = null;       // the actual prefix string found in the message
        let commandText = '';        // text with prefix stripped

        if (noPrefixMode) {
            // Any message could be a command — match bare words
            usedPrefix  = '';
            commandText = text.trim();
        } else if (anyPrefixMode) {
            // Any single leading character that isn't alphanumeric / space = prefix
            const first = text[0];
            if (first && !/^[a-zA-Z0-9\u00C0-\u024F\s]/.test(first)) {
                usedPrefix  = first;
                commandText = text.slice(1).trim();
            }
        } else {
            // Exact prefix list — check each in order, longest match wins
            const sorted = [...prefixList].sort((a, b) => b.length - a.length);
            for (const p of sorted) {
                if (text.startsWith(p)) {
                    usedPrefix  = p;
                    commandText = text.slice(p.length).trim();
                    break;
                }
            }
        }

        if (usedPrefix === null) {
            // Allow natural "MUSHII, ...", "Hey MUSHII ...", or "agent ..." activation without a prefix.
                const directAgent = text.trim().match(/^(?:hey\s+)?(mushii|agent)(?:\s*[,!:.\-]\s*|\s+|$)(.*)$/i);
            if (directAgent) {
                usedPrefix  = '';
                commandText = `${directAgent[1]} ${directAgent[2] || ''}`.trim();
            } else {
                // No prefix matched — fire typing indicator then stop
                if (!message.key.fromMe && (config.AUTO_TYPING || config.AUTO_RECORDING)) {
                    const presenceType = config.AUTO_RECORDING ? 'recording' : 'composing';
                    try { await sock.sendPresenceUpdate(presenceType, jid); } catch { /* ok */ }
                    setTimeout(async () => {
                        try { await sock.sendPresenceUpdate('paused', jid); } catch { /* ok */ }
                    }, 2000);
                }
                return;
            }
        }

        const parts   = commandText.split(/\s+/);
        const command = (parts.shift() || '').toLowerCase();
        const args    = parts;
        if (!command) return;

        // Support both `.help <command>` and `.command help` forms. The latter
        // is especially useful for commands discovered from older bot menus.
        const commandHelpTarget = /^(?:help|\?)$/i.test(args[0] || '') ? command : '';
        if (commandHelpTarget) {
            args.splice(0, 1, commandHelpTarget);
        }

        // ── Command predictor: resolve typos / short-forms ───────────────────
        let resolvedCommand = commandHelpTarget ? 'help' : command;
        let predictionNote  = null;
        const exactExists   = plugins.some(p => p.commands?.includes(command));
        if (!commandHelpTarget && !exactExists) {
            const prediction = predictCommand(command, plugins);
            if (prediction?.confidence === 'ambiguous') {
                const th = getActiveTheme()?.global || {};
                await safeSend(sock, jid, {
                    text: [
                        `❓ *Did you mean one of these?*`,
                        prediction.matches.map(c => `• \`${prefix}${c}\``).join('\n'),
                        ``,
                        th.footer ? `_${th.footer}_` : ''
                    ].filter(Boolean).join('\n')
                }, { quoted: message });
                if (config.AUTO_TYPING || config.AUTO_RECORDING)
                    try { await sock.sendPresenceUpdate('paused', jid); } catch { /* ok */ }
                return;
            } else if (prediction) {
                resolvedCommand = prediction.match;
                if (prediction.confidence !== 'exact') {
                    const th = getActiveTheme()?.global || {};
                    predictionNote = `_💡 Running_ \`${prefix}${resolvedCommand}\`${th.footer ? `\n_${th.footer}_` : ''}`;
                }
            }
        }

        // ── Fetch group metadata FIRST — needed for LID resolution ────────────
        // Modern WhatsApp sends group messages with a @lid (privacy/account ID)
        // instead of a phone number. We must look up the LID in the participants
        // list to find the sender's real phone JID before doing any comparisons.
        let isAdmin       = false;
        let isBotAdmin    = false;
        let groupMetadata = null;

        if (isGroup) {
            groupMetadata = await getCachedGroupMetadata(sock, jid);
        }

        // ── Resolve sender phone (handle @lid format) ─────────────────────────
        const isLid = typeof from === 'string' && from.endsWith('@lid');
        let resolvedFrom = from; // will be the real phone JID if LID is resolved

        if (isLid) {
            // 1. Try group participants list (most accurate)
            if (groupMetadata?.participants) {
                for (const p of groupMetadata.participants) {
                    const pLid = p.lid || '';
                    if (pLid && (pLid === from || jidNormalizedUser(pLid) === jidNormalizedUser(from))) {
                        resolvedFrom = p.id; // swap LID for real phone JID
                        break;
                    }
                }
            }

            // 2. Fall back to the global LID→phone cache populated by silva.js
            //    (every received message caches participant LID + phone via cacheLidPhone)
            if (resolvedFrom === from && global.lidPhoneCache?.size) {
                const normLid = from.split(':')[0].split('@')[0];
                const cachedPhone = global.lidPhoneCache.get(normLid)
                    || global.lidPhoneCache.get(normLid + '@lid')
                    || global.lidPhoneCache.get(from);
                if (cachedPhone) {
                    resolvedFrom = cachedPhone.includes('@')
                        ? cachedPhone
                        : `${cachedPhone.replace(/\D/g, '')}@s.whatsapp.net`;
                }
            }
        }

        const fromNum = jidToNum(resolvedFrom);

        // ── Resolve owner / bot phone numbers ─────────────────────────────────
        // Pull directly from process.env first so stale config objects can't
        // cause a false empty result, then fall through to config and global.
        const ownerRaw  = (process.env.OWNER_NUMBER || '').trim()
            || (typeof config.OWNER_NUMBER === 'string' ? config.OWNER_NUMBER.trim() : '')
            || (global.botNum || '');
        const ownerNum  = ownerRaw.replace(/\D/g, '');
        const botNum    = (global.botNum || '').replace(/\D/g, '');

        // In full-LID groups WhatsApp never exposes phone numbers — the only
        // identifier is the account LID.  If the sender's LID matches the bot's
        // own LID they are the same WhatsApp account → owner.
        // Both sides must be normalised (strip :deviceSuffix) before comparing.
        const botLid     = jidNormalizedUser(global.botLid || '');
        const fromNorm   = jidNormalizedUser(from);

        const isSudo = global.sudoUsers?.size
            ? (global.sudoUsers.has(from) || global.sudoUsers.has(fromNorm) || global.sudoUsers.has(resolvedFrom)
               || (fromNum && [...global.sudoUsers].some(s => sameNumber(s.replace(/@.*/, ''), fromNum))))
            : false;

        const isOwner = message.key.fromMe
            || (botLid && fromNorm === botLid)
            || (botLid && jidNormalizedUser(resolvedFrom) === botLid)
            || (fromNum && ownerNum && (fromNum === ownerNum || sameNumber(fromNum, ownerNum)))
            || (fromNum && botNum   && (fromNum === botNum   || sameNumber(fromNum, botNum)))
            || isSudo;

        // ── Resolve group admin status ────────────────────────────────────────
        if (isGroup && groupMetadata?.participants) {
            const botJid     = sock.user?.id || '';
            const botPhone   = botNum;

            for (const p of groupMetadata.participants) {
                const role = p.admin;
                const isAdm = role === 'admin' || role === 'superadmin';
                const pPhone = (p.id || '').split('@')[0].replace(/\D/g, '');
                const pLid   = p.lid || '';

                // Is this participant the sender?
                const isSender =
                    areJidsSameUser(p.id, resolvedFrom) ||
                    (pLid && (pLid === from || jidNormalizedUser(pLid) === jidNormalizedUser(from))) ||
                    (pPhone && fromNum && sameNumber(pPhone, fromNum));

                // Is this participant the bot?
                const isBot =
                    areJidsSameUser(p.id, botJid) ||
                    (botLid && (jidNormalizedUser(p.id) === botLid || (pLid && jidNormalizedUser(pLid) === botLid))) ||
                    (botPhone && pPhone && sameNumber(pPhone, botPhone));

                if (isSender) isAdmin    = isAdm;
                if (isBot)    isBotAdmin = isAdm;
            }
        }

        // ── Build unified context ─────────────────────────────────────────────
        const ctx = {
            sock,
            conn:          sock,
            m:             message,
            message,
            sender,               // = jid (the chat) — where plugins send responses
            from,                 // = individual who typed the command
            jid,
            chat:          jid,
            isGroup,
            isAdmin,
            isBotAdmin,
            isOwner,
            isSudo,
            args,
            text,
            prefix,               // primary/canonical prefix for help text
            usedPrefix,           // the actual prefix that triggered this command
            groupMetadata,
            contextInfo:   isGroup ? {} : GLOBAL_CONTEXT_INFO,
            mentionedJid:  msg.extendedTextMessage?.contextInfo?.mentionedJid || [],
            safeSend:      (content, opts) => safeSend(sock, jid, content, opts),
            reply:         (replyText) => safeSend(sock, jid, { text: replyText }, { quoted: message }),
            theme:         getActiveTheme()?.global || {},
            getStr,
            command:       resolvedCommand,
        };

        // ── Ban gate — banned users cannot trigger any command (owner always exempt) ──
        if (!isOwner && global.bannedUsers?.size) {
            const senderNorm = jidNormalizedUser(from);
            if (global.bannedUsers.has(from) || global.bannedUsers.has(senderNorm) || global.bannedUsers.has(resolvedFrom)) {
                const th = getActiveTheme()?.global || {};
                return await safeSend(sock, jid, {
                    text: [
                        `⛔ *${th.botName || 'MUSHII'}*`,
                        ``,
                        getStr('owner') || 'You have been banned from using bot commands.',
                        ``,
                        th.footer ? `_${th.footer}_` : ''
                    ].filter(Boolean).join('\n')
                }, { quoted: message });
            }
        }

        // ── Dispatch ──────────────────────────────────────────────────────────
        const RECORDING_CMDS = new Set(['play', 'song', 'sticker', 's', 'tiktok', 'tt', 'ttdl', 'tiktokdl', 'youtube', 'yt', 'instagram', 'igdl', 'ig', 'insta', 'facebook', 'fb', 'fbdl']);

        const fromNum2 = from.split('@')[0];
        const _chatLabel = isGroup ? `group:${jid.split('@')[0]}` : `dm:${jid.split('@')[0]}`;
        console.log(`⚡ CMD  "${usedPrefix}${resolvedCommand}"  from=+${fromNum2}  ${_chatLabel}  owner=${isOwner}  admin=${isAdmin}`);

        for (const plugin of plugins) {
            if (!plugin.commands.includes(resolvedCommand)) continue;

            const th = getActiveTheme()?.global || {};

            // ── Scope guards — with themed alerts ────────────────────────────
            const allowGroup   = plugin.group   !== false;
            const allowPrivate = plugin.private !== false;

            if (isGroup && !allowGroup) {
                await safeSend(sock, jid, {
                    text: [
                        `*${th.botName || 'MUSHII'}*`,
                        ``,
                        getStr('private') || '⚠️ This feature is for private chats only.',
                        ``,
                        th.footer ? `_${th.footer}_` : ''
                    ].filter(Boolean).join('\n')
                }, { quoted: message });
                continue;
            }

            if (!isGroup && !allowPrivate) {
                await safeSend(sock, jid, {
                    text: [
                        `*${th.botName || 'MUSHII'}*`,
                        ``,
                        getStr('group') || '❗ This feature is for groups only.',
                        ``,
                        th.footer ? `_${th.footer}_` : ''
                    ].filter(Boolean).join('\n')
                }, { quoted: message });
                continue;
            }

            // ── Bot admin guard ───────────────────────────────────────────────
            if (plugin.botAdmin && !isBotAdmin) {
                await safeSend(sock, jid, {
                    text: [
                        `*${th.botName || 'MUSHII'}*`,
                        ``,
                        getStr('botAdmin') || '❗ Please give me admin role first.',
                        ``,
                        th.footer ? `_${th.footer}_` : ''
                    ].filter(Boolean).join('\n')
                }, { quoted: message });
                continue;
            }

            // ── Permission check ──────────────────────────────────────────────
            const perm = (plugin.permission || PERM.PUBLIC).toLowerCase();
            let allowed = false;
            if      (perm === PERM.PUBLIC) allowed = true;
            else if (perm === PERM.ADMIN)  allowed = isAdmin || isOwner;
            else if (perm === PERM.OWNER)  allowed = isOwner;

            if (!allowed) {
                const alertKey = perm === PERM.OWNER ? 'owner' : 'admin';
                const fallback = perm === PERM.OWNER
                    ? '⛔ This command is reserved for the bot owner.'
                    : '⛔ This command is for group admins only.';
                await safeSend(sock, jid, {
                    text: [
                        `*${th.botName || 'MUSHII'}*`,
                        ``,
                        getStr(alertKey) || fallback,
                        ``,
                        th.footer ? `_${th.footer}_` : ''
                    ].filter(Boolean).join('\n')
                }, { quoted: message });
                continue;
            }

            // ── Prediction note: let user know what command was resolved ────
            if (predictionNote) {
                await safeSend(sock, jid, { text: predictionNote }, { quoted: message });
                predictionNote = null;
            }

            // ── Override presence to recording for media commands ───────────
            if (config.AUTO_RECORDING && RECORDING_CMDS.has(resolvedCommand)) {
                try { await sock.sendPresenceUpdate('recording', jid); } catch { /* non-fatal */ }
            }

            try {
                const PLUGIN_TIMEOUT_MS = 60_000;
                const _timeoutP = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Plugin timed out after ${PLUGIN_TIMEOUT_MS / 1000}s`)), PLUGIN_TIMEOUT_MS)
                );
                await Promise.race([plugin.run(sock, message, args, ctx), _timeoutP]);
            } catch (err) {
                const isTimeout = /timed out/i.test(err.message);
                console.error(`[Plugin:${command}] ${isTimeout ? '⏱ TIMEOUT' : ''} ${err.stack || err.message}`);
                const errTheme = getActiveTheme();
                const errMsg = isTimeout
                    ? `⏱ That command took too long and was cancelled. Try again.`
                    : (errTheme?.error?.text || `⚠️ Command error: ${err.message || 'unknown error'}`);
                await safeSend(sock, jid, {
                    text: [
                        `*${th.botName || 'MUSHII'}*`,
                        ``,
                        errMsg,
                        ``,
                        th.footer ? `_${th.footer}_` : ''
                    ].filter(Boolean).join('\n')
                }, { quoted: message });
            }

            // ── Auto-presence: back to paused after responding ───────────────
            if (config.AUTO_TYPING || config.AUTO_RECORDING) {
                try { await sock.sendPresenceUpdate('paused', jid); } catch { /* non-fatal */ }
            }

            // ── Only run the first matching plugin — stop after one dispatch ─
            break;
        }
    } catch (err) {
        console.error('[Handler] Fatal:', err.stack || err.message);
    }
}

module.exports = { handleMessages, safeSend, setupConnectionHandlers, installNewsletterForwarding, withNewsletterContext, PERM, plugins, extractMessageText };
