# Vendored grammars

Tree-sitter grammars compiled to WebAssembly that are not in the `tree-sitter-wasms` package, or
newer than the ones it has.

| file | grammar | version | licence |
| --- | --- | --- | --- |
| `tree-sitter-r.wasm` | https://github.com/r-lib/tree-sitter-r | release v1.3.0 (`tree-sitter-r.wasm` asset) | MIT |
| `tree-sitter-groovy.wasm` | https://github.com/amaanq/tree-sitter-groovy | npm `tree-sitter-groovy` 0.1.2 | MIT |
| `tree-sitter-scala.wasm` | https://github.com/tree-sitter/tree-sitter-scala | release v0.26.2 (Scala 2 and 3) | MIT |
| `tree-sitter-java.wasm` | https://github.com/tree-sitter/tree-sitter-java | release v0.23.5 (switch rules `case A ->`) | MIT |

The other languages come from the `tree-sitter-wasms` npm package (MIT), loaded with
`web-tree-sitter` 0.25.
