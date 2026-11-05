import { getConfig } from './config'

// Keine Ableitung pro Nutzer hier (gehoert Phase 1: server/gateway/crypto/secrets.ts).
export function getMasterKey(): Buffer {
  return getConfig().masterKey
}
