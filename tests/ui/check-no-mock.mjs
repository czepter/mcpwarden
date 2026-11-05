// Fails if a production build contains mock code (R14). Usage: node tests/ui/check-no-mock.mjs .output
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Content markers for mock code and the real worker (INTEGRITY_CHECKSUM). The file name in the cleanup code of the real app is allowed.
// mockRole/mockScenario: localStorage keys of the mock control (banner); __styleguide: route only in the mock build.
const NEEDLES = ['INTEGRITY_CHECKSUM', 'startMock', 'seedUpstreams', 'setupWorker', 'mockRole', 'mockScenario', '__styleguide', '__API_MOCK__']

export function findMock(dir) {
  const hits = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { hits.push(...findMock(p)); continue }
    if (name.includes('mockServiceWorker')) { hits.push(`${p} (Dateiname)`); continue }
    if (/\.(m?js|cjs|html|json|css|map)$/.test(name)) {
      const txt = readFileSync(p, 'utf8')
      for (const n of NEEDLES) if (txt.includes(n)) hits.push(`${p} contains "${n}"`)
    }
  }
  return hits
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '.output'
  if (!existsSync(dir)) { console.error(`${dir} missing: run "pnpm build" first.`); process.exit(2) }
  const hits = findMock(dir)
  if (hits.length) { console.error(`Mock code in the build ${dir}:\n${hits.join('\n')}`); process.exit(1) }
  console.log(`OK: no mock code in ${dir}`)
}
