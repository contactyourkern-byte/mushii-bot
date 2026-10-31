'use strict';

class GeminiApiError extends Error {
    constructor(status, message, statusText = '') {
        super(`Gemini API request failed (HTTP ${status})${statusText ? `: ${statusText}` : ''}: ${message}`);
        this.name = 'GeminiApiError';
        this.status = status;
    }
}

class GeminiClient {
    constructor(options = {}) {
        this.apiKey = options.apiKey
            || process.env.GEMINI_API_KEY
            || process.env.GOOGLE_AI_KEY
            || process.env.GOOGLE_API_KEY
            || '';
        this.model = options.model || process.env.CREATOR_GEMINI_MODEL || 'gemini-3.6-flash';
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.quotaManager = options.quotaManager || null;
        this.timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000);
        if (typeof this.fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
    }

    async generateContent(prompt, options = {}) {
        if (!this.apiKey) {
            throw new Error('Gemini is not configured. Add GEMINI_API_KEY to the private config.env file.');
        }
        const text = String(prompt || '').trim();
        if (!text) throw new TypeError('A non-empty Gemini prompt is required.');
        if (this.quotaManager) this.quotaManager.consumeGeminiRequest(1);

        const url = new URL(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`
        );
        url.searchParams.set('key', this.apiKey);
        const body = {
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
                temperature: Number.isFinite(options.temperature) ? options.temperature : 0.35,
                maxOutputTokens: Math.max(256, Math.min(12000, Number(options.maxOutputTokens) || 8000))
            }
        };
        if (options.googleSearch === true) body.tools = [{ google_search: {} }];

        let response;
        try {
            response = await this.fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs)
            });
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                throw new Error('Gemini request timed out.', { cause: error });
            }
            throw new Error('Could not reach Gemini API.', { cause: error });
        }

        let payload = {};
        try { payload = await response.json(); } catch { /* non-JSON error body */ }
        if (!response.ok) {
            const apiError = payload.error || {};
            const message = String(apiError.message || response.statusText || 'The API returned an error.')
                .replaceAll(this.apiKey, '[redacted]').slice(0, 400);
            throw new GeminiApiError(response.status, message, apiError.status || '');
        }

        const candidate = payload.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const output = parts.map(part => part.text || '').filter(Boolean).join('\n').trim();
        if (!output) {
            const reason = candidate?.finishReason || payload.promptFeedback?.blockReason || 'empty_response';
            throw new Error(`Gemini returned no text (${reason}).`);
        }

        const grounding = candidate?.groundingMetadata || {};
        const sources = (grounding.groundingChunks || [])
            .map(chunk => chunk.web)
            .filter(web => web?.uri)
            .map(web => ({ title: web.title || web.uri, url: web.uri }));
        const searchQueries = Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries : [];

        return {
            text: output,
            sources: [...new Map(sources.map(source => [source.url, source])).values()],
            searchQueries,
            model: this.model,
            finishReason: candidate.finishReason || null
        };
    }
}

module.exports = { GeminiApiError, GeminiClient };
