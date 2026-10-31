'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    COOLDOWN_MS,
    DEFAULT_REPLY,
    GREETING_REPLY,
    createAutoReply,
    isCommandMessage,
    isGreeting,
    responseFor
} = require('../lib/auto-reply');
const { __test: awayTest } = require('../plugins/away');
const menuPlugin = require('../plugins/menu');
const { handleMessages, plugins } = require('../handler');
const registeredCommands = new Set(plugins.flatMap(plugin => plugin.commands || []));

async function createStatePath(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mushii-away-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return path.join(directory, 'away.json');
}

test('detects supported greetings without matching words embedded in other words', () => {
    for (const greeting of [
        'Hi!', 'Hello there', 'Hey MUSHII', 'Muraho', 'Amakuru?', 'Mwaramutse',
        'Mwiriwe', 'Bite', 'Good morning', 'Good evening'
    ]) {
        assert.equal(isGreeting(greeting), true, `${greeting} should be recognized`);
        assert.equal(responseFor(greeting), GREETING_REPLY);
    }

    for (const message of ['this is a song', 'high quality', 'good afternoon', '']) {
        assert.equal(isGreeting(message), false, `${message} should not be recognized`);
        assert.equal(responseFor(message), DEFAULT_REPLY);
    }
});

test('default reply includes the requested help and two registered commands', () => {
    assert.equal(DEFAULT_REPLY, [
        '✨ MUSHII ENTERTAINMENT ✨',
        '',
        'Hey! 👋 Iragena is not online right now.',
        '',
        'Ariko ntugire ikibazo! You can still enjoy MUSHII',
        'while waiting:',
        '',
        '🎵 .play <song name> — Play your favourite music.',
        '',
        '😂 .joke — Get a random joke.',
        '',
        '🧩 .riddle — Challenge your brain.',
        '',
        '💎 Type .menu to explore all MUSHII features.',
        '',
        'Enjoy your time! ❤️'
    ].join('\n'));
    assert.match(DEFAULT_REPLY, /🎵 \.play <song name> — Play your favourite music\./);
    assert.match(DEFAULT_REPLY, /😂 \.joke — Get a random joke\./);
    assert.match(DEFAULT_REPLY, /🧩 \.riddle — Challenge your brain\./);
    assert.match(DEFAULT_REPLY, /💎 Type \.menu to explore all MUSHII features\./);
    for (const command of ['play', 'joke', 'riddle', 'menu']) {
        assert.ok(registeredCommands.has(command), `.${command} must be a registered command`);
    }
    assert.equal((DEFAULT_REPLY.match(/\.[a-z0-9]+ — .+$/gm) || []).length, 2);
});

test('does not send away replies for registered commands', () => {
    assert.equal(isCommandMessage('.menu', '.', plugins), true);
    assert.equal(isCommandMessage('.play Blinding Lights', '.', plugins), true);
    assert.equal(isCommandMessage('!menu', '.,!', plugins), true);
    assert.equal(isCommandMessage('menu', 'none', plugins), true);
    assert.equal(isCommandMessage('hello there', '.', plugins), false);
    assert.equal(isCommandMessage('hey MUSHII, tell me something', '.', plugins), true);
});

test('replies once per sender during cooldown and persists cooldown across restarts', async t => {
    const filePath = await createStatePath(t);
    let timestamp = 1_000_000;
    const first = createAutoReply({ filePath, now: () => timestamp });
    first.setEnabled(true);
    const sent = [];
    const send = async content => sent.push(content.text);
    const message = {
        jid: 'contact@s.whatsapp.net',
        sender: 'contact@s.whatsapp.net',
        text: 'Hi',
        send
    };

    assert.equal(await first.replyToMessage(message), true);
    assert.equal(await first.replyToMessage(message), false);
    assert.equal(sent.length, 1);

    const afterRestart = createAutoReply({ filePath, now: () => timestamp });
    assert.equal(afterRestart.isEnabled(), true);
    assert.equal(await afterRestart.replyToMessage(message), false);

    timestamp += COOLDOWN_MS;
    assert.equal(await afterRestart.replyToMessage(message), true);
    assert.equal(sent.length, 2);
});

test('ignores groups, status, newsletters, bot messages, protocol messages, and owners', async t => {
    const filePath = await createStatePath(t);
    const autoReply = createAutoReply({ filePath });
    autoReply.setEnabled(true);
    let sendCount = 0;
    const send = async () => { sendCount++; };

    for (const context of [
        { jid: '123@g.us', isGroup: true },
        { jid: 'status@broadcast' },
        { jid: 'news@newsletter' },
        { jid: 'bot@s.whatsapp.net', fromMe: true },
        { jid: 'protocol@s.whatsapp.net', isProtocolMessage: true },
        { jid: 'owner@s.whatsapp.net', isOwner: true }
    ]) {
        assert.equal(await autoReply.replyToMessage({ ...context, send }), false);
    }
    assert.equal(sendCount, 0);
});

test('releases the cooldown when sending fails', async t => {
    const filePath = await createStatePath(t);
    const autoReply = createAutoReply({ filePath });
    autoReply.setEnabled(true);
    const message = {
        jid: 'contact@s.whatsapp.net',
        send: async () => { throw new Error('send failed'); }
    };

    await assert.rejects(autoReply.replyToMessage(message), /send failed/);
    assert.equal(await autoReply.replyToMessage({
        ...message,
        send: async () => {}
    }), true);
});

test('away command is owner-only and persists on/off controls', async t => {
    const filePath = await createStatePath(t);
    const autoReply = createAutoReply({ filePath });
    const away = awayTest.createAwayPlugin(autoReply);
    const replies = [];
    const context = {
        isOwner: false,
        reply: async text => replies.push(text)
    };

    await away.run({}, {}, ['on'], context);
    assert.equal(autoReply.isEnabled(), false);
    assert.match(replies.pop(), /Only the bot owner/);

    context.isOwner = true;
    await away.run({}, {}, ['on'], context);
    assert.equal(autoReply.isEnabled(), true);
    assert.equal(createAutoReply({ filePath }).isEnabled(), true);
    assert.match(replies.pop(), /Auto Reply is ON/);

    await away.run({}, {}, ['off'], context);
    assert.equal(autoReply.isEnabled(), false);
    assert.equal(createAutoReply({ filePath }).isEnabled(), false);
    assert.match(replies.pop(), /Auto Reply is OFF/);
});

test('automatic reply does not block the normal .menu command', async t => {
    const filePath = await createStatePath(t);
    const awayIndex = plugins.findIndex(plugin => plugin.commands?.includes('away'));
    assert.notEqual(awayIndex, -1);
    const originalAwayPlugin = plugins[awayIndex];
    plugins[awayIndex] = awayTest.createAwayPlugin(createAutoReply({ filePath }));

    const sent = [];
    const sock = {
        sendMessage: async (jid, content) => {
            sent.push({ jid, content });
            return { key: { id: `away-test-${sent.length}` } };
        },
        sendPresenceUpdate: async () => {}
    };
    const message = (id, jid, text, fromMe = false) => ({
        key: { id, remoteJid: jid, fromMe },
        message: { conversation: text }
    });

    try {
        await handleMessages(sock, message('away-on', 'owner@s.whatsapp.net', '.away on', true));
        await handleMessages(sock, message('menu-request', 'contact@s.whatsapp.net', '.menu'));
        await handleMessages(sock, message('plain-message', 'another-contact@s.whatsapp.net', 'hello there'));

        assert.match(sent[1].content.text, /MUSHII ELITE/);
        assert.equal(sent[2].content.text, GREETING_REPLY);
    } finally {
        plugins[awayIndex] = originalAwayPlugin;
    }
});

test('premium menu includes every existing command with exact syntax', async () => {
    let result;
    await menuPlugin.run({}, {}, [], { command: 'menu', reply: async text => { result = text; } });
    assert.match(result, /✨ \*MUSHII ELITE\* ✨/);
    assert.match(result, /〔 01 · 🎮 \*GAMES & FUN\* 〕/);
    assert.match(result, /〔 02 · 🎵 \*MUSIC & VIDEO\* 〕/);

    for (const syntax of [
        '.joke', '.truth', '.dare', '.riddle', '.8ball <question>',
        '.ship <name> and <name>', '.rps <rock|paper|scissors>', '.dice [sides]',
        '.trivia', '.compliment', '.play <song or YouTube link>',
        '.ytmp3 <YouTube link>', '.ytmp4 <YouTube link>',
        '.download <public media link> [mp3|mp4]'
    ]) {
        assert.ok(result.includes(`\`${syntax}\``), `Menu must include ${syntax}`);
    }

    for (const command of ['joke', 'truth', 'dare', 'riddle', '8ball', 'ship', 'rps', 'dice',
        'trivia', 'compliment', 'play', 'ytmp3', 'ytmp4', 'download']) {
        assert.ok(registeredCommands.has(command), `.${command} must remain registered`);
    }
});
