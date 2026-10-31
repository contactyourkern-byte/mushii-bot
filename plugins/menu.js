'use strict';

const MENU_LINES = [
    '*🎮 GAMES & FUN*',
    '😂 `.joke` — Random joke',
    '💬 `.truth` — Truth question',
    '🎯 `.dare` — Fun dare',
    '🧩 `.riddle` — Brain teaser',
    '🔮 `.8ball <question>` — Ask the 8-ball',
    '💞 `.ship <name> and <name>` — Name compatibility',
    '✊ `.rps <rock|paper|scissors>` — Rock-paper-scissors',
    '🎲 `.dice [sides]` — Roll a die',
    '🏆 `.trivia` — Trivia quiz',
    '✨ `.compliment` — Get a compliment',
    '',
    '*🎵 MUSIC & VIDEO*',
    '🎧 `.play <song or YouTube link>` — Find and play music',
    '🎵 `.ytmp3 <YouTube link>` — Download YouTube audio',
    '🎬 `.ytmp4 <YouTube link>` — Download YouTube video',
    '📥 `.download <public media link> [mp3|mp4]` — Download media',
    '',
    '*💎 QUICK START*',
    'Pick a command, copy an example, and send it:',
    '```',
    '.play Basara Zuba Ray',
    '.8ball Will I have a great day?',
    '.ship Alice and Bob',
    '```',
    '_Type .menu anytime to explore MUSHII ELITE._'
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
