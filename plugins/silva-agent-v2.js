'use strict';

const { runAgent, clearHistory, getHistory } = require('../lib/agent-v2');
const universalDownloader = require('./universal-downloader');

const SOCIAL_URL = /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com)\//i;
const ACTION_INTENT = /\b(weather|forecast|temperature|search|google|look up|wiki|wikipedia|translate|definition|define|lyrics?|play|music|song|spotify|tiktok|instagram|insta|facebook|youtube|ytmp[34]|twitter|tweet|pinterest|sticker|qr code|qrcode|remind|reminder|note|poll|schedule|group|kick|remove|promote|demote|mute|unmute|lock|unlock|tag all|download|save this|send this)\b/i;

function pluginMap() {
    const map = new Map();
    try {
        const { plugins } = require('../handler');
        for (const plugin of plugins || []) {
            const modules = Array.isArray(plugin) ? plugin : [plugin];
            for (const mod of modules) for (const command of mod?.commands || []) if (!map.has(command)) map.set(command, mod);
        }
    } catch {}
    return map;
}

function permissionAllowed(plugin, ctx) {
    if (plugin.permission === 'owner') return Boolean(ctx.isOwner);
    if (plugin.permission === 'admin') return Boolean(ctx.isAdmin || ctx.isOwner);
    return true;
}

async function runExplicitCommand(sock, message, query, ctx) {
    const match = query.match(/^(?:run|execute|do|use|try|open)\s+\.?([a-z0-9_-]+)(?:\s+(.*))?$/i)
        || query.match(/^\.?([a-z0-9_-]+)(?:\s+(.*))?$/i);
    if (!match) return false;
    const command = (match[1] || '').toLowerCase();
    const plugin = pluginMap().get(command);
    if (!plugin || ['mushii', 'agent', 'assistant', 'ask', 'autopilot', 'agent2', 'copilot'].includes(command)) return false;
    if (!permissionAllowed(plugin, ctx)) {
        await ctx.reply(`⛔ The ${command} command requires ${plugin.permission} permission.`);
        return true;
    }
    await plugin.run(sock, message, (match[2] || '').split(/\s+/).filter(Boolean), ctx);
    return true;
}

async function runLocalAction(sock, message, query, ctx) {
    const url = query.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.!?]+$/, '');
    const asksForMedia = /\b(download|save|send|get|fetch|video|audio|mp3|mp4)\b/i.test(query);
    if ((url && SOCIAL_URL.test(url) && asksForMedia) || /^download\s+(?:search\s+)?/i.test(query)) {
        const format = /\bmp3\b|\baudio\b/i.test(query) ? 'mp3' : 'mp4';
        const args = query.match(/^download\s+search\s+(.+?)(?:\s+(mp3|mp4))?$/i);
        if (args) {
            await universalDownloader.run(sock, message, ['search', args[1], args[2] || format], ctx);
            return true;
        }
        await universalDownloader.run(sock, message, [url || query.replace(/^download\s+/i, ''), format], ctx);
        return true;
    }

    if (await runExplicitCommand(sock, message, query, ctx)) return true;

    // Reuse the mature legacy action router for deterministic commands only.
    // Conversational requests continue through Agent v2 and ch.at.
    if (ACTION_INTENT.test(query)) {
        const legacy = require('./silva-agent');
        await legacy.run(sock, message, query.split(/\s+/).filter(Boolean), ctx);
        return true;
    }
    return false;
}

module.exports = {
    commands: ['mushii', 'agent', 'assistant', 'ask', 'autopilot', 'agent2', 'copilot'],
    description: 'MUSHII assistant with memory, local commands, and media delivery',
    usage: 'MUSHII <request> | .mushii <request> | .autopilot <request>',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const { jid, reply } = ctx;
        const query = args.join(' ').trim();
        if (!query) return reply([
            '🧠 *MUSHII Assistant*',
            '',
            'Talk naturally without a prefix, or use `.mushii`.',
            '',
            'Examples:',
            '• `MUSHII, what is the weather in Nairobi?`',
            '• `MUSHII, download this link as mp4: <url>`',
            '• `MUSHII, download this link as mp3: <url>`',
            '• `MUSHII, run menu`',
            '• `MUSHII, remember that I prefer short answers`',
            '',
            'Use `MUSHII, forget our conversation` to clear memory.'
        ].join('\n'));

        if (/^(forget|clear|reset)\b/i.test(query)) {
            clearHistory(jid);
            return reply('✅ MUSHII memory cleared for this chat.');
        }
        if (/^status$/i.test(query)) {
            return reply(`🧠 *MUSHII Assistant Status*\n\nPersistent memory items: ${getHistory(jid).length}\nChat backend: ch.at (no API key)\nLocal command execution: enabled\nMedia delivery: MP4 + MP3 enabled`);
        }

        try {
            if (await runLocalAction(sock, message, query, ctx)) return;
            await reply('🧠 Thinking...');
            const result = await runAgent(query, { ...ctx, sock, message });
            return reply(`🤖 *MUSHII*\n\n${result.text}`);
        } catch (error) {
            console.error(`[MUSHII-Agent] ${error.message}`);
            return reply('❌ MUSHII could not complete that request. Please try again.');
        }
    }
};
