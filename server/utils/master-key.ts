import { getConfig } from './config'

// No per-user derivation here (belongs to phase 1: server/gateway/crypto/secrets.ts).
export function getMasterKey(): Buffer {
  return getConfig().masterKey
}
