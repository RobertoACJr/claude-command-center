import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { envWithPath } from '../src/main/proc'
import { tempDir } from './helpers'

test('PATH ganha ~/.local/bin quando existe e não está lá (instalador do Claude)', () => {
  const home = tempDir('ccc-home-')
  mkdirSync(join(home, '.local', 'bin'), { recursive: true })
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const old = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env[pathKey] }
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    const env = envWithPath()
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH')!
    const parts = env[key]!.split(process.platform === 'win32' ? ';' : ':')
    assert.ok(parts.includes(join(home, '.local', 'bin')))
    // Não duplica
    process.env[key] = env[key]
    const again = envWithPath()[key]!.split(process.platform === 'win32' ? ';' : ':')
    assert.equal(again.filter((p) => p === join(home, '.local', 'bin')).length, 1)
  } finally {
    process.env.HOME = old.HOME
    process.env.USERPROFILE = old.USERPROFILE
    process.env[pathKey] = old.PATH
  }
})
