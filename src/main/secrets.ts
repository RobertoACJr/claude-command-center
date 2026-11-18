import { app, safeStorage } from 'electron'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SecretKey, SecretsStatus } from '../shared/types'

/**
 * Cofre de tokens. Usa o cofre do sistema via Electron safeStorage:
 *   Windows: DPAPI (atrelado ao seu usuário)
 *   Linux:   libsecret / kwallet (se não houver, cai para texto apenas ofuscado; a UI avisa)
 * Fica num arquivo separado (secrets.json) e os valores nunca voltam para a interface.
 */
interface Entry {
  enc: boolean
  v: string
}

const file = () => join(app.getPath('userData'), 'secrets.json')

function canEncrypt(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    // No Linux sem keyring o backend é 'basic_text' (só ofuscação)
    const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.()
    return backend !== 'basic_text'
  } catch {
    return false
  }
}

function readAll(): Record<string, Entry> {
  try {
    if (!existsSync(file())) return {}
    const data = JSON.parse(readFileSync(file(), 'utf-8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, Entry>): void {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
  renameSync(tmp, file())
  try {
    chmodSync(file(), 0o600)
  } catch {
    /* Windows */
  }
}

export const secrets = {
  get(key: SecretKey): string | null {
    const e = readAll()[key]
    if (!e) return null
    try {
      const buf = Buffer.from(e.v, 'base64')
      return e.enc ? safeStorage.decryptString(buf) : buf.toString('utf-8')
    } catch {
      return null // ex: arquivo copiado de outra máquina/usuário
    }
  },

  set(key: SecretKey, value: string | null): void {
    const all = readAll()
    if (value === null || value === '') {
      delete all[key]
    } else if (canEncrypt()) {
      all[key] = { enc: true, v: safeStorage.encryptString(value).toString('base64') }
    } else {
      all[key] = { enc: false, v: Buffer.from(value, 'utf-8').toString('base64') }
    }
    writeAll(all)
  },

  status(): SecretsStatus {
    const all = readAll()
    return { set: Object.keys(all) as SecretKey[], encrypted: canEncrypt() }
  }
}
