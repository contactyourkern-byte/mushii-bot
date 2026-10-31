# MUSHII

**WhatsApp Entertainment Bot**

MUSHII brings games, music search, and public-media downloads to WhatsApp chats. It is built with Node.js and Baileys.

## Features

| Command | Description |
|---|---|
| `.menu` | MUSHII Entertainment menu |
| `.joke` | Random joke |
| `.truth` / `.dare` | Truth or dare prompt |
| `.riddle` / `.answer` | Riddle and answer |
| `.8ball <question>` | Random 8-ball answer |
| `.ship <name> and <name>` | Playful compatibility score |
| `.rps <rock\|paper\|scissors>` | Rock, paper, scissors |
| `.dice [sides]` | Roll dice |
| `.trivia` | Trivia question |
| `.compliment` | Random compliment |
| `.play <song or YouTube link>` | Search and send a track as audio |
| `.ytmp3 <YouTube link>` | Download YouTube audio |
| `.ytmp4 <YouTube link>` | Download YouTube video (subject to provider limits) |
| `.download <public link> [mp3\|mp4]` | Download supported public media |

Use `.help <command>` for command details.

## Setup

1. Use Node.js 24.x.
2. Install the exact locked dependencies with `npm ci`.
3. Copy `config.env.example` to the ignored local `config.env` and set your private WhatsApp credentials there.
4. Start with `npm start`.

Never commit `config.env`, session data, authentication files, passwords, or tokens. The repository ignore rules exclude the local environment and WhatsApp auth directories.

## Privacy

MUSHII does not open, forward, or otherwise bypass WhatsApp View Once messages. When a contact deletes a message in a one-to-one chat, MUSHII privately alerts the owner with the sender and deletion time, then forwards the original message when it is available. The in-memory cache is limited to 500 private incoming messages and expires after 24 hours; group messages are not cached or monitored. Messages sent by the owner, disappearing messages, and View Once messages are never forwarded. Automatic greetings are private-chat only and limited to three successful replies to a contact in any rolling 24-hour period. No automatic greeting, welcome, goodbye, or other passive bot response is sent into groups; group commands remain available.

## Configuration

`config.env.example` contains non-secret defaults. Set `BOT_NAME=MUSHII` to customize the display name. The owner number is intentionally blank and must be configured by the operator. Optional provider keys and database credentials belong only in the host's private secret settings.

Pair-code commands remain unavailable until the operator supplies their own `PAIR_CODE_API_URL` in private configuration; MUSHII does not provide or promote a pairing service.

## Project

Repository: https://github.com/contactyourkern-byte/mushii-bot

See [LICENSE](LICENSE) for the existing license and attribution.
