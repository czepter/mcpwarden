import { constants as C, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { USER_ID_RE } from './protocol'

export const UID_MIN = 20000
export const UID_MAX = 59999

/** Dateisystem-Operationen als Schnittstelle, damit Unit-Tests ohne Root laufen. */
export type FsOps = {
  chown: (fh: fsp.FileHandle, uid: number, gid: number) => Promise<void>
}
export const realFs: FsOps = { chown: (fh, uid, gid) => fh.chown(uid, gid) }

export class UidExhausted extends Error {}
export class UnsafeDirectory extends Error {}

type MapFile = { v: 1, next: number, users: Record<string, number> }

/**
 * `user_id -> uid` gehört dem Supervisor (root-eigen, 0600). Fortlaufende Vergabe, nie Wiederverwendung
 * (auch nicht nach Löschen), niemals 0 oder die Web-UID (Bereich 20000-59999).
 */
export class UidMap {
  private data: MapFile = { v: 1, next: UID_MIN, users: {} }
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private file: string, private reserved: number[] = []) {}

  async load() {
    try {
      const d = JSON.parse(await fsp.readFile(this.file, 'utf8')) as MapFile
      if (d.v === 1 && Number.isInteger(d.next) && d.users) this.data = d
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  }

  private async persist() {
    const tmp = `${this.file}.${process.pid}.tmp`
    const fh = await fsp.open(tmp, 'w', 0o600)
    try { await fh.writeFile(JSON.stringify(this.data)); await fh.sync() } finally { await fh.close() }
    await fsp.rename(tmp, this.file)
    const dir = await fsp.open(join(this.file, '..'), 'r')
    try { await dir.sync() } finally { await dir.close() }
  }

  /** Serialisiert (ein Supervisor-Prozess); liefert dieselbe UID für dieselbe userId. */
  uidFor(userId: string): Promise<number> {
    if (!USER_ID_RE.test(userId)) return Promise.reject(new Error('invalid userId'))
    const run = this.chain.then(async () => {
      const known = this.data.users[userId]
      if (known !== undefined) return known
      let uid = this.data.next
      while (this.reserved.includes(uid)) uid++
      if (uid > UID_MAX) throw new UidExhausted('uid range exhausted')
      this.data.users[userId] = uid
      this.data.next = uid + 1
      await this.persist()
      return uid
    })
    this.chain = run.catch(() => {})
    return run
  }

  lookup(userId: string): number | undefined { return this.data.users[userId] }
}

/**
 * Legt `stdio/<uid>` an (exklusives mkdir). Existiert es: lstat muss Verzeichnis (kein Symlink) sein, Besitzer root oder uid.
 * Besitzer/Modus werden über den O_NOFOLLOW-Deskriptor gesetzt. Danach fasst Root nichts mehr innerhalb an.
 */
export async function ensureUserDir(dataDir: string, uid: number, fs: FsOps = realFs, rootUid = 0): Promise<string> {
  const dir = join(dataDir, 'stdio', String(uid))
  try { await fsp.mkdir(dir, { mode: 0o700 }) } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    const st = await fsp.lstat(dir)
    if (st.isSymbolicLink() || !st.isDirectory()) throw new UnsafeDirectory('user dir is not a plain directory')
    if (st.uid === uid) return dir // fertig eingerichtet: root fasst (und kann ohne DAC_OVERRIDE) nichts darin anfassen
    if (st.uid !== rootUid) throw new UnsafeDirectory('user dir has unexpected owner')
    // root-eigen: Einrichtung war unterbrochen, unten über den O_NOFOLLOW-Deskriptor abschließen
  }
  const fh = await fsp.open(dir, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW)
  try {
    const st = await fh.stat()
    if (!st.isDirectory()) throw new UnsafeDirectory('not a directory')
    // Reihenfolge: erst chmod (solange root Eigentümer ist; ohne CAP_FOWNER danach nicht mehr möglich), dann chown.
    await fh.chmod(0o700)
    await fs.chown(fh, uid, uid)
  } finally { await fh.close() }
  return dir
}

/**
 * Löschen erst nach Stopp aller Prozesse dieser UID. Root kann das 0700-Nutzerverzeichnis ohne CAP_DAC_OVERRIDE nicht
 * betreten und folgt nie Nutzerpfaden: der Inhalt wird per `find -delete` unter der Nutzer-UID entfernt
 * (`find` folgt keinen Symlinks), danach `rmdir` des leeren Verzeichnisses im root-eigenen Elternverzeichnis.
 */
export async function purgeUserDir(dataDir: string, uid: number, runAsUser: (argv: string[]) => Promise<number>) {
  const dir = join(dataDir, 'stdio', String(uid))
  if (!(await fsp.lstat(dir).catch(() => null))) return
  const code = await runAsUser(['find', dir, '-mindepth', '1', '-delete'])
  if (code !== 0) throw new Error(`purge failed (find exit ${code})`)
  await fsp.rmdir(dir)
}
