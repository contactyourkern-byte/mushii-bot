'use strict';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

function parseIsoDuration(value) {
    const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if (!match) return 0;
    return (Number(match[1]) || 0) * 3600
        + (Number(match[2]) || 0) * 60
        + (Number(match[3]) || 0);
}

function normalizeVideo(item) {
    const snippet = item?.snippet || {};
    const stats = item?.statistics || {};
    const details = item?.contentDetails || {};
    const id = typeof item?.id === 'string' ? item.id : item?.id?.videoId;
    if (!id) return null;
    return {
        id,
        channelId: snippet.channelId || '',
        channelTitle: snippet.channelTitle || '',
        title: snippet.title || '',
        description: snippet.description || '',
        publishedAt: snippet.publishedAt || null,
        durationSeconds: parseIsoDuration(details.duration),
        viewCount: Number(stats.viewCount) || 0,
        likeCount: Number(stats.likeCount) || 0,
        commentCount: Number(stats.commentCount) || 0,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
        thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null
    };
}

function normalizeChannel(item) {
    if (!item?.id) return null;
    return {
        id: item.id,
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        publishedAt: item.snippet?.publishedAt || null,
        uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || null,
        videoCount: Number(item.statistics?.videoCount) || 0,
        viewCount: Number(item.statistics?.viewCount) || 0,
        subscriberCount: item.statistics?.hiddenSubscriberCount
            ? null
            : Number(item.statistics?.subscriberCount) || 0
    };
}

class YouTubeApiError extends Error {
    constructor(status, message, reason = '') {
        super(`YouTube Data API request failed (HTTP ${status})${reason ? `: ${reason}` : ''}: ${message}`);
        this.name = 'YouTubeApiError';
        this.status = status;
        this.reason = reason;
    }
}

class YouTubeDataApi {
    constructor(options = {}) {
        this.apiKey = options.apiKey || process.env.YOUTUBE_API_KEY || '';
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.quotaManager = options.quotaManager || null;
        this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
        if (typeof this.fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    }

    async request(method, params = {}) {
        if (!this.apiKey) throw new Error('YouTube API is not configured. Add YOUTUBE_API_KEY to the private config.env file.');
        if (method === 'search') {
            if (this.quotaManager) this.quotaManager.consumeYoutubeSearch(1);
        } else if (this.quotaManager) {
            this.quotaManager.consumeYoutubeUnits(1);
        }

        const url = new URL(`${API_BASE}/${method}`);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
        url.searchParams.set('key', this.apiKey);

        let response;
        try {
            response = await this.fetchImpl(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(this.timeoutMs)
            });
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                throw new Error('YouTube Data API request timed out.', { cause: error });
            }
            throw new Error('Could not reach YouTube Data API.', { cause: error });
        }

        let payload = {};
        try { payload = await response.json(); } catch { /* non-JSON error body */ }
        if (!response.ok) {
            const apiError = payload.error || {};
            const reason = apiError.errors?.[0]?.reason || '';
            const message = String(apiError.message || 'The API returned an error.')
                .replaceAll(this.apiKey, '[redacted]').slice(0, 300);
            if (response.status === 403 || response.status === 429) {
                throw new YouTubeApiError(response.status, message, reason || 'quota_or_access_denied');
            }
            throw new YouTubeApiError(response.status, message, reason);
        }
        return payload;
    }

    async searchVideos(options = {}) {
        const query = String(options.query || '').trim();
        if (!query) throw new TypeError('A YouTube search query is required.');
        const maxResults = Math.max(1, Math.min(50, Number(options.maxResults) || 25));
        const order = ['date', 'viewCount', 'relevance', 'rating', 'title', 'videoCount'].includes(options.order)
            ? options.order
            : 'relevance';
        const data = await this.request('search', {
            part: 'snippet',
            type: 'video',
            q: query,
            order,
            maxResults,
            publishedAfter: options.publishedAfter,
            publishedBefore: options.publishedBefore,
            pageToken: options.pageToken,
            regionCode: options.regionCode,
            relevanceLanguage: options.relevanceLanguage,
            videoDuration: options.videoDuration
        });
        return {
            items: (data.items || []).map(item => ({
                id: item.id?.videoId || '',
                channelId: item.snippet?.channelId || '',
                channelTitle: item.snippet?.channelTitle || '',
                title: item.snippet?.title || '',
                description: item.snippet?.description || '',
                publishedAt: item.snippet?.publishedAt || null,
                url: item.id?.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.id.videoId)}` : null
            })).filter(item => item.id),
            nextPageToken: data.nextPageToken || null,
            pageInfo: data.pageInfo || null
        };
    }

    async getVideos(videoIds) {
        const uniqueIds = [...new Set((videoIds || []).map(id => String(id || '').trim()).filter(Boolean))];
        const results = [];
        for (let index = 0; index < uniqueIds.length; index += 50) {
            const ids = uniqueIds.slice(index, index + 50);
            const data = await this.request('videos', {
                part: 'snippet,statistics,contentDetails',
                id: ids.join(',')
            });
            results.push(...(data.items || []).map(normalizeVideo).filter(Boolean));
        }
        return results;
    }

    async getChannels(channelIds) {
        const uniqueIds = [...new Set((channelIds || []).map(id => String(id || '').trim()).filter(Boolean))];
        const results = [];
        for (let index = 0; index < uniqueIds.length; index += 50) {
            const ids = uniqueIds.slice(index, index + 50);
            const data = await this.request('channels', {
                part: 'snippet,statistics,contentDetails',
                id: ids.join(',')
            });
            results.push(...(data.items || []).map(normalizeChannel).filter(Boolean));
        }
        return results;
    }

    async getChannel(channelId) {
        const channels = await this.getChannels([channelId]);
        return channels[0] || null;
    }

    async getRecentUploads(channelId, options = {}) {
        const limit = Math.max(1, Math.min(50, Number(options.limit) || 20));
        const channel = options.channel || await this.getChannel(channelId);
        if (!channel?.uploadsPlaylistId) return { channel, videos: [] };
        const playlist = await this.request('playlistItems', {
            part: 'snippet,contentDetails',
            playlistId: channel.uploadsPlaylistId,
            maxResults: limit
        });
        const ids = (playlist.items || [])
            .map(item => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
            .filter(Boolean);
        const videos = await this.getVideos(ids);
        return { channel, videos };
    }
}

module.exports = {
    API_BASE,
    YouTubeApiError,
    YouTubeDataApi,
    normalizeVideo,
    normalizeChannel,
    parseIsoDuration
};
