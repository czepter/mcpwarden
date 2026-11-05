// Bundles supervisor and worker (no SDK, no DB) to dist/supervisor/ and the dump tool to dist/tools/.
import { build } from 'esbuild'

const common = { bundle: true, platform: 'node', target: 'node24', format: 'esm', outExtension: { '.js': '.mjs' }, banner: { js: '' }, sourcemap: false, logLevel: 'info' }

await build({ ...common, entryPoints: { main: 'supervisor/main.ts', worker: 'supervisor/worker.ts' }, outdir: 'dist/supervisor' })
// pglite-dump needs PGlite (WASM files next to the bundle) and pglite-tools; therefore not bundled but loaded from node_modules
await build({ ...common, entryPoints: { 'pglite-dump': 'tools/pglite-dump.ts' }, outdir: 'dist/tools', packages: 'external' })
