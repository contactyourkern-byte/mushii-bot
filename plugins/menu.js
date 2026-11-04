'use strict';

const MENU_LINES = [
    '*🌸 WELCOME TO MUSHII*',
    '_Your friendly WhatsApp companion · Umufasha wawe wa buri munsi._',
    '',
    '*🎮 GAMES & FUN*',
    '😂 `.joke` — A little laughter',
    '💬 `.truth` / `.dare` — Play with friends',
    '🧩 `.riddle` / `.answer` — Test your mind',
    '🔮 `.8ball <question>` — Ask a playful question',
    '💞 `.ship <name> and <name>` — Fun compatibility',
    '✊ `.rps <rock|paper|scissors>` · `.dice` · `.trivia`',
    '✨ `.compliment` — A kind word',
    '',
    '*🎵 MUSIC & MEDIA*',
    '🎧 `.play <song>` — Find music',
    '🎵 `.ytmp3 <YouTube link>` · 🎬 `.ytmp4 <YouTube link>`',
    '📥 `.download <public link> [mp3|mp4]`',
    '',
    '*🌱 LIFE OS · YOUR PERSONAL PLANNER*',
    '📅 `.life help` — Full Life OS guide',
    '🧭 `.life status` · `.agenda` · `.timeline` · `.next`',
    '🎯 `.life goals` · `.life pillars` · `.life report week`',
    '📔 `.life journal add <note>` — Save a private reflection',
    '📚 `.life book help` — Your private knowledge library',
    '☁️ `.life upload data` — Encrypted backup to Google Drive',
    '',
    '*🤝 FRIENDLY AI AUTO-REPLY*',
    'Owner controls: `.away on` · `.away off`',
    'MUSHII replies to short greetings only, at most twice per contact in 24 hours.',
    'Other ordinary messages are left for you to answer. Commands such as `.menu` work normally.',
    '',
    '*💎 QUICK START*',
    'Send a command below, or ask MUSHII a question:',
    '`.menu` · `.life help` · `.admin`',
    '',
    '_Made with care · Yako mu biganiro byiza!_'
];

const COMMAND_HELP = {
    joke: '.joke',
    truth: '.truth',
    dare: '.dare',
    riddle: '.riddle, then .answer',
    '8ball': '.8ball <question>',
    ship: '.ship <name> and <name>',
    rps: '.rps <rock|paper|scissors>',
    dice: '.dice [sides] or .dice <count>d<sides>',
    trivia: '.trivia, then .trivia a <A|B|C|D>',
    compliment: '.compliment',
    play: '.play <song name or YouTube link>',
    ytmp3: '.ytmp3 <YouTube link>',
    ytmp4: '.ytmp4 <YouTube link>',
    download: '.download <public media link> [mp3|mp4]'
};

function buildMenu() {
    return [
        '*MUSHII ELITE*',
        '_Premium entertainment, ready to play._',
        '',
        ...MENU_LINES
    ].join('\n');
}

module.exports = {
    commands: ['menu', 'help', 'commands'],
    description: 'Show the MUSHII Entertainment menu',
    usage: '.menu',
    permission: 'public',
    group: true,
    private: true,

    run: async (sock, message, args, ctx) => {
        const command = (args[0] || '').toLowerCase();
        if (ctx.command === 'help' && command) {
            return ctx.reply(COMMAND_HELP[command]
                ? `📖 *MUSHII Help: ${command}*\n\nUsage: ${COMMAND_HELP[command]}`
                : `No MUSHII Entertainment help is available for ${command}. Use .menu.`);
        }
        return ctx.reply(buildMenu());
    },

    __test: { buildMenu, menuCommands: [...new Set([...Object.keys(COMMAND_HELP), 'menu', 'help', 'commands'])] }
};
