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
3. Copy `config.env.example` to the ignored local `config.env`. Set `PAIRING_NUMBER` to the WhatsApp number to link, using digits only and including its country calling code (no `+`, spaces, or punctuation).
4. Start with `npm start`.

Never commit `config.env`, session data, authentication files, passwords, or tokens. The repository ignore rules exclude the local environment and WhatsApp auth directories.

### Pair MUSHII with WhatsApp

When there is no registered session, MUSHII requests a pairing code after Baileys announces its QR-ready event. Read the one-time **MUSHII PAIRING CODE** from the private server console, then in WhatsApp open **Linked devices → Link a device → Link with phone number instead** and enter the code. Keep the console private and treat the code as a secret. MUSHII saves credentials and Signal keys in the persistent `session/` directory; `SESSION_ID` is not required for this setup. Existing registered sessions are reused and are not replaced by pairing.

After pairing, clear `PAIRING_NUMBER` from `config.env`; the saved session is sufficient for future starts. To unlink MUSHII, remove it from **Linked devices** in WhatsApp. Keep `session/` to reuse the local session; only remove that directory after unlinking if you intentionally want to discard the saved session and pair again.

## Privacy

MUSHII does not open, forward, or otherwise bypass WhatsApp View Once messages. When a contact deletes a message in a one-to-one chat, MUSHII privately alerts the owner with the sender and deletion time, then forwards the original message when it is available. The in-memory cache is limited to 500 private incoming messages and expires after 24 hours; group messages are not cached or monitored. Messages sent by the owner, disappearing messages, and View Once messages are never forwarded. Automatic greetings are private-chat only and limited to three successful replies to a contact in any rolling 24-hour period. No automatic greeting, welcome, goodbye, or other passive bot response is sent into groups; group commands remain available.

## Configuration

`config.env.example` contains non-secret defaults. Set `BOT_NAME=MUSHII` to customize the display name. The owner number is intentionally blank and must be configured by the operator. Optional provider keys and database credentials belong only in the host's private secret settings.

## Project

Repository: https://github.com/contactyourkern-byte/mushii-bot

See [LICENSE](LICENSE) for the existing license and attribution.
