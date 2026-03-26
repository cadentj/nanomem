/**
 * Normalization utilities for memory bullet metadata.
 */

export function safeDateIso(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

export function todayIsoDate() {
    return new Date().toISOString().slice(0, 10);
}

export function inferTopicFromPath(path) {
    if (!path || typeof path !== 'string') return 'general';
    const first = path.split('/')[0]?.trim().toLowerCase();
    return first || 'general';
}

export function normalizeTopic(value, fallback = 'general') {
    const source = String(value || '').trim().toLowerCase();
    const normalized = source
        .replace(/[^a-z0-9/_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-/]+|[-/]+$/g, '');
    return normalized || fallback;
}

export function normalizeFactText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeTier(value, fallback = 'long_term') {
    const source = String(value || '').trim().toLowerCase();
    if (['working', 'short_term', 'short-term'].includes(source)) return 'working';
    if (['long_term', 'long-term', 'longterm', 'active'].includes(source)) return 'long_term';
    if (['history', 'archive', 'archived'].includes(source)) return 'history';
    return fallback;
}

export function normalizeStatus(value, fallback = 'active') {
    const source = String(value || '').trim().toLowerCase();
    if (['active', 'current'].includes(source)) return 'active';
    if (['superseded', 'replaced', 'resolved'].includes(source)) return 'superseded';
    if (['expired', 'stale'].includes(source)) return 'expired';
    if (['uncertain', 'tentative'].includes(source)) return 'uncertain';
    return fallback;
}

export function normalizeSource(value, fallback = 'user_statement') {
    const source = String(value || '').trim().toLowerCase();
    if (['user_statement', 'user', 'explicit_user'].includes(source)) return 'user_statement';
    if (['assistant_summary', 'assistant', 'summary'].includes(source)) return 'assistant_summary';
    if (['inference', 'inferred'].includes(source)) return 'inference';
    if (['system', 'system_note'].includes(source)) return 'system';
    return fallback;
}

export function normalizeConfidence(value, fallback = 'medium') {
    const source = String(value || '').trim().toLowerCase();
    if (['high', 'strong'].includes(source)) return 'high';
    if (['medium', 'med', 'moderate'].includes(source)) return 'medium';
    if (['low', 'weak'].includes(source)) return 'low';
    return fallback;
}

export function defaultConfidenceForSource(source) {
    if (source === 'user_statement') return 'high';
    if (source === 'assistant_summary') return 'medium';
    if (source === 'system') return 'medium';
    return 'low';
}

export function inferTierFromSection(section) {
    if (section === 'working') return 'working';
    if (section === 'history') return 'history';
    return 'long_term';
}

export function inferStatusFromSection(section) {
    return section === 'history' ? 'superseded' : 'active';
}

export function normalizeTierToSection(value) {
    const tier = normalizeTier(value);
    if (tier === 'working') return 'working';
    if (tier === 'history') return 'history';
    return 'long_term';
}

export function inferTierFromBullet(bullet, fallback = 'long_term') {
    if (bullet?.reviewAt || bullet?.expiresAt) return 'working';

    const text = String(bullet?.text || '').toLowerCase();
    if (!text) return fallback;

    const workingPatterns = [
        /\bcurrently\b/,
        /\bright now\b/,
        /\bthis (week|month|quarter|year)\b/,
        /\bnext (week|month|quarter|year)\b/,
        /\bplanning\b/,
        /\bevaluating\b/,
        /\bconsidering\b/,
        /\btrying to\b/,
        /\bworking on\b/,
        /\bdebugging\b/,
        /\bpreparing\b/,
        /\binterviewing\b/,
        /\bin progress\b/,
        /\btemporary\b/,
        /\bfor now\b/,
        /\bas of \d{4}-\d{2}-\d{2}\b/
    ];

    return workingPatterns.some((pattern) => pattern.test(text)) ? 'working' : fallback;
}

export function ensureBulletMetadata(bullet, options = {}) {
    const fallbackTopic = normalizeTopic(options.defaultTopic || 'general');
    const fallbackUpdatedAt = options.updatedAt || todayIsoDate();
    const inferredTier = inferTierFromBullet(bullet, options.defaultTier || 'long_term');
    const preferredTier = bullet?.explicitTier ? bullet?.tier : inferredTier;
    const fallbackTier = normalizeTier(options.defaultTier || preferredTier || bullet?.tier || 'long_term');
    const fallbackStatus = normalizeStatus(
        options.defaultStatus
            || (bullet?.explicitStatus ? bullet?.status : null)
            || inferStatusFromSection(normalizeTierToSection(fallbackTier))
    );
    return {
        text: String(bullet?.text || '').trim(),
        topic: normalizeTopic(bullet?.topic || fallbackTopic, fallbackTopic),
        updatedAt: safeDateIso(bullet?.updatedAt) || fallbackUpdatedAt,
        expiresAt: safeDateIso(bullet?.expiresAt),
        reviewAt: safeDateIso(bullet?.reviewAt),
        tier: normalizeTier(preferredTier, fallbackTier),
        status: normalizeStatus(bullet?.status, fallbackStatus),
        source: normalizeSource(
            bullet?.source,
            normalizeSource(options.defaultSource, 'user_statement')
        ),
        confidence: normalizeConfidence(
            bullet?.confidence,
            normalizeConfidence(
                options.defaultConfidence,
                defaultConfidenceForSource(normalizeSource(
                    bullet?.source,
                    normalizeSource(options.defaultSource, 'user_statement')
                ))
            )
        ),
        section: normalizeTierToSection(preferredTier || fallbackTier)
    };
}

export function isExpiredBullet(bullet, today = todayIsoDate()) {
    if (!bullet?.expiresAt) return false;
    return String(bullet.expiresAt) < String(today);
}
