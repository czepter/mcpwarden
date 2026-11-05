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
 * (auch nicht nach Löschen), niemals 0 oder die Web-UID (Bereich 20000-59999). Die Datei wird beim Laden geprüft:
 * Besitzer = Supervisor-UID, Modus ohne Gruppen-/Other-Rechte, jede UID im Bereich, nicht reserviert, ohne Duplikate.
 */
export class UidMap {
  private users = new Map<string, number>()
  private next = UID_MIN
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private file: string, private reserved: number[] = [], private ownerUid: number = process.getuid?.() ?? 0) {}

  async load() {
    let raw: string
    try {
      const fh = await fsp.open(this.file, C.O_RDONLY | C.O_NOFOLLOW)
      try {
        const st = await fh.stat()
        if (!st.isFile()) throw new UnsafeDirectory('.uidmap is not a regular file')
        if (st.uid !== this.ownerUid) throw new UnsafeDirectory(`.uidmap owner ${st.uid}, expected ${this.ownerUid}`)
        if (st.mode & 0o077) throw new UnsafeDirectory('.uidmap must not be accessible to group/other (mode 0600)')
        raw = await fh.readFile('utf8')
      } finally { await fh.close() }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    const d = JSON.parse(raw) as MapFile
    if (d.v !== 1 || !Number.isInteger(d.next) || !d.users || typeof d.users !== 'object') throw new UnsafeDirectory('.uidmap malformed')
    const seen = new Set<number>()
    let max = UID_MIN - 1
    const users = new Map<string, number>()
    for (const [id, uid] of Object.entries(d.users)) {
      if (!USER_ID_RE.test(id)) throw new UnsafeDirectory('.uidmap contains an invalid user id')
      if (!Number.isInteger(uid) || uid < UID_MIN || uid > UID_MAX) throw new UnsafeDirectory(`.uidmap uid ${uid} outside ${UID_MIN}..${UID_MAX}`)
      if (this.reserved.includes(uid)) throw new UnsafeDirectory(`.uidmap uid ${uid} is reserved`)
      if (seen.has(uid)) throw new UnsafeDirectory(`.uidmap uid ${uid} assigned twice`)
      seen.add(uid); users.set(id, uid); max = Math.max(max, uid)
    }
    this.users = users
    this.next = Math.max(d.next, max + 1, UID_MIN)
  }

  private async persist() {
    const tmp = `${this.file}.${process.pid}.tmp`
    const fh = await fsp.open(tmp, 'w', 0o600)
    try {
      await fh.writeFile(JSON.stringify({ v: 1, next: this.next, users: Object.fromEntries(this.users) } satisfies MapFile)); await fh.sync()
    } finally { await fh.close() }
    await fsp.rename(tmp, this.file)
    const dir = await fsp.open(join(this.file, '..'), 'r')
    try { await dir.sync() } finally { await dir.close() }
  }

  /** Serialisiert (ein Supervisor-Prozess); liefert dieselbe UID für dieselbe userId. */
  uidFor(userId: string): Promise<number> {
    if (!USER_ID_RE.test(userId)) return Promise.reject(new Error('invalid userId'))
    const run = this.chain.then(async () => {
      const known = this.users.get(userId)
      if (known !== undefined) return known
      let uid = this.next
      while (this.reserved.includes(uid)) uid++
      if (uid > UID_MAX) throw new UidExhausted('uid range exhausted')
      this.users.set(userId, uid)
      this.next = uid + 1
      await this.persist()
      return uid
    })
    this.chain = run.catch(() => {})
    return run
  }

  lookup(userId: string): number | undefined { return this.users.get(userId) }
}

/**
 * Prüft und richtet die Verzeichnisse unter DATA_DIR ein, ohne Symlinks zu folgen: lstat (kein Symlink, Verzeichnis),
 * dann Besitzer/Modus über einen O_NOFOLLOW|O_DIRECTORY-Deskriptor (fstat/fchmod/fchown). `dataDir` und `stdio` müssen
 * dem Supervisor gehören (fremder Besitzer => Abbruch; zu offener Modus => fchmod). `pgdata` gehört der Web-UID.
 */
export async function prepareDataDirs(o: { dataDir: string, rootUid: number, webUid: number, webGid: number, stdio: boolean, chown?: boolean }) {
  const open = async (path: string, mode: number): Promise<fsp.FileHandle> => {
    const st = await fsp.lstat(path).catch(() => null)
    if (!st) await fsp.mkdir(path, { mode })
    else if (st.isSymbolicLink() || !st.isDirectory()) throw new UnsafeDirectory(`${path} is not a plain directory`)
    return await fsp.open(path, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW)
  }
  const own = async (path: string, mode: number) => {
    const fh = await open(path, mode)
    try {
      const st = await fh.stat()
      if (st.uid !== o.rootUid) throw new UnsafeDirectory(`${path} is owned by uid ${st.uid}, expected ${o.rootUid}`)
      if ((st.mode & 0o777) !== mode) await fh.chmod(mode)
    } finally { await fh.close() }
  }
  await own(o.dataDir, 0o755)
  if (o.stdio) await own(join(o.dataDir, 'stdio'), 0o711)
  const fh = await open(join(o.dataDir, 'pgdata'), 0o700)
  try {
    const st = await fh.stat()
    if (st.uid === o.rootUid && o.chown) { await fh.chmod(0o700); await fh.chown(o.webUid, o.webGid) } // frisch angelegt: Web-UID
    else if (st.uid !== o.webUid && st.uid !== o.rootUid) {
      throw new UnsafeDirectory(`DATA_DIR/pgdata gehört uid ${st.uid}, erwartet ${o.webUid}. Einmalig: chown -R ${o.webUid}:${o.webGid} <Volume>/pgdata`)
    }
  } finally { await fh.close() }
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
  // Verzeichnisse ohne Rechte (chmod 000) würden find -delete scheitern lassen: erst u+rwx (unter der Nutzer-UID, ohne Symlinks zu folgen)
  await runAsUser(['find', dir, '-type', 'd', '-exec', 'chmod', 'u+rwx', '{}', ';'])
  const code = await runAsUser(['find', dir, '-mindepth', '1', '-delete'])
  if (code !== 0) throw new Error(`purge failed (find exit ${code})`)
  await fsp.rmdir(dir)
}
