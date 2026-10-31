'use strict';

module.exports = {
    commands:    ['antidelete', 'antidel'],
    description: 'Explain private deleted-message notifications',
    permission:  'owner',
    group:       true,
    private:     true,

    run: async (_sock, _message, _args, ctx) => {
        await ctx.safeSend({
            text: 'Private-chat deletion alerts are active. The owner receives the sender and deletion time, followed by the original cached message when available. Group, owner-sent, disappearing, and View Once messages are not forwarded.',
            contextInfo: ctx.contextInfo
        });
    }
};
