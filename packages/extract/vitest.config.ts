import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@provenflow/language': fileURLToPath(new URL('../language/src/index.ts', import.meta.url))
        }
    },
    test: { testTimeout: 60_000 }
});
