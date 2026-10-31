'use strict';

const playdl = require('play-dl');
const { isYoutubeUrl, withDownloadedMedia } = require('../lib/youtube-media');

module.exports = {
    commands:    ['ytvid-audio', 'ytaudio2'],
    description: 'Download YouTube audio as MP3 by URL',
    permission:  'public',
    group:       true,
    private:     true,

    run: async (sock, message, args, { sender, contextInfo }) => {
        const url = args[0];
        if (!isYoutubeUrl(url)) {
            return sock.sendMessage(sender, {
                text: '🎵 Please provide a valid YouTube URL.\nExample: `.ytmp3 https://youtu.be/dQw4w9WgXcQ`',
                contextInfo
            }, { quoted: message });
        }

        await sock.sendMessage(sender, { text: '⏳ Fetching audio...', contextInfo }, { quoted: message });

        try {
            let title = 'Audio', artist = 'Unknown', duration = '';
            try {
                const info = await playdl.video_info(url);
                const d = info.video_details;
                title    = d.title || title;
                artist   = d.channel?.name || artist;
                duration = d.durationRaw || '';
            } catch {}

            await withDownloadedMedia(url, 'audio', async ({ filePath }) => {
                await sock.sendMessage(sender, {
                    audio:    { url: filePath },
                    mimetype: 'audio/mpeg',
                    ptt:      false,
                    contextInfo
                }, { quoted: message });
            });

            await sock.sendMessage(sender, {
                text: `🎵 *${title}*\n🎤 ${artist}  •  ⏱ ${duration}`,
                contextInfo
            }, { quoted: message });

        } catch (err) {
            await sock.sendMessage(sender, {
                text: `❌ Audio download failed: ${err.message}`,
                contextInfo
            }, { quoted: message });
        }
    }
};
