// Bündelt Supervisor und Worker (kein SDK, keine DB) nach dist/supervisor/ sowie das Dump-Werkzeug nach dist/tools/.
import { build } from 'esbuild'

const common = { bundle: true, platform: 'node', target: 'node24', format: 'esm', outExtension: { '.js': '.mjs' }, banner: { js: '' }, sourcemap: false, logLevel: 'info' }

await build({ ...common, entryPoints: { main: 'supervisor/main.ts', worker: 'supervisor/worker.ts' }, outdir: 'dist/supervisor' })
// pglite-dump braucht PGlite (WASM-Dateien neben dem Bundle) und pglite-tools; deshalb nicht gebündelt, sondern aus node_modules geladen
await build({ ...common, entryPoints: { 'pglite-dump': 'tools/pglite-dump.ts' }, outdir: 'dist/tools', packages: 'external' })
