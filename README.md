# @openanonymity/memory

LLM-driven memory for agentic systems. Plug it into any agent to give it persistent, structured memory backed by markdown files.

The system uses an LLM to decide what to save (extraction), what to recall (retrieval), and how to consolidate (compaction). Memory is stored as human-readable markdown — not hidden vector state.

## Quick Start

```js
import { createMemory } from '@openanonymity/memory';

const memory = createMemory({
    llm: { apiKey: 'sk-...', model: 'gpt-4o' },
});

await memory.init();
```

## API

### High-level (LLM-driven)

```js
// Save facts from a conversation
await memory.extract([
    { role: 'user', content: 'I just moved to San Francisco' },
    { role: 'assistant', content: 'Welcome to SF!' },
]);

// Retrieve relevant context for a query
const result = await memory.retrieve('Where do I live?');
// → { files, paths, assembledContext }

// With conversation context (helps resolve "that", "the same", etc.)
const result = await memory.retrieve('Tell me more about that', conversationText);

// Compact all memory files (dedup, archive stale facts)
await memory.compact();
```

### Low-level (direct storage)

```js
await memory.storage.read('health/allergies.md');
await memory.storage.write('health/allergies.md', content);
await memory.storage.delete('temporary/old.md');
await memory.storage.exists('health/allergies.md');
await memory.storage.search('peanut');
await memory.storage.ls('health');
await memory.storage.getIndex();
await memory.storage.rebuildIndex();
await memory.storage.exportAll();
```

### Utilities (portability)

```js
const str = await memory.serialize();  // single string, all files
const zip = await memory.toZip();      // Uint8Array, valid ZIP
```

The standalone functions also work directly on an `exportAll()` result:

```js
import { serialize, deserialize, toZip } from '@openanonymity/memory/utils';

const records = await memory.storage.exportAll();
const str = serialize(records);          // → string
const back = deserialize(str);           // → [{ path, content }, ...]
const zip = toZip(records);              // → Uint8Array
```

## Configuration

```js
const memory = createMemory({
    // LLM provider (required — pick one)
    llm: { apiKey, baseUrl, model, provider, headers },
    // or bring your own client:
    llmClient: { createChatCompletion, streamChatCompletion },
    model: 'gpt-4o',

    // Storage backend (default: 'ram')
    storage: 'ram',              // 'ram' | 'filesystem' | 'indexeddb' | custom backend object
    storagePath: './memory/',    // for 'filesystem' backend

    // Callbacks (optional)
    onProgress: ({ stage, message }) => {},   // retrieval progress
    onToolCall: (name, args, result) => {},   // extraction tool calls
    onModelText: (text) => {},                // intermediate model text
});
```

## LLM Providers

### OpenAI / Tinfoil / OpenRouter

```js
createMemory({
    llm: { apiKey: 'sk-...', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
});
```

### Anthropic

```js
createMemory({
    llm: { apiKey: 'sk-ant-...', provider: 'anthropic', model: 'claude-sonnet-4-6' },
});
```

### Custom LLM Client

```js
createMemory({
    llmClient: {
        async createChatCompletion({ model, messages, tools, max_tokens, temperature }) {
            // → { content: string, tool_calls: [{ id, function: { name, arguments } }] }
        },
    },
    model: 'your-model-id',
});
```

## Storage Backends

| Config | Environment | Persistence |
|--------|-------------|-------------|
| `'ram'` (default) | Any | None — data lost on exit |
| `'filesystem'` | Node.js | Files on disk |
| `'indexeddb'` | Browser | IndexedDB |
| Custom object | Any | You decide |

### Custom Backend

Extend `BaseStorage` and implement the raw I/O layer:

```js
import { BaseStorage } from '@openanonymity/memory/backends';

class MyStorage extends BaseStorage {
    async init() { }
    async _readRaw(path) { }              // → string | null
    async _writeRaw(path, content, meta) { } // meta: { l0, itemCount, titles }
    async delete(path) { }
    async exists(path) { }               // → boolean
    async rebuildIndex() { }
    async exportAll() { }                // → [{ path, content, updatedAt, itemCount, l0 }]
}

// BaseStorage provides: read(), write(), search(), ls(), getIndex()
// read/write handle fact interning and resolution transparently.
```

## How Memory is Stored

### Fact store

Every fact is assigned a unique integer ID and stored in `_facts.json`:

```json
{
  "0": "Allergic to peanuts | topic=health | source=user_statement | confidence=high | updated_at=2025-03-12",
  "1": "Lives in San Francisco | topic=location | tier=long_term | ..."
}
```

`.md` files on disk reference facts by ID:

```
- {0}
- {1}
```

`read()` resolves references transparently — callers always see full text. Writing the same fact with updated metadata reuses its existing ID (deduplication by fact text, ignoring metadata).

### File structure

Each memory file has three sections managed by compaction:

```markdown
# Memory: Health

## Working
### Current context
- Currently adjusting medication | tier=working | source=user_statement | ...

## Long-Term
### Stable facts
- Allergic to peanuts | tier=long_term | source=user_statement | ...

## History
### No longer current
- Was on old medication | tier=history | status=superseded | ...
```

There is no hardcoded folder structure. The LLM organizes files into folders naturally based on the topics discussed.

## Source Layout

```
src/
├── index.js          — createMemory(), public API
├── engine/       — LLM-driven: retrieval, extractor, compactor, executors, toolLoop
├── backends/        — storage backends: ram, filesystem, indexeddb, BaseStorage, schema
├── bullets/          — bullet format utilities: parser, normalize, scoring, compaction
├── llm/              — LLM client wrappers: openai, anthropic
└── utils/            — portability (serialize/toZip), oaFastchat adapter
```
