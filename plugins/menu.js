'use strict';

const MENU_LINES = [
    '╭━━━〔 01 · 🎮 *GAMES & FUN* 〕━━━',
    '│ 😂 `.joke` — Get a random joke',
    '│ 💬 `.truth` — Answer a fun truth question',
    '│ 🎯 `.dare` — Take on a playful dare',
    '│ 🧩 `.riddle` — Solve a brain teaser',
    '│ 🔮 `.8ball <question>` — Ask the magic 8-ball',
    '│ 💞 `.ship <name> and <name>` — Check name compatibility',
    '│ ✊ `.rps <rock|paper|scissors>` — Play rock-paper-scissors',
    '│ 🎲 `.dice [sides]` — Roll a die',
    '│ 🏆 `.trivia` — Play a trivia quiz',
    '│ ✨ `.compliment` — Get a feel-good compliment',
    '╰━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '╭━━━〔 02 · 🎵 *MUSIC & VIDEO* 〕━━━',
    '│ 🎧 `.play <song or YouTube link>` — Find and play a song',
    '│ 🎵 `.ytmp3 <YouTube link>` — Download YouTube audio',
    '│ 🎬 `.ytmp4 <YouTube link>` — Download a YouTube video',
    '│ 📥 `.download <public media link> [mp3|mp4]` — Download public media',
    '╰━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '✨ Type `.menu` anytime to explore MUSHII ELITE.'
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
        '╔══════════════════════╗',
        '      ✨ *MUSHII ELITE* ✨',
        '   _Your premium entertainment_',
        '╚══════════════════════╝',
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

    __test: { buildMenu }
};
