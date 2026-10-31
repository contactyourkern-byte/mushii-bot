'use strict';

module.exports = {
    commands: ['welcome', 'goodbye', 'setwelcome', 'setgoodbye', 'welcomeoff', 'goodbyeoff'],
    description: 'Group welcome and goodbye messages are disabled',
    usage: '.welcome | .goodbye',
    permission: 'admin',
    group: true,
    private: false,
    run: async (sock, message, args, ctx) =>
        ctx.reply('MUSHII does not send automated welcome or goodbye messages into groups.')
};
