/**
 * MemoryCompactor — Periodic dedup + archive of stale facts.
 *
 * Uses an LLM to rewrite each memory file into a stable Active/Archive format,
 * merging duplicates, resolving conflicts, and moving expired facts to Archive.
 *
 * Usage:
 * - compactAll(): Force-compact all memory files immediately.
 * - maybeCompact(): Only runs if ≥6 hours have passed since last run (opportunistic).
 *   Call this at convenient trigger points (after extraction, on app load, etc.).
 *   There is no built-in timer — the caller decides when to invoke this.
 */

const COMPACT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_FILE_CHARS = 8000;

const COMPACTION_PROMPT = `You are compacting a markdown memory file into a stable long-term format.

Input is one memory file. Rewrite it into:

## Active
### <Topic>
- fact | topic=<topic> | updated_at=YYYY-MM-DD | expires_at=YYYY-MM-DD(optional)

## Archive
### <Topic>
- fact | topic=<topic> | updated_at=YYYY-MM-DD | expires_at=YYYY-MM-DD(optional)

Rules:
- Keep only concrete reusable facts.
- Merge semantic duplicates and keep the most recent/best phrasing.
- Resolve contradictions by keeping the most recently updated fact; older conflicting facts go to Archive.
- Expired facts (expires_at in the past) go to Archive.
- Keep Active concise. Move stale/low-priority/older overflow facts to Archive.
- Preserve meaning; do not invent facts.
- Output markdown only (no fences, no explanations).

Today: {TODAY}
Path: {PATH}

File content:
\`\`\`
{CONTENT}
\`\`\``;

class MemoryCompactor {
    constructor({ backend, bulletIndex, llmClient, model }) {
        this._backend = backend;
        this._bulletIndex = bulletIndex;
        this._llmClient = llmClient;
        this._model = model;
        this._lastRunAt = 0;
        this._running = false;
    }

    async maybeCompact() {
        if (this._running) return;
        const now = Date.now();
        if (now - this._lastRunAt < COMPACT_INTERVAL_MS) return;
        await this.compactAll();
    }

    async compactAll() {
        if (this._running) return;
        this._running = true;
        try {
            await this._backend.init();
            const allFiles = await this._backend.exportAll();
            const realFiles = allFiles.filter((file) => !file.path.endsWith('_index.md'));
            let changed = 0;

            for (const file of realFiles) {
                const compacted = await this._compactFileWithLlm(file.path, file.content || '');
                if (!compacted) continue;
                const original = String(file.content || '').trim();
                if (compacted.trim() === original) continue;
                await this._backend.write(file.path, compacted);
                await this._bulletIndex.refreshPath(file.path);
                changed += 1;
            }

            this._lastRunAt = Date.now();
        } finally {
            this._running = false;
        }
    }

    async _compactFileWithLlm(path, content) {
        const raw = String(content || '').trim();
        if (!raw) return null;

        const prompt = COMPACTION_PROMPT
            .replace('{TODAY}', new Date().toISOString().slice(0, 10))
            .replace('{PATH}', path)
            .replace('{CONTENT}', raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) + '\n...(truncated)' : raw);

        const response = await this._llmClient.createChatCompletion({
            model: this._model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1800,
            temperature: 0,
        });

        const text = (response.content || '').trim();
        if (!text) return null;
        return text;
    }
}

export { MemoryCompactor };
