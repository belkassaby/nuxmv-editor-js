/**
 * `provenflow.config.json`: what the project promises about itself. Every
 * part is optional; without it `pflow extract` still extracts the models and
 * runs the checks that need no declared intent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Style = 'functional' | 'object-oriented' | 'any';

export const PATTERNS = ['singleton', 'observer', 'factory', 'strategy', 'builder', 'adapter', 'decorator', 'state', 'command', 'facade'] as const;
export type PatternName = (typeof PATTERNS)[number];

export interface LayerConfig {
    name: string;
    /** Globs of the files in the layer. */
    paths: string[];
    /** Layers this layer may import (itself is always allowed). */
    mayImport?: string[];
    /** Programming style the layer follows; checked by the paradigm rules. */
    style?: Style;
}

export interface MachineConfig {
    /** States in which the machine may stop (overrides the naming heuristic). */
    terminal?: string[];
    /** Extra LTL/CTL properties, over `state = <value>`, e.g. "AG (state = closed -> AG state = closed)". */
    specs?: string[];
    /** Do not report this machine. */
    ignore?: boolean;
}

export interface PatternExpectation {
    /** Class, interface or function name. */
    subject: string;
    pattern: PatternName;
}

export interface IgnoreRule {
    rule: string;
    /** Subject (machine, class, file) the finding is about; all subjects when omitted. */
    subject?: string;
    /** Glob of files. */
    file?: string;
    reason?: string;
}

export interface Limits {
    classMethods: number;
    classLines: number;
    functionLines: number;
    inheritanceDepth: number;
    functionParams: number;
}

export interface ProvenflowConfig {
    include?: string[];
    exclude?: string[];
    layers?: LayerConfig[];
    /** Imports between packages go through their entry point (index), not deep paths. */
    packageEntries?: boolean;
    machines?: Record<string, MachineConfig>;
    patterns?: PatternExpectation[];
    ignore?: IgnoreRule[];
    limits?: Partial<Limits>;
}

export const DEFAULT_LIMITS: Limits = { classMethods: 30, classLines: 600, functionLines: 80, inheritanceDepth: 3, functionParams: 6 };

export const CONFIG_FILE = 'provenflow.config.json';

export function loadConfig(root: string, file?: string): ProvenflowConfig {
    const path = file ?? join(root, CONFIG_FILE);
    if (!existsSync(path)) return {};
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as ProvenflowConfig;
    } catch (error) {
        throw new Error(`${path}: ${(error as Error).message}`);
    }
}
