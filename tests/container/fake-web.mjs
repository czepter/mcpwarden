// Runs in the container as the web UID (started by the supervisor) and plays through the scenarios.
// Output: one JSON line "RESULT {...}" per check, at the end "DONE".
import net from 'node:net'
import fs from 'node:fs'

const SOCK = process.env.SUP_SOCKET
process.on('uncaughtException', e => console.log('UNCAUGHT ' + e.code))
const rec = (k, v) => { console.log('RESULT ' + JSON.stringify({ [k]: v })) }
const enc = (o) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); return Buffer.concat([h, b]) }
function reader(sock) {
  let buf = Buffer.alloc(0); const q = []; let wake
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); for (;;) { if (buf.length < 4) break; const n = buf.readUInt32BE(0); if (buf.length < 4 + n) break; q.push(JSON.parse(buf.subarray(4, 4 + n).toString())); buf = buf.subarray(4 + n) } wake?.() })
  let closed = false; sock.on('close', () => { closed = true; wake?.() }); sock.on('error', () => {})
  return { next: (ms = 5000) => new Promise((res) => { const t = setTimeout(() => res({ timeout: true }), ms); const tick = () => { if (q.length) { clearTimeout(t); res(q.shift()) } else if (closed) { clearTimeout(t); res({ closed: true }) } else wake = tick }; tick() }) }
}
const connect = () => new Promise((res, rej) => { const s = net.connect(SOCK); s.once('connect', () => res(s)); s.once('error', rej) })
async function control(cmd) { const s = await connect(); const r = reader(s); s.write(enc(cmd)); const out = await r.next(); s.destroy(); return out }
async function raw(bytes) { const s = await connect(); const r = reader(s); s.write(bytes); const out = await r.next(2000); s.destroy(); return out }

async function attach(userId, extra = {}) {
  const s = await connect(); const r = reader(s)
  s.write(enc({ v: 1, cmd: 'attach', userId, ...extra }))
  const ack = await r.next()
  if (!ack.ok) { s.destroy(); return { ack } }
  const ready = await r.next()
  return { ack, ready, s, r }
}
async function runChild(a, childId, command, args = [], env = {}, cwdRel) {
  a.s.write(enc({ t: 'start', childId, command, args, env, cwdRel }))
  const lines = []; let exit
  for (;;) { const m = await a.r.next(8000); if (m.timeout || m.closed) break; if (m.childId && m.childId !== childId) continue; if (m.t === 'msg') lines.push(m.line); if (m.t === 'exit') { exit = m; break } if (m.t === 'error') return { error: m } }
  return { lines, exit }
}
const stat = (p) => { try { const s = fs.lstatSync(p); return `${s.uid}:${s.gid}:${(s.mode & 0o7777).toString(8)}` } catch (e) { return e.code } }

if (process.env.FAKE_MODE === 'nocaps') {
  rec('capabilities', await control({ v: 1, cmd: 'capabilities' }))
  const A = await attach('userA')
  const r = await runChild(A, 'c1', 'node', ['-e', "console.log(process.getuid())"])
  rec('child_uid', Number(r.lines[0]))
  rec('web_uid', process.getuid())
  console.log('DONE'); process.exit(0)
}
rec('capabilities', await control({ v: 1, cmd: 'capabilities' }))
rec('webCapEff', fs.readFileSync('/proc/self/status', 'utf8').match(/CapEff:\s+(\w+)/)[1])
rec('webUid', process.getuid())
rec('ping', (await control({ v: 1, cmd: 'ping' })).ok)

// forged commands
rec('forge_uid', (await control({ v: 1, cmd: 'attach', userId: 'x', uid: 0 })).error)
rec('forge_cwd', (await control({ v: 1, cmd: 'attach', userId: 'x', cwd: '../..' })).error)
rec('forge_userId_slash', (await control({ v: 1, cmd: 'attach', userId: '../etc' })).error)
rec('forge_unknown_cmd', (await control({ v: 1, cmd: 'chown', path: '/etc' })).error)
rec('forge_big_frame', (await raw(Buffer.concat([Buffer.from([0, 0x10, 0, 0]), Buffer.alloc(100)]))).closed === true)

// Worker A / B
const A = await attach('userA', { maxProcs: 5 })
rec('attachA', { ack: A.ack.ok, ready: A.ready?.t })
const idScript = `process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),env:process.env,cwd:process.cwd()})+'\\n')`
const idr = await runChild(A, 'c1', 'node', ['-e', idScript], { MY_SECRET: 'abc' })
const info = JSON.parse(idr.lines[0])
rec('childA', { uidOk: info.uid >= 20000 && info.uid <= 59999, uid: info.uid, groupsHaveZero: info.groups.includes(0), envKeys: Object.keys(info.env).sort(), hasMy: info.env.MY_SECRET === 'abc', leaksMaster: 'MASTER_KEY' in info.env || 'BETTER_AUTH_SECRET' in info.env || 'DATABASE_URL' in info.env, cwd: info.cwd })
rec('idG', (await runChild(A, 'c1b', 'id', ['-G'])).lines[0])
const uidA = info.uid

const B = await attach('userB')
const idB = JSON.parse((await runChild(B, 'c1', 'node', ['-e', idScript])).lines[0])
rec('uidDiffers', idB.uid !== uidA)
const readTry = (p) => `try{require('fs').readdirSync(${JSON.stringify(p)});console.log('READ_OK')}catch(e){console.log(e.code)}`
rec('A_reads_B', (await runChild(A, 'c2', 'node', ['-e', readTry(`/data/stdio/${idB.uid}`)])).lines[0])
rec('A_reads_pgdata', (await runChild(A, 'c3', 'node', ['-e', readTry('/data/pgdata')])).lines[0])
let w1 = 'ok'; try { fs.mkdirSync('/data/stdio/evil') } catch (e) { w1 = e.code }
let w2 = 'ok'; try { fs.renameSync(`/data/stdio/${uidA}`, '/data/stdio/moved') } catch (e) { w2 = e.code }
let w3 = 'ok'; try { fs.readdirSync(`/data/stdio/${uidA}`) } catch (e) { w3 = e.code }
rec('web_mkdir_stdio', w1); rec('web_rename', w2); rec('web_reads_user_dir', w3)

// Symlink attack: A creates symlinks, afterwards stop + attach again (ensureUserDir runs again)
const before = { etc: stat('/etc'), b: stat(`/data/stdio/${idB.uid}`) }
const atk = `const fs=require('fs');for(const [t,l] of [['/etc','home2'],['../${idB.uid}','tmp2'],['/etc/passwd','pw']]){try{fs.symlinkSync(t,l)}catch(e){console.log('ERR',e.code)}};console.log('done')`
await runChild(A, 'c4', 'node', ['-e', atk])
A.s.destroy(); await control({ v: 1, cmd: 'stopWorker', userId: 'userA' })
const A2 = await attach('userA')
rec('reattachA', A2.ack)
const after = { etc: stat('/etc'), b: stat(`/data/stdio/${idB.uid}`) }
rec('symlink_untouched', JSON.stringify(before) === JSON.stringify(after))
rec('symlink_stat', { before, after })

// Child limit (maxProcs 5)
for (let i = 0; i < 6; i++) A2.s.write(enc({ t: 'start', childId: 'k' + i, command: 'sleep', args: ['30'], env: {} }))
const seen = []; for (let i = 0; i < 8; i++) { const m = await A2.r.next(1500); if (m.timeout) break; seen.push(m.t === 'error' ? m.code : m.t) }
rec('child_limit', seen.filter(x => x === 'limit').length)
for (let i = 0; i < 5; i++) A2.s.write(enc({ t: 'stop', childId: 'k' + i }))
await new Promise(r => setTimeout(r, 500))

// cwd-Ausbruch
rec('cwd_escape', (await runChild(A2, 'cw', 'pwd', [], {}, '../../..')).error?.code)
rec('cwd_abs', (await runChild(A2, 'cw2', 'pwd', [], {}, '/etc')).error?.code)

// Fork bomb: bounded, B stays operational
const bomb = `const {spawn}=require('child_process');let err=0,ok=0;for(let i=0;i<700;i++){const p=spawn('sleep',['5'],{stdio:'ignore'});p.on('error',()=>{err++});p.on('spawn',()=>{ok++})}setTimeout(()=>{console.log(JSON.stringify({ok,err}));process.exit(0)},1500)`
const bm = await runChild(A2, 'bomb', 'node', ['-e', bomb])
rec('forkbomb', bm.lines ? JSON.parse(bm.lines[0]) : bm)
rec('B_after_bomb', (await runChild(B, 'c5', 'echo', ['alive'])).lines?.[0])

rec('busy', (await attach('userA')).ack.error)

// Worker ends => web sees EOF
B.s.write(enc({ t: 'start', childId: 'x', command: 'sleep', args: ['30'], env: {} }))
await B.r.next()
await control({ v: 1, cmd: 'stopWorker', userId: 'userB' })
let eof; for (let i = 0; i < 5; i++) { eof = await B.r.next(5000); if (eof.closed) break }
rec('worker_exit_eof', eof.closed === true)

// Crash -> backoff: frame over the limit => worker ends itself with code 1
const C = await attach('userC')
C.s.write(Buffer.concat([Buffer.from([0x7f, 0xff, 0xff, 0xff]), Buffer.alloc(16)]))
await C.r.next(3000)
await new Promise(r => setTimeout(r, 300))
rec('backoff', (await attach('userC')).ack.error)
await new Promise(r => setTimeout(r, 1300))
rec('after_backoff', (await attach('userC')).ack?.ok === true)

// Idle (SUP_IDLE_UNIT_MS small): worker ends itself
const D = await attach('userD', { idleMin: 1 })
let idle; for (let i = 0; i < 4; i++) { idle = await D.r.next(3000); if (idle.closed) break }
rec('idle_exit', idle.closed === true)

// Purge removes the directory
await control({ v: 1, cmd: 'stopWorker', userId: 'userA', purge: true })
rec('purged', fs.existsSync(`/data/stdio/${uidA}`) === false)

console.log('DONE')
process.exit(0)
