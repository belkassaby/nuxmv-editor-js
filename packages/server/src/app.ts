import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { generateSmv, GenerationError, parseDiagram } from '@nuxmv-editor/language';
import { ENGINES, nuxmvInfo, runNuxmv, type Engine, type RunnerConfig } from './nuxmv-runner.js';

export interface AppOptions {
    runner: RunnerConfig;
    /** Directory of the built Angular application, served on `/`. */
    staticDir?: string;
    /** Maximum number of nuXmv processes running at the same time. */
    maxConcurrentRuns?: number;
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
        res.json({ ok: true, nuxmv: await nuxmvInfo(options.runner) });
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
