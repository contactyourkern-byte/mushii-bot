'use strict';

const KERN_PILLARS = [
    {
        id: 'cybercrime',
        label: 'Cybercrime & Digital Intelligence',
        queries: [
            'hacker social engineering true story',
            'cybercrime billion dollar heist investigation',
            'North Korea cyber attack bank heist',
            'dark web marketplace takedown',
            'deepfake voice fraud true story',
            'ransomware hospital cyber attack',
            'SIM swapping cryptocurrency theft',
            'state sponsored hackers cyber espionage'
        ]
    },
    {
        id: 'luxury-logistics',
        label: 'Logistics of Luxury',
        queries: [
            'how superyachts are transported documentary',
            'luxury supercar global transport logistics',
            'private jet logistics behind the scenes',
            'how rare art is transported securely'
        ]
    },
    {
        id: 'luxury-business',
        label: 'Luxury Industry & Business',
        queries: [
            'how luxury brands built billion dollar empires',
            'luxury business empire investigation documentary',
            'luxury brand business strategy documentary',
            'inside the global luxury goods industry'
        ]
    },
    {
        id: 'luxury-wealth',
        label: 'Luxury Lifestyle & Wealth',
        queries: [
            'billionaire superyacht true cost documentary',
            'private island billionaire investigation',
            'inside extreme luxury lifestyle documentary',
            'how billionaires manage private aviation'
        ]
    },
    {
        id: 'history',
        label: 'High-Stakes History & Forgotten Events',
        queries: [
            'forgotten historical operation documentary',
            'mysterious historical event investigation',
            'high stakes history true story documentary',
            'forgotten event that changed the world'
        ]
    },
    {
        id: 'science-technology',
        label: 'Strange Science & Technology',
        queries: [
            'strange science mystery explained documentary',
            'unusual technology mystery investigation',
            'scientific anomaly true story documentary',
            'mysterious engineering failure investigation'
        ]
    },
    {
        id: 'human-extremes',
        label: 'Human Extremes & Extraordinary Stories',
        queries: [
            'extraordinary human survival true story documentary',
            'human endurance extreme true story',
            'unbelievable real life story documentary',
            'person who survived impossible circumstances'
        ]
    }
];

const MUSHII_PILLARS = [
    {
        id: 'african-rwandan-history',
        label: 'African & Rwandan History',
        queries: [
            'Rwanda history documentary untold story',
            'African kingdoms forgotten history documentary',
            'East African historical mystery',
            'African historical figures extraordinary story'
        ]
    },
    {
        id: 'mysteries',
        label: 'Mysteries & Untold Stories',
        queries: [
            'African mystery true story documentary',
            'Rwanda unsolved historical mystery',
            'untold African stories documentary',
            'mysterious places in Africa history'
        ]
    },
    {
        id: 'real-life',
        label: 'Celebrity & Real-Life Stories',
        queries: [
            'African celebrity biography documentary',
            'African public figure untold story',
            'extraordinary African real life story',
            'African artist rise and fall documentary'
        ]
    },
    {
        id: 'amazing-facts',
        label: 'Amazing Facts & Discoveries',
        queries: [
            'amazing facts about Africa documentary',
            'little known facts about Rwanda',
            'African discoveries explained documentary',
            'surprising facts about African culture'
        ]
    }
];

const CHANNEL_PROFILES = Object.freeze({
    kern: Object.freeze({
        id: 'kern',
        name: 'KERN',
        language: 'en',
        audience: 'International documentary viewers',
        channelDescription: 'Cinematic documentaries for the endlessly curious. Kern uncovers the extraordinary stories, mysteries, and hidden forces shaping our world. From high-stakes history and strange science to human extremes and forgotten events, every video follows a compelling question beneath the surface. One channel. Infinite curiosity. Always something waiting to be uncovered. New Documentary Almost Weekly.',
        outputMode: 'opportunity-report',
        scriptGeneration: false,
        maxVideoSeconds: 600,
        targetVideoSeconds: { min: 420, max: 540 },
        pillars: KERN_PILLARS
    }),
    mushii: Object.freeze({
        id: 'mushii',
        name: 'MUSHII',
        language: 'rw',
        audience: 'Kinyarwanda speakers worldwide, including diaspora',
        channelDescription: 'African Stories & Entertainment told in natural Kinyarwanda for audiences in Rwanda and across the Kinyarwanda-speaking diaspora.',
        outputMode: 'final-narration-script',
        scriptGeneration: true,
        maxVideoSeconds: 600,
        targetVideoSeconds: { min: 420, max: 540 },
        pillars: MUSHII_PILLARS
    })
});

function normalizeChannelId(channelId) {
    return String(channelId || '').trim().toLowerCase();
}

function getChannelProfile(channelId) {
    const id = normalizeChannelId(channelId);
    const profile = CHANNEL_PROFILES[id];
    if (!profile) {
        throw new Error('Unknown channel. Use "kern" or "mushii".');
    }
    return profile;
}

function getSearchQueries(channelId, options = {}) {
    const profile = getChannelProfile(channelId);
    const perPillar = Math.max(1, Math.min(8, Number(options.perPillar) || 2));
    const queries = [];
    for (const pillar of profile.pillars) {
        for (const query of pillar.queries.slice(0, perPillar)) {
            queries.push({ pillarId: pillar.id, pillar: pillar.label, query });
        }
    }
    return queries;
}

module.exports = {
    CHANNEL_PROFILES,
    getChannelProfile,
    getSearchQueries,
    normalizeChannelId
};
