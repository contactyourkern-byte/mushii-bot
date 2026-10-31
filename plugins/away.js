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
            send: content => context.safeSend
                ? context.safeSend(content, { quoted: message })
                : sock.sendMessage(context.jid, content, { quoted: message })
        }),

        run: async (sock, message, args, context) => {
            if (!context.isOwner) return context.reply('⛔ Only the bot owner can control Auto Reply.');

            const action = (args[0] || '').toLowerCase();
            if (action !== 'on' && action !== 'off') {
                return context.reply(
                    'Auto Reply is currently *' + (autoReply.isEnabled() ? 'ON' : 'OFF') + '*.\n\n' +
                    'AI replies use recent private-chat context, polished language, and a 30-second per-contact cooldown.\n' +
                    'Sensitive or owner-only matters are handed off for your manual reply.\n\n' +
                    'Usage: .away on or .away off
                );
            }

            const enabled = action === 'on';
            autoReply.setEnabled(enabled);
            return context.reply(enabled
                ? '✅ *MUSHII AI Auto Reply is ON.*\n\nProfessional contextual replies are enabled for private chats. The AI will use recent conversation context, respect a 30-second cooldown, and leave sensitive or owner-only matters for your manual response.'
                : '✅ *MUSHII AI Auto Reply is OFF.*\n\nAutomatic replies are disabled and the temporary conversation memory has been cleared.');
        }
    };
}

const plugin = createAwayPlugin();
plugin.__test = { createAwayPlugin };

module.exports = plugin;
