'use strict';

const fs = require('node:fs');
const path = require('node:path');

class QuotaLimitError extends Error {
    constructor(bucket, limit, used, requested) {
        super(`Free quota reached for ${bucket} (${used}/${limit}; requested ${requested}). Try again after the quota reset.`);
        this.name = 'QuotaLimitError';
        this.bucket = bucket;
        this.limit = limit;
        this.used = used;
        this.requested = requested;
    }
}

class CreatorStore {
    constructor(options = {}) {
        const configuredPath = options.filePath || process.env.CREATOR_DB_PATH
            || path.join(process.cwd(), 'data', 'creator-studio.sqlite');
        this.filePath = path.resolve(configuredPath);
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
        if (!fs.existsSync(this.filePath)) {
            const fd = fs.openSync(this.filePath, 'a', 0o600);
            fs.closeSync(fd);
        }

        let DatabaseSync;
        try {
            ({ DatabaseSync } = require('node:sqlite'));
        } catch (error) {
            throw new Error('Creator Studio requires Node.js 24 with the built-in node:sqlite module available.', { cause: error });
        }

        this.db = new DatabaseSync(this.filePath);
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        try { fs.chmodSync(this.filePath, 0o600); } catch { /* platform may not support chmod */ }
        this.initialize();
    }

    initialize() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS quota_usage (
                bucket TEXT NOT NULL,
                quota_date TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (bucket, quota_date)
            );

            CREATE TABLE IF NOT EXISTS research_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL,
                run_type TEXT NOT NULL,
                topic TEXT,
                status TEXT NOT NULL,
                result_json TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS research_runs_channel_created_idx
                ON research_runs (channel_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS creator_videos (
                video_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                channel_title TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                published_at TEXT,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                view_count INTEGER NOT NULL DEFAULT 0,
                like_count INTEGER NOT NULL DEFAULT 0,
                comment_count INTEGER NOT NULL DEFAULT 0,
                video_url TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS creator_videos_channel_published_idx
                ON creator_videos (channel_id, published_at DESC);

            CREATE TABLE IF NOT EXISTS video_snapshots (
                video_id TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                view_count INTEGER NOT NULL DEFAULT 0,
                like_count INTEGER NOT NULL DEFAULT 0,
                comment_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (video_id, captured_at),
                FOREIGN KEY (video_id) REFERENCES creator_videos(video_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS video_snapshots_captured_idx
                ON video_snapshots (captured_at DESC);
        `);
    }

    consumeQuota(bucket, quotaDate, limit, requested = 1, now = new Date()) {
        if (!bucket || !quotaDate || !Number.isInteger(limit) || limit < 1
            || !Number.isInteger(requested) || requested < 1) {
            throw new TypeError('Quota bucket, date, positive integer limit and request cost are required.');
        }

        this.db.exec('BEGIN IMMEDIATE');
        try {
            const row = this.db.prepare(
                'SELECT used FROM quota_usage WHERE bucket = ? AND quota_date = ?'
            ).get(bucket, quotaDate);
            const used = Number(row?.used || 0);
            if (used + requested > limit) {
                this.db.exec('ROLLBACK');
                throw new QuotaLimitError(bucket, limit, used, requested);
            }

            const nextUsed = used + requested;
            this.db.prepare(`
                INSERT INTO quota_usage (bucket, quota_date, used, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(bucket, quota_date) DO UPDATE SET
                    used = excluded.used,
                    updated_at = excluded.updated_at
            `).run(bucket, quotaDate, nextUsed, now.toISOString());
            this.db.exec('COMMIT');
            return { bucket, quotaDate, used: nextUsed, limit, remaining: limit - nextUsed };
        } catch (error) {
            try { this.db.exec('ROLLBACK'); } catch { /* transaction already rolled back */ }
            throw error;
        }
    }

    getQuota(bucket, quotaDate) {
        const row = this.db.prepare(
            'SELECT used, updated_at FROM quota_usage WHERE bucket = ? AND quota_date = ?'
        ).get(bucket, quotaDate);
        return { bucket, quotaDate, used: Number(row?.used || 0), updatedAt: row?.updated_at || null };
    }

    saveVideo(video, capturedAt = new Date()) {
        if (!video?.id || !video.channelId) throw new TypeError('A video id and channel id are required.');
        const timestamp = capturedAt.toISOString();
        this.db.prepare(`
            INSERT INTO creator_videos (
                video_id, channel_id, channel_title, title, description, published_at,
                duration_seconds, view_count, like_count, comment_count, video_url,
                first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET
                channel_id = excluded.channel_id,
                channel_title = excluded.channel_title,
                title = excluded.title,
                description = excluded.description,
                published_at = excluded.published_at,
                duration_seconds = excluded.duration_seconds,
                view_count = excluded.view_count,
                like_count = excluded.like_count,
                comment_count = excluded.comment_count,
                video_url = excluded.video_url,
                last_seen_at = excluded.last_seen_at
        `).run(
            video.id,
            video.channelId,
            video.channelTitle || '',
            video.title || '',
            video.description || '',
            video.publishedAt || null,
            Math.max(0, Number(video.durationSeconds) || 0),
            Math.max(0, Number(video.viewCount) || 0),
            Math.max(0, Number(video.likeCount) || 0),
            Math.max(0, Number(video.commentCount) || 0),
            video.url || `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
            timestamp,
            timestamp
        );
        return this.getVideo(video.id);
    }

    getVideo(videoId) {
        return this.db.prepare('SELECT * FROM creator_videos WHERE video_id = ?').get(videoId) || null;
    }

    saveSnapshot(videoId, statistics = {}, capturedAt = new Date()) {
        const timestamp = capturedAt.toISOString();
        this.db.prepare(`
            INSERT OR IGNORE INTO video_snapshots
                (video_id, captured_at, view_count, like_count, comment_count)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            videoId,
            timestamp,
            Math.max(0, Number(statistics.viewCount) || 0),
            Math.max(0, Number(statistics.likeCount) || 0),
            Math.max(0, Number(statistics.commentCount) || 0)
        );
        return this.db.prepare(`
            SELECT * FROM video_snapshots WHERE video_id = ? AND captured_at = ?
        `).get(videoId, timestamp);
    }

    getRecentSnapshots(videoId, limit = 2) {
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 2));
        return this.db.prepare(`
            SELECT * FROM video_snapshots
            WHERE video_id = ?
            ORDER BY captured_at DESC
            LIMIT ?
        `).all(videoId, safeLimit);
    }

    createResearchRun({ channelId, runType, topic = '', status = 'running' }) {
        if (!channelId || !runType) throw new TypeError('channelId and runType are required.');
        const result = this.db.prepare(`
            INSERT INTO research_runs (channel_id, run_type, topic, status, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(channelId, runType, String(topic).slice(0, 500), status, new Date().toISOString());
        return Number(result.lastInsertRowid);
    }

    completeResearchRun(id, { status = 'completed', result = null } = {}) {
        this.db.prepare(`
            UPDATE research_runs
            SET status = ?, result_json = ?, completed_at = ?
            WHERE id = ?
        `).run(status, result === null ? null : JSON.stringify(result), new Date().toISOString(), id);
        return this.db.prepare('SELECT * FROM research_runs WHERE id = ?').get(id) || null;
    }

    getLatestResearchRun(channelId, runType) {
        const row = this.db.prepare(`
            SELECT * FROM research_runs
            WHERE channel_id = ? AND (? IS NULL OR run_type = ?)
            ORDER BY created_at DESC
            LIMIT 1
        `).get(channelId, runType || null, runType || null);
        if (!row) return null;
        let result = null;
        try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch { /* invalid old result */ }
        return { ...row, result };
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = { CreatorStore, QuotaLimitError };
