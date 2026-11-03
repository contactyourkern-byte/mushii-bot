'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    createEncryptedBackup,
    decryptBackup,
    FORMAT,
    VERSION,
} = require('../lib/life-os-backup');

function sampleState() {
    return {
        version: 2,
        timezone: 'Africa/Kigali',
        templates: { morning: [] },
        routines: [],
        reminders: [],
        records: [{ id: 'p1', category: 'work', title: 'Project', value: 'A private note' }],
        goals: [],
        journal: [],
        checkins: [],
        sentEvents: {},
        notificationDeliveries: {},
        routineProgress: {},
        dailyProgress: {},
        settings: { advanceMinutes: 10 },
    };
}

const password = 'a-long-private-passphrase-for-tests';

test('encrypted Life OS backup round-trips complete private state', () => {
    const state = sampleState();
    const backup = createEncryptedBackup(state, password);
    assert.ok(Buffer.isBuffer(backup));
    const envelope = JSON.parse(backup.toString('utf8'));
    assert.equal(envelope.format, FORMAT);
    assert.equal(envelope.version, VERSION);
    assert.equal(envelope.cipher, 'aes-256-gcm');
    assert.notEqual(envelope.payload, JSON.stringify(state));
    assert.deepEqual(decryptBackup(backup, password), state);
});

test('backup fails closed with an incorrect passphrase', () => {
    const backup = createEncryptedBackup(sampleState(), password);
    assert.throws(() => decryptBackup(backup, 'a-different-passphrase-value'), /could not be unlocked/);
});

test('backup tampering is detected by authenticated encryption', () => {
    const backup = createEncryptedBackup(sampleState(), password);
    const envelope = JSON.parse(backup.toString('utf8'));
    const payload = Buffer.from(envelope.payload, 'base64');
    payload[payload.length - 1] ^= 1;
    envelope.payload = payload.toString('base64');
    assert.throws(() => decryptBackup(Buffer.from(JSON.stringify(envelope)), password), /could not be unlocked/);
});

test('malformed, unsupported and oversized backup envelopes are rejected', () => {
    assert.throws(() => decryptBackup(Buffer.from('not json'), password), /valid JSON/);
    assert.throws(() => decryptBackup(Buffer.alloc(8 * 1024 * 1024 + 1), password), /between 1 byte and 8 MB/);
    assert.throws(() => decryptBackup(Buffer.from(JSON.stringify({ format: 'other', version: 1 })), password), /not a supported/);
});

test('weak passphrases and unsupported state versions are rejected', () => {
    assert.throws(() => createEncryptedBackup(sampleState(), 'short'), /at least 12 characters/);
    assert.throws(() => createEncryptedBackup({ version: 1 }, password), /version 2/);
});

test('backup content is compressed before encryption without exposing a plaintext marker', () => {
    const state = sampleState();
    state.journal = Array.from({ length: 20 }, (_, i) => ({ id: String(i), text: 'PRIVATE_JOURNAL_MARKER_' + i }));
    const backup = createEncryptedBackup(state, password);
    assert.equal(backup.includes(Buffer.from('PRIVATE_JOURNAL_MARKER')), false);
    assert.deepEqual(decryptBackup(backup, password), state);
});

test('Google integration stays disconnected and rejects OAuth until private client config exists', () => {
    const oldId = process.env.LIFE_OS_GOOGLE_CLIENT_ID;
    const oldSecret = process.env.LIFE_OS_GOOGLE_CLIENT_SECRET;
    delete process.env.LIFE_OS_GOOGLE_CLIENT_ID;
    delete process.env.LIFE_OS_GOOGLE_CLIENT_SECRET;
    try {
        const google = require('../lib/life-os-google');
        assert.equal(google.getStatus().connected, false);
        assert.throws(() => google.beginOAuth(), /not configured/);
        assert.deepEqual(google.SCOPES, [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/gmail.send',
        ]);
    } finally {
        if (oldId === undefined) delete process.env.LIFE_OS_GOOGLE_CLIENT_ID;
        else process.env.LIFE_OS_GOOGLE_CLIENT_ID = oldId;
        if (oldSecret === undefined) delete process.env.LIFE_OS_GOOGLE_CLIENT_SECRET;
        else process.env.LIFE_OS_GOOGLE_CLIENT_SECRET = oldSecret;
    }
});
