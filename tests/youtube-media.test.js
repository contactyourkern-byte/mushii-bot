'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { withDownloadedMedia } = require('../lib/youtube-media');

async function createTempRoot(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mushii-youtube-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

function fakeExecFile({
    probe = { streams: [{ codec_type: 'audio', codec_name: 'mp3' }], format: { duration: '12.5' } },
    downloadError,
    outputSize = 1
} = {}) {
    const calls = [];
    const execFileImpl = (command, args, options, callback) => {
        calls.push({ command, args, options });
        if (command === 'yt-dlp') {
            if (downloadError) return callback(downloadError);
            const outputTemplate = args[args.indexOf('--output') + 1];
            const extension = args.includes('--audio-format') ? 'mp3' : 'mp4';
            const outputFile = outputTemplate.replace('%(ext)s', extension);
            fsSync.writeFileSync(outputFile, 'x');
            fsSync.truncateSync(outputFile, outputSize);
            return callback(null, '', '');
        }
        if (command === 'ffprobe') return callback(null, JSON.stringify(probe), '');
        callback(new Error(`Unexpected command: ${command}`));
    };
    return { calls, execFileImpl };
}

test('reports yt-dlp errors and removes the temporary download directory', async t => {
    const tempRoot = await createTempRoot(t);
    const { execFileImpl } = fakeExecFile({ downloadError: new Error('network unavailable') });

    await assert.rejects(
        withDownloadedMedia('https://youtu.be/example', 'audio', async () => {}, { tempRoot, execFileImpl }),
        /yt-dlp failed: network unavailable/
    );
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('rejects invalid MP3 media', async t => {
    const tempRoot = await createTempRoot(t);
    const { execFileImpl } = fakeExecFile({
        probe: { streams: [{ codec_type: 'audio', codec_name: 'aac' }], format: { duration: '12' } }
    });

    await assert.rejects(
        withDownloadedMedia('https://youtu.be/example', 'audio', async () => {}, { tempRoot, execFileImpl }),
        /not a valid MP3/
    );
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('rejects media with a zero or invalid duration', async t => {
    const tempRoot = await createTempRoot(t);
    const { execFileImpl } = fakeExecFile({
        probe: { streams: [{ codec_type: 'audio', codec_name: 'mp3' }], format: { duration: '0' } }
    });

    await assert.rejects(
        withDownloadedMedia('https://youtu.be/example', 'audio', async () => {}, { tempRoot, execFileImpl }),
        /invalid duration/
    );
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('rejects video without both streams', async t => {
    const tempRoot = await createTempRoot(t);
    const { execFileImpl } = fakeExecFile({
        probe: { streams: [{ codec_type: 'video', codec_name: 'h264' }], format: { duration: '12' } }
    });

    await assert.rejects(
        withDownloadedMedia('https://youtu.be/example', 'video', async () => {}, { tempRoot, execFileImpl }),
        /both video and audio streams/
    );
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('enforces video file-size limits before probing or sending', async t => {
    const tempRoot = await createTempRoot(t);
    const { calls, execFileImpl } = fakeExecFile({ outputSize: 64 * 1024 * 1024 + 1 });
    let sent = false;

    await assert.rejects(
        withDownloadedMedia('https://youtu.be/example', 'video', async () => { sent = true; }, {
            tempRoot,
            execFileImpl,
        }),
        /64 MiB WhatsApp file-size limit/
    );
    assert.equal(sent, false);
    assert.equal(calls.some(call => call.command === 'ffprobe'), false);
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('keeps the validated local file available until sending completes, then cleans up', async t => {
    const tempRoot = await createTempRoot(t);
    const { calls, execFileImpl } = fakeExecFile();
    let sentFile;

    const duration = await withDownloadedMedia('https://youtu.be/example', 'audio', async media => {
        sentFile = media.filePath;
        assert.equal(await fs.readFile(media.filePath).then(file => file.length), 1);
        assert.equal(media.duration, 12.5);
    }, { tempRoot, execFileImpl });

    assert.equal(duration, undefined);
    assert.equal(calls[0].command, 'yt-dlp');
    assert.equal(calls[0].args[0], '--no-update');
    assert.deepEqual(calls[0].args.slice(0, 6), [
        '--no-update', '--js-runtimes', 'node', '--no-playlist', '--no-progress', '-f'
    ]);
    assert.equal(calls[0].options.shell, undefined);
    await assert.rejects(fs.access(sentFile), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('downloads and validates an MP4 with preferred H.264 and AAC formats', async t => {
    const tempRoot = await createTempRoot(t);
    const { calls, execFileImpl } = fakeExecFile({
        probe: {
            streams: [
                { codec_type: 'video', codec_name: 'h264' },
                { codec_type: 'audio', codec_name: 'aac' }
            ],
            format: { duration: '187.315' }
        }
    });
    let media;

    await withDownloadedMedia('https://youtu.be/example', 'video', async downloaded => {
        media = downloaded;
        assert.equal(await fs.readFile(downloaded.filePath).then(file => file.length), 1);
    }, { tempRoot, execFileImpl });

    const formatIndex = calls[0].args.indexOf('-f');
    assert.equal(calls[0].args[formatIndex + 1], '18/b[ext=mp4][height<=360][vcodec^=avc1][acodec^=mp4a]/b[ext=mp4][height<=360]');
    assert.deepEqual(calls[0].args.slice(formatIndex + 2, formatIndex + 4), ['--merge-output-format', 'mp4']);
    assert.equal(media.duration, 187.315);
    await assert.rejects(fs.access(media.filePath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('cleans up the temporary file when sending fails', async t => {
    const tempRoot = await createTempRoot(t);
    const { execFileImpl } = fakeExecFile();
    let sentFile;

    await assert.rejects(
        withDownloadedMedia('https://youtu.be/example', 'audio', async ({ filePath }) => {
            sentFile = filePath;
            throw new Error('WhatsApp send failed');
        }, { tempRoot, execFileImpl }),
        /WhatsApp send failed/
    );
    await assert.rejects(fs.access(sentFile), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('rejects non-YouTube URLs before starting yt-dlp', async t => {
    const tempRoot = await createTempRoot(t);
    const { calls, execFileImpl } = fakeExecFile();

    await assert.rejects(
        withDownloadedMedia('https://example.com/video', 'audio', async () => {}, { tempRoot, execFileImpl }),
        /valid YouTube URL/
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(await fs.readdir(tempRoot), []);
});
