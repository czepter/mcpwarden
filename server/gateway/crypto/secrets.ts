import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/** Zeilenbindung: Teil der AAD, damit ein vertauschter Datensatz nicht entschlüsselt. */
export type SecretContext = { upstreamId: string, kind: string, name: string }

const SALT = 'mcpwarden/secrets/v1'
const FORMAT = 'v1'
const CACHE_MAX = 64
const keyCache = new Map<string, Buffer>()

function deriveUserKey(masterKey: Buffer, userId: string): Buffer {
  if (masterKey.length !== 32) throw new Error('masterKey must be 32 bytes')
  const cacheKey = `${masterKey.toString('hex').slice(0, 16)}:${userId}`
  const hit = keyCache.get(cacheKey)
  if (hit) return hit
  const key = Buffer.from(hkdfSync('sha256', masterKey, SALT, `user:${userId}`, 32))
  if (keyCache.size >= CACHE_MAX) keyCache.delete(keyCache.keys().next().value as string)
  keyCache.set(cacheKey, key)
  return key
}

const aad = (userId: string, c: SecretContext) => Buffer.from(`${userId}|${c.upstreamId}|${c.kind}|${c.name}`)
const b64 = (b: Buffer) => b.toString('base64url')

/** `userId` kommt immer aus dem Auth-Kontext, nie aus der Zeile. */
export function encryptSecret(masterKey: Buffer, userId: string, ctx: SecretContext, plaintext: string, iv: Buffer = randomBytes(12)): string {
  const cipher = createCipheriv('aes-256-gcm', deriveUserKey(masterKey, userId), iv)
  cipher.setAAD(aad(userId, ctx))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [FORMAT, b64(iv), b64(ct), b64(cipher.getAuthTag())].join('.')
}

export function decryptSecret(masterKey: Buffer, userId: string, ctx: SecretContext, ciphertext: string): string {
  const [fmt, iv, ct, tag, ...rest] = ciphertext.split('.')
  if (fmt !== FORMAT || !iv || ct === undefined || !tag || rest.length) throw new Error('invalid secret format')
  const decipher = createDecipheriv('aes-256-gcm', deriveUserKey(masterKey, userId), Buffer.from(iv, 'base64url'))
  decipher.setAAD(aad(userId, ctx))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}
