import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { configFromEnv, nuxmvInfo } from './nuxmv-runner.js';
import { nurvExecutable } from './nurv-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env['PORT'] ?? 3000);
// Bind to loopback by default: the API runs a local binary on request.
const host = process.env['HOST'] ?? '127.0.0.1';
const staticDir = process.env['STATIC_DIR'] ?? resolve(here, '../../app/dist/app/browser');
const runner = configFromEnv();

const app = createApp({ runner, staticDir, nurv: nurvExecutable() });
app.listen(port, host, async () => {
    console.log(`nuxmv-editor server listening on http://${host}:${port}`);
    const info = await nuxmvInfo(runner);
    if (info.available) console.log(`Using ${info.version ?? 'nuXmv'} (${info.executable})`);
    else console.warn(`nuXmv not available (${info.error}). Set NUXMV_PATH to the nuXmv executable.`);
});
