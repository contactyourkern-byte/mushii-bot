'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleStatusBroadcast, getAutoStatusSettings } = require('../lib/statusManager');

function makeStatus(id, key = {}) {
    return {
        key: { id, participant: '123456789@lid', ...key },
        message: { conversation: 'status test' },
    };
}

test('runtime autolike ON overrides disabled config and sends reaction with phone JIDs', async () => {
    const previous = global.autoStatusFlags;
    const previousMap = global.lidJidMap;
    const previousCache = global.lidPhoneCache;
    global.autoStatusFlags = { seen: false, react: true };
    global.lidJidMap = new Map([['123456789@lid', '250788123456@s.whatsapp.net']]);
    global.lidPhoneCache = new Map();
    const sent = [];
    const sock = {
        user: { id: '250700000000:3@s.whatsapp.net' },
        sendMessage: async (...args) => { sent.push(args); },
    };

    try {
        await handleStatusBroadcast(sock, makeStatus('status-runtime-on-' + Date.now()), undefined);
        assert.equal(sent.length, 1);
        assert.equal(sent[0][0], 'status@broadcast');
        assert.equal(sent[0][2].statusJidList.includes('250788123456@s.whatsapp.net'), true);
        assert.equal(sent[0][2].statusJidList.includes('250700000000@s.whatsapp.net'), true);
        assert.equal(getAutoStatusSettings().autoLikeStatus, 'true');
    } finally {
        global.autoStatusFlags = previous;
        global.lidJidMap = previousMap;
        global.lidPhoneCache = previousCache;
    }
});

test('runtime autolike OFF suppresses status reactions', async () => {
    const previous = global.autoStatusFlags;
    global.autoStatusFlags = { seen: false, react: false };
    const sent = [];
    const sock = {
        user: { id: '250700000000:3@s.whatsapp.net' },
        sendMessage: async (...args) => { sent.push(args); },
    };

    try {
        await handleStatusBroadcast(sock, makeStatus('status-runtime-off-' + Date.now(), {
            participantPn: '250788123456@s.whatsapp.net',
        }), undefined);
        assert.equal(sent.length, 0);
        assert.equal(getAutoStatusSettings().autoLikeStatus, 'false');
    } finally {
        global.autoStatusFlags = previous;
    }
});

test('status reaction skips unresolved LID rather than sending invalid recipient list', async () => {
    const previous = global.autoStatusFlags;
    const previousMap = global.lidJidMap;
    const previousCache = global.lidPhoneCache;
    global.autoStatusFlags = { seen: false, react: true };
    global.lidJidMap = new Map();
    global.lidPhoneCache = new Map();
    const sent = [];
    const sock = {
        user: { id: '250700000000@s.whatsapp.net' },
        sendMessage: async (...args) => { sent.push(args); },
    };

    try {
        await handleStatusBroadcast(sock, makeStatus('status-unresolved-' + Date.now()), undefined);
        assert.equal(sent.length, 0);
    } finally {
        global.autoStatusFlags = previous;
        global.lidJidMap = previousMap;
        global.lidPhoneCache = previousCache;
    }
});
