'use strict';

const config = require('../config');
const R = require('../lib/research-engine');
const Agent = require('../lib/agent-v2');

function ownerDestination(ctx) {
    const configuredOwner = String(process.env.OWNER_NUMBER || config.OWNER_NUMBER || '').replace(/\D/g, '');
    if (!configuredOwner) throw Error('Set OWNER_NUMBER in private host settings.');
    if (!ctx?.isOwner) throw Error('This research command is owner-only.');
    if (ctx.isGroup || !ctx.jid || String(ctx.jid).endsWith('@g.us')) {
        throw Error('Research results can only be delivered to the owner in a private chat.');
    }
    // Use the authenticated private chat JID rather than rebuilding a phone JID.
    // This keeps WhatsApp LID routing intact for linked devices.
    return ctx.jid;
}

async function send(sock, jid, text, ctx) {
    const chunks = String(text || '').match(/[\s\S]{1,3500}/g) || [''];
    for (const part of chunks) {
        if (typeof ctx?.safeSend === 'function') {
            await ctx.safeSend({ text: part });
        } else {
            await sock.sendMessage(jid, { text: part });
        }
    }
}

function narrationPrompt(topic, result) {
    const lines = [];
    for (const cluster of result.clusters || []) {
        lines.push('RESEARCH CLUSTER: ' + cluster.label);
        for (const video of (cluster.videos || []).slice(0, 5)) {
            lines.push('- Video lead: ' + video.title + ' | channel: ' + video.channel + ' | views: ' + video.views + ' | ' + video.url);
        }
        for (const source of (cluster.sources || []).slice(0, 4)) {
            lines.push('- Reference lead: ' + source.title + ' | ' + source.url);
        }
    }
    const evidence = lines.join('\n').slice(0, 2600);
    return [
        'Write a cinematic 8–10 minute YouTube documentary narration in fluent, natural spoken Kinyarwanda for MUSHII: African Stories & Entertainment.',
        'Topic: ' + topic,
        'Structure: strong opening hook; historical/background context; three connected story acts; turning point; consequences and legacy; memorable closing.',
        'Use clear Kinyarwanda rather than literal translations. Keep the tone factual, compelling and respectful.',
        'Do not invent facts, dates, names, statistics or quotations. Treat YouTube titles as discovery leads, not proof. Where facts are uncertain or sources do not agree, mark [KUGENZURA IKIREGO] and explain what must be checked.',
        'Cite source URLs in a short source note at the end. Do not claim a source proves something unless its content was actually checked.',
        'Research leads from the latest scan:',
        evidence
    ].join('\n').slice(0, 4700);
}

module.exports = {
    commands: ['kern', 'mushii'],
    description: 'Owner-only KERN and MUSHII documentary research',
    usage: '.kern scan | .mushii scan | .mushii script <topic>',
    permission: 'owner',
    group: false,
    private: true,
    run: async (sock, message, args, ctx) => {
        let jid = '';
        try {
            jid = ownerDestination(ctx);
            const p = ctx.command === 'kern' ? 'kern' : 'mushii';
            const action = String(args[0] || 'help').toLowerCase();
            const topic = args.slice(1).join(' ').trim();

            if (action === 'help') {
                const help = p === 'kern'
                    ? '*KERN*\n.kern scan [topic]\n.kern ideas\n.kern analyze <topic>\n.kern export\nSeven clusters include cybercrime, all three luxury pillars, strange science, history and human extremes.'
                    : '*MUSHII*\n.mushii scan [topic]\n.mushii ideas\n.mushii script <topic>\nFive African story clusters.';
                return send(sock, jid, help, ctx);
            }

            if (!['scan', 'ideas', 'analyze', 'export', 'script'].includes(action)) {
                return send(sock, jid, 'Unknown action. Use .' + p + ' help', ctx);
            }
            if ((action === 'analyze' || action === 'script') && !topic) {
                return send(sock, jid, 'Add a topic.', ctx);
            }
            if (p === 'kern' && action === 'script') {
                return send(sock, jid, 'KERN is research-only; use .mushii script <topic>.', ctx);
            }
            if (p === 'mushii' && action === 'analyze') {
                return send(sock, jid, 'Use .mushii scan <topic> or .mushii script <topic>.', ctx);
            }

            if (action === 'ideas' || action === 'export') {
                const saved = R.latest(p);
                if (!saved) return send(sock, jid, 'No saved scan. Run .' + p + ' scan first.', ctx);
                if (action === 'ideas') return send(sock, jid, R.report(saved), ctx);
                const document = {
                    document: Buffer.from(R.csv(saved)),
                    mimetype: 'text/csv',
                    fileName: p + '-research.csv'
                };
                if (typeof ctx.safeSend === 'function') return ctx.safeSend(document);
                return sock.sendMessage(jid, document);
            }

            await send(sock, jid, '🔎 ' + p.toUpperCase() + ' research started. Results will be sent to this private owner chat.', ctx);
            const result = await R.scan(p, topic);

            if (action === 'script') {
                const generated = await Agent.runAgent(narrationPrompt(topic, result), ctx);
                const narration = String(generated?.text || '').trim();
                if (!narration) throw Error('The existing no-key writing service returned an empty response.');
                return send(sock, jid, '🇷🇼 *MUSHII KINYARWANDA NARRATION*\n' + narration, ctx);
            }
            return send(sock, jid, R.report(result), ctx);
        } catch (error) {
            const safe = String(error.message || error)
                .replace(/(key|token|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
                .slice(0, 240);
            if (jid) return send(sock, jid, '⚠️ Research failed: ' + safe, ctx);
            throw error;
        }
    }
};
