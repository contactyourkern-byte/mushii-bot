'use strict';

const { CreatorStore } = require('./sqlite-store');
const { QuotaManager } = require('./quota-manager');
const { YouTubeDataApi } = require('./youtube-data-api');
const { GeminiClient } = require('./gemini-client');
const { GdeltClient } = require('./gdelt-client');
const { getChannelProfile, getSearchQueries } = require('./profiles');
const { scoreOpportunity } = require('./outlier-detector');

function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    });
    return Promise.all(workers).then(() => results);
}

function isoDaysAgo(days, now = new Date()) {
    return new Date(now.getTime() - days * 86400000).toISOString();
}

function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(rows) {
    const columns = [
        ['title', 'Title'],
        ['channel_title', 'Channel'],
        ['view_count', 'Views'],
        ['outlierMultiple', 'Outlier multiple'],
        ['channelMedian', 'Channel median views'],
        ['score', 'Opportunity score'],
        ['pillar', 'KERN pillar'],
        ['published_at', 'Published at'],
        ['video_url', 'YouTube URL']
    ];
    return [
        columns.map(([, label]) => csvEscape(label)).join(','),
        ...(rows || []).map(row => columns.map(([key]) => csvEscape(row[key])).join(','))
    ].join('\r\n');
}

function youtubeVideoId(input) {
    const text = String(input || '').trim();
    if (/^[\w-]{11}$/.test(text)) return text;
    let url;
    try { url = new URL(text); } catch { return null; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0];
        return /^[\w-]{11}$/.test(id || '') ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        const id = url.searchParams.get('v')
            || url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
        return /^[\w-]{11}$/.test(id || '') ? id : null;
    }
    return null;
}

class CreatorEngine {
    constructor(options = {}) {
        this.store = options.store || new CreatorStore(options.storeOptions);
        this.quota = options.quota || new QuotaManager(this.store, options.quotaOptions);
        this.youtube = options.youtube || new YouTubeDataApi({
            apiKey: options.youtubeApiKey || process.env.YOUTUBE_API_KEY,
            quotaManager: this.quota,
            fetchImpl: options.fetchImpl
        });
        this.gemini = options.gemini || new GeminiClient({
            apiKey: options.geminiApiKey || process.env.GEMINI_API_KEY
                || process.env.GOOGLE_AI_KEY || process.env.GOOGLE_API_KEY,
            model: options.geminiModel || process.env.CREATOR_GEMINI_MODEL,
            quotaManager: this.quota,
            fetchImpl: options.fetchImpl
        });
        this.gdelt = options.gdelt || new GdeltClient({ fetchImpl: options.gdeltFetchImpl || options.fetchImpl });
    }

    async scan(channelId, options = {}) {
        const profile = getChannelProfile(channelId);
        const runId = this.store.createResearchRun({
            channelId: profile.id,
            runType: 'youtube-scan',
            topic: options.topic || ''
        });
        try {
            const queries = options.topic
                ? [{ pillarId: 'custom', pillar: 'Custom topic', query: String(options.topic).slice(0, 180) }]
                : getSearchQueries(profile.id, { perPillar: 1 });
            const now = options.now || new Date();
            const searches = [];
            for (const item of queries) {
                searches.push(
                    { ...item, order: 'viewCount', publishedAfter: isoDaysAgo(730, now) },
                    { ...item, order: 'date', publishedAfter: isoDaysAgo(90, now) }
                );
            }

            const searchResponses = await mapLimit(searches, 3, async search => {
                const result = await this.youtube.searchVideos({
                    query: search.query,
                    order: search.order,
                    publishedAfter: search.publishedAfter,
                    videoDuration: 'medium',
                    maxResults: 20,
                    relevanceLanguage: profile.language === 'en' ? 'en' : undefined
                });
                return { search, result };
            });

            const discovered = new Map();
            for (const item of searchResponses) {
                for (const video of item.result.items) {
                    const existing = discovered.get(video.id);
                    if (existing) {
                        existing.matchedPillars.add(item.search.pillarId);
                        existing.matchedQueries.add(item.search.query);
                        existing.discoveryOrders.add(item.search.order);
                    } else {
                        discovered.set(video.id, {
                            ...video,
                            pillar: item.search.pillar,
                            pillarId: item.search.pillarId,
                            matchedPillars: new Set([item.search.pillarId]),
                            matchedQueries: new Set([item.search.query]),
                            discoveryOrders: new Set([item.search.order])
                        });
                    }
                }
            }

            const fullVideos = await this.youtube.getVideos([...discovered.keys()]);
            const candidates = fullVideos.map(video => {
                const match = discovered.get(video.id);
                return {
                    ...video,
                    pillar: match?.pillar || 'Unclassified',
                    pillarId: match?.pillarId || 'unclassified',
                    matchedPillars: [...(match?.matchedPillars || [])],
                    matchedQueries: [...(match?.matchedQueries || [])],
                    discoveryOrders: [...(match?.discoveryOrders || [])]
                };
            }).filter(video => video.durationSeconds >= 240 && video.durationSeconds <= 1200);

            const channelFrequency = new Map();
            for (const video of candidates) {
                const current = channelFrequency.get(video.channelId) || { count: 0, views: 0, title: video.channelTitle };
                current.count += 1;
                current.views += video.viewCount;
                channelFrequency.set(video.channelId, current);
            }
            const baselineChannelIds = [...channelFrequency.entries()]
                .sort((a, b) => (b[1].count * 1000000 + b[1].views) - (a[1].count * 1000000 + a[1].views))
                .slice(0, 10)
                .map(([id]) => id);
            const channels = await this.youtube.getChannels(baselineChannelIds);
            const channelById = new Map(channels.map(channel => [channel.id, channel]));

            const baselines = await mapLimit(baselineChannelIds, 3, async channelId => {
                const result = await this.youtube.getRecentUploads(channelId, {
                    limit: 25,
                    channel: channelById.get(channelId)
                });
                return [channelId, result.videos || []];
            });
            const baselineByChannel = new Map(baselines);

            const captureTime = options.now || new Date();
            for (const video of candidates) {
                this.store.saveVideo(video, captureTime);
                this.store.saveSnapshot(video.id, video, captureTime);
            }
            for (const baselineVideos of baselineByChannel.values()) {
                for (const video of baselineVideos) {
                    this.store.saveVideo(video, captureTime);
                    this.store.saveSnapshot(video.id, video, captureTime);
                }
            }

            const evidenceCandidates = [...candidates]
                .sort((a, b) => b.viewCount - a.viewCount)
                .slice(0, 12);
            const evidenceResults = await mapLimit(evidenceCandidates, 2, async video => {
                try {
                    const articles = await this.gdelt.searchArticles(video.title, { maxResults: 8, timespan: '30d' });
                    return [video.id, articles];
                } catch {
                    return [video.id, []];
                }
            });
            const evidenceByVideo = new Map(evidenceResults);

            const opportunities = candidates.map(video => {
                const previousSnapshots = this.store.getRecentSnapshots(video.id, 3);
                const evidence = evidenceByVideo.get(video.id) || [];
                const metric = scoreOpportunity({
                    video,
                    query: video.matchedQueries.join(' '),
                    baselineVideos: baselineByChannel.get(video.channelId) || [],
                    snapshots: previousSnapshots,
                    evidence
                });
                return {
                    ...video,
                    matchedPillars: video.matchedPillars,
                    matchedQueries: video.matchedQueries,
                    ...metric,
                    evidence: evidence.slice(0, 5)
                };
            }).sort((a, b) => b.score - a.score || (b.viewCount - a.viewCount));

            const result = {
                channelId: profile.id,
                channelName: profile.name,
                createdAt: captureTime.toISOString(),
                searchCalls: searches.length,
                discoveredCount: discovered.size,
                analyzedCount: candidates.length,
                baselineChannels: baselineChannelIds.length,
                opportunities: opportunities.slice(0, 40),
                quota: this.quota.getStatus(captureTime)
            };
            this.store.completeResearchRun(runId, { result });
            return result;
        } catch (error) {
            this.store.completeResearchRun(runId, { status: 'failed', result: { error: error.message } });
            throw error;
        }
    }

    async analyzeVideo(videoInput) {
        const videoId = youtubeVideoId(videoInput);
        if (!videoId) throw new Error('Send a valid YouTube video URL or 11-character video ID.');
        const videos = await this.youtube.getVideos([videoId]);
        const video = videos[0];
        if (!video) throw new Error('YouTube did not return this video. It may be private, removed, or unavailable.');
        const channel = await this.youtube.getChannel(video.channelId);
        const baseline = await this.youtube.getRecentUploads(video.channelId, { limit: 25, channel });
        const snapshotHistory = this.store.getRecentSnapshots(video.id, 3);
        this.store.saveVideo(video);
        this.store.saveSnapshot(video.id, video);
        const evidence = await this.gdelt.searchArticles(video.title, { maxResults: 10, timespan: '30d' }).catch(() => []);
        const metrics = scoreOpportunity({
            video,
            query: video.title,
            baselineVideos: baseline.videos,
            snapshots: snapshotHistory,
            evidence
        });
        return { ...video, ...metrics, evidence };
    }

    async getIdeas(channelId, limit = 8) {
        const profile = getChannelProfile(channelId);
        const latest = this.store.getLatestResearchRun(profile.id, 'youtube-scan');
        const opportunities = latest?.result?.opportunities || [];
        return {
            channelId: profile.id,
            createdAt: latest?.created_at || null,
            status: latest?.status || 'not-scanned',
            opportunities: opportunities.slice(0, Math.max(1, Math.min(20, limit)))
        };
    }

    async generateMushiiScript(topic) {
        const cleanTopic = String(topic || '').trim().slice(0, 300);
        if (cleanTopic.length < 8) throw new Error('Give MUSHII a specific topic (at least 8 characters).');
        const runId = this.store.createResearchRun({
            channelId: 'mushii',
            runType: 'final-script',
            topic: cleanTopic
        });
        try {
            const prompt = [
                'You are the lead documentary researcher and Kinyarwanda narration writer for MUSHII.',
                'Research the topic using Google Search grounding. Prioritize official records, reputable journalism, academic or institutional sources, and primary documentation.',
                'Cross-check important dates, names, numbers, locations, and causal claims. Do not invent quotes, statistics, scenes, motives, or facts. Clearly distinguish documented facts from disputed or uncertain claims.',
                'Write an original, natural, fluent Kinyarwanda documentary narration for Kinyarwanda-speaking audiences in Rwanda and the diaspora.',
                'Use cinematic storytelling: an engaging opening, a clear narrative arc, strong transitions, context, consequences, and a satisfying ending.',
                'Target approximately 850–1,050 spoken words for a 7–9 minute narration. Never intentionally exceed 10 minutes.',
                'The output must contain ONLY the words to be narrated: no title, headings, bullet points, citations, source list, timestamps, stage directions, sound cues, visual prompts, production notes, or explanations.',
                'Do not copy source wording. Write original narration based on verified facts.',
                'TOPIC: ' + cleanTopic
            ].join('\n\n');
            const generated = await this.gemini.generateContent(prompt, {
                googleSearch: true,
                temperature: 0.35,
                maxOutputTokens: 10000
            });
            if (generated.sources.length < 2) {
                throw new Error('Google Search did not provide enough source references to verify this story. Try again with a more specific topic.');
            }
            const script = generated.text
                .replace(/^\x60{3}[a-z]*\s*/i, '')
                .replace(/\s*\x60{3}$/, '')
                .trim();
            const wordCount = script.split(/\s+/).filter(Boolean).length;
            if (wordCount < 450) {
                throw new Error('The generated narration was too short. Please retry with a more specific topic.');
            }
            const result = {
                script,
                wordCount,
                model: generated.model,
                sources: generated.sources,
                searchQueries: generated.searchQueries
            };
            this.store.completeResearchRun(runId, { result });
            return result;
        } catch (error) {
            this.store.completeResearchRun(runId, { status: 'failed', result: { error: error.message } });
            throw error;
        }
    }

    getQuotaStatus() {
        return this.quota.getStatus();
    }

    exportKernCsv() {
        const ideas = this.getIdeas('kern', 40);
        return Buffer.from(toCsv(ideas.opportunities || []), 'utf8');
    }

    close() {
        this.store.close();
    }
}

module.exports = {
    CreatorEngine,
    csvEscape,
    mapLimit,
    toCsv,
    youtubeVideoId
};
