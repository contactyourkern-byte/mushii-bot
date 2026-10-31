'use strict';

function median(values) {
    const numbers = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!numbers.length) return null;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2
        ? numbers[middle]
        : (numbers[middle - 1] + numbers[middle]) / 2;
}

function durationClass(seconds) {
    return Number(seconds) <= 60 ? 'short' : 'long';
}

function getComparableBaseline(videos, candidate) {
    const sameFormat = (videos || []).filter(video => {
        const duration = Number(video.duration_seconds ?? video.durationSeconds) || 0;
        return durationClass(duration) === durationClass(candidate.duration_seconds ?? candidate.durationSeconds);
    });
    if (sameFormat.length >= 5) return sameFormat;
    return (videos || []).filter(video => durationClass(video.duration_seconds ?? video.durationSeconds) === 'long');
}

function storySignals(video) {
    const text = `${video.title || ''} ${video.description || ''}`.toLowerCase();
    const signals = {
        humanCharacter: /\b(hacker|teenager|teen|billionaire|ceo|founder|operative|spy|insider|employee|engineer|pilot|king|queen|investigator|family|man|woman|person)\b/.test(text),
        recognizableTarget: /\b(fbi|cia|bank|hospital|company|government|military|exchange|airport| nasa|agency|corporation|university|state)\b/.test(text),
        unusualMethod: /\b(fake|voice|phone call|deepfake|email|social engineering|inside job|secret|hidden|disguise|one mistake|single email)\b/.test(text),
        seriousConsequence: /\b(million|billion|stole|stolen|lost|collapse|crash|shut down|hostage|hijack|blackout|bankrupt|disaster)\b/.test(text),
        investigation: /\b(investigation|investigators|police|fbi|arrest|caught|tracked|traced|exposed|uncovered|revealed|court|trial)\b/.test(text)
    };
    const count = Object.values(signals).filter(Boolean).length;
    return { signals, count, score: count * 4 };
}

function keywordFit(video, query) {
    const stop = new Set(['the','and','for','with','from','that','this','how','what','when','where','why','who','into','your','about','behind']);
    const terms = [...new Set(String(query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(term => !stop.has(term));
    if (!terms.length) return 0;
    const text = `${video.title || ''} ${video.description || ''}`.toLowerCase();
    const hits = terms.filter(term => text.includes(term)).length;
    return Math.min(25, Math.round((hits / Math.min(terms.length, 5)) * 25));
}

function dailyGrowth(snapshots) {
    const ordered = [...(snapshots || [])].sort((a, b) => new Date(b.captured_at || b.capturedAt) - new Date(a.captured_at || a.capturedAt));
    if (ordered.length < 2) return null;
    const latest = ordered[0];
    const previous = ordered[1];
    const latestAt = new Date(latest.captured_at || latest.capturedAt).getTime();
    const previousAt = new Date(previous.captured_at || previous.capturedAt).getTime();
    const elapsedHours = (latestAt - previousAt) / 3600000;
    if (!Number.isFinite(elapsedHours) || elapsedHours < 20 || elapsedHours > 24 * 14) return null;
    const delta = Number(latest.view_count ?? latest.viewCount) - Number(previous.view_count ?? previous.viewCount);
    return {
        estimatedViewsPer24h: Math.round((delta / elapsedHours) * 24),
        rawViewChange: delta,
        elapsedHours: Number(elapsedHours.toFixed(1))
    };
}

function scoreOpportunity({ video, query, baselineVideos = [], snapshots = [], evidence = [] }) {
    const comparable = getComparableBaseline(baselineVideos, video);
    const channelMedian = median(comparable.map(item => item.view_count ?? item.viewCount));
    const views = Number(video.view_count ?? video.viewCount) || 0;
    const outlierMultiple = channelMedian > 0 ? views / channelMedian : null;
    const outlierScore = outlierMultiple === null
        ? null
        : Math.max(0, Math.min(25, Math.log2(Math.max(1, outlierMultiple)) / Math.log2(10) * 25));
    const fitScore = keywordFit(video, query);
    const story = storySignals(video);
    const momentum = dailyGrowth(snapshots);
    const momentumScore = momentum
        ? Math.max(0, Math.min(15, Math.log2(1 + Math.max(0, momentum.estimatedViewsPer24h)) / 16 * 15))
        : null;
    const domains = new Set((evidence || []).map(item => item.domain).filter(Boolean));
    const evidenceScore = Math.min(15, domains.size * 3.75);
    const components = [
        { weight: 25, score: outlierScore },
        { weight: 25, score: fitScore },
        { weight: 20, score: story.score },
        { weight: 15, score: momentumScore },
        { weight: 15, score: evidenceScore }
    ].filter(item => item.score !== null);
    const availableWeight = components.reduce((sum, item) => sum + item.weight, 0);
    const score = availableWeight
        ? Math.round(components.reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight * (100 / 25))
        : 0;

    return {
        outlierMultiple: outlierMultiple === null ? null : Number(outlierMultiple.toFixed(2)),
        channelMedian: channelMedian === null ? null : Math.round(channelMedian),
        baselineCount: comparable.length,
        outlierScore: outlierScore === null ? null : Number(outlierScore.toFixed(1)),
        fitScore,
        storyStrengthScore: story.score,
        storySignals: story.signals,
        momentum,
        momentumScore: momentumScore === null ? null : Number(momentumScore.toFixed(1)),
        evidenceCount: (evidence || []).length,
        evidenceDomains: [...domains],
        evidenceScore: Number(evidenceScore.toFixed(1)),
        score,
        scoreCoverage: Math.round(availableWeight)
    };
}

module.exports = { dailyGrowth, durationClass, getComparableBaseline, keywordFit, median, scoreOpportunity, storySignals };
