'use strict';

const { createAutoReply } = require('../lib/auto-reply');

function createAwayPlugin(autoReply = createAutoReply()) {
    return {
        commands: ['away'],
        description: 'Toggle professional AI-generated automatic private-message replies while away',
        usage: '.away on | .away off',
        permission: 'owner',
        group: false,
        private: true,

        isAwayEnabled: () => autoReply.isEnabled(),
        recordConversationMessage: (message, text) => autoReply.recordConversationMessage(message, text),
        getConversationHistory: jid => autoReply.getConversationHistory(jid),

        handleAutoReply: (sock, message, text, context) => autoReply.replyToMessage({
            jid: context.jid,
            sender: context.from || context.jid,
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
                    'Commands: .away on | .away off'
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
