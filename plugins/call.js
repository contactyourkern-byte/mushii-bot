'use strict';

module.exports = {
    commands: ['support', 'call'],
    description: 'Show MUSHII status and support availability',
    usage: '.support | .support status',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const uptime = Math.floor(process.uptime());
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        const isStatus = (args[0] || '').toLowerCase() === 'status';
        const text = isStatus
            ? `🖥️ *MUSHII Status*\n\nUptime: ${hours}h ${minutes}m ${seconds}s\nPlatform: ${process.platform} ${process.arch}`
            : '*MUSHII Support*\n\nNo support contact or channel has been configured.';
        return ctx.reply(text);
    }
};
