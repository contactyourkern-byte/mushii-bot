'use strict';

const R = require('../lib/research-engine');
const Agent = require('../lib/agent-v2');

function getPrivateOwnerSender(ctx) {
    if (!ctx?.isOwner || ctx.isGroup) {
        throw Error('This research command is available only to the owner in a private chat.');
    }
    if (!/^\\d+@(?:s\\.whatsapp\\.net|lid|c\\.us)$/.test(String(ctx.jid || ''))) {
        throw Error('Could not resolve the owner's private WhatsApp chat.');
    }
    if (typeof ctx.safeSend !== 'function') {
        throw Error('Secure WhatsApp reply handler is unavailable.');
    }
    return ctx.safeSend;
}

async function send(ctx, text) {
    const deliver = getPrivateOwnerSender(ctx);
    const chunks = String(text || '').match(/[\\s\\S]{1,3500}/g) || [''];
    for (const part of chunks) await deliver({ text: part });
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
    const evidence = lines.join('\\n').slice(0, 2600);
    return [
        'Write a cinematic 8–10 minute YouTube documentary narration in fluent, natural spoken Kinyarwanda for MUSHII: African Stories & Entertainment.',
        'Topic: ' + topic,
        'Structure: strong opening hook; historical/background context; three connected story acts; turning point; consequences and legacy; memorable closing.',
        'Use clear Kinyarwanda rather than literal translations. Keep the tone factual, compelling and respectful.',
        'Do not invent facts, dates, names, statistics or quotations. Treat YouTube titles as discovery leads, not proof. Where facts are uncertain or sources do not agree, mark [KUGENZURA IKIREGO] and explain what must be checked.',
        'Cite source URLs in a short source note at the end. Do not claim a source proves something unless its content was actually checked.',
        'Research leads from the latest scan:',
        evidence
    ].join('\\n').slice(0, 4700);
}

module.exports = {
    commands: ['kern', 'mushii'],
    description: 'Owner-only KERN and MUSHII documentary research',
    usage: '.kern scan | .mushii scan | .mushii script <topic>',
    permission: 'owner',
    group: false,
    private: true,
    run: async (sock, message, args, ctx) => {
        try {
            getPrivateOwnerSender(ctx);
            const profile = ctx.command === 'kern' ? 'kern' : 'mushii';
            const action = String(args[0] || 'help').toLowerCase();
            const topic = args.slice(1).join(' ').trim();

            if (action === 'help') {
                const help = profile === 'kern'
                    ? '*KERN*\\n.kern scan [topic]\\n.kern ideas\\n.kern analyze <topic>\\n.kern export\\nSeven clusters include cybercrime, all three luxury pillars, strange science, history and human extremes.'
                    : '*MUSHII*\\n.mushii scan [topic]\\n.mushii ideas\\n.mushii script <topic>\\nFive African story clusters.';
                return send(ctx, help);
            }

            if (!['scan', 'ideas', 'analyze', 'export', 'script'].includes(action)) {
                return send(ctx, 'Unknown action. Use .' + profile + ' help');
            }
            if ((action === 'analyze' || action === 'script') && !topic) {
                return send(ctx, 'Add a topic.');
            }
            if (profile === 'kern' && action === 'script') {
                return send(ctx, 'KERN is research-only; use .mushii script <topic>.');
            }
            if (profile === 'mushii' && action === 'analyze') {
                return send(ctx, 'Use .mushii scan <topic> or .mushii script <topic>.');
            }

            if (action === 'ideas' || action === 'export') {
                const saved = R.latest(profile);
                if (!saved) return send(ctx, 'No saved scan. Run .' + profile + ' scan first.');
                if (action === 'ideas') return send(ctx, R.report(saved));
                const deliver = getPrivateOwnerSender(ctx);
                return deliver({
                    document: Buffer.from(R.csv(saved)),
                    mimetype: 'text/csv',
                    fileName: profile + '-research.csv'
                });
            }

            await send(ctx, '🔎 ' + profile.toUpperCase() + ' research started. Results will be sent in this private chat.');
            const result = await R.scan(profile, topic);

            if (action === 'script') {
                const generated = await Agent.runAgent(narrationPrompt(topic, result), ctx);
                const narration = String(generated?.text || '').trim();
                if (!narration) throw Error('The existing no-key writing service returned an empty response.');
                return send(ctx, '🇷🇼 *MUSHII KINYARWANDA NARRATION*\\n' + narration);
            }
            return send(ctx, R.report(result));
        } catch (error) {
            const safe = String(error.message || error)
                .replace(/(key|token|authorization)\\s*[:=]\\s*\\S+/gi, '$1=[redacted]')
                .slice(0, 240);
            if (typeof ctx?.safeSend === 'function' && ctx?.isOwner && !ctx?.isGroup) {
                return ctx.safeSend({ text: '⚠️ Research failed: ' + safe });
            }
            throw error;
        }
    }
};
