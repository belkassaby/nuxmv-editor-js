/** What the tree-sitter front end records about files, classes, methods and state variables. */
import type { Node, Tree } from 'web-tree-sitter';
import type { FieldFact, Location, StateVariableFact } from '../ir.js';
import type { LanguageProfile } from './languages.js';


export interface Field {
    name: string;
    type?: string;
    init?: Node;
    loc: Location;
    visibility: FieldFact['visibility'];
    static: boolean;
    readonly: boolean;
}

export interface Method {
    name: string;
    node: Node;
    body?: Node;
    params: string[];
    visibility: FieldFact['visibility'];
    static: boolean;
    abstract: boolean;
    ctor: boolean;
    /** Go: name of the receiver (`j` in `func (j *Job) Start()`). */
    receiver?: string;
}

export interface ClassRec {
    id: string;
    name: string;
    node: Node;
    file: string;
    fields: Map<string, Field>;
    methods: Method[];
    extends?: string;
    implements: string[];
    decorators: string[];
    singleton: boolean;
    abstract: boolean;
}

export interface FileRec {
    file: string;
    profile: LanguageProfile;
    tree: Tree;
    text: string;
    test: boolean;
    classes: ClassRec[];
    /** Module-level variables (C/Go/Rust statics, Kotlin/Swift top-level properties). */
    globals: Map<string, Field>;
    functions: Method[];
}

export interface Var {
    fact: StateVariableFact;
    /** Enum the values belong to (undefined for inferred string/symbol domains). */
    enumName?: string;
    owner?: ClassRec;
    field: string;
    fileRec: FileRec;
    initial: Set<string>;
}

export interface Context {
    rec: FileRec;
    cls?: ClassRec;
    method?: Method;
}