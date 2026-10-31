'use strict';

const { createAutoReply } = require('../lib/auto-reply');

function createAwayPlugin(autoReply = createAutoReply()) {
    return {
        commands:    ['away'],
        description: 'Toggle automatic private-message replies while away',
        usage:       '.away on | .away off',
        permission:  'owner',
        group:       false,
        private:     true,

        isAwayEnabled: () => autoReply.isEnabled(),

        handleAutoReply: (sock, message, text, context) => autoReply.replyToMessage({
            jid: context.jid,
            sender: context.from || context.jid,
            text,
            isGroup: context.isGroup,
            isOwner: context.isOwner,
            fromMe: message?.key?.fromMe,
            isProtocolMessage: context.isProtocolMessage,
            send: content => context.safeSend
                ? context.safeSend(content, { quoted: message })
                : sock.sendMessage(context.jid, content, { quoted: message })
        }),

        run: async (sock, message, args, context) => {
            if (!context.isOwner) return context.reply('⛔ Only the bot owner can control Auto Reply.');

            const action = (args[0] || '').toLowerCase();
            if (action !== 'on' && action !== 'off') {
                return context.reply(`Auto Reply is currently *${autoReply.isEnabled() ? 'ON' : 'OFF'}*.\n\nUsage: \`.away on\` or \`.away off\``);
            }

            const enabled = action === 'on';
            autoReply.setEnabled(enabled);
            return context.reply(enabled
                ? '✅ Auto Reply is ON. Private messages will receive an automatic reply.'
                : '✅ Auto Reply is OFF.');
        }
    };
}

const plugin = createAwayPlugin();
plugin.__test = { createAwayPlugin };

module.exports = plugin;
