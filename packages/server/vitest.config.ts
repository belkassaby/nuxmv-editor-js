import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Code-base extraction (and re-checking proposed changes) takes seconds on CI machines.
    test: { testTimeout: 60_000 },
    resolve: {
        alias: {
            '@provenflow/language': fileURLToPath(new URL('../language/src/index.ts', import.meta.url)),
            '@provenflow/extract': fileURLToPath(new URL('../extract/src/index.ts', import.meta.url))
        }
    }
});
