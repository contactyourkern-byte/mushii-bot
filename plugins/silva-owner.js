'use strict';

module.exports = {
    commands: ['owner', 'creator'],
    description: 'Check whether owner contact details are configured',
    permission: 'public',
    group: true,
    private: true,
    run: async (sock, message, args, ctx) =>
        ctx.reply('MUSHII owner contact details have not been configured.')
};
