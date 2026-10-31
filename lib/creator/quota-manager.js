'use strict';

const { QuotaLimitError } = require('./sqlite-store');

const YOUTUBE_SEARCH_DAILY_HARD_LIMIT = 100;
const YOUTUBE_DATA_UNITS_DAILY_HARD_LIMIT = 10000;

function dateInPacificTime(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(value);
    const part = type => parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

function boundedLimit(value, fallback, hardLimit) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, hardLimit);
}

class QuotaManager {
    constructor(store, options = {}) {
        if (!store || typeof store.consumeQuota !== 'function') {
            throw new TypeError('QuotaManager requires a persistent store.');
        }
        this.store = store;
        this.searchLimit = boundedLimit(
            options.searchLimit ?? process.env.CREATOR_YOUTUBE_SEARCH_DAILY_LIMIT,
            20,
            YOUTUBE_SEARCH_DAILY_HARD_LIMIT
        );
        this.dataUnitsLimit = boundedLimit(
            options.dataUnitsLimit ?? process.env.CREATOR_YOUTUBE_UNITS_DAILY_LIMIT,
            9000,
            YOUTUBE_DATA_UNITS_DAILY_HARD_LIMIT
        );
        this.geminiRequestsLimit = boundedLimit(
            options.geminiRequestsLimit ?? process.env.CREATOR_GEMINI_REQUESTS_DAILY_LIMIT,
            10,
            100
        );
    }

    consumeYoutubeSearch(cost = 1, now = new Date()) {
        return this.store.consumeQuota('youtube_search', dateInPacificTime(now), this.searchLimit, cost, now);
    }

    consumeYoutubeUnits(cost = 1, now = new Date()) {
        return this.store.consumeQuota('youtube_data_units', dateInPacificTime(now), this.dataUnitsLimit, cost, now);
    }

    consumeGeminiRequest(cost = 1, now = new Date()) {
        return this.store.consumeQuota('gemini_requests', dateInPacificTime(now), this.geminiRequestsLimit, cost, now);
    }

    getStatus(now = new Date()) {
        const quotaDate = dateInPacificTime(now);
        return {
            quotaDatePacific: quotaDate,
            youtubeSearch: {
                ...this.store.getQuota('youtube_search', quotaDate),
                limit: this.searchLimit,
                remaining: Math.max(0, this.searchLimit - this.store.getQuota('youtube_search', quotaDate).used)
            },
            youtubeDataUnits: {
                ...this.store.getQuota('youtube_data_units', quotaDate),
                limit: this.dataUnitsLimit,
                remaining: Math.max(0, this.dataUnitsLimit - this.store.getQuota('youtube_data_units', quotaDate).used)
            },
            geminiRequests: {
                ...this.store.getQuota('gemini_requests', quotaDate),
                limit: this.geminiRequestsLimit,
                remaining: Math.max(0, this.geminiRequestsLimit - this.store.getQuota('gemini_requests', quotaDate).used)
            }
        };
    }
}

module.exports = {
    QuotaManager,
    YOUTUBE_SEARCH_DAILY_HARD_LIMIT,
    YOUTUBE_DATA_UNITS_DAILY_HARD_LIMIT,
    dateInPacificTime
};
