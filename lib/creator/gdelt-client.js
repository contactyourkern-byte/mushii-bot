'use strict';

const API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

class GdeltClient {
    constructor(options = {}) {
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
        if (typeof this.fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    }

    async searchArticles(query, options = {}) {
        const cleanQuery = String(query || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
        if (!cleanQuery) throw new TypeError('A GDELT search query is required.');
        const url = new URL(API_URL);
        url.searchParams.set('query', cleanQuery);
        url.searchParams.set('mode', 'ArtList');
        url.searchParams.set('format', 'json');
        url.searchParams.set('sort', 'HybridRel');
        url.searchParams.set('maxrecords', String(Math.max(1, Math.min(50, Number(options.maxResults) || 10))));
        url.searchParams.set('timespan', options.timespan || '30d');

        let response;
        try {
            response = await this.fetchImpl(url, {
                headers: { Accept: 'application/json', 'User-Agent': 'MUSHII-Creator-Studio/1.0' },
                signal: AbortSignal.timeout(this.timeoutMs)
            });
        } catch (error) {
            throw new Error('Could not reach GDELT article search.', { cause: error });
        }
        if (!response.ok) throw new Error(`GDELT article search failed (HTTP ${response.status}).`);
        const payload = await response.json();
        return (payload.articles || []).map(article => ({
            title: String(article.title || '').slice(0, 300),
            url: article.url || '',
            domain: article.domain || '',
            publishedAt: article.seendate || null,
            language: article.language || '',
            sourceCountry: article.sourcecountry || ''
        })).filter(article => article.url);
    }
}

module.exports = { GdeltClient, GDELT_API_URL: API_URL };
