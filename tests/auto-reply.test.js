'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const axios = require('axios');

const {
    COOLDOWN_MS,
    HISTORY_LIMIT,
    buildAutoReplyPrompt,
    createAutoReply,
    createConversationHistory,
    isCommandMessage,
    parseAIReply
} = require('../lib/auto-reply');
const { __test: awayTest } = require('../plugins/away');
const { plugins: loadedPlugins } = require('../handler');
const { firstAvailable, askAIFast } = require('../plugins/ai2');

async function createStatePath(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mushii-away-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return path.join(directory, 'away.json');
}

test('uses a 15-second per-contact cooldown and persists it across restarts', async t => {
    const filePath = await createStatePath(t);
    let timestamp = 1_000_000;
    const first = createAutoReply({
        filePath,
        now: () => timestamp,
        generateReply: async () => 'Muraho neza. Nishimiye kukumva.'
    });
    first.setEnabled(true);
    const sent = [];
    const message = {
        jid: 'contact@s.whatsapp.net',
        sender: 'contact@s.whatsapp.net',
        text: 'Muraho',
        send: async content => {
            sent.push(content.text);
            return { key: { id: 'reply-1' } };
        }
    };

    assert.equal(COOLDOWN_MS, 15_000);
    assert.equal(await first.replyToMessage(message), true);
    assert.equal(await first.replyToMessage(message), false);
    assert.equal(sent.length, 1);

    const afterRestart = createAutoReply({
        filePath,
        now: () => timestamp,
        generateReply: async () => 'Mwaramutse.'
    });
    assert.equal(await afterRestart.replyToMessage(message), false);
    timestamp += COOLDOWN_MS - 1;
    assert.equal(await afterRestart.replyToMessage(message), false);
    timestamp += 1;
    assert.equal(await afterRestart.replyToMessage(message), true);
    assert.equal(sent.length, 2);
});

test('only accepts eligible private contacts and excludes groups, owner and protocol messages', async t => {
    const filePath = await createStatePath(t);
    const autoReply = createAutoReply({ filePath, generateReply: async () => 'Muraho.' });
    autoReply.setEnabled(true);
    let sendCount = 0;
    const send = async () => {
        sendCount++;
        return { key: { id: String(sendCount) } };
    };

    for (const context of [
        { jid: '123@g.us', isGroup: true },
        { jid: 'status@broadcast' },
        { jid: 'news@newsletter' },
        { jid: 'owner@s.whatsapp.net', isOwner: true },
        { jid: 'bot@s.whatsapp.net', fromMe: true },
        { jid: 'contact@s.whatsapp.net', isProtocolMessage: true }
    ]) {
        assert.equal(await autoReply.replyToMessage({ ...context, send }), false);
    }
    assert.equal(sendCount, 0);
});

test('conversation history is private per contact, bounded, expires, and ignores protected content', () => {
    let timestamp = 10_000;
    const history = createConversationHistory({ now: () => timestamp });
    assert.equal(history.add({ jid: 'a@s.whatsapp.net', role: 'user', text: 'Nitwa Aline.' }), true);
    assert.equal(history.add({ jid: 'b@s.whatsapp.net', role: 'user', text: 'Nitwa Keza.' }), true);
    assert.equal(history.get('a@s.whatsapp.net')[0].text, 'Nitwa Aline.');
    assert.equal(history.get('b@s.whatsapp.net')[0].text, 'Nitwa Keza.');

    for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
        timestamp += 6000;
        history.add({ jid: 'a@s.whatsapp.net', role: 'user', text: 'Ubutumwa ' + i, at: timestamp });
    }
    assert.equal(history.get('a@s.whatsapp.net').length, HISTORY_LIMIT);

    assert.equal(history.recordMessage({
        key: { remoteJid: '123@g.us', id: 'group' },
        message: { conversation: 'private content should not be stored' }
    }, 'private content should not be stored'), false);
    assert.equal(history.recordMessage({
        key: { remoteJid: 'a@s.whatsapp.net', id: 'view-once' },
        message: { viewOnceMessageV2: { message: { imageMessage: {} } } }
    }, 'view-once image'), false);
    assert.equal(history.get('a@s.whatsapp.net').some(item => item.text.includes('private content')), false);

    timestamp += 12 * 60 * 60 * 1000 + 1;
    assert.deepEqual(history.get('a@s.whatsapp.net'), []);
});

test('history captures both received messages and the owner’s manual private replies', () => {
    const history = createConversationHistory();
    const incoming = {
        key: { remoteJid: 'contact@s.whatsapp.net', id: 'in-1', fromMe: false },
        message: { conversation: 'Nitwa Aline.' }
    };
    const outgoing = {
        key: { remoteJid: 'contact@s.whatsapp.net', id: 'out-1', fromMe: true },
        message: { conversation: 'Muraho Aline, nagufasha iki?' }
    };
    assert.equal(history.recordMessage(incoming, 'Nitwa Aline.'), true);
    assert.equal(history.recordMessage(outgoing, 'Muraho Aline, nagufasha iki?'), true);
    assert.deepEqual(history.get('contact@s.whatsapp.net').map(item => item.role), ['user', 'outgoing']);
    assert.equal(history.recordMessage(outgoing, 'Muraho Aline, nagufasha iki?'), false);
});

test('prompt uses prior chat context, asks for polished Kinyarwanda, and supports manual handoff', () => {
    const prompt = buildAutoReplyPrompt('Ese uracyabyibuka?', [
        { role: 'user', text: 'Nitwa Aline kandi mba i Huye.' },
        { role: 'outgoing', text: 'Muraho Aline. Wavuze ko uba i Huye.' },
        { role: 'user', text: 'Ese uracyabyibuka?' }
    ]);
    assert.match(prompt, /clear, correct, polished, natural Kinyarwanda/);
    assert.match(prompt, /Aline kandi mba i Huye/);
    assert.match(prompt, /MUSHII AI/);
    assert.match(prompt, /"action":"manual"/);
    assert.doesNotMatch(prompt, /Latest message[\s\S]*Latest message/);
    assert.doesNotMatch(prompt, /How can I help you today\?/);
});

test('parses structured replies and routes sensitive matters to the human owner', () => {
    assert.deepEqual(parseAIReply('{"action":"reply","reply":"Muraho neza."}'), {
        action: 'reply',
        reply: 'Muraho neza.'
    });
    assert.deepEqual(parseAIReply('{"action":"manual","reason":"Asaba nyirayo."}'), {
        action: 'manual',
        reason: 'Asaba nyirayo.'
    });
    assert.deepEqual(parseAIReply('MANUAL'), { action: 'manual', reason: '' });
    assert.equal(parseAIReply('⚠️ AI servers are busy right now.'), null);
});

test('auto reply supplies recent history to the model and remembers its sent reply', async t => {
    const filePath = await createStatePath(t);
    let capturedHistory = [];
    const autoReply = createAutoReply({
        filePath,
        generateReply: async (text, jid, history) => {
            capturedHistory = history;
            return { action: 'reply', reply: 'Ndabyibuka, Aline. Wambwiye ko uba i Huye.' };
        }
    });
    autoReply.setEnabled(true);
    autoReply.recordConversationMessage({
        key: { remoteJid: 'contact@s.whatsapp.net', id: 'old-in', fromMe: false },
        message: { conversation: 'Nitwa Aline kandi mba i Huye.' }
    }, 'Nitwa Aline kandi mba i Huye.');

    const sent = [];
    const result = await autoReply.replyToMessage({
        jid: 'contact@s.whatsapp.net',
        sender: 'contact@s.whatsapp.net',
        text: 'Ese uracyabyibuka?',
        send: async content => {
            sent.push(content.text);
            return { key: { id: 'ai-reply-1' } };
        }
    });
    assert.equal(result, true);
    assert.equal(capturedHistory[0].text, 'Nitwa Aline kandi mba i Huye.');
    assert.match(sent[0], /Aline/);
    assert.equal(autoReply.getConversationHistory('contact@s.whatsapp.net').at(-1).role, 'outgoing');
});

test('manual handoff stays silent to the contact and notifies the owner', async t => {
    const filePath = await createStatePath(t);
    const autoReply = createAutoReply({
        filePath,
        generateReply: async () => ({ action: 'manual', reason: 'Asaba kwishyura.' })
    });
    autoReply.setEnabled(true);
    let contactMessages = 0;
    const notices = [];

    const context = {
        jid: 'contact@s.whatsapp.net',
        sender: 'contact@s.whatsapp.net',
        text: 'Ndashaka ko nyirayo ansubiza ku bijyanye no kwishyura.',
        send: async () => {
            contactMessages++;
            return { key: { id: 'should-not-send' } };
        },
        notifyOwner: async detail => notices.push(detail)
    };

    assert.equal(await autoReply.replyToMessage(context), false);
    assert.equal(contactMessages, 0);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].reason, 'Asaba kwishyura.');
    assert.equal(await autoReply.replyToMessage(context), false);
    assert.equal(notices.length, 1);
});

test('failed generation releases cooldown so a later message can be answered', async t => {
    const filePath = await createStatePath(t);
    let calls = 0;
    const autoReply = createAutoReply({
        filePath,
        generateReply: async () => {
            calls++;
            return calls === 1 ? null : { action: 'reply', reply: 'Muraho.' };
        }
    });
    autoReply.setEnabled(true);
    const message = {
        jid: 'contact@s.whatsapp.net',
        text: 'Muraho',
        send: async () => ({ key: { id: 'reply-ok' } })
    };

    assert.equal(await autoReply.replyToMessage(message), false);
    assert.equal(await autoReply.replyToMessage(message), true);
});

test('away command remains owner-only and off clears temporary chat memory', async t => {
    const filePath = await createStatePath(t);
    const autoReply = createAutoReply({ filePath });
    autoReply.setEnabled(false);
    const away = awayTest.createAwayPlugin(autoReply);
    const replies = [];
    const context = { isOwner: false, reply: async text => replies.push(text) };

    await away.run({}, {}, ['on'], context);
    assert.equal(autoReply.isEnabled(), false);
    assert.match(replies.pop(), /Only the bot owner/);

    context.isOwner = true;
    await away.run({}, {}, ['on'], context);
    assert.equal(autoReply.isEnabled(), true);
    assert.match(replies.pop(), /15-second per-contact cooldown/);

    away.recordConversationMessage({
        key: { remoteJid: 'contact@s.whatsapp.net', id: 'memory', fromMe: false },
        message: { conversation: 'Private chat.' }
    }, 'Private chat.');
    assert.equal(autoReply.getConversationHistory('contact@s.whatsapp.net').length, 1);

    await away.run({}, {}, ['off'], context);
    assert.equal(autoReply.isEnabled(), false);
    assert.deepEqual(autoReply.getConversationHistory('contact@s.whatsapp.net'), []);
    assert.match(replies.pop(), /memory has been cleared/);
});

test('registered commands are not treated as conversation prompts', () => {
    const plugins = [{ commands: ['menu', 'play', 'joke'] }];
    assert.equal(isCommandMessage('.menu', '.', plugins), true);
    assert.equal(isCommandMessage('!play music', '.,!', plugins), true);
    assert.equal(isCommandMessage('hey MUSHII, tell me something', '.', plugins), true);
    assert.equal(isCommandMessage('Muraho neza', '.', plugins), false);
});


test('keeps all away and scheduled auto-reply commands registered', () => {
    const commands = new Set(loadedPlugins.flatMap(plugin => plugin.commands || []));
    for (const command of ['away', 'awaymute', 'awayunmute', 'awaymuted', 'autoreply', 'awaymsg', 'setaway', 'awayoff']) {
        assert.ok(commands.has(command), 'Expected auto-reply command .' + command + ' to remain registered');
    }
});


test('starts typing before generating the first AI reply and stops after sending', async t => {
    const filePath = await createStatePath(t);
    const events = [];
    const autoReply = createAutoReply({
        filePath,
        generateReply: async () => {
            events.push('generate');
            return { action: 'reply', reply: 'Muraho neza.' };
        }
    });
    autoReply.setEnabled(true);
    const sent = await autoReply.replyToMessage({
        jid: 'contact@s.whatsapp.net',
        text: 'Muraho',
        onStart: async () => events.push('typing'),
        onFinish: async () => events.push('paused'),
        send: async () => {
            events.push('send');
            return { key: { id: 'reply' } };
        }
    });
    assert.equal(sent, true);
    assert.deepEqual(events, ['typing', 'generate', 'send', 'paused']);
});

test('starts the cooldown only after the generated reply is sent', async t => {
    const filePath = await createStatePath(t);
    let timestamp = 1000;
    let generationCount = 0;
    const autoReply = createAutoReply({
        filePath,
        now: () => timestamp,
        generateReply: async () => {
            generationCount++;
            timestamp += 20_000;
            return { action: 'reply', reply: 'Igisubizo.' };
        }
    });
    autoReply.setEnabled(true);
    const message = {
        jid: 'contact@s.whatsapp.net',
        text: 'Muraho',
        send: async () => ({ key: { id: 'reply-' + generationCount } })
    };

    assert.equal(await autoReply.replyToMessage(message), true);
    assert.equal(await autoReply.replyToMessage(message), false);
    assert.equal(generationCount, 1);
});

test('uses the first valid AI provider answer instead of waiting for slower providers', async () => {
    const started = Date.now();
    const result = await firstAvailable([
        async () => {
            await new Promise(resolve => setTimeout(resolve, 15));
            return null;
        },
        async () => {
            await new Promise(resolve => setTimeout(resolve, 25));
            return 'fast valid answer';
        },
        async () => {
            await new Promise(resolve => setTimeout(resolve, 100));
            return 'slow answer';
        }
    ], 500);
    assert.equal(result, 'fast valid answer');
    assert.ok(Date.now() - started < 90, 'first valid answer should win without waiting for slow providers');
});

test('skips generic AI provider busy placeholders and continues to the next provider', async () => {
    const result = await firstAvailable([
        async () => '⚠️ AI servers are busy right now. Please try again in a moment.',
        async () => 'Igisubizo cyiza.'
    ], 500);
    assert.equal(result, 'Igisubizo cyiza.');
});


test('uses Gemini as the primary provider when both AI keys are configured', async () => {
    const originalPost = axios.post;
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    const previousGroqKey = process.env.GROQ_API_KEY;
    const calls = [];
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.GROQ_API_KEY = 'test-groq-key';
    axios.post = async (url, body, options) => {
        calls.push({ url, body, options });
        return { data: { candidates: [{ content: { parts: [{ text: 'Gemini answer.' }] } }] } };
    };

    try {
        const answer = await askAIFast('Hello', 5000);
        assert.equal(answer, 'Gemini answer.');
        assert.equal(calls.length, 1);
        assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
        assert.match(calls[0].url, /gemini-3\.5-flash-lite/);
        assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-gemini-key');
        assert.equal(calls[0].body.generationConfig.maxOutputTokens, 450);
        assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    } finally {
        axios.post = originalPost;
        if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousGeminiKey;
        if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = previousGroqKey;
    }
});

test('falls back to Groq when Gemini returns a rate limit', async () => {
    const originalPost = axios.post;
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    const previousGroqKey = process.env.GROQ_API_KEY;
    const calls = [];
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.GROQ_API_KEY = 'test-groq-key';
    axios.post = async (url, body, options) => {
        calls.push({ url, body, options });
        if (url.includes('generativelanguage.googleapis.com')) {
            const error = new Error('rate limited');
            error.response = { status: 429 };
            throw error;
        }
        if (url.includes('api.groq.com')) {
            return { data: { choices: [{ message: { content: 'Groq fallback answer.' } }] } };
        }
        throw new Error('Unexpected provider URL: ' + url);
    };

    try {
        const answer = await askAIFast('Hello', 5000);
        assert.equal(answer, 'Groq fallback answer.');
        assert.equal(calls.length, 2);
        assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
        assert.match(calls[1].url, /api\.groq\.com\/openai\/v1\/chat\/completions/);
        assert.equal(calls[1].options.headers.Authorization, 'Bearer test-groq-key');
        assert.equal(calls[1].body.model, 'openai/gpt-oss-20b');
        assert.equal(calls[1].body.include_reasoning, false);
    } finally {
        axios.post = originalPost;
        if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousGeminiKey;
        if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = previousGroqKey;
    }
});


test('mutes one contact only, matches phone numbers to WhatsApp JIDs, and persists across restarts', async t => {
    const filePath = await createStatePath(t);
    const autoReply = createAutoReply({
        filePath,
        generateReply: async () => ({ action: 'reply', reply: 'Muraho neza.' })
    });
    autoReply.setEnabled(true);
    assert.equal(autoReply.muteContact('250785562525'), true);
    assert.equal(autoReply.isContactMuted({ sender: '250785562525@s.whatsapp.net' }), true);
    assert.equal(autoReply.isContactMuted({ sender: 'another@s.whatsapp.net' }), false);

    const mutedSent = await autoReply.replyToMessage({
        jid: '250785562525@s.whatsapp.net',
        sender: '250785562525@s.whatsapp.net',
        senderNumber: '250785562525',
        text: 'Muraho',
        send: async () => ({ key: { id: 'muted-reply' } })
    });
    assert.equal(mutedSent, false);

    const otherSent = await autoReply.replyToMessage({
        jid: '250788888888@s.whatsapp.net',
        sender: '250788888888@s.whatsapp.net',
        senderNumber: '250788888888',
        text: 'Muraho',
        send: async () => ({ key: { id: 'other-reply' } })
    });
    assert.equal(otherSent, true);

    const afterRestart = createAutoReply({ filePath, generateReply: async () => 'Muraho.' });
    assert.equal(afterRestart.isContactMuted({ sender: '250785562525@s.whatsapp.net' }), true);
    assert.equal(afterRestart.unmuteContact('250785562525'), true);
    assert.equal(afterRestart.isContactMuted({ sender: '250785562525@s.whatsapp.net' }), false);
    assert.equal(afterRestart.getMutedContacts().length, 0);
});

test('rejects invalid per-contact mute identifiers', async t => {
    const autoReply = createAutoReply({ filePath: await createStatePath(t) });
    assert.throws(() => autoReply.muteContact('123'), /valid WhatsApp phone number or private JID/);
    assert.throws(() => autoReply.unmuteContact(''), /valid WhatsApp phone number or private JID/);
});

test('registers owner-only per-contact away mute commands', () => {
    const commands = new Set(loadedPlugins.flatMap(plugin => plugin.commands || []));
    for (const command of ['away', 'awaymute', 'awayunmute', 'awaymuted']) {
        assert.ok(commands.has(command), 'Expected per-contact Away command .' + command + ' to be registered');
    }
});
