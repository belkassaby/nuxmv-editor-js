/**
 * Language profiles for the tree-sitter front end: which syntax nodes are
 * enums, classes, functions, assignments, conditions and cases in each
 * language, and its idioms for resources, singletons and side effects. The
 * front end itself (frontend.ts) is the same for every language.
 */
import type { ResourceKind } from '../ir.js';

export type LanguageId = 'java' | 'kotlin' | 'groovy' | 'scala' | 'c' | 'cpp' | 'c_sharp' | 'go' | 'rust' | 'swift' | 'ruby' | 'php' | 'r';

export interface ResourceRule {
    kind: ResourceKind;
    /** Matches the callee (or `new Type`) of an acquisition. */
    acquire: RegExp;
    /** Matches the callee of a release; the handle is the receiver (`h.close()`) or the first argument (`free(h)`). */
    release: RegExp;
    releaseHandle: 'receiver' | 'argument';
}

export interface LanguageProfile {
    id: LanguageId;
    name: string;
    extensions: string[];
    /** File name of the grammar: in tree-sitter-wasms, or vendored under grammars/. */
    grammar: string;
    vendored?: boolean;
    /** Rewrites the text before parsing without moving any line (e.g. statement terminators). */
    preprocess?: (text: string) => string;

    /** Nodes declaring an enum, and the nodes naming its members. */
    enums: Array<{ node: string; member: string; when?: RegExp }>;
    classes: string[];
    /** Nodes declaring an interface, trait or protocol. */
    interfaces: string[];
    /** `impl Type {}` (Rust): methods attached to another declaration. */
    impls?: string[];
    functions: string[];
    /** Field declarations inside a class body. */
    fields: string[];
    /** Top-level variable declarations (module state). */
    globals: string[];
    assignments: string[];
    /** Struct literal fields (`Job { state: Idle }`, `Job{state: Idle}`): initial values. */
    structFields?: string[];
    ifs: string[];
    /** `unless` forms: the condition is negated. */
    unless?: string[];
    switches: string[];
    cases: string[];
    calls: string[];
    imports: string[];
    /** Blocks whose `finally`/`defer`/`ensure`/`using` releases run on every path. */
    guarded: string[];
    /** Receiver tokens: `this.x`, `self.x`, `$this->x`, `@x`, `self$x`. */
    self: RegExp;
    /** Constructor method names (besides the class name). */
    constructors: string[];
    dispose: RegExp;
    /** Object creation, with the class name in group 1. */
    creation: RegExp;
    resources: ResourceRule[];
    effects: RegExp;
    mutators: string[];
    /** Anonymous functions and callbacks. */
    lambda: RegExp;
    notImplemented: RegExp;
    /** A class the language itself makes a singleton (Kotlin/Scala `object`, Ruby `include Singleton`...). */
    singleton?: RegExp;
    /** How imports map to project files. */
    resolve: (spec: string, file: string, files: string[]) => string | undefined;
    /** Visibility when there is no modifier. */
    defaultVisibility: 'public' | 'private';
    /** Visibility from the name (Go: capitalised is exported). */
    visibilityByName?: (name: string) => 'public' | 'private';
}

// ------------------------------------------------------------------ resolution

const byPackagePath = (exts: string[]) => (spec: string, _file: string, files: string[]) => {
    const path = spec.replace(/^static\s+/, '').replace(/\.\*$/, '').replace(/[.:]+/g, '/').replace(/\\/g, '/');
    return files.find(f => exts.some(e => f.endsWith(`/${path}${e}`) || f === `${path}${e}`)) ?? files.find(f => exts.some(e => f.endsWith(`/${path.split('/').slice(0, -1).join('/')}${e}`)));
};

const relative = (exts: string[]) => (spec: string, file: string, files: string[]) => {
    const dir = file.split('/').slice(0, -1);
    const parts = [...dir, ...spec.split('/')];
    const out: string[] = [];
    for (const p of parts) {
        if (p === '..') out.pop();
        else if (p !== '.' && p) out.push(p);
    }
    const base = out.join('/');
    return files.find(f => f === base || exts.some(e => f === `${base}${e}`)) ?? files.find(f => f.endsWith(`/${spec}`) || exts.some(e => f.endsWith(`/${spec}${e}`)));
};

const include = (spec: string, file: string, files: string[]) => relative([''])(spec, file, files);

const rustUse = (spec: string, _file: string, files: string[]) => {
    const parts = spec.replace(/^(crate|self|super)::/, '').split('::').filter(p => !/[{}*]/.test(p));
    for (let n = parts.length; n > 0; n--) {
        const path = parts.slice(0, n).join('/');
        const hit = files.find(f => f.endsWith(`src/${path}.rs`) || f.endsWith(`src/${path}/mod.rs`));
        if (hit) return hit;
    }
    return undefined;
};

const goImport = (spec: string, _file: string, files: string[]) => {
    const segments = spec.split('/');
    for (let n = segments.length; n > 0; n--) {
        const dir = segments.slice(-n).join('/');
        const hit = files.find(f => f.startsWith(`${dir}/`) || f.includes(`/${dir}/`));
        if (hit && hit.split('/').slice(0, -1).join('/').endsWith(dir)) return hit;
    }
    return undefined;
};

// --------------------------------------------------------------------- shared

const JAVA_LIKE_RESOURCES: ResourceRule[] = [
    { kind: 'file', acquire: /^new\s+(File(Input|Output)Stream|FileReader|FileWriter|BufferedReader|BufferedWriter|RandomAccessFile|PrintWriter|Scanner|ZipFile|JarFile)\b|Files\.new(BufferedReader|BufferedWriter|InputStream|OutputStream)$/, release: /\.close$/, releaseHandle: 'receiver' },
    { kind: 'socket', acquire: /^new\s+(Socket|ServerSocket|DatagramSocket)\b|\.accept$/, release: /\.close$/, releaseHandle: 'receiver' },
    { kind: 'lock', acquire: /\.lock$/, release: /\.unlock$/, releaseHandle: 'receiver' },
    { kind: 'executor', acquire: /Executors\.new\w+$/, release: /\.(shutdown|shutdownNow|close)$/, releaseHandle: 'receiver' },
    { kind: 'timeout', acquire: /\.schedule(AtFixedRate|WithFixedDelay)?$|^new\s+Timer\b/, release: /\.(cancel|shutdown)$/, releaseHandle: 'receiver' },
    { kind: 'listener', acquire: /\.add\w*Listener$/, release: /\.remove\w*Listener$/, releaseHandle: 'receiver' }
];

const JAVA_EFFECTS = /\b(System\.(out|err|in|exit|currentTimeMillis|nanoTime)|Files\.|new\s+File|Thread\.sleep|Math\.random|new\s+Random|LocalDateTime\.now|Instant\.now|println|print)\b/;
const JAVA_MUTATORS = ['add', 'addAll', 'remove', 'removeIf', 'clear', 'put', 'putAll', 'set', 'sort', 'push', 'pop', 'offer', 'poll', 'append', 'insert'];

/**
 * Groovy lines end without `;`: add one where Java syntax needs it, and write the empty string `''`
 * as `""` (the grammar does not parse it). Lines never move, so locations stay right.
 */
function groovyTerminators(text: string): string {
    const lines = text.replace(/(?<!['\\])''(?!')/g, '""').split('\n');
    return lines
        .map((line, i) => {
            const t = line.trimEnd();
            const next = (lines[i + 1] ?? '').trim();
            if (!t.trim() || /[{}(\[,;:=+\-*/&|?.>\\]$/.test(t) || /^(\.|\?\.|\)|&&|\|\||\?|:)/.test(next) || /^\s*(\/\/|\*|\/\*|@|import\b.*;$)/.test(t)) return line;
            if (/^\s*(if|for|while|else|switch|catch|finally|try|do)\b.*\)?$/.test(t) && !/\breturn\b|=/.test(t.replace(/^\s*(if|while)\s*\(.*?\)\s*/, ''))) return line;
            return `${t};${line.slice(t.length)}`;
        })
        .join('\n');
}

// ------------------------------------------------------------------- profiles

export const PROFILES: LanguageProfile[] = [
    {
        id: 'java',
        name: 'Java',
        extensions: ['.java'],
        grammar: 'tree-sitter-java.wasm',
        vendored: true,
        enums: [{ node: 'enum_declaration', member: 'enum_constant' }],
        classes: ['class_declaration', 'record_declaration', 'enum_declaration'],
        interfaces: ['interface_declaration'],
        functions: ['method_declaration', 'constructor_declaration'],
        fields: ['field_declaration'],
        globals: [],
        assignments: ['assignment_expression'],
        ifs: ['if_statement'],
        switches: ['switch_expression', 'switch_statement'],
        cases: ['switch_block_statement_group', 'switch_rule'],
        calls: ['method_invocation', 'object_creation_expression'],
        imports: ['import_declaration'],
        guarded: ['finally_clause', 'resource_specification'],
        self: /^this\s*\.\s*/,
        constructors: [],
        dispose: /^(close|shutdown|dispose|stop|destroy|cleanup)$/,
        creation: /\bnew\s+([A-Z]\w*)\s*[(<]/g,
        resources: JAVA_LIKE_RESOURCES,
        effects: JAVA_EFFECTS,
        mutators: JAVA_MUTATORS,
        lambda: /->|::\w/,
        notImplemented: /throw\s+new\s+(UnsupportedOperationException|NotImplementedException|RuntimeException\(\s*"(not implemented|TODO))/i,
        resolve: byPackagePath(['.java']),
        defaultVisibility: 'public'
    },
    {
        id: 'kotlin',
        name: 'Kotlin',
        extensions: ['.kt', '.kts'],
        grammar: 'tree-sitter-kotlin.wasm',
        enums: [{ node: 'class_declaration', member: 'enum_entry', when: /^\s*(\w+\s+)*enum\s+class\b/ }],
        classes: ['class_declaration', 'object_declaration'],
        interfaces: [],
        functions: ['function_declaration', 'secondary_constructor'],
        fields: ['property_declaration'],
        globals: ['property_declaration'],
        assignments: ['assignment'],
        ifs: ['if_expression'],
        switches: ['when_expression'],
        cases: ['when_entry'],
        calls: ['call_expression'],
        imports: ['import_header'],
        guarded: ['finally_block'],
        self: /^this\s*\.\s*/,
        constructors: ['init'],
        dispose: /^(close|dispose|stop|destroy|cleanup|onDestroy|onCleared)$/,
        creation: /(?<![\w.])([A-Z]\w*)\s*\(/g,
        resources: [
            { kind: 'file', acquire: /^(File(Input|Output)Stream|FileReader|FileWriter|BufferedReader)$|\.(bufferedReader|bufferedWriter|inputStream|outputStream)$/, release: /\.close$/, releaseHandle: 'receiver' },
            { kind: 'lock', acquire: /\.lock$/, release: /\.unlock$/, releaseHandle: 'receiver' },
            { kind: 'timeout', acquire: /^(Timer|launch)$|\.schedule$/, release: /\.cancel$/, releaseHandle: 'receiver' }
        ],
        effects: /\b(println|print|System\.|File\(|Random|currentTimeMillis|readLine)\b/,
        mutators: [...JAVA_MUTATORS, 'plusAssign'],
        lambda: /\{\s*(\w+\s*(,\s*\w+)*\s*->|it\b)|::\w/,
        notImplemented: /\bTODO\(|throw\s+(NotImplementedError|UnsupportedOperationException)/,
        singleton: /^\s*(\w+\s+)*object\s+\w+/,
        resolve: byPackagePath(['.kt', '.kts']),
        defaultVisibility: 'public'
    },
    {
        id: 'groovy',
        name: 'Groovy',
        extensions: ['.groovy', '.gradle'],
        grammar: 'tree-sitter-groovy.wasm',
        vendored: true,
        preprocess: groovyTerminators,
        enums: [{ node: 'enum_declaration', member: 'enum_constant' }],
        classes: ['class_declaration', 'enum_declaration'],
        interfaces: ['interface_declaration'],
        functions: ['method_declaration', 'constructor_declaration'],
        fields: ['field_declaration'],
        globals: [],
        assignments: ['assignment_expression'],
        ifs: ['if_statement'],
        switches: ['switch_expression', 'switch_statement'],
        cases: ['switch_block_statement_group', 'switch_rule'],
        calls: ['method_invocation', 'object_creation_expression'],
        imports: ['import_declaration'],
        guarded: ['finally_clause'],
        self: /^this\s*\.\s*/,
        constructors: [],
        dispose: /^(close|shutdown|dispose|stop|destroy|cleanup)$/,
        creation: /\bnew\s+([A-Z]\w*)\s*[(<]/g,
        resources: JAVA_LIKE_RESOURCES,
        effects: /\b(println|print|System\.|new\s+File|Math\.random|Thread\.sleep)\b/,
        mutators: [...JAVA_MUTATORS, 'leftShift'],
        lambda: /\{\s*(\w+\s*(,\s*\w+)*\s*->|it\b)|->/,
        notImplemented: /throw\s+new\s+(UnsupportedOperationException|NotImplementedException)/,
        singleton: /@Singleton\b/,
        resolve: byPackagePath(['.groovy', '.java']),
        defaultVisibility: 'public'
    },
    {
        id: 'scala',
        name: 'Scala',
        extensions: ['.scala', '.sc'],
        grammar: 'tree-sitter-scala.wasm',
        vendored: true,
        // Scala 3 enums; Scala 2 enumerations (a sealed trait and its case objects) are read in the front end.
        enums: [{ node: 'enum_definition', member: 'simple_enum_case' }],
        classes: ['class_definition', 'object_definition', 'trait_definition'],
        interfaces: ['trait_definition'],
        functions: ['function_definition'],
        fields: ['var_definition', 'val_definition'],
        globals: [],
        assignments: ['assignment_expression'],
        ifs: ['if_expression'],
        switches: ['match_expression'],
        cases: ['case_clause'],
        calls: ['call_expression', 'instance_expression'],
        imports: ['import_declaration'],
        guarded: ['finally_clause'],
        self: /^this\s*\.\s*/,
        constructors: [],
        dispose: /^(close|shutdown|dispose|stop|destroy)$/,
        creation: /\bnew\s+([A-Z]\w*)\s*[(\[]|(?<![\w.])([A-Z]\w*)\s*\(/g,
        resources: [{ kind: 'file', acquire: /Source\.fromFile$|^new\s+(FileInputStream|FileOutputStream|FileReader|PrintWriter)\b/, release: /\.close$/, releaseHandle: 'receiver' }],
        effects: /\b(println|print|System\.|Source\.|Random|currentTimeMillis)\b/,
        mutators: ['+=', 'append', 'update', 'remove', 'clear', 'put', 'addOne', 'subtractOne'],
        lambda: /=>/,
        notImplemented: /\?\?\?|throw\s+new\s+(NotImplementedError|UnsupportedOperationException)/,
        singleton: /^\s*(\w+\s+)*object\s+\w+/,
        resolve: byPackagePath(['.scala']),
        defaultVisibility: 'public'
    },
    {
        id: 'c',
        name: 'C',
        extensions: ['.c', '.h'],
        grammar: 'tree-sitter-c.wasm',
        enums: [{ node: 'enum_specifier', member: 'enumerator' }],
        classes: [],
        interfaces: [],
        functions: ['function_definition'],
        fields: [],
        globals: ['declaration'],
        assignments: ['assignment_expression'],
        structFields: ['initializer_pair'],
        ifs: ['if_statement'],
        switches: ['switch_statement'],
        cases: ['case_statement'],
        calls: ['call_expression'],
        imports: ['preproc_include'],
        guarded: [],
        self: /^(self|this)\s*->\s*/,
        constructors: [],
        dispose: /(_destroy|_free|_close|_cleanup|_deinit|_shutdown)$/,
        creation: /\b(?:\w+_)?(?:new|create|alloc)_?([A-Z]\w*)\s*\(/g,
        resources: [
            { kind: 'memory', acquire: /^(malloc|calloc|realloc|strdup|strndup)$/, release: /^free$/, releaseHandle: 'argument' },
            { kind: 'file', acquire: /^(fopen|fdopen|tmpfile|popen|opendir)$/, release: /^(fclose|pclose|closedir)$/, releaseHandle: 'argument' },
            { kind: 'socket', acquire: /^(socket|accept|open)$/, release: /^close$/, releaseHandle: 'argument' },
            { kind: 'lock', acquire: /^pthread_mutex_lock$/, release: /^pthread_mutex_unlock$/, releaseHandle: 'argument' }
        ],
        effects: /\b(printf|fprintf|puts|putchar|scanf|fopen|fwrite|fread|rand|time|exit|system)\s*\(/,
        mutators: [],
        lambda: /\(\s*\*\s*\w+\s*\)\s*\(/,
        notImplemented: /abort\s*\(\s*\)|assert\s*\(\s*0\s*&&\s*"not implemented/i,
        resolve: include,
        defaultVisibility: 'public'
    },
    {
        id: 'cpp',
        name: 'C++',
        extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.h++'],
        grammar: 'tree-sitter-cpp.wasm',
        enums: [{ node: 'enum_specifier', member: 'enumerator' }],
        classes: ['class_specifier', 'struct_specifier'],
        interfaces: [],
        functions: ['function_definition'],
        fields: ['field_declaration'],
        globals: ['declaration'],
        assignments: ['assignment_expression'],
        structFields: ['initializer_pair'],
        ifs: ['if_statement'],
        switches: ['switch_statement'],
        cases: ['case_statement'],
        calls: ['call_expression', 'new_expression', 'delete_expression'],
        imports: ['preproc_include'],
        guarded: [],
        self: /^this\s*->\s*/,
        constructors: [],
        dispose: /^(~\w+|close|shutdown|dispose|stop|destroy|release|reset)$/,
        creation: /\b(?:new\s+|std::make_(?:unique|shared)<)([A-Z]\w*)/g,
        resources: [
            { kind: 'memory', acquire: /^new\s/, release: /^delete\b/, releaseHandle: 'argument' },
            { kind: 'memory', acquire: /^(malloc|calloc|realloc)$/, release: /^free$/, releaseHandle: 'argument' },
            { kind: 'file', acquire: /^(fopen|popen)$/, release: /^(fclose|pclose)$/, releaseHandle: 'argument' },
            { kind: 'lock', acquire: /\.lock$|^pthread_mutex_lock$/, release: /\.unlock$|^pthread_mutex_unlock$/, releaseHandle: 'receiver' }
        ],
        effects: /\b(std::cout|std::cerr|printf|fprintf|std::rand|rand|time|std::chrono|fopen|std::ifstream|std::ofstream|exit)\b/,
        mutators: ['push_back', 'emplace_back', 'insert', 'erase', 'clear', 'pop_back', 'push', 'pop', 'emplace', 'resize', 'assign'],
        lambda: /\[[&=\w\s,]*\]\s*\(/,
        notImplemented: /throw\s+std::(logic_error|runtime_error)\(\s*"(not implemented|TODO)/i,
        resolve: include,
        defaultVisibility: 'private'
    },
    {
        id: 'c_sharp',
        name: 'C#',
        extensions: ['.cs'],
        grammar: 'tree-sitter-c_sharp.wasm',
        enums: [{ node: 'enum_declaration', member: 'enum_member_declaration' }],
        classes: ['class_declaration', 'struct_declaration', 'record_declaration'],
        interfaces: ['interface_declaration'],
        functions: ['method_declaration', 'constructor_declaration', 'destructor_declaration'],
        fields: ['field_declaration', 'property_declaration'],
        globals: [],
        assignments: ['assignment_expression'],
        ifs: ['if_statement'],
        switches: ['switch_statement', 'switch_expression'],
        cases: ['switch_section', 'switch_expression_arm'],
        calls: ['invocation_expression', 'object_creation_expression'],
        imports: ['using_directive'],
        guarded: ['finally_clause', 'using_statement'],
        self: /^this\s*\.\s*/,
        constructors: [],
        dispose: /^(Dispose|DisposeAsync|Close|Stop|Shutdown|OnDestroy)$/,
        creation: /\bnew\s+([A-Z]\w*)\s*[(<{]/g,
        resources: [
            { kind: 'file', acquire: /^new\s+(FileStream|StreamReader|StreamWriter|BinaryReader|BinaryWriter)\b|File\.(Open|OpenRead|OpenWrite|Create)\w*$/, release: /\.(Close|Dispose)$/, releaseHandle: 'receiver' },
            { kind: 'timeout', acquire: /^new\s+(Timer|CancellationTokenSource)\b/, release: /\.(Dispose|Stop|Cancel)$/, releaseHandle: 'receiver' },
            { kind: 'lock', acquire: /Monitor\.Enter$|\.Wait$/, release: /Monitor\.Exit$|\.Release$/, releaseHandle: 'argument' }
        ],
        effects: /\b(Console\.|File\.|DateTime\.Now|new\s+Random|Environment\.|Thread\.Sleep)\b/,
        mutators: ['Add', 'AddRange', 'Remove', 'RemoveAt', 'Clear', 'Insert', 'Push', 'Pop', 'Enqueue', 'Dequeue', 'Sort'],
        lambda: /=>/,
        notImplemented: /throw\s+new\s+(NotImplementedException|NotSupportedException)/,
        resolve: () => undefined,
        defaultVisibility: 'private'
    },
    {
        id: 'go',
        name: 'Go',
        extensions: ['.go'],
        grammar: 'tree-sitter-go.wasm',
        // Go enumerations are typed constants (`const ( Idle State = iota; Running )`), read in the front end.
        enums: [],
        classes: ['type_spec'],
        interfaces: [],
        functions: ['function_declaration', 'method_declaration'],
        fields: ['field_declaration'],
        globals: ['var_declaration'],
        assignments: ['assignment_statement'],
        structFields: ['keyed_element'],
        ifs: ['if_statement'],
        switches: ['expression_switch_statement'],
        cases: ['expression_case', 'default_case'],
        calls: ['call_expression'],
        imports: ['import_spec'],
        guarded: ['defer_statement'],
        self: /^(?!)/,
        constructors: [],
        dispose: /^(Close|Stop|Shutdown|Cancel|Release)$/,
        creation: /&([A-Z]\w*)\s*\{|\bNew([A-Z]\w*)\s*\(/g,
        resources: [
            { kind: 'file', acquire: /^os\.(Open|Create|OpenFile)$|^net\.(Dial|Listen)\w*$/, release: /\.Close$/, releaseHandle: 'receiver' },
            { kind: 'lock', acquire: /\.(R)?Lock$/, release: /\.(R)?Unlock$/, releaseHandle: 'receiver' },
            { kind: 'timeout', acquire: /^time\.(NewTicker|NewTimer|AfterFunc)$/, release: /\.Stop$/, releaseHandle: 'receiver' },
            { kind: 'subscription', acquire: /^context\.With(Cancel|Timeout|Deadline)$/, release: /^cancel$/, releaseHandle: 'receiver' }
        ],
        effects: /\b(fmt\.Print|log\.|os\.|time\.Now|rand\.|http\.|ioutil\.)/,
        mutators: ['append'],
        lambda: /\bfunc\s*\(/,
        notImplemented: /panic\(\s*"(not implemented|TODO|unimplemented)/i,
        resolve: goImport,
        defaultVisibility: 'private',
        visibilityByName: name => (/^[A-Z]/.test(name) ? 'public' : 'private')
    },
    {
        id: 'rust',
        name: 'Rust',
        extensions: ['.rs'],
        grammar: 'tree-sitter-rust.wasm',
        enums: [{ node: 'enum_item', member: 'enum_variant' }],
        classes: ['struct_item', 'enum_item'],
        interfaces: ['trait_item'],
        impls: ['impl_item'],
        functions: ['function_item'],
        fields: ['field_declaration'],
        globals: ['static_item'],
        assignments: ['assignment_expression'],
        structFields: ['field_initializer'],
        ifs: ['if_expression'],
        switches: ['match_expression'],
        cases: ['match_arm'],
        calls: ['call_expression', 'macro_invocation'],
        imports: ['use_declaration', 'mod_item'],
        guarded: [],
        self: /^self\s*\.\s*/,
        constructors: ['new', 'default'],
        dispose: /^(drop|close|shutdown|stop)$/,
        creation: /\b([A-Z]\w*)::(?:new|default|with_\w+)\s*\(|\b([A-Z]\w*)\s*\{\s*\w+\s*:/g,
        // Ownership releases resources when they go out of scope (RAII): only explicit leaks are tracked.
        resources: [{ kind: 'memory', acquire: /^(Box::leak|std::mem::forget|mem::forget|Box::into_raw)$/, release: /^(Box::from_raw|drop)$/, releaseHandle: 'argument' }],
        effects: /\b(println!|print!|eprintln!|std::fs::|fs::|std::time|SystemTime::now|Instant::now|rand::|std::process::exit)/,
        mutators: ['push', 'push_str', 'insert', 'remove', 'clear', 'pop', 'extend', 'retain', 'truncate', 'sort'],
        lambda: /\|[\w\s,:&]*\|/,
        notImplemented: /\b(unimplemented!|todo!)\s*\(|panic!\(\s*"(not implemented|TODO)/i,
        singleton: /\b(OnceLock|OnceCell|Lazy|lazy_static!)\b/,
        resolve: rustUse,
        defaultVisibility: 'private'
    },
    {
        id: 'swift',
        name: 'Swift',
        extensions: ['.swift'],
        grammar: 'tree-sitter-swift.wasm',
        enums: [{ node: 'class_declaration', member: 'enum_entry', when: /^\s*(\w+\s+)*enum\s+\w+/ }],
        classes: ['class_declaration'],
        interfaces: ['protocol_declaration'],
        functions: ['function_declaration', 'init_declaration', 'deinit_declaration'],
        fields: ['property_declaration'],
        globals: ['property_declaration'],
        assignments: ['assignment'],
        ifs: ['if_statement', 'guard_statement'],
        unless: ['guard_statement'],
        switches: ['switch_statement'],
        cases: ['switch_entry'],
        calls: ['call_expression'],
        imports: ['import_declaration'],
        guarded: ['defer_statement'],
        self: /^self\s*\.\s*/,
        constructors: ['init'],
        dispose: /^(deinit|close|stop|invalidate|cancel)$/,
        creation: /(?<![\w.])([A-Z]\w*)\s*\(/g,
        resources: [
            { kind: 'timeout', acquire: /Timer\.scheduledTimer$/, release: /\.invalidate$/, releaseHandle: 'receiver' },
            { kind: 'listener', acquire: /\.addObserver$/, release: /\.removeObserver$/, releaseHandle: 'receiver' },
            { kind: 'file', acquire: /FileHandle\(forReadingAtPath|fopen$/, release: /\.closeFile$|\.close$|^fclose$/, releaseHandle: 'receiver' }
        ],
        effects: /\b(print|debugPrint|Date\(\)|FileManager|UserDefaults|arc4random|Int\.random|URLSession)\b/,
        mutators: ['append', 'insert', 'remove', 'removeAll', 'removeLast', 'removeFirst', 'sort'],
        lambda: /\{\s*(\[\w+\s+\w+\]\s*)?(\(?[\w\s,]*\)?\s+in\b|\$0)/,
        notImplemented: /fatalError\(\s*"(not implemented|TODO|unimplemented)/i,
        singleton: /static\s+(let|var)\s+shared\s*=/,
        resolve: () => undefined,
        defaultVisibility: 'public'
    },
    {
        id: 'ruby',
        name: 'Ruby',
        extensions: ['.rb'],
        grammar: 'tree-sitter-ruby.wasm',
        enums: [],
        classes: ['class', 'module'],
        interfaces: [],
        functions: ['method', 'singleton_method'],
        fields: [],
        globals: [],
        assignments: ['assignment', 'operator_assignment'],
        ifs: ['if', 'if_modifier', 'unless', 'unless_modifier', 'elsif'],
        unless: ['unless', 'unless_modifier'],
        switches: ['case'],
        cases: ['when', 'else'],
        calls: ['call'],
        imports: ['call'],
        guarded: ['ensure'],
        self: /^(@|self\.)/,
        constructors: ['initialize'],
        dispose: /^(close|shutdown|stop|dispose|cleanup)$/,
        creation: /\b([A-Z]\w*)\.new\b/g,
        resources: [
            { kind: 'file', acquire: /^(File|IO)\.(open|new)$|^open$|TCPSocket\.new$/, release: /\.close$/, releaseHandle: 'receiver' },
            { kind: 'lock', acquire: /\.lock$/, release: /\.unlock$/, releaseHandle: 'receiver' }
        ],
        effects: /\b(puts|print|p|pp|gets|File\.|IO\.|Time\.now|rand|sleep|system|`)\b/,
        mutators: ['<<', 'push', 'append', 'concat', 'delete', 'clear', 'insert', 'store', 'merge!', 'map!', 'select!', 'reject!', 'sort!', 'shift', 'unshift', 'pop'],
        lambda: /\bdo\s*\||\{\s*\|/,
        notImplemented: /raise\s+NotImplementedError/,
        singleton: /include\s+Singleton\b/,
        resolve: (spec, file, files) => relative(['.rb'])(spec, file, files) ?? files.find(f => f.endsWith(`lib/${spec}.rb`)),
        defaultVisibility: 'public'
    },
    {
        id: 'php',
        name: 'PHP',
        extensions: ['.php'],
        grammar: 'tree-sitter-php.wasm',
        enums: [{ node: 'enum_declaration', member: 'enum_case' }],
        classes: ['class_declaration', 'trait_declaration', 'enum_declaration'],
        interfaces: ['interface_declaration'],
        functions: ['method_declaration', 'function_definition'],
        fields: ['property_declaration'],
        globals: [],
        assignments: ['assignment_expression'],
        ifs: ['if_statement'],
        switches: ['switch_statement', 'match_expression'],
        cases: ['case_statement', 'default_statement', 'match_conditional_expression', 'match_default_expression'],
        calls: ['function_call_expression', 'member_call_expression', 'object_creation_expression', 'scoped_call_expression'],
        imports: ['namespace_use_clause', 'require_expression', 'require_once_expression', 'include_expression', 'include_once_expression'],
        guarded: ['finally_clause'],
        self: /^\$this\s*->\s*/,
        constructors: ['__construct'],
        dispose: /^(__destruct|close|shutdown|dispose)$/,
        creation: /\bnew\s+\\?(?:\w+\\)*([A-Z]\w*)\s*\(/g,
        resources: [
            { kind: 'file', acquire: /^(fopen|opendir|popen|tmpfile|curl_init)$/, release: /^(fclose|closedir|pclose|curl_close)$/, releaseHandle: 'argument' },
            { kind: 'lock', acquire: /^flock$/, release: /^flock$/, releaseHandle: 'argument' }
        ],
        effects: /\b(echo|print|printf|var_dump|file_get_contents|file_put_contents|fopen|time|rand|mt_rand|header|exit|die)\b/,
        mutators: ['array_push', 'array_pop', 'array_shift', 'array_unshift', 'array_splice', 'sort', 'unset'],
        lambda: /\bfn\s*\(|\bfunction\s*\(/,
        notImplemented: /throw\s+new\s+\\?(BadMethodCallException|LogicException|Exception)\(\s*['"](not implemented|TODO)/i,
        resolve: (spec, _file, files) => {
            const path = spec.replace(/^\\/, '').replace(/\\/g, '/');
            return files.find(f => f.endsWith(`/${path}.php`) || f === `${path}.php`) ?? files.find(f => f.endsWith(spec.replace(/^['"]|['"]$/g, '')));
        },
        defaultVisibility: 'public'
    },
    {
        id: 'r',
        name: 'R',
        extensions: ['.R', '.r'],
        grammar: 'tree-sitter-r.wasm',
        vendored: true,
        enums: [],
        // R6Class()/setRefClass()/setClass() calls are read as classes in the front end.
        classes: [],
        interfaces: [],
        functions: ['function_definition'],
        fields: [],
        globals: [],
        assignments: ['binary_operator'],
        ifs: ['if_statement'],
        switches: [],
        cases: [],
        calls: ['call'],
        imports: ['call'],
        guarded: [],
        self: /^(self|private)\s*\$\s*|^\.self\s*\$\s*/,
        constructors: ['initialize'],
        dispose: /^(finalize|close|stop)$/,
        creation: /\b([A-Z]\w*)\$new\s*\(/g,
        resources: [
            { kind: 'file', acquire: /^(file|url|gzfile|bzfile|pipe|socketConnection|odbcConnect|dbConnect)$/, release: /^(close|dbDisconnect|odbcClose)$/, releaseHandle: 'argument' },
            { kind: 'file', acquire: /^(sink|pdf|png|jpeg|svg)$/, release: /^(sink|dev\.off)$/, releaseHandle: 'argument' }
        ],
        effects: /\b(print|cat|message|warning|write\.\w+|read\.\w+|readRDS|saveRDS|Sys\.time|runif|rnorm|sample|set\.seed|setwd|library)\s*\(/,
        mutators: ['<<-'],
        lambda: /\bfunction\s*\(|\\\(/,
        notImplemented: /stop\(\s*["'](not implemented|TODO)/i,
        resolve: relative(['.R', '.r']),
        defaultVisibility: 'public'
    }
];

export function profileFor(file: string, cppProject: boolean): LanguageProfile | undefined {
    if (/\.h$/.test(file)) return PROFILES.find(p => p.id === (cppProject ? 'cpp' : 'c'));
    return PROFILES.find(p => p.extensions.some(e => file.endsWith(e)));
}

export const TREE_SITTER_EXTENSIONS = PROFILES.flatMap(p => p.extensions);
