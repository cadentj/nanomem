/**
 * @openanonymity/memory — LLM-driven personal memory.
 *
 * createMemory(config) is the main entry point. It wires up an LLM client,
 * storage backend, bullet index, and the three core modules (retrieval,
 * extraction, compaction) into a single public API.
 */

import { createOpenAIClient } from './llm/openai.js';
import { createAnthropicClient } from './llm/anthropic.js';
import { MemoryBulletIndex } from './bullets/bulletIndex.js';
import { MemoryRetrieval } from './core/retrieval.js';
import { MemoryExtractor } from './core/extractor.js';
import { MemoryCompactor } from './core/compactor.js';
import { InMemoryStorage } from './storage/memory.js';

/**
 * Create a memory instance.
 *
 * @param {object} config
 * @param {object} [config.llm] — { apiKey, baseUrl, model, provider?, headers? }
 * @param {object} [config.llmClient] — custom LLM client (overrides config.llm)
 * @param {string} [config.model] — model ID (can also be set in config.llm.model)
 * @param {string|object} [config.storage='memory'] — 'indexeddb' | 'filesystem' | 'memory' | custom backend
 * @param {string} [config.storagePath] — root directory for filesystem backend
 */
export function createMemory(config = {}) {
    // ─── LLM Client ─────────────────────────────────────────────
    const llmClient = config.llmClient || _createLlmClient(config.llm || {});
    const model = config.model || config.llm?.model || 'gpt-4o';

    // ─── Storage Backend ─────────────────────────────────────────
    const backend = _createBackend(config.storage, config.storagePath);

    // ─── Bullet Index ────────────────────────────────────────────
    const bulletIndex = new MemoryBulletIndex(backend);

    // ─── Core Modules ────────────────────────────────────────────
    const retrieval = new MemoryRetrieval({ backend, bulletIndex, llmClient, model });
    const extractor = new MemoryExtractor({ backend, bulletIndex, llmClient, model });
    const compactor = new MemoryCompactor({ backend, bulletIndex, llmClient, model });

    // ─── Public API ──────────────────────────────────────────────
    return {
        /** Initialize the storage backend (creates seed files if empty). */
        init: () => backend.init(),

        /**
         * Retrieve relevant memory context for a query.
         * @param {string} query
         * @param {object} [options] — { conversationText, onProgress, onModelText, signal }
         * @returns {Promise<{files, paths, assembledContext}|null>}
         */
        retrieve: (query, options) => retrieval.retrieveForQuery(query, options),

        /**
         * Extract facts from a conversation into memory.
         * @param {Array<{role: string, content: string}>} messages
         * @param {object} [options] — { signal, onToolCall }
         * @returns {Promise<{status: string, writeCalls: number}>}
         */
        extract: (messages, options) => extractor.extract(messages, options),

        /**
         * Compact all memory files (dedup, archive stale facts).
         * Forces immediate compaction.
         */
        compact: () => compactor.compactAll(),

        /**
         * Compact only if ≥6 hours since last run (opportunistic).
         * Call at convenient trigger points (after extraction, on load).
         */
        maybeCompact: () => compactor.maybeCompact(),

        // ─── Direct Storage Access ──────────────────────────────
        read: (path) => backend.read(path),
        write: (path, content) => backend.write(path, content),
        delete: (path) => backend.delete(path),
        exists: (path) => backend.exists(path),
        search: (query) => backend.search(query),
        ls: (dirPath) => backend.ls(dirPath),
        getIndex: () => backend.getIndex(),
        rebuildIndex: () => backend.rebuildIndex(),
        exportAll: () => backend.exportAll(),

        // ─── Internals (for advanced use) ───────────────────────
        backend,
        bulletIndex,
    };
}

// ─── Internal Helpers ────────────────────────────────────────────

function _createLlmClient(llmConfig) {
    const { apiKey, baseUrl, headers, provider } = llmConfig;
    if (!apiKey) {
        throw new Error('createMemory: config.llm.apiKey is required (or provide config.llmClient)');
    }

    // Auto-detect provider from baseUrl if not specified
    const detectedProvider = provider || _detectProvider(baseUrl);

    if (detectedProvider === 'anthropic') {
        return createAnthropicClient({ apiKey, baseUrl, headers });
    }

    // Default: OpenAI-compatible (works with OpenAI, Tinfoil, OpenRouter, etc.)
    return createOpenAIClient({ apiKey, baseUrl, headers });
}

function _detectProvider(baseUrl) {
    if (!baseUrl) return 'openai';
    const lower = baseUrl.toLowerCase();
    if (lower.includes('anthropic.com')) return 'anthropic';
    return 'openai';
}

function _createBackend(storage, storagePath) {
    // Custom backend object
    if (storage && typeof storage === 'object' && typeof storage.read === 'function') {
        return storage;
    }

    const storageType = typeof storage === 'string' ? storage : 'memory';

    switch (storageType) {
        case 'indexeddb':
            // Dynamic import: indexeddb.js uses browser-only APIs that would fail in Node.
            // The MemoryFileSystem class is loaded on demand and cached.
            return _asyncBackend(() => import('./storage/indexeddb.js').then(m => new m.MemoryFileSystem()));
        case 'filesystem':
            // Dynamic import: filesystem.js uses node:fs which would fail in browsers.
            return _asyncBackend(() => import('./storage/filesystem.js').then(m => new m.FileSystemStorage(storagePath)));
        case 'memory':
        default:
            return new InMemoryStorage();
    }
}

/**
 * Wraps an async backend loader into a synchronous proxy object.
 *
 * createMemory() must return synchronously, but the 'indexeddb' and 'filesystem'
 * backends require dynamic import() because they use environment-specific APIs
 * (browser IndexedDB or node:fs). This wrapper defers the import to the first
 * method call — typically init() — and delegates all subsequent calls to the
 * loaded backend.
 */
function _asyncBackend(loader) {
    let _backend = null;
    let _loading = null;

    async function resolve() {
        if (_backend) return _backend;
        if (!_loading) _loading = loader().then(b => { _backend = b; return b; });
        return _loading;
    }

    const methods = ['init', 'read', 'write', 'delete', 'exists', 'ls', 'search', 'getIndex', 'rebuildIndex', 'exportAll'];
    const proxy = {};
    for (const method of methods) {
        proxy[method] = async (...args) => (await resolve())[method](...args);
    }
    return proxy;
}

// ─── Re-exports ──────────────────────────────────────────────────

export { createOpenAIClient } from './llm/openai.js';
export { createAnthropicClient } from './llm/anthropic.js';
export { InMemoryStorage } from './storage/memory.js';
export { MemoryBulletIndex } from './bullets/bulletIndex.js';
export { MemoryRetrieval } from './core/retrieval.js';
export { MemoryExtractor } from './core/extractor.js';
export { MemoryCompactor } from './core/compactor.js';
export {
    extractSessionsFromOAFastchatExport,
    extractConversationFromOAFastchatExport,
    listOAFastchatSessions
} from './imports/index.js';
export {
    createRetrievalExecutors,
    createExtractionExecutors
} from './storage/interface.js';
