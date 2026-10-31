'use strict';

module.exports = {
    commands: ['developers', 'devs', 'devcontact'],
    description: 'Check whether MUSHII developer contacts are configured',
    usage: '.developers',
    permission: 'public',
    group: true,
    private: true,
    run: async (sock, message, args, ctx) =>
        ctx.reply('MUSHII developer contact details have not been configured.')
};
