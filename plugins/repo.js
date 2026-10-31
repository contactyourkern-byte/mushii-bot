'use strict';

const axios = require('axios');

const REPO_URL = 'https://github.com/contactyourkern-byte/mushii-bot';
const API_URL = 'https://api.github.com/repos/contactyourkern-byte/mushii-bot';

module.exports = {
    commands: ['repo', 'repository', 'github'],
    description: 'Show MUSHII repository information',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        let data = null;
        try {
            const response = await axios.get(API_URL, { timeout: 10000 });
            data = response.data;
        } catch { /* use the local description */ }

        const details = data
            ? `\nStars: ${data.stargazers_count.toLocaleString()}\nForks: ${data.forks_count.toLocaleString()}\nLanguage: ${data.language || 'JavaScript'}`
            : '\nWhatsApp Entertainment Bot';
        return ctx.reply(`✨ *MUSHII Repository*\n\n${REPO_URL}${details}`);
    }
};
