/**
 * Interactive authentication for `memory login`.
 *
 * All providers: API key paste
 */

import { writeConfigFile, CONFIG_FILE_PATH } from './config.js';

// ─── Main entry point ─────────────────────────────────────────────

export async function loginInteractive(flags = {}) {
    const provider = await promptChoice('Provider', ['openai', 'anthropic', 'tinfoil']);

    const labels = { openai: 'OpenAI', anthropic: 'Anthropic', tinfoil: 'Tinfoil' };
    const apiKey = await promptSecret(`Paste your ${labels[provider]} API key`);

    const toSave = { provider, apiKey };
    if (flags.model) toSave.model = flags.model;
    if (flags.path)  toSave.path  = flags.path;

    await writeConfigFile(toSave);
    return { status: 'logged_in', provider, configFile: CONFIG_FILE_PATH };
}

// ─── Arrow-key choice selector ────────────────────────────────────

function promptChoice(label, choices) {
    if (!process.stdin.isTTY) {
        throw new Error(`${label} selection requires an interactive terminal.`);
    }

    return new Promise(resolve => {
        let idx = 0;

        process.stderr.write(`\n? ${label}\n`);
        drawChoices(choices, idx);

        const { stdin } = process;
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf-8');

        function cleanup() {
            stdin.setRawMode(wasRaw);
            stdin.pause();
            stdin.removeListener('data', onData);
        }

        function onData(data) {
            switch (data) {
                case '\u0003': // Ctrl-C
                    cleanup();
                    process.stderr.write('\n');
                    process.exit(1);
                    break;
                case '\x1b[A': // Up arrow
                    idx = (idx - 1 + choices.length) % choices.length;
                    redrawChoices(choices, idx);
                    break;
                case '\x1b[B': // Down arrow
                    idx = (idx + 1) % choices.length;
                    redrawChoices(choices, idx);
                    break;
                case '\r': case '\n': { // Enter — collapse to single line
                    cleanup();
                    // Move back to first choice line and show only the selected item
                    process.stderr.write(`\x1b[${choices.length}A`);
                    process.stderr.write(`\r\x1b[2K  \x1b[36m❯\x1b[0m ${choices[idx]}\n`);
                    for (let i = 1; i < choices.length; i++) {
                        process.stderr.write('\r\x1b[2K\n');
                    }
                    resolve(choices[idx]);
                    break;
                }
            }
        }

        stdin.on('data', onData);
    });
}

function drawChoices(choices, selected) {
    for (let i = 0; i < choices.length; i++) {
        const isSelected = i === selected;
        const cursor = isSelected ? '\x1b[36m❯\x1b[0m' : ' ';
        const text   = isSelected ? `\x1b[36m${choices[i]}\x1b[0m` : choices[i];
        process.stderr.write(`  ${cursor} ${text}\n`);
    }
}

function redrawChoices(choices, selected) {
    process.stderr.write(`\x1b[${choices.length}A`);
    drawChoices(choices, selected);
}

// ─── Masked secret input ──────────────────────────────────────────

function promptSecret(label) {
    if (!process.stdin.isTTY) {
        throw new Error('API key input requires an interactive terminal. Use --api-key instead.');
    }

    return new Promise((resolve, reject) => {
        process.stderr.write(`\n? ${label}: `);

        const { stdin } = process;
        if (!stdin.isTTY) return reject(new Error('Not a TTY'));

        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf-8');

        let value = '';

        function cleanup() {
            stdin.setRawMode(wasRaw);
            stdin.pause();
            stdin.removeListener('data', onData);
        }

        function onData(char) {
            switch (char) {
                case '\r': case '\n':
                    cleanup();
                    process.stderr.write('\n');
                    if (!value) reject(new Error('No key entered.'));
                    else resolve(value);
                    break;
                case '\u0003': // Ctrl-C
                    cleanup();
                    process.stderr.write('\n');
                    process.exit(1);
                    break;
                case '\u007f': case '\b': // Backspace
                    if (value.length > 0) {
                        value = value.slice(0, -1);
                        process.stderr.write('\b \b'); // erase last visible character
                    }
                    break;
                default:
                    if (char >= ' ') {
                        value += char;
                        process.stderr.write(char);
                    }
            }
        }

        stdin.on('data', onData);
    });
}
