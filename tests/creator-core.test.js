'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CHANNEL_PROFILES, getChannelProfile, getSearchQueries } = require('../lib/creator/profiles');
const { CreatorStore, QuotaLimitError } = require('../lib/creator/sqlite-store');
const { QuotaManager, dateInPacificTime } = require('../lib/creator/quota-manager');
const { YouTubeDataApi, parseIsoDuration, normalizeVideo } = require('../lib/creator/youtube-data-api');
const { GeminiClient, GeminiApiError } = require('../lib/creator/gemini-client');

function tempDatabase(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mushii-creator-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'creator.sqlite');
}

test('channel profiles keep KERN research-only and MUSHII narration-only', () => {
    assert.equal(CHANNEL_PROFILES.kern.scriptGeneration, false);
    assert.equal(CHANNEL_PROFILES.kern.language, 'en');
    assert.match(CHANNEL_PROFILES.kern.channelDescription, /Cinematic documentaries for the endlessly curious/);
    assert.equal(CHANNEL_PROFILES.mushii.scriptGeneration, true);
    assert.equal(CHANNEL_PROFILES.mushii.language, 'rw');
    assert.equal(CHANNEL_PROFILES.mushii.maxVideoSeconds, 600);
    assert.ok(CHANNEL_PROFILES.kern.pillars.some(pillar => pillar.id === 'luxury-logistics'));
    assert.ok(CHANNEL_PROFILES.kern.pillars.some(pillar => pillar.id === 'luxury-business'));
    assert.ok(CHANNEL_PROFILES.kern.pillars.some(pillar => pillar.id === 'luxury-wealth'));
    assert.throws(() => getChannelProfile('unknown'), /Use "kern" or "mushii"/);
    assert.ok(getSearchQueries('kern', { perPillar: 1 }).length >= 7);
    assert.ok(getSearchQueries('mushii', { perPillar: 1 }).length >= 4);
});

test('YouTube quota date resets by Pacific calendar date', () => {
    const beforePacificMidnight = new Date('2026-10-31T06:59:00.000Z');
    const afterPacificMidnight = new Date('2026-10-31T07:01:00.000Z');
    assert.equal(dateInPacificTime(beforePacificMidnight), '2026-10-30');
    assert.equal(dateInPacificTime(afterPacificMidnight), '2026-10-31');
});

test('local SQLite store persists quota counters, research runs and view snapshots', () => {
    const filePath = tempDatabase(test);
    const store = new CreatorStore({ filePath });
    try {
        const first = store.consumeQuota('youtube_search', '2026-10-31', 20, 1, new Date('2026-10-31T12:00:00Z'));
        assert.equal(first.used, 1);
        assert.equal(first.remaining, 19);
        assert.throws(
            () => store.consumeQuota('youtube_search', '2026-10-31', 1, 1),
            QuotaLimitError
        );

        store.saveVideo({
            id: 'video-1',
            channelId: 'channel-1',
            channelTitle: 'Example Channel',
            title: 'Example investigation',
            durationSeconds: 300,
            viewCount: 1000,
            url: 'https://www.youtube.com/watch?v=video-1'
        });
        const snapshot = store.saveSnapshot('video-1', { viewCount: 1200 }, new Date('2026-10-31T13:00:00Z'));
        assert.equal(snapshot.view_count, 1200);
        assert.equal(store.getRecentSnapshots('video-1', 1).length, 1);

        const runId = store.createResearchRun({ channelId: 'kern', runType: 'scan', topic: 'cybercrime' });
        store.completeResearchRun(runId, { result: { count: 4 } });
        assert.deepEqual(store.getLatestResearchRun('kern', 'scan').result, { count: 4 });
    } finally {
        store.close();
    }

    const reopened = new CreatorStore({ filePath });
    try {
        assert.equal(reopened.getQuota('youtube_search', '2026-10-31').used, 1);
        assert.equal(reopened.getVideo('video-1').view_count, 1000);
    } finally {
        reopened.close();
    }
});

test('quota manager applies conservative local caps below YouTube hard limits', () => {
    const filePath = tempDatabase(test);
    const store = new CreatorStore({ filePath });
    try {
        const quota = new QuotaManager(store, { searchLimit: 20, dataUnitsLimit: 9000, geminiRequestsLimit: 10 });
        assert.equal(quota.consumeYoutubeSearch().remaining, 19);
        assert.equal(quota.consumeYoutubeUnits(3).remaining, 8997);
        assert.equal(quota.consumeGeminiRequest().remaining, 9);
    } finally {
        store.close();
    }
});

test('YouTube Data API sends official search parameters and returns normalized videos', async () => {
    const requests = [];
    const quotaCalls = [];
    const api = new YouTubeDataApi({
        apiKey: 'test-youtube-key',
        quotaManager: {
            consumeYoutubeSearch: cost => quotaCalls.push(['search', cost]),
            consumeYoutubeUnits: cost => quotaCalls.push(['units', cost])
        },
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    items: [{
                        id: 'video-123',
                        snippet: {
                            channelId: 'channel-1',
                            channelTitle: 'KERN Example',
                            title: 'A digital mystery',
                            description: 'An example.',
                            publishedAt: '2026-10-01T00:00:00Z'
                        },
                        statistics: { viewCount: '9000', likeCount: '100', commentCount: '15' },
                        contentDetails: { duration: 'PT7M30S' }
                    }]
                })
            };
        }
    });

    const response = await api.getVideos(['video-123']);
    const url = new URL(requests[0].url);
    assert.equal(url.hostname, 'www.googleapis.com');
    assert.equal(url.pathname, '/youtube/v3/videos');
    assert.equal(url.searchParams.get('part'), 'snippet,statistics,contentDetails');
    assert.equal(url.searchParams.get('id'), 'video-123');
    assert.equal(response[0].viewCount, 9000);
    assert.equal(response[0].durationSeconds, 450);
    assert.deepEqual(quotaCalls, [['units', 1]]);
});

test('YouTube search uses its separate quota bucket and supports date/view ordering', async () => {
    const quotaCalls = [];
    const api = new YouTubeDataApi({
        apiKey: 'test-key',
        quotaManager: {
            consumeYoutubeSearch: cost => quotaCalls.push(cost),
            consumeYoutubeUnits: () => assert.fail('search.list must use its own quota bucket')
        },
        fetchImpl: async (url) => ({
            ok: true,
            status: 200,
            json: async () => ({ items: [], nextPageToken: 'next-page' })
        })
    });

    const result = await api.searchVideos({
        query: 'cybercrime true story',
        order: 'viewCount',
        publishedAfter: '2026-01-01T00:00:00Z',
        maxResults: 50
    });
    assert.equal(result.nextPageToken, 'next-page');
    assert.equal(quotaCalls.length, 1);
});

test('YouTube API key is never included in error messages', async () => {
    const api = new YouTubeDataApi({
        apiKey: 'super-secret-key',
        fetchImpl: async () => ({
            ok: false,
            status: 403,
            json: async () => ({ error: { message: 'Rejected super-secret-key', errors: [{ reason: 'quotaExceeded' }] } })
        })
    });
    await assert.rejects(api.searchVideos({ query: 'test' }), error => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /super-secret-key/);
        return true;
    });
});

test('duration parsing and video normalization handle public API values', () => {
    assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
    assert.equal(parseIsoDuration('PT7M'), 420);
    assert.equal(parseIsoDuration('invalid'), 0);
    const video = normalizeVideo({
        id: { videoId: 'abc' },
        snippet: { channelId: 'channel', title: 'Title', channelTitle: 'Channel' },
        statistics: { viewCount: '100' },
        contentDetails: { duration: 'PT10M' }
    });
    assert.equal(video.id, 'abc');
    assert.equal(video.durationSeconds, 600);
    assert.equal(video.viewCount, 100);
});

test('Gemini client calls the configured model and extracts Google grounding sources', async () => {
    const requests = [];
    const quotaCalls = [];
    const client = new GeminiClient({
        apiKey: 'test-gemini-key',
        model: 'gemini-test-model',
        quotaManager: { consumeGeminiRequest: cost => quotaCalls.push(cost) },
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{
                        content: { parts: [{ text: 'Research summary.' }] },
                        groundingMetadata: {
                            groundingChunks: [{ web: { title: 'Official source', uri: 'https://example.com/report' } }],
                            webSearchQueries: ['example research']
                        },
                        finishReason: 'STOP'
                    }]
                })
            };
        }
    });

    const result = await client.generateContent('Research this topic.', { googleSearch: true });
    const request = requests[0];
    assert.match(request.url, /models\/gemini-test-model:generateContent/);
    assert.equal(new URL(request.url).searchParams.get('key'), 'test-gemini-key');
    assert.deepEqual(JSON.parse(request.options.body).tools, [{ google_search: {} }]);
    assert.equal(result.text, 'Research summary.');
    assert.deepEqual(result.sources, [{ title: 'Official source', url: 'https://example.com/report' }]);
    assert.deepEqual(result.searchQueries, ['example research']);
    assert.deepEqual(quotaCalls, [1]);
});

test('Gemini client requires a key and surfaces free-tier/quota errors without paid fallback', async () => {
    const client = new GeminiClient({ apiKey: '', fetchImpl: async () => assert.fail('must not call API') });
    await assert.rejects(client.generateContent('Research'), /Add GEMINI_API_KEY/);

    const limited = new GeminiClient({
        apiKey: 'test-key',
        fetchImpl: async () => ({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            json: async () => ({ error: { message: 'Free quota exhausted for this project.' } })
        })
    });
    await assert.rejects(limited.generateContent('Research'), error => {
        assert.ok(error instanceof GeminiApiError);
        assert.equal(error.status, 429);
        return true;
    });
});
