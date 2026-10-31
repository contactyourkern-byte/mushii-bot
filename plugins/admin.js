'use strict';

const STANDARD_MENU_COMMANDS = new Set(require('./menu').__test.menuCommands);
const PAGE_SIZE = 25;

function collectRemainingCommands(plugins = []) {
    const entries = new Map();

    for (const plugin of plugins) {
        if (!plugin || !Array.isArray(plugin.commands)) continue;
        const permission = String(plugin.permission || 'public').toLowerCase();
        for (const raw of plugin.commands) {
            const command = String(raw || '').trim().toLowerCase();
            if (!command || STANDARD_MENU_COMMANDS.has(command) || command === 'admin') continue;
            if (!entries.has(command)) {
                entries.set(command, {
                    command,
                    permission,
                    description: String(plugin.description || 'No description available').trim()
                });
            }
        }
    }

    const rank = { owner: 0, admin: 1, public: 2 };
    return [...entries.values()].sort((a, b) =>
        (rank[a.permission] ?? 3) - (rank[b.permission] ?? 3)
        || a.command.localeCompare(b.command)
    );
}

function buildAdminMenu(plugins, page = 1, prefix = '.') {
    const entries = collectRemainingCommands(plugins);
    const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const currentPage = Math.min(totalPages, Math.max(1, Number.parseInt(page, 10) || 1));
    const visible = entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const lines = [
        '*⚙️ MUSHII ADMIN COMMAND DIRECTORY*',
        '_Owner-only directory · commands not shown in the standard .menu_',
        '',
        ...visible.map(item => {
            const icon = item.permission === 'owner' ? '👑' : item.permission === 'admin' ? '🛡️' : '🌍';
            return icon + ' `' + prefix + item.command + '` — ' + item.description;
        }),
        '',
        'Commands listed: ' + entries.length,
        'Page ' + currentPage + '/' + totalPages,
        totalPages > 1 ? 'Next: ' + prefix + 'admin ' + Math.min(totalPages, currentPage + 1) + ' | Previous: ' + prefix + 'admin ' + Math.max(1, currentPage - 1) : '',
        '_👑 Owner  🛡️ Group admin  🌍 Public_'
    ].filter(Boolean);
    return lines.join('\n');
}

module.exports = {
    commands: ['admin'],
    description: 'Show the owner-only directory of commands omitted from the standard menu',
    usage: '.admin [page]',
    permission: 'owner',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        if (!ctx.isOwner) return ctx.reply('⛔ This command is reserved for the bot owner.');
        return ctx.reply(buildAdminMenu(ctx.plugins || [], args[0], ctx.prefix || '.'));
    },

    __test: { collectRemainingCommands, buildAdminMenu, STANDARD_MENU_COMMANDS, PAGE_SIZE }
};
