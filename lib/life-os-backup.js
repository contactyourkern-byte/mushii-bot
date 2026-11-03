'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const FORMAT = 'mushii-life-os-backup';
const VERSION = 1;
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

function deriveKey(passphrase, salt) {
    const password = String(passphrase || '');
    if (password.length < 12) {
        throw new TypeError('Set LIFE_OS_BACKUP_PASSPHRASE to a strong passphrase of at least 12 characters.');
    }
    return crypto.scryptSync(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function createEncryptedBackup(state, passphrase, options = {}) {
    if (!state || typeof state !== 'object' || state.version !== 2) {
        throw new TypeError('Life OS state is not a supported version 2 backup.');
    }
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = deriveKey(passphrase, salt);
    const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(state), 'utf8'));
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const aad = Buffer.from(FORMAT + ':' + VERSION, 'utf8');
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = {
        format: FORMAT,
        version: VERSION,
        createdAt: new Date(options.now || Date.now()).toISOString(),
        cipher: 'aes-256-gcm',
        kdf: 'scrypt',
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        payload: ciphertext.toString('base64'),
    };
    const output = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (output.length > MAX_BACKUP_BYTES) throw new RangeError('Life OS backup is larger than 8 MB.');
    return output;
}

function decryptBackup(input, passphrase) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || '');
    if (!buffer.length || buffer.length > MAX_BACKUP_BYTES) {
        throw new RangeError('Backup must be between 1 byte and 8 MB.');
    }
    let envelope;
    try { envelope = JSON.parse(buffer.toString('utf8')); }
    catch { throw new TypeError('Backup file is not valid JSON.'); }
    if (!envelope || envelope.format !== FORMAT || envelope.version !== VERSION
        || envelope.cipher !== 'aes-256-gcm' || envelope.kdf !== 'scrypt') {
        throw new TypeError('This is not a supported MUSHII Life OS encrypted backup.');
    }
    let salt, iv, tag, ciphertext;
    try {
        salt = Buffer.from(envelope.salt, 'base64');
        iv = Buffer.from(envelope.iv, 'base64');
        tag = Buffer.from(envelope.tag, 'base64');
        ciphertext = Buffer.from(envelope.payload, 'base64');
    } catch { throw new TypeError('Backup encryption fields are malformed.'); }
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
        throw new TypeError('Backup encryption fields are invalid.');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    decipher.setAAD(Buffer.from(FORMAT + ':' + VERSION, 'utf8'));
    decipher.setAuthTag(tag);
    let plaintext;
    try {
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
        throw new Error('Backup could not be unlocked. Check LIFE_OS_BACKUP_PASSPHRASE or use an unmodified backup.');
    }
    let state;
    try { state = JSON.parse(zlib.gunzipSync(plaintext, { maxOutputLength: MAX_BACKUP_BYTES }).toString('utf8')); }
    catch { throw new TypeError('Unlocked backup contains invalid or oversized Life OS data.'); }
    if (!state || typeof state !== 'object' || state.version !== 2) {
        throw new TypeError('Unlocked backup is not a compatible Life OS state.');
    }
    return state;
}

module.exports = {
    FORMAT,
    VERSION,
    MAX_BACKUP_BYTES,
    createEncryptedBackup,
    decryptBackup,
};
