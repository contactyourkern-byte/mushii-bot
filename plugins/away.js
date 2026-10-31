'use strict';

const { createAutoReply } = require('../lib/auto-reply');

function createAwayPlugin(autoReply = createAutoReply()) {
    return {
        commands: ['away', 'awaymute', 'awayunmute', 'awaymuted'],
        description: 'Toggle professional AI-generated automatic private-message replies while away',
        usage: '.away on | .away off',
        permission: 'owner',
        group: false,
        private: true,

        isAwayEnabled: () => autoReply.isEnabled(),
        recordConversationMessage: (message, text) => autoReply.recordConversationMessage(message, text),
        getConversationHistory: jid => autoReply.getConversationHistory(jid),
        isContactMuted: identifier => autoReply.isContactMuted({ sender: identifier, senderNumber: identifier, jid: identifier }),
        muteContact: identifier => autoReply.muteContact(identifier),
        unmuteContact: identifier => autoReply.unmuteContact(identifier),
        getMutedContacts: () => autoReply.getMutedContacts(),

        handleAutoReply: (sock, message, text, context) => autoReply.replyToMessage({
            jid: context.jid,
            sender: context.from || context.jid,
            senderNumber: context.senderNumber || '',
            text,
            isGroup: context.isGroup,
            isOwner: context.isOwner,
            fromMe: message?.key?.fromMe,
            isProtocolMessage: context.isProtocolMessage,
            notifyOwner: context.notifyOwner,
            onStart: () => sock.sendPresenceUpdate?.('composing', context.jid),
            onFinish: () => sock.sendPresenceUpdate?.('paused', context.jid),
            send: content => context.safeSend
                ? context.safeSend(content, { quoted: message })
                : sock.sendMessage(context.jid, content, { quoted: message })
        }),

        run: async (sock, message, args, context) => {
            if (!context.isOwner) {
                return context.reply('⛔ Only the bot owner can control Auto Reply.');
            }

            const command = String(context.command || '').toLowerCase();
            if (command === 'awaymute' || command === 'awayunmute') {
                const identifier = String(args[0] || '').trim();
                if (!identifier) {
                    return context.reply(command === 'awaymute'
                        ? 'Usage: .awaymute <phone-number-or-private-JID>\nExample: .awaymute 2507XXXXXXXX'
                        : 'Usage: .awayunmute <phone-number-or-private-JID>\nExample: .awayunmute 2507XXXXXXXX');
                }
                try {
                    const changed = command === 'awaymute'
                        ? autoReply.muteContact(identifier)
                        : autoReply.unmuteContact(identifier);
                    const target = identifier.replace(/:\d+(?=@)/, '').slice(0, 40);
                    if (command === 'awaymute') {
                        return context.reply(changed
                            ? '🔕 AI Auto Reply muted for *' + target + '* only. Other contacts are unaffected.'
                            : 'ℹ️ AI Auto Reply was already muted for *' + target + '*.');
                    }
                    return context.reply(changed
                        ? '🔔 AI Auto Reply unmuted for *' + target + '*. Replies can resume when the 15-second cooldown allows.'
                        : 'ℹ️ AI Auto Reply was not muted for *' + target + '*.');
                } catch (error) {
                    return context.reply('⚠️ ' + error.message + '\nUse a full phone number with country code or a private WhatsApp JID.');
                }
            }

            if (command === 'awaymuted') {
                const contacts = autoReply.getMutedContacts();
                return context.reply(contacts.length
                    ? '🔕 *Contacts muted from AI Auto Reply:*\n' + contacts.map((value, index) => (index + 1) + '. ' + value).join('\n')
                    : '✅ No contacts are muted from AI Auto Reply.');
            }
            if (!context.isOwner) {
                return context.reply('⛔ Only the bot owner can control Auto Reply.');
            }

            const action = (args[0] || '').toLowerCase();
            if (action !== 'on' && action !== 'off') {
                const status = autoReply.isEnabled() ? 'ON' : 'OFF';
                return context.reply([
                    'MUSHII AI Auto Reply is currently *' + status + '*.',
                    '',
                    '• Context-aware private chat replies',
                    '• Clear, polished Kinyarwanda and natural English',
                    '• 15-second cooldown per contact',
                    '• Sensitive requests are handed to the owner',
                    '',
                    'Commands: .away on | .away off',
                    '.awaymute <number> | .awayunmute <number> | .awaymuted'
                ].join('\n'));
            }

            const enabled = action === 'on';
            autoReply.setEnabled(enabled);
            return context.reply(enabled
                ? '✅ *MUSHII AI Auto Reply is ON.*\n\nProfessional contextual replies are enabled for private chats. The AI uses recent conversation context, a 15-second per-contact cooldown, and hands sensitive or owner-only matters to you for a manual reply.'
                : '✅ *MUSHII AI Auto Reply is OFF.*\n\nAutomatic replies are disabled and temporary conversation memory has been cleared.');
        }
    };
}

const plugin = createAwayPlugin();
plugin.__test = { createAwayPlugin };

module.exports = plugin;
