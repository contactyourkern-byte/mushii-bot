'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    extractMessageText,
    safeSend,
    handleMessages,
    installNewsletterForwarding,
    plugins,
} = require('../handler');
const {
    isDuplicateMessage,
    rememberMessageIfContent,
} = require('../lib/message-gate');
const {
    UNDECRYPTABLE_LOG_THRESHOLD,
    trackUndecryptableMessage,
} = require('../lib/session-recovery');
const { containsViewOnceWrapper } = require('../lib/message-utils');
const {
    createPrivateMessageCache,
    installPrivateDeletionNotifications,
} = require('../lib/deletion-notifications');
const stickerSearch = require('../plugins/stickersearch');
const { __test: greetingLimit } = require('../plugins/greet');
const availableCommands = new Set(plugins.flatMap(plugin => plugin.commands || []));

function makeGreetingHarness(options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mushii-greeting-test-'));
    const limiter = greetingLimit.createReplyLimiter({
        filePath: path.join(directory, 'reply-limits.json'),
        now: options.now,
        logError: error => { throw error; },
    });
    const sent = [];
    const errors = [];
    const greet = greetingLimit.createAutoGreeting({
        limiter,
        random: options.random || (() => 0),
        enabled: () => true,
        logError: error => errors.push(error),
    });
    return {
        directory,
        limiter,
        sent,
        errors,
        greet,
        sock: {
            sendMessage: async (jid, content, sendOptions) => {
                sent.push({ jid, content, sendOptions });
                return options.sendResult ? options.sendResult(sent.length) : { key: { id: `greet-${sent.length}` } };
            },
        },
        cleanup() {
            fs.rmSync(directory, { recursive: true, force: true });
        },
    };
}

function incomingPrivateMessage(jid = '254700000000@s.whatsapp.net', fromMe = false) {
    return { key: { id: 'incoming', remoteJid: jid, fromMe }, message: { conversation: 'hi' } };
}

test('extracts commands from nested WhatsApp wrappers', () => {
    const wrapped = {
        ephemeralMessage: {
            message: {
                deviceSentMessage: {
                    message: {
                        extendedTextMessage: { text: '\uFEFF .ping  ' },
                    },
                },
            },
        },
    };

    assert.equal(extractMessageText(wrapped), '.ping');
});

test('extracts interactive response text without a live WhatsApp connection', () => {
    const message = {
        interactiveResponseMessage: {
            nativeFlowResponseMessage: {
                paramsJson: '{"id":"alive"}',
            },
        },
    };

    assert.equal(extractMessageText(message), '{"id":"alive"}');
});

test('keeps nested View Once messages opaque', () => {
    const protectedMessage = {
        ephemeralMessage: {
            message: {
                viewOnceMessageV2: {
                    message: { imageMessage: { caption: '.menu' } }
                }
            }
        }
    };

    assert.equal(containsViewOnceWrapper(protectedMessage), true);
    assert.equal(extractMessageText(protectedMessage), '');
});

test('does not add newsletter attribution to plugin sends', async () => {
    const sent = [];
    const sock = {
        sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'sent' } }; },
    };
    installNewsletterForwarding(sock);
    await sock.sendMessage('123@g.us', { text: 'group reply' });
    await sock.sendMessage('254700000000@s.whatsapp.net', { image: Buffer.from('image'), caption: 'inbox reply' });
    await sock.sendMessage('123@g.us', { delete: { remoteJid: '123@g.us', id: 'old' } });

    assert.equal(sent[0].content.contextInfo, undefined);
    assert.equal(sent[1].content.contextInfo, undefined);
    assert.equal(sent[2].content.contextInfo, undefined);
});

test('sticker search explains when its API key is not configured', async () => {
    const previousKey = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const sent = [];
    try {
        await stickerSearch.run({
            sendMessage: async (jid, content, options) => sent.push({ jid, content, options }),
        }, { key: { id: 'sticker-search' } }, ['cat'], {
            sender: '123@s.whatsapp.net',
            contextInfo: { test: true },
        });
    } finally {
        if (previousKey === undefined) delete process.env.GOOGLE_API_KEY;
        else process.env.GOOGLE_API_KEY = previousKey;
    }

    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, '123@s.whatsapp.net');
    assert.match(sent[0].content.text, /not configured/i);
    assert.match(sent[0].content.text, /GOOGLE_API_KEY/);
});

test('greets a private contact with English, Kinyarwanda, and registered commands', async () => {
    const harness = makeGreetingHarness();
    try {
        await harness.greet(harness.sock, incomingPrivateMessage(), 'hi', {
            jid: '254700000000@s.whatsapp.net',
            isGroup: false,
            availableCommands,
        });

        assert.equal(harness.sent.length, 1);
        const greeting = harness.sent[0].content.text;
        assert.match(greeting, /💜 Heyyy! Welcome to MUSHII!/);
        assert.match(greeting, /😂 Bite se\? What's up\?/);
        assert.match(greeting, /🎮 Bored\? Let's have some fun!/);
        assert.match(greeting, /Nta kurambirwa hano/);
        assert.match(greeting, /Available commands:/);
        assert.match(greeting, /\.menu - View the full MUSHII menu/);
        assert.match(greeting, /MUSHII — Your Entertainment Bestie! 💜$/);
        const advertised = [...greeting.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map(match => match[1]);
        assert.ok(advertised.every(command => availableCommands.has(command)));
    } finally {
        harness.cleanup();
    }
});

test('varies greeting text between replies', () => {
    const first = greetingLimit.buildGreeting(availableCommands, () => 0);
    const second = greetingLimit.buildGreeting(availableCommands, () => 0.5);

    assert.notEqual(first, second);
    assert.match(first, /Nta kurambirwa hano/);
    assert.match(second, /twishimane/);
});

test('advertises only commands present in the loaded plugin registry', () => {
    assert.ok(availableCommands.has('menu'), 'the .menu plugin command must be registered');
    const greeting = greetingLimit.buildGreeting(availableCommands, () => 0);
    const advertised = [...greeting.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map(match => match[1]);

    assert.ok(advertised.includes('menu'));
    assert.ok(advertised.every(command => availableCommands.has(command)));
    for (const command of ['joke', 'truth', 'dare', 'riddle', 'ship', 'play']) {
        assert.equal(advertised.includes(command), availableCommands.has(command));
    }
});

test('allows at most three successful replies to concurrent private messages', async () => {
    let releaseSends;
    const sendGate = new Promise(resolve => { releaseSends = resolve; });
    let attempts = 0;
    const harness = makeGreetingHarness();
    harness.sock.sendMessage = async (jid, content) => {
        attempts++;
        await sendGate;
        harness.sent.push({ jid, content });
        return { key: { id: `greet-${attempts}` } };
    };

    try {
        const replies = Array.from({ length: 5 }, (_, index) =>
            harness.greet(harness.sock, incomingPrivateMessage(`25470000000${index}@s.whatsapp.net`), 'hello', {
                jid: 'same-contact@s.whatsapp.net',
                isGroup: false,
                availableCommands,
            })
        );
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(attempts, 3);
        releaseSends();
        await Promise.all(replies);
        assert.equal(harness.limiter.recent('same-contact@s.whatsapp.net').length, 3);
    } finally {
        releaseSends();
        harness.cleanup();
    }
});

test('failed automatic sends do not count toward the rolling limit', async () => {
    const harness = makeGreetingHarness({ sendResult: count => count === 1 ? null : { key: { id: 'sent' } } });
    const message = incomingPrivateMessage();
    const context = { jid: message.key.remoteJid, isGroup: false, availableCommands };
    try {
        await harness.greet(harness.sock, message, 'hello', context);
        assert.equal(harness.limiter.recent(context.jid).length, 0);
        await harness.greet(harness.sock, message, 'hello', context);
        assert.equal(harness.limiter.recent(context.jid).length, 1);
    } finally {
        harness.cleanup();
    }
});

test('reply limits persist across limiter restarts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mushii-greeting-persist-'));
    const filePath = path.join(directory, 'reply-limits.json');
    let now = 100000000;
    const createLimiter = () => greetingLimit.createReplyLimiter({
        filePath,
        now: () => now,
        logError: error => { throw error; },
    });
    try {
        const first = createLimiter();
        for (let i = 0; i < 2; i++) {
            const reservation = first.reserve('contact');
            assert.ok(reservation);
            assert.equal(first.commit(reservation), true);
        }

        const afterRestart = createLimiter();
        const third = afterRestart.reserve('contact');
        assert.ok(third);
        afterRestart.commit(third);
        assert.equal(afterRestart.reserve('contact'), null);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('allows automatic replies again after old timestamps expire', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mushii-greeting-expiry-'));
    const filePath = path.join(directory, 'reply-limits.json');
    let now = 100000000;
    const createLimiter = () => greetingLimit.createReplyLimiter({
        filePath,
        now: () => now,
        logError: error => { throw error; },
    });
    try {
        const first = createLimiter();
        for (let i = 0; i < 3; i++) first.commit(first.reserve('contact'));
        assert.equal(first.reserve('contact'), null);

        now += greetingLimit.REPLY_WINDOW_MS + 1;
        const afterExpiry = createLimiter();
        assert.ok(afterExpiry.reserve('contact'));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('does not greet groups, broadcasts, newsletters, or owner messages', async () => {
    const harness = makeGreetingHarness();
    const contexts = [
        { jid: '12345@g.us', isGroup: true },
        { jid: 'status@broadcast', isGroup: false },
        { jid: 'newsletter-1@newsletter', isGroup: false },
        { jid: 'owner@s.whatsapp.net', isGroup: false, isOwner: true },
    ];
    try {
        for (const context of contexts) {
            await harness.greet(harness.sock, incomingPrivateMessage(context.jid), 'hello', {
                ...context,
                availableCommands,
            });
        }
        await harness.greet(harness.sock, incomingPrivateMessage('owner@s.whatsapp.net', true), 'hello', {
            jid: 'owner@s.whatsapp.net',
            isGroup: false,
            availableCommands,
        });
        assert.equal(harness.sent.length, 0);
    } finally {
        harness.cleanup();
    }
});

function makeDeletionHarness(options = {}) {
    const ev = new EventEmitter();
    const sent = [];
    const sock = {
        ev,
        sendMessage: async (jid, content) => sent.push({ jid, content }),
    };
    const cache = createPrivateMessageCache({
        now: options.now,
        getOwnerJid: () => '999@s.whatsapp.net',
    });
    cache.bind(ev);
    installPrivateDeletionNotifications(sock, () => '999@s.whatsapp.net', {
        now: options.now,
        loadMessage: (jid, id) => cache.loadMessage(jid, id),
        deleteMessage: (jid, id) => cache.deleteMessage(jid, id),
        logError: error => { throw error; },
    });

    return { ev, sent, cache };
}

async function flushDeletionEvents() {
    await new Promise(resolve => setImmediate(resolve));
}

function privateMessage(id, message, overrides = {}) {
    return {
        key: {
            remoteJid: '254700000000@s.whatsapp.net',
            id,
            fromMe: false,
            ...overrides,
        },
        message,
        pushName: 'Contact',
    };
}

test('forwards a deleted private text message to the owner', async () => {
    const { ev, sent, cache } = makeDeletionHarness({
        now: () => Date.UTC(2026, 9, 31, 2, 0, 0),
    });
    const original = privateMessage('private-text', { conversation: 'hello there' });
    ev.emit('messages.upsert', { messages: [original] });
    ev.emit('messages.delete', { keys: [original.key] });
    await flushDeletionEvents();

    assert.equal(sent.length, 2);
    assert.equal(sent[0].jid, '999@s.whatsapp.net');
    assert.match(sent[0].content.text, /Deleted Message/);
    assert.match(sent[0].content.text, /Contact/);
    assert.match(sent[0].content.text, /2026-10-31T02:00:00\.000Z/);
    assert.deepEqual(sent[1].content, { forward: original, force: true });
    assert.equal(cache.size, 0);
});

test('forwards deleted private media in its original message type', async () => {
    const { ev, sent } = makeDeletionHarness();
    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
    const originals = mediaTypes.map((type, index) =>
        privateMessage(`private-media-${index}`, { [type]: { mimetype: 'application/octet-stream' } })
    );
    ev.emit('messages.upsert', { messages: originals });
    ev.emit('messages.delete', { keys: originals.map(message => message.key) });
    await flushDeletionEvents();

    assert.equal(sent.length, mediaTypes.length * 2);
    for (let i = 0; i < mediaTypes.length; i++) {
        assert.deepEqual(sent[i * 2 + 1].content, { forward: originals[i], force: true });
        assert.ok(sent[i * 2 + 1].content.forward.message[mediaTypes[i]]);
    }
});

test('ignores group deletion events completely', async () => {
    const { ev, sent, cache } = makeDeletionHarness();
    const groupMessage = {
        key: { remoteJid: '12345@g.us', id: 'group-message', fromMe: false },
        message: { conversation: 'group text' },
    };
    ev.emit('messages.upsert', { messages: [groupMessage] });
    ev.emit('messages.update', [{ key: groupMessage.key, update: { message: null } }]);
    ev.emit('messages.delete', { keys: [groupMessage.key] });
    await flushDeletionEvents();

    assert.equal(sent.length, 0);
    assert.equal(cache.size, 0);
});

test('alerts but never forwards a deleted View Once message', async () => {
    const { ev, sent, cache } = makeDeletionHarness();
    const original = privateMessage('private-view-once', {
        viewOnceMessageV2: { message: { imageMessage: { caption: 'private' } } },
    });
    ev.emit('messages.upsert', { messages: [original] });
    ev.emit('messages.delete', { keys: [original.key] });
    await flushDeletionEvents();

    assert.equal(sent.length, 1);
    assert.match(sent[0].content.text, /Deleted Message/);
    assert.equal(cache.size, 0);
});

test('alerts but never forwards a disappearing private message', async () => {
    const { ev, sent, cache } = makeDeletionHarness();
    const original = privateMessage('private-ephemeral', {
        ephemeralMessage: { message: { conversation: 'expires' } },
    });
    ev.emit('messages.upsert', { messages: [original] });
    ev.emit('messages.delete', { keys: [original.key] });
    await flushDeletionEvents();

    assert.equal(sent.length, 1);
    assert.match(sent[0].content.text, /Deleted Message/);
    assert.equal(cache.size, 0);
});

test('does not cache or alert on messages sent by the bot owner', async () => {
    const { ev, sent, cache } = makeDeletionHarness();
    const original = privateMessage('owner-message', { conversation: 'owner content' }, { fromMe: true });
    ev.emit('messages.upsert', { messages: [original] });
    ev.emit('messages.delete', { keys: [original.key] });
    await flushDeletionEvents();

    assert.equal(cache.size, 0);
    assert.equal(sent.length, 0);
});

test('handles duplicate deletion events only once', async () => {
    const { ev, sent } = makeDeletionHarness();
    const original = privateMessage('duplicate-private', { conversation: 'once' });
    ev.emit('messages.upsert', { messages: [original] });
    ev.emit('messages.update', [{
        key: original.key,
        update: { message: { protocolMessage: { type: 0 } } },
    }]);
    ev.emit('messages.delete', { keys: [original.key] });
    await flushDeletionEvents();

    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].content, { forward: original, force: true });
});

test('sends only an alert when the original private message is not cached', async () => {
    const { ev, sent } = makeDeletionHarness();
    const key = {
        remoteJid: '254700000000@s.whatsapp.net',
        id: 'missing-private',
        fromMe: false,
    };
    ev.emit('messages.delete', { keys: [key] });
    await flushDeletionEvents();

    assert.equal(sent.length, 1);
    assert.match(sent[0].content.text, /Deleted Message/);
});

test('private message cache is capped at 500 entries and expires after 24 hours', () => {
    let now = 0;
    const ev = new EventEmitter();
    const cache = createPrivateMessageCache({
        now: () => now,
        getOwnerJid: () => '999@s.whatsapp.net',
    });
    cache.bind(ev);
    const messages = Array.from({ length: 501 }, (_, i) =>
        privateMessage(`cached-${i}`, { conversation: `message ${i}` })
    );
    ev.emit('messages.upsert', { messages });
    assert.equal(cache.size, 500);
    assert.equal(cache.loadMessage(messages[0].key.remoteJid, messages[0].key.id), null);

    now = 24 * 60 * 60 * 1000;
    assert.equal(cache.size, 0);
});

test('does not mark an empty delivery as seen before the real message arrives', () => {
    const seen = new Set();
    const stub = { key: { id: 'same-message' } };
    const real = { key: { id: 'same-message' }, message: { conversation: '.ping' } };

    assert.equal(isDuplicateMessage(stub, seen), false);
    assert.equal(rememberMessageIfContent(stub, seen), false);
    assert.equal(isDuplicateMessage(real, seen), false);
    assert.equal(rememberMessageIfContent(real, seen), true);
    assert.equal(isDuplicateMessage(real, seen), true);
});

test('sends replies to LID chats after attempting session establishment', async () => {
    const calls = [];
    const sock = {
        assertSessions: async jids => calls.push({ type: 'assertSessions', jids }),
        sendMessage: async (jid, content) => {
            calls.push({ type: 'sendMessage', jid, content });
            return { key: { id: 'reply' } };
        },
    };

    const result = await safeSend(sock, '123456789@lid', { text: 'pong' });

    assert.equal(result.key.id, 'reply');
    assert.deepEqual(calls, [
        { type: 'assertSessions', jids: ['123456789@lid'] },
        { type: 'sendMessage', jid: '123456789@lid', content: { text: 'pong' } },
    ]);
});

test('routes a prefixed command to a plugin without a live WhatsApp connection', async () => {
    const sent = [];
    const contactJid = `mushii-test-${Date.now()}@s.whatsapp.net`;
    const sock = {
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            return { key: { id: `reply-${sent.length}` } };
        },
        sendPresenceUpdate: async () => {},
    };

    await handleMessages(sock, {
        key: {
            id: 'incoming-ping',
            remoteJid: contactJid,
            fromMe: false,
        },
        message: { conversation: '.ping' },
    });

    assert.equal(sent.length, 2);
    assert.ok(sent.some(item => /Pinging/.test(item.content.text)));
    assert.ok(sent.some(item => /Bot is Online/.test(item.content.text)));
});

test('preserves manual owner commands without sending an automatic greeting', async () => {
    const sent = [];
    const sock = {
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            return { key: { id: `owner-reply-${sent.length}` } };
        },
        sendPresenceUpdate: async () => {},
    };

    await handleMessages(sock, {
        key: {
            id: 'owner-ping',
            remoteJid: `mushii-owner-test-${Date.now()}@s.whatsapp.net`,
            fromMe: true,
        },
        message: { conversation: '.ping' },
    });

    assert.equal(sent.length, 2);
    assert.ok(sent.every(item => !/Heyyy! Welcome to MUSHII/.test(item.content.text)));
    assert.ok(sent.some(item => /Pinging/.test(item.content.text)));
    assert.ok(sent.some(item => /Bot is Online/.test(item.content.text)));
});

test('undecryptable-message tracking only logs and resets its counter', () => {
    const logs = [];
    let state = { count: 0 };

    for (let i = 0; i < UNDECRYPTABLE_LOG_THRESHOLD - 1; i++) {
        state = trackUndecryptableMessage(state, count => logs.push(count));
    }
    assert.equal(logs.length, 0);
    assert.equal(state.count, UNDECRYPTABLE_LOG_THRESHOLD - 1);

    state = trackUndecryptableMessage(state, count => logs.push(count));
    assert.deepEqual(logs, [UNDECRYPTABLE_LOG_THRESHOLD]);
    assert.deepEqual(state, { count: 0, thresholdReached: true });
});

test('greeting rate limit allows three replies in a rolling 24-hour window', () => {
    const now = 100000000;
    const history = new Map([['contact', [
        now - greetingLimit.REPLY_WINDOW_MS - 1,
        now - greetingLimit.REPLY_WINDOW_MS + 1,
        now - 1
    ]]]);

    const recent = greetingLimit.recentReplyTimes(history, 'contact', now);
    assert.deepEqual(recent, [now - greetingLimit.REPLY_WINDOW_MS + 1, now - 1]);

    recent.push(now);
    history.set('contact', recent);
    assert.equal(greetingLimit.recentReplyTimes(history, 'contact', now).length, greetingLimit.REPLY_LIMIT);
});
