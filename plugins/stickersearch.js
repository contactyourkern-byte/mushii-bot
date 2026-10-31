'use strict';

module.exports = {
    commands:    ['stickersearch', 'findsticker', 'giphy'],
    description: 'Search and send animated stickers/GIFs',
    permission:  'public',
    group:       true,
    private:     true,
    run: async (sock, message, args, { sender, groupId, contextInfo }) => {
        const chatId = groupId || sender;
        const query = args.join(' ');
        if (!query) {
            return sock.sendMessage(chatId, {
                text: '🔍 Usage: .stickersearch <query>\nExample: .stickersearch laughing cat',
                contextInfo
            }, { quoted: message });
        }

        const apiKey = process.env.GOOGLE_API_KEY?.trim();
        if (!apiKey) {
            return sock.sendMessage(chatId, {
                text: 'Sticker search is not configured yet. Please ask the bot owner to set GOOGLE_API_KEY.',
                contextInfo
            }, { quoted: message });
        }

        await sock.sendMessage(chatId, {
            text: `⏳ Searching GIFs for "${query}"...`,
            contextInfo
        }, { quoted: message });

        try {
            const axios = require('axios');
            const { data } = await axios.get('https://tenor.googleapis.com/v2/search', {
                params: { q: query, key: apiKey, limit: 1, media_filter: 'gif' },
                timeout: 10000
            });
            const gif = data?.results?.[0]?.media_formats?.gif?.url;
            if (!gif) throw new Error('No GIFs found.');
            const { data: gifData } = await axios.get(gif, {
                responseType: 'arraybuffer',
                timeout: 20000
            });
            await sock.sendMessage(chatId, {
                video: Buffer.from(gifData),
                gifPlayback: true,
                mimetype: 'video/mp4',
                caption: `🎭 *${query}* — MUSHII`,
                contextInfo
            }, { quoted: message });
        } catch (e) {
            const errorMessage = String(e.message || 'Unknown error').replaceAll(apiKey, '[redacted]');
            await sock.sendMessage(chatId, {
                text: `❌ Sticker search failed: ${errorMessage}`,
                contextInfo
            }, { quoted: message });
        }
    }
};
