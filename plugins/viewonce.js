'use strict';

module.exports = {
    commands: ['vv', 'viewonce', 'open', 'openphoto', 'openvideo', 'vvphoto'],
    description: 'View Once media access is disabled to respect privacy',
    permission: 'owner',
    group: true,
    private: true,
    run: async (sock, message, args, ctx) =>
        ctx.reply('MUSHII never opens, forwards, or bypasses View Once messages.')
};
