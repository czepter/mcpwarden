// Faellt aus, wenn ein Produktions-Build Mock-Code enthaelt (R14). Aufruf: node tests/ui/check-no-mock.mjs .output
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Inhaltsmarker fuer Mock-Code und den echten Worker (INTEGRITY_CHECKSUM). Der Dateiname im Aufraeum-Code der Echt-App ist erlaubt.
const NEEDLES = ['INTEGRITY_CHECKSUM', 'startMock', 'seedUpstreams', 'setupWorker']

export function findMock(dir) {
  const hits = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { hits.push(...findMock(p)); continue }
    if (name.includes('mockServiceWorker')) { hits.push(`${p} (Dateiname)`); continue }
    if (/\.(m?js|cjs|html|json|css|map)$/.test(name)) {
      const txt = readFileSync(p, 'utf8')
      for (const n of NEEDLES) if (txt.includes(n)) hits.push(`${p} enthaelt "${n}"`)
    }
  }
  return hits
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? '.output'
  const hits = findMock(dir)
  if (hits.length) { console.error(`Mock-Code im Build ${dir}:\n${hits.join('\n')}`); process.exit(1) }
  console.log(`OK: kein Mock-Code in ${dir}`)
}
