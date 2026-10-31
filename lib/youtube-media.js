'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_VIDEO_SIZE = 64 * 1024 * 1024;
const VIDEO_FORMAT = '18/b[ext=mp4][height<=360][vcodec^=avc1][acodec^=mp4a]/b[ext=mp4][height<=360]';

function isYoutubeUrl(videoUrl) {
    let parsed;
    try {
        parsed = new URL(videoUrl);
    } catch {
        return false;
    }

    const host = parsed.hostname.toLowerCase();
    return ['http:', 'https:'].includes(parsed.protocol) &&
        (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com'));
}

async function runCommand(command, args, execFileImpl) {
    try {
        return await new Promise((resolve, reject) => {
            execFileImpl(command, args, {
                timeout: 10 * 60 * 1000,
                maxBuffer: 10 * 1024 * 1024,
                windowsHide: true
            }, (error, stdout, stderr) => {
                if (error) return reject(error);
                resolve({ stdout, stderr });
            });
        });
    } catch (error) {
        const detail = error.stderr?.trim() || error.message;
        throw new Error(`${command} failed: ${detail}`, { cause: error });
    }
}

async function verifyMedia(filePath, type, execFileImpl) {
    let probeOutput;
    try {
        ({ stdout: probeOutput } = await runCommand('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration:stream=codec_type,codec_name',
            '-of', 'json',
            filePath
        ], execFileImpl));
    } catch (error) {
        throw new Error(`Unable to verify downloaded ${type}: ${error.message}`, { cause: error });
    }

    let probe;
    try {
        probe = JSON.parse(probeOutput);
    } catch (error) {
        throw new Error(`Unable to verify downloaded ${type}: ffprobe returned invalid data`, { cause: error });
    }

    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Downloaded ${type} has an invalid duration`);
    }

    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    if (type === 'audio') {
        if (!streams.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'mp3')) {
            throw new Error('Downloaded audio is not a valid MP3');
        }
    } else if (!streams.some(stream => stream.codec_type === 'video') ||
        !streams.some(stream => stream.codec_type === 'audio')) {
        throw new Error('Downloaded video must contain both video and audio streams');
    }

    return duration;
}

async function withDownloadedMedia(videoUrl, type, send, options = {}) {
    if (!['audio', 'video'].includes(type)) throw new Error(`Unsupported media type: ${type}`);
    if (typeof send !== 'function') throw new TypeError('A send callback is required');
    if (!isYoutubeUrl(videoUrl)) throw new Error('A valid YouTube URL is required');

    const execFileImpl = options.execFileImpl || execFile;
    const tempRoot = options.tempRoot || os.tmpdir();
    const tempDir = await fs.mkdtemp(path.join(tempRoot, 'mushii-youtube-'));

    try {
        const args = [
            '--no-update',
            '--js-runtimes', 'node',
            '--no-playlist',
            '--no-progress'
        ];
        if (type === 'audio') {
            args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '5');
        } else {
            args.push('-f', VIDEO_FORMAT, '--merge-output-format', 'mp4');
        }
        args.push('--output', path.join(tempDir, 'media.%(ext)s'), videoUrl);

        await runCommand('yt-dlp', args, execFileImpl);

        const filePath = path.join(tempDir, type === 'audio' ? 'media.mp3' : 'media.mp4');
        const stat = await fs.stat(filePath).catch(error => {
            if (error.code === 'ENOENT') {
                throw new Error(`yt-dlp did not produce the expected ${type} file`);
            }
            throw error;
        });

        if (type === 'video' && stat.size > MAX_VIDEO_SIZE) {
            throw new Error('Video exceeds the 64 MiB WhatsApp file-size limit');
        }
        if (stat.size === 0) throw new Error(`Downloaded ${type} file is empty`);

        const duration = await verifyMedia(filePath, type, execFileImpl);
        return await send({ filePath, duration });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

module.exports = { MAX_VIDEO_SIZE, isYoutubeUrl, withDownloadedMedia };
