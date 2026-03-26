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

Four methods:

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

    // Callbacks (optional, configured once)
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
| `'filesystem'` | Node.js | `.md` files on disk |
| `'indexeddb'` | Browser | IndexedDB |
| Custom object | Any | You decide |

### Custom Backend

Extend `BaseStorage` or implement the interface directly:

```js
import { BaseStorage } from '@openanonymity/memory/storage';

class MyStorage extends BaseStorage {
    async init() { }
    async read(path) { }            // → string | null
    async write(path, content) { }  // → void
    async delete(path) { }          // → void
    async exists(path) { }          // → boolean
    async rebuildIndex() { }        // → void
    async exportAll() { }           // → [{ path, content, updatedAt, itemCount, l0 }]
}

// BaseStorage provides default implementations for search(), ls(), getIndex()
```

## How Memory is Stored

Facts are stored as markdown bullets with metadata:

```markdown
- Allergic to peanuts | topic=health | source=user_statement | confidence=high | updated_at=2025-03-12
```

Each memory file has three sections (managed by compaction):

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

## Low-Level Access

For advanced use, storage methods are available with `_` prefix:

```js
await memory._read('health/allergies.md');
await memory._write('health/allergies.md', content);
await memory._search('peanut');
await memory._ls('health');
await memory._delete('temporary/old.md');
await memory._exportAll();
```

## Architecture

See [docs/memory-system.md](docs/memory-system.md) for implementation details including:

- The two-index system (file index for the LLM, bullet index for scoring)
- End-to-end extraction, retrieval, and compaction flows
- Module relationships and recommended reading order
