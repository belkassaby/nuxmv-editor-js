import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { generateSmv, GenerationError, parseDiagram } from '@nuxmv-editor/language';
import { ENGINES, nuxmvInfo, runNuxmv, type Engine, type RunnerConfig } from './nuxmv-runner.js';
import { nurvAvailable, runNurv } from './nurv-runner.js';

export interface AppOptions {
    runner: RunnerConfig;
    /** Directory of the built Angular application, served on `/`. */
    staticDir?: string;
    /** Maximum number of nuXmv processes running at the same time. */
    maxConcurrentRuns?: number;
    /** NuRV executable for full-LTL monitor generation (optional). */
    nurv?: string;
}

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly details?: unknown
    ) {
        super(message);
    }
}

export function createApp(options: AppOptions): express.Express {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '2mb' }));

    let running = 0;
    const maxRuns = options.maxConcurrentRuns ?? 2;

    app.get('/api/health', async (_req, res) => {
        res.json({ ok: true, nuxmv: await nuxmvInfo(options.runner), nurv: { available: nurvAvailable(options.nurv) } });
    });

    /** POST /api/nurv { diagram }: NuRV-generated full-LTL monitors (sources + build commands). */
    app.post('/api/nurv', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const executable = options.nurv;
            if (!executable || !nurvAvailable(executable)) throw new HttpError(503, 'NuRV is not configured: set NURV_PATH to the NuRV executable (https://es-static.fbk.eu/tools/nurv/).');
            const body = (req.body ?? {}) as { diagram?: unknown };
            if (typeof body.diagram !== 'string') throw new HttpError(400, "Provide 'diagram' (.nxd text).");
            const parsed = await parseDiagram(body.diagram);
            if (parsed.hasErrors) throw new HttpError(422, 'The diagram has errors.', parsed.diagnostics.filter(d => d.severity === 'error'));
            const result = await runNurv(parsed.model, executable);
            res.json({ files: result.files, monitors: result.monitors, build: result.build });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/verify
     *   { model: "<nuXmv model>" }            run a model as is, or
     *   { diagram: "<.nxd source>" }          generate the model from a diagram first
     *   engine?: "bdd" | "bmc" | "ic3", bound?: number
     */
    app.post('/api/verify', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const body = (req.body ?? {}) as { model?: unknown; diagram?: unknown; engine?: unknown; bound?: unknown };
            const engine = (body.engine ?? 'bdd') as Engine;
            if (!ENGINES.includes(engine)) throw new HttpError(400, `Unknown engine '${String(body.engine)}'. Use one of ${ENGINES.join(', ')}.`);
            if (body.bound !== undefined && (typeof body.bound !== 'number' || !Number.isFinite(body.bound))) {
                throw new HttpError(400, "'bound' must be a number.");
            }

            let model: string;
            if (typeof body.model === 'string') {
                model = body.model;
            } else if (typeof body.diagram === 'string') {
                const parsed = await parseDiagram(body.diagram);
                if (parsed.hasErrors) {
                    throw new HttpError(422, 'The diagram has errors.', parsed.diagnostics.filter(d => d.severity === 'error'));
                }
                model = generateSmv(parsed.model).text;
            } else {
                throw new HttpError(400, "Provide either 'model' (nuXmv text) or 'diagram' (.nxd text).");
            }

            if (running >= maxRuns) throw new HttpError(429, 'nuXmv is busy, try again in a moment.');
            running++;
            try {
                const result = await runNuxmv(model, { engine, bound: body.bound as number | undefined }, options.runner);
                res.json({ model, ...result });
            } finally {
                running--;
            }
        } catch (error) {
            next(error);
        }
    });

    // ------------------------------------------------------------------
    // Live link: a running Python state machine (EditorLink) posts each state
    // change; editors subscribed to the same channel receive it over SSE.
    // ------------------------------------------------------------------
    const channels = new Map<string, { clients: Set<Response>; commandClients: Set<Response>; last?: string }>();
    const channel = (name: string) => {
        if (!/^[\w-]{1,64}$/.test(name)) throw new HttpError(400, 'Channel names are 1-64 letters, digits, _ or -.');
        let c = channels.get(name);
        if (!c) channels.set(name, (c = { clients: new Set(), commandClients: new Set() }));
        return c;
    };

    app.post('/api/live/:channel', (req: Request, res: Response, next: NextFunction) => {
        try {
            const c = channel(String(req.params['channel']));
            const body = (req.body ?? {}) as Record<string, unknown>;
            if (typeof body['state'] !== 'string') throw new HttpError(400, "'state' (string) is required.");
            const update = JSON.stringify({ ...body, receivedAt: Date.now() });
            c.last = update;
            for (const client of c.clients) client.write(`data: ${update}\n\n`);
            res.json({ ok: true, listeners: c.clients.size });
        } catch (error) {
            next(error);
        }
    });

    // Two-way link: the editor sends events to the running machine (it applies them with send(),
    // so only transitions of the verified model can happen).
    app.post('/api/live/:channel/command', (req: Request, res: Response, next: NextFunction) => {
        try {
            const c = channel(String(req.params['channel']));
            const body = (req.body ?? {}) as Record<string, unknown>;
            if (typeof body['event'] !== 'string' || !/^[\w :()-]{1,128}$/.test(body['event'])) throw new HttpError(400, "'event' (string) is required.");
            const command = JSON.stringify({ event: body['event'], ...(body['values'] && typeof body['values'] === 'object' ? { values: body['values'] } : {}), sentAt: Date.now() });
            for (const client of c.commandClients) client.write(`data: ${command}\n\n`);
            res.json({ ok: true, listeners: c.commandClients.size });
        } catch (error) {
            next(error);
        }
    });

    app.get('/api/live/:channel/commands', (req: Request, res: Response, next: NextFunction) => {
        let c;
        try {
            c = channel(String(req.params['channel']));
        } catch (error) {
            next(error);
            return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n');
        c.commandClients.add(res);
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
        req.on('close', () => {
            clearInterval(keepAlive);
            c.commandClients.delete(res);
        });
    });

    app.get('/api/live/:channel/stream', (req: Request, res: Response, next: NextFunction) => {
        let c;
        try {
            c = channel(String(req.params['channel']));
        } catch (error) {
            next(error);
            return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n');
        if (c.last) res.write(`data: ${c.last}\n\n`);
        c.clients.add(res);
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);
        req.on('close', () => {
            clearInterval(keepAlive);
            c.clients.delete(res);
        });
    });

    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    if (options.staticDir && existsSync(join(options.staticDir, 'index.html'))) {
        const dir = options.staticDir;
        // Bundles have content hashes and can be cached; index.html must always be
        // revalidated so a rebuilt app is picked up on the next page load.
        app.use(
            express.static(dir, {
                index: 'index.html',
                maxAge: '1h',
                setHeaders: (res, path) => {
                    if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
                }
            })
        );
        app.get(/^\/(?!api\/).*/, (_req, res) => {
            res.setHeader('Cache-Control', 'no-cache');
            res.sendFile(join(dir, 'index.html'));
        });
    }

    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        if (error instanceof HttpError) {
            res.status(error.status).json({ error: error.message, details: error.details });
        } else if (error instanceof GenerationError) {
            res.status(422).json({ error: error.message });
        } else if (error instanceof SyntaxError && 'body' in error) {
            res.status(400).json({ error: 'Invalid JSON body.' });
        } else {
            const message = error instanceof Error ? error.message : String(error);
            const notFound = /not found/.test(message);
            res.status(notFound ? 503 : 500).json({ error: message });
        }
    });

    return app;
}
