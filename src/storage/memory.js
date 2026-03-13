/**
 * InMemoryStorage — In-memory storage backend for testing.
 *
 * Implements the full storage interface using a plain Map.
 * Data is lost when the process exits.
 */

import {
    countMemoryBullets,
    extractMemoryTitles,
    parseMemoryBullets,
} from '../bullets/utils.js';

const BOOTSTRAP_INDEX = `# Memory Index

## Structure
- personal/ — User background, preferences, interests, career
- projects/ — One file per project (e.g. projects/recipe-app.md)

_No memories yet._
`;

class InMemoryStorage {
    constructor() {
        this._files = new Map(); // path → { path, content, l0, itemCount, titles, parentPath, createdAt, updatedAt }
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        this._initialized = true;

        if (this._files.size > 0) return;

        const now = Date.now();
        const seeds = [
            { path: '_index.md', content: BOOTSTRAP_INDEX, l0: 'Root index of memory filesystem', parentPath: '', createdAt: now, updatedAt: now },
            { path: 'personal/about.md', content: '', l0: '', itemCount: 0, titles: [], parentPath: 'personal', createdAt: now, updatedAt: now },
            { path: 'projects/about.md', content: '', l0: '', itemCount: 0, titles: [], parentPath: 'projects', createdAt: now, updatedAt: now },
        ];

        for (const seed of seeds) {
            this._files.set(seed.path, seed);
        }
    }

    async read(path) {
        await this.init();
        const record = this._files.get(path);
        return record?.content ?? null;
    }

    async write(path, content) {
        await this.init();
        const now = Date.now();
        const existing = this._files.get(path);
        const nextContent = String(content || '');
        const parentPath = this._parentPath(path);

        const record = {
            path,
            content: nextContent,
            l0: this._generateL0(nextContent),
            itemCount: countMemoryBullets(nextContent),
            titles: extractMemoryTitles(nextContent),
            parentPath,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        this._files.set(path, record);

        // Rebuild index (non-blocking)
        this.rebuildIndex().catch(() => {});
    }

    async delete(path) {
        if (path.endsWith('_index.md')) return;
        await this.init();
        this._files.delete(path);
        this.rebuildIndex().catch(() => {});
    }

    async exists(path) {
        await this.init();
        return this._files.has(path);
    }

    async ls(dirPath) {
        await this.init();
        const prefix = dirPath ? dirPath + '/' : '';
        const files = [];
        const dirSet = new Set();

        for (const rec of this._files.values()) {
            if (prefix && !rec.path.startsWith(prefix)) continue;
            if (!prefix && rec.path === '_index.md') continue;

            const relative = rec.path.slice(prefix.length);
            if (!relative.includes('/')) {
                files.push(rec.path);
            } else {
                dirSet.add(relative.split('/')[0]);
            }
        }

        return { files, dirs: [...dirSet] };
    }

    async search(query) {
        await this.init();
        if (!query || !query.trim()) return [];
        const lowerQuery = query.toLowerCase();
        const results = [];

        for (const rec of this._files.values()) {
            if (rec.path.endsWith('_index.md')) continue;
            const idx = (rec.content || '').toLowerCase().indexOf(lowerQuery);
            if (idx === -1) continue;
            const start = Math.max(0, idx - 40);
            const end = Math.min(rec.content.length, idx + query.length + 40);
            results.push({
                path: rec.path,
                snippet: (start > 0 ? '...' : '') + rec.content.slice(start, end) + (end < rec.content.length ? '...' : ''),
            });
        }

        return results;
    }

    async getIndex() {
        return this.read('_index.md');
    }

    async rebuildIndex() {
        await this.init();
        const files = [...this._files.values()]
            .filter(r => !r.path.endsWith('_index.md'))
            .sort((a, b) => a.path.localeCompare(b.path));

        let indexContent = '# Memory Index\n\n';
        indexContent += '## Structure\n';
        indexContent += '- personal/ — User background, preferences, interests, career\n';
        indexContent += '- projects/ — One file per project (e.g. projects/recipe-app.md)\n\n';

        if (files.length > 0) {
            indexContent += '## Files\n';
            for (const f of files) {
                const count = f.itemCount || 0;
                const updated = f.updatedAt ? new Date(f.updatedAt).toISOString().split('T')[0] : '';
                const meta = count > 0
                    ? `(${count} item${count !== 1 ? 's' : ''}, updated ${updated})`
                    : updated ? `(updated ${updated})` : '';
                indexContent += `- ${f.path} ${meta} — ${f.l0}\n`;
            }
        } else {
            indexContent += '_No files yet._\n';
        }

        const existing = this._files.get('_index.md');
        const now = Date.now();

        this._files.set('_index.md', {
            path: '_index.md',
            content: indexContent,
            l0: 'Root index of memory filesystem',
            parentPath: '',
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    }

    async exportAll() {
        await this.init();
        return [...this._files.values()];
    }

    // ─── Internal Helpers ────────────────────────────────────────

    _parentPath(filePath) {
        const lastSlash = filePath.lastIndexOf('/');
        return lastSlash === -1 ? '' : filePath.slice(0, lastSlash);
    }

    _generateL0(content) {
        if (!content) return '';

        const bullets = parseMemoryBullets(content);
        if (bullets.length > 0) {
            const factTexts = bullets
                .filter(b => b.section !== 'archive')
                .slice(0, 4)
                .map(b => b.text.trim())
                .filter(Boolean);
            if (factTexts.length > 0) {
                const joined = factTexts.join('; ');
                return joined.length > 120 ? joined.slice(0, 117) + '...' : joined;
            }
        }

        const titles = extractMemoryTitles(content);
        if (titles.length > 0) {
            const joined = titles.join('; ');
            return joined.length > 120 ? joined.slice(0, 117) + '...' : joined;
        }

        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            return trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed;
        }
        return content.slice(0, 120);
    }
}

export { InMemoryStorage };
