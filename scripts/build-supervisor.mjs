// Bundelt Supervisor und Worker (kein SDK, keine DB) nach dist/supervisor/.
import { build } from 'esbuild'

await build({
  entryPoints: { main: 'supervisor/main.ts', worker: 'supervisor/worker.ts' },
  outdir: 'dist/supervisor', bundle: true, platform: 'node', target: 'node24', format: 'esm', outExtension: { '.js': '.mjs' },
  banner: { js: '' }, sourcemap: false, logLevel: 'info',
})
