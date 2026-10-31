'use strict';

const axios = require('axios');
const { fmt } = require('../lib/theme');

// ── Dead as of 2026-06 (removed): siputzx (all endpoints), ryzendesu (bot-protected),
//    giftedtech (ENOTFOUND), lance-frank (dead), letmegpt (400), paxsenix (ENOTFOUND)
// ── Live: ch.at (~400ms), pollinations.ai text (~3-5s)

async function callChAt(prompt, retries = 3, timeoutMs = 7000) {
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await axios.post('https://ch.at/api/chat',
                { message: prompt },
                { headers: { 'Content-Type': 'application/json', 'User-Agent': 'MUSHII-Bot/2.0' }, timeout: timeoutMs }
            );
            const t = res.data?.answer || res.data?.reply || res.data?.message || res.data?.response || res.data?.result;
            if (t && String(t).trim().length > 2) return String(t).trim();
        } catch {}
        if (i < retries) await new Promise(r => setTimeout(r, 500 * i));
    }
    return null;
}

async function callPollinations(prompt, timeoutMs = 7000) {
    try {
        const res = await axios.get(
            'https://text.pollinations.ai/' + encodeURIComponent(String(prompt || '').slice(0, 3500)) +
            '?model=openai&seed=' + (Date.now() % 9999),
            { timeout: timeoutMs }
        );
        return typeof res.data === 'string' ? res.data.trim() : null;
    } catch { return null; }
}


async function callOpenRouter(prompt, timeoutMs = 7000, maxTokens = 450) {
    const key = String(process.env.OPENROUTER_API_KEY || '').trim();
    if (!key) return null;
    const model = process.env.OPENROUTER_MODEL || 'openrouter/free';
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model,
            messages: [{ role: 'user', content: String(prompt).slice(0, 7000) }],
            temperature: 0.45,
            max_tokens: maxTokens
        }, {
            headers: {
                Authorization: 'Bearer ' + key,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/contactyourkern-byte/mushii-bot',
                'X-Title': 'MUSHII AI Auto Reply'
            },
            timeout: timeoutMs
        });
        const answer = response.data?.choices?.[0]?.message?.content;
        return typeof answer === 'string' && answer.trim() ? answer.trim() : null;
    } catch (error) {
        console.warn('[AI] OpenRouter free model unavailable; trying no-key providers:', error.message);
        return null;
    }
}

async function firstAvailable(tasks, timeoutMs = 7000) {
    let timer;
    const providers = Promise.any(tasks.map(task => Promise.resolve()
        .then(task)
        .then(answer => {
            const value = typeof answer === 'string' ? answer.trim() : '';
            if (value.length > 2
                && !/^(?:⚠️\\s*)?(?:AI servers are busy|service unavailable|temporarily unavailable|rate limit)/i.test(value)) {
                return value;
            }
            throw new Error('Provider returned no usable answer');
        })));
    const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
        return await Promise.race([providers, timeout]);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function askAIFast(prompt, timeoutMs = 7000) {
    const input = String(prompt || '').slice(0, 7000);
    return firstAvailable([
        () => callChAt(input, 1, timeoutMs),
        () => callOpenRouter(input, timeoutMs, 450),
        () => callPollinations(input, timeoutMs)
    ], timeoutMs);
}

async function askAI(prompt) {
    const openRouterAnswer = await callOpenRouter(prompt);
    if (openRouterAnswer) return openRouterAnswer;
    let pollinationsTriggered = false;
    const pollinationsFallback = new Promise(resolve => {
        setTimeout(() => {
            pollinationsTriggered = true;
            callPollinations(prompt).then(resolve).catch(() => resolve(null));
        }, 200);
    });

    const result = await Promise.race([
        callChAt(prompt),
        pollinationsFallback,
        new Promise(resolve => setTimeout(() => resolve(null), 22000)),
    ]);
    return result || '⚠️ AI servers are busy right now. Please try again in a moment.';
}

function buildPlugin(cmds, label, systemHint) {
    return {
        commands:    cmds,
        description: `Ask ${label} a question`,
        usage:       `.${cmds[0]} <question>`,
        permission:  'public',
        group:       true,
        private:     true,

        run: async (sock, message, args, ctx) => {
            const { jid, contextInfo } = ctx;
            const query = args.join(' ').trim();
            if (!query) {
                return sock.sendMessage(jid, {
                    text: fmt(`❌ *Usage:* \`.${cmds[0]} <question>\`\n\nExample: \`.${cmds[0]} What is quantum computing?\``),
                    contextInfo
                }, { quoted: message });
            }
            await sock.sendPresenceUpdate('composing', jid);
            const prompt = systemHint ? `[${systemHint}] ${query}` : query;
            const answer = await askAI(prompt);
            await sock.sendMessage(jid, {
                text: fmt(`🤖 *${label}*\n\n❓ *Q:* ${query}\n\n💬 *A:* ${answer}`),
                contextInfo
            }, { quoted: message });
        }
    };
}

const plugins = [
    buildPlugin(['chatat', 'chat'],      'ch.at AI',      null),
    buildPlugin(['chatai'],               'MUSHII Chat AI', null),
    buildPlugin(['gemini', 'bard'],       'Gemini AI',     'Answer as a knowledgeable AI assistant'),
    buildPlugin(['giftedai'],             'Gifted AI',     'Be creative and helpful'),
    buildPlugin(['gpt4', 'gpt-4'],        'GPT-4',         'Provide a detailed expert answer'),
    buildPlugin(['gpt4o', 'gpt-4o'],      'GPT-4o',        'Provide a detailed expert answer'),
    buildPlugin(['gpt4o-mini'],           'GPT-4o Mini',   'Be concise and helpful'),
    buildPlugin(['openai'],               'OpenAI',        'Provide a detailed expert answer'),
    buildPlugin(['venice'],               'Venice AI',     'Be creative and insightful'),
    buildPlugin(['letmegpt'],             'LetMeGPT',      null),
];

module.exports = plugins;
module.exports.askAI = askAI;
module.exports.askAIFast = askAIFast;
module.exports.firstAvailable = firstAvailable;
