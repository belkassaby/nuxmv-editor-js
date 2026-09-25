/**
 * `pflow extract`: models of a code base, verified.
 *
 *   facts (TypeScript checker, Python ast)
 *     -> state machines, resource lifecycles, pattern contracts, architecture (models)
 *     -> nuXmv (or explicit-state checks)            -> findings with counterexamples
 *     -> paradigm and structural rules               -> findings
 *     -> optional LLM: computed writes, properties, fixes (each verified)
 */
import { join } from 'node:path';
import { loadConfig, type ProvenflowConfig } from './config.js';
import { mergeFacts, type Facts } from './ir.js';
import { analyseArchitecture, type ArchitectureResult } from './architecture.js';
import { buildLifecycles } from './lifecycles.js';
import { cachedProvider, resolveDynamicWrites, suggestFixes, suggestProperties, type LlmLog, type LlmProvider } from './llm.js';
import { buildStateMachines } from './machines.js';
import type { ExtractedModel, Finding } from './models.js';
import { analyseParadigm, type ParadigmProfile } from './paradigm.js';
import { analysePatterns, checkExpectations, type PatternInstance } from './patterns.js';
import { extractPython } from './python-frontend.js';
import { listSourceFiles, matchesAny } from './scan.js';
import { extractTypeScript } from './typescript-frontend.js';
import { verifyModels, type Checker, type SpecVerdict } from './verify.js';

export * from './config.js';
export * from './ir.js';
export * from './models.js';
export * from './llm.js';
export * from './report.js';
export { listSourceFiles } from './scan.js';
export type { Checker, SpecVerdict } from './verify.js';
export type { PatternInstance } from './patterns.js';
export type { ParadigmProfile } from './paradigm.js';

export interface ExtractOptions {
    config?: ProvenflowConfig;
    /** Path of the config file (default: <root>/provenflow.config.json). */
    configFile?: string;
    /** Runs nuXmv; without it the standard properties are checked explicitly. */
    checker?: Checker;
    llm?: LlmProvider;
    /** Ask the LLM for fixes of the first N warnings/errors (0: none). */
    llmFixes?: number;
    /** Where LLM answers are cached (default: <root>/.provenflow/cache). */
    cacheDir?: string;
    /** Files whose text replaces the file on disk (used to check fixes). */
    overrides?: Map<string, string>;
}

export interface ExtractionResult {
    root: string;
    files: number;
    config: ProvenflowConfig;
    facts: Facts;
    models: ExtractedModel[];
    findings: Finding[];
    verdicts: SpecVerdict[];
    patterns: PatternInstance[];
    paradigm: ParadigmProfile[];
    architecture: Pick<ArchitectureResult, 'edges'>;
    llm?: LlmLog & { provider: string };
    /** Notes about the run (skipped files, nuXmv errors). */
    notes: string[];
    checkedWith: 'nuxmv' | 'explicit';
}

export async function extractProject(root: string, options: ExtractOptions = {}): Promise<ExtractionResult> {
    const config = options.config ?? loadConfig(root, options.configFile);
    const files = listSourceFiles(root, config.include, config.exclude);
    const parsed = mergeFacts(extractTypeScript(root, files.filter(f => !f.endsWith('.py')), options.overrides), extractPython(root, files.filter(f => f.endsWith('.py')), options.overrides));

    const llmLog: LlmLog = { accepted: [], rejected: [] };
    const record = (log: LlmLog) => {
        llmLog.accepted.push(...log.accepted);
        llmLog.rejected.push(...log.rejected);
    };
    const llm = options.llm ? cachedProvider(options.llm, options.cacheDir ?? join(root, '.provenflow', 'cache')) : undefined;
    let facts = parsed;
    if (llm) {
        const resolved = await resolveDynamicWrites(parsed, llm);
        record(resolved.log);
        facts = { ...parsed, writes: resolved.writes };
    }

    const machines = buildStateMachines(facts, config);
    const lifecycles = buildLifecycles(facts);
    const patterns = analysePatterns(facts, config);
    const architecture = analyseArchitecture(facts, config);
    const instances = [...patterns.instances, ...architecture.facades];
    const paradigm = analyseParadigm(facts, config);
    let models = [...machines.models, ...lifecycles.models, ...patterns.models, ...architecture.models];
    if (llm) {
        const suggested = await suggestProperties(models, root, llm);
        record(suggested.log);
        models = suggested.models;
    }

    const verification = await verifyModels(models, options.checker);
    let findings = dedupe([
        ...machines.findings,
        ...lifecycles.findings,
        ...patterns.findings,
        ...checkExpectations(config, instances),
        ...architecture.findings,
        ...paradigm.findings,
        ...verification.findings
    ]);
    findings = applyIgnores(findings, config).sort(bySeverity);

    if (llm && (options.llmFixes ?? 0) > 0) {
        const rerun = async (overrides: Map<string, string>) =>
            (await extractProject(root, { config, checker: options.checker, overrides: new Map([...(options.overrides ?? []), ...overrides]) })).findings;
        const fixed = await suggestFixes(findings, root, llm, rerun, options.llmFixes);
        record(fixed.log);
        findings = fixed.findings;
    }

    return {
        root,
        files: facts.files.length,
        config,
        facts,
        models,
        findings,
        verdicts: verification.verdicts,
        patterns: instances,
        paradigm: paradigm.profiles,
        architecture: { edges: architecture.edges },
        llm: llm ? { provider: llm.name, ...llmLog } : undefined,
        notes: [...facts.notes, ...verification.errors, ...uncheckedNote(verification.verdicts)],
        checkedWith: options.checker && verification.errors.length < models.length ? 'nuxmv' : 'explicit'
    };
}

function uncheckedNote(verdicts: SpecVerdict[]): string[] {
    const unchecked = verdicts.filter(v => v.by === 'none');
    return unchecked.length > 0 ? [`${unchecked.length} declared or suggested propert${unchecked.length === 1 ? 'y was' : 'ies were'} not checked without nuXmv (${unchecked.slice(0, 3).map(v => `${v.model}: ${v.spec}`).join(', ')}${unchecked.length > 3 ? ', ...' : ''}). Set NUXMV_PATH.`] : [];
}

const ORDER = { error: 0, warning: 1, info: 2 } as const;

function bySeverity(a: Finding, b: Finding): number {
    return ORDER[a.severity] - ORDER[b.severity] || a.category.localeCompare(b.category) || (a.loc?.file ?? '').localeCompare(b.loc?.file ?? '') || (a.loc?.line ?? 0) - (b.loc?.line ?? 0);
}

/** The same problem found twice (e.g. by the graph check and by nuXmv) is reported once, keeping the proof. */
function dedupe(findings: Finding[]): Finding[] {
    const result: Finding[] = [];
    for (const f of findings) {
        const same = result.findIndex(x => x.rule === f.rule && x.subject === f.subject && x.loc?.file === f.loc?.file && x.loc?.line === f.loc?.line);
        if (same < 0) result.push(f);
        else if (f.source === 'nuxmv' || (f.counterexample && !result[same].counterexample)) result[same] = f;
    }
    return result;
}

function applyIgnores(findings: Finding[], config: ProvenflowConfig): Finding[] {
    const rules = config.ignore ?? [];
    return findings.filter(
        f => !rules.some(r => (r.rule === '*' || r.rule === f.rule) && (!r.subject || f.subject === r.subject || f.subject.startsWith(`${r.subject}.`) || f.subject.startsWith(`${r.subject} `)) && (!r.file || (f.loc && matchesAny(f.loc.file, [r.file]))))
    );
}
