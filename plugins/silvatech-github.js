'use strict';

const axios = require('axios');

const REPOSITORY = 'contactyourkern-byte/mushii-bot';
const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
const API_URL = `https://api.github.com/repos/${REPOSITORY}`;

module.exports = {
    commands: ['mushiirepo', 'mushiifiles'],
    description: 'Browse the MUSHII GitHub repository (read-only)',
    usage: '.mushiirepo | .mushiifiles <path>',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        if (ctx.command === 'mushiirepo' || !args.length) {
            let description = 'WhatsApp Entertainment Bot';
            try {
                const response = await axios.get(API_URL, { timeout: 8000 });
                description = response.data.description || description;
            } catch { /* use the local description */ }
            return ctx.reply(`✨ *MUSHII Repository*\n\n${description}\n${REPOSITORY_URL}`);
        }

        const filePath = args.join('/').replace(/^\/+|\.\./g, '');
        if (!filePath) return ctx.reply(`Usage: .mushiifiles <path>\n${REPOSITORY_URL}`);

        try {
            const response = await axios.get(`${API_URL}/contents/${filePath}`, { timeout: 10000 });
            const data = response.data;
            if (Array.isArray(data)) {
                const entries = data.map(entry => `${entry.type === 'dir' ? '📁' : '📄'} ${entry.name}`);
                return ctx.reply(`📂 *${filePath || '/'}*\n\n${entries.join('\n') || 'Empty directory'}`);
            }
            if (data.encoding !== 'base64' || !data.content) {
                return ctx.reply(`Could not read ${filePath}.\n${data.html_url || REPOSITORY_URL}`);
            }
            const content = Buffer.from(data.content, 'base64').toString('utf8').slice(0, 3000);
            return ctx.reply(`📄 *${filePath}*\n\n\`\`\`\n${content}\n\`\`\``);
        } catch {
            return ctx.reply(`Could not find ${filePath}.\n${REPOSITORY_URL}`);
        }
    }
};
