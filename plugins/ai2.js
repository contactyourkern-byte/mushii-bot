'use strict';

const axios = require('axios');
const { fmt } = require('../lib/theme');

// ── Provider order for auto-replies: Gemini primary, Groq backup, then public fallbacks.

async function callGemini(prompt, timeoutMs = 4000, maxOutputTokens = 450) {
    const key = String(process.env.GEMINI_API_KEY || '').trim();
    if (!key) return null;

    const model = String(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
    try {
        const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/' +
                encodeURIComponent(model) + ':generateContent',
            {
                contents: [{ role: 'user', parts: [{ text: String(prompt || '').slice(0, 7000) }] }],
                generationConfig: {
                    thinkingConfig: { thinkingLevel: 'low' },
                    maxOutputTokens
                }
            },
            {
                headers: {
                    'x-goog-api-key': key,
                    'Content-Type': 'application/json'
                },
                timeout: timeoutMs
            }
        );
        const parts = response.data?.candidates?.[0]?.content?.parts;
        const answer = Array.isArray(parts)
            ? parts.map(part => typeof part.text === 'string' ? part.text : '').join('').trim()
            : '';
        return answer || null;
    } catch (error) {
        const status = error.response?.status;
        console.warn('[AI] Gemini unavailable' + (status ? ' (HTTP ' + status + ')' : '') + '; trying Groq.');
        return null;
    }
}

async function callGroq(prompt, timeoutMs = 3500, maxTokens = 450) {
    const key = String(process.env.GROQ_API_KEY || '').trim();
    if (!key) return null;

    const model = String(process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim();
    const request = {
        model,
        messages: [{ role: 'user', content: String(prompt || '').slice(0, 7000) }],
        temperature: 0.45,
        max_completion_tokens: maxTokens,
        include_reasoning: false
    };
    if (model.startsWith('openai/gpt-oss-')) request.reasoning_effort = 'low';

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            request,
            {
                headers: {
                    Authorization: 'Bearer ' + key,
                    'Content-Type': 'application/json'
                },
                timeout: timeoutMs
            }
        );
        const answer = response.data?.choices?.[0]?.message?.content;
        return typeof answer === 'string' && answer.trim() ? answer.trim() : null;
    } catch (error) {
        const status = error.response?.status;
        console.warn('[AI] Groq unavailable' + (status ? ' (HTTP ' + status + ')' : '') + '; trying another provider.');
        return null;
    }
}


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
                && !/^(?:⚠️\s*)?(?:AI servers are busy|service unavailable|temporarily unavailable|rate limit)/i.test(value)) {
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

async function askAIFast(prompt, timeoutMs = 9000) {
    const input = String(prompt || '').slice(0, 7000);
    const deadline = Date.now() + Math.max(500, timeoutMs);
    const providers = [
        { name: 'Gemini', enabled: Boolean(String(process.env.GEMINI_API_KEY || '').trim()), budget: 4000, run: ms => callGemini(input, ms, 450) },
        { name: 'Groq', enabled: Boolean(String(process.env.GROQ_API_KEY || '').trim()), budget: 3500, run: ms => callGroq(input, ms, 450) },
        { name: 'ch.at', enabled: true, budget: 900, run: ms => callChAt(input, 1, ms) },
        { name: 'Pollinations', enabled: true, budget: 900, run: ms => callPollinations(input, ms) }
    ];

    for (const provider of providers) {
        if (!provider.enabled) continue;
        const remaining = deadline - Date.now();
        if (remaining < 250) break;
        const providerTimeout = Math.max(200, Math.min(provider.budget, remaining - 100));
        try {
            const answer = await provider.run(providerTimeout);
            if (typeof answer === 'string' && answer.trim().length > 2
                && !/^(?:⚠️\s*)?(?:AI servers are busy|service unavailable|temporarily unavailable|rate limit)/i.test(answer.trim())) {
                return answer.trim();
            }
        } catch (error) {
            console.warn('[AI] ' + provider.name + ' failed; continuing to next provider: ' + error.message);
        }
    }
    return null;
}

async function askAI(prompt) {
    const result = await askAIFast(prompt, 12000);
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
module.exports.callGemini = callGemini;
module.exports.callGroq = callGroq;
module.exports.firstAvailable = firstAvailable;
