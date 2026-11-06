'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TIMEZONE = 'Africa/Kigali';
const TIMES = ['06:30', '13:30', '18:30'];
const STATE_PATH = path.join(__dirname, '..', 'data', 'no-post-reminders.json');
const MESSAGE = [
    '🚫 *NO POST — MUSHII REMINDER*',
    '',
    'Do not post anything on WhatsApp.',
    'Pause before sharing. Protect your focus and keep your attention on what matters today.',
    '',
    '_NO POST. Stay disciplined._'
].join('\n');

let socket = null;
let timer = null;
let busy = false;

function readState() {
    try {
        const value = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        return value && typeof value === 'object' ? value : { sent: {} };
    } catch {
        return { sent: {} };
    }
}

function writeState(state) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const temp = STATE_PATH + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, STATE_PATH);
}

function localClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(now);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return {
        date: get('year') + '-' + get('month') + '-' + get('day'),
        time: get('hour') + ':' + get('minute')
    };
}

function ownerJid(sock) {
    const id = sock?.user?.id || sock?.user?.jid;
    if (!id || typeof id !== 'string') return null;
    return id.replace(/:\d+@/, '@');
}

async function tick() {
    if (!socket || busy) return;
    const jid = ownerJid(socket);
    if (!jid) return;

    const now = localClock();
    if (!TIMES.includes(now.time)) return;

    busy = true;
    try {
        const state = readState();
        state.sent = state.sent && typeof state.sent === 'object' ? state.sent : {};
        const key = now.date + ':' + now.time;
        if (state.sent[key]) return;

        await socket.sendMessage(jid, { text: MESSAGE });
        state.sent[key] = new Date().toISOString();

        // Keep only the latest 45 days of delivery records.
        const cutoff = new Date(Date.now() - 45 * 86400000);
        for (const [entry] of Object.entries(state.sent)) {
            const date = entry.slice(0, 10);
            if (date && new Date(date + 'T00:00:00Z') < cutoff) delete state.sent[entry];
        }
        writeState(state);
    } catch (error) {
        console.error('[NO POST] Reminder delivery failed:', error.message);
    } finally {
        busy = false;
    }
}

function ensureScheduler() {
    if (timer) return;
    timer = setInterval(() => tick().catch(() => {}), 15000);
    if (typeof timer.unref === 'function') timer.unref();
}

async function onConnectionOpen(sock) {
    if (!sock?.user?.id) return;
    socket = sock;
    ensureScheduler();
    await tick();
}

function onConnectionClose(sock) {
    if (sock && socket && sock !== socket) return;
    socket = null;
}

module.exports = {
    commands: ['nopost'],
    description: 'Owner-only daily NO POST WhatsApp reminders at 06:30, 13:30 and 18:30 Kigali time',
    permission: 'owner',
    group: false,
    private: true,
    onConnectionOpen,
    onConnectionClose,
    run: async (sock, message, args, ctx) => {
        if (ctx.isGroup) return ctx.reply('🔒 NO POST settings are private-chat-only.');
        if (!ctx.isOwner) return ctx.reply('⛔ This reminder is owner-only.');
        return ctx.reply(
            '🚫 *NO POST is active*\n\n' +
            'Daily WhatsApp reminders: *06:30 · 13:30 · 18:30* (Africa/Kigali).\n' +
            'I will remind you not to post anything on WhatsApp.'
        );
    }
};
