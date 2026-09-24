#!/usr/bin/env node
// Stand-in for nuXmv used by the tests when the real tool is not installed.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
console.log('*** This is nuXmv 9.9.9 (fake for tests)');
if (args.includes('-h')) process.exit(0);
const model = readFileSync(args[args.length - 1], 'utf8');
if (model.includes('syntax-error')) {
    console.error('file model.smv: line 1: at token "syntax-error": syntax error');
    process.exit(1);
}
console.log(`-- args: ${args.slice(0, -1).join(' ')}`);
console.log('-- specification  G p   is false');
console.log('-- as demonstrated by the following execution sequence');
console.log('Trace Description: LTL Counterexample');
console.log('Trace Type: Counterexample');
console.log('  -> State: 1.1 <-');
console.log('    state = s0');
console.log('    p = TRUE');
console.log('  -- Loop starts here');
console.log('  -> State: 1.2 <-');
console.log('    state = s1');
console.log('    p = FALSE');
