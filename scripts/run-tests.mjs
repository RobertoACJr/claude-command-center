// Testes dos módulos do processo principal (sem abrir o app).
// Transpila src/main, src/shared e tests/ com o TypeScript do projeto para uma pasta temporária (CommonJS),
// troca o pacote "electron" por um simulado e roda tudo com o test runner nativo do Node (node --test).
// Uso: node scripts/run-tests.mjs [filtro]   (ex: node scripts/run-tests.mjs queue)
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
let ts
for (const p of ['typescript', process.env.TS_PATH].filter(Boolean)) {
  try {
    ts = require(p)
    break
  } catch {
    /* tenta o próximo */
  }
}
if (!ts) {
  console.error('TypeScript não encontrado: rode npm install (ou defina TS_PATH).')
  process.exit(1)
}

const out = mkdtempSync(join(tmpdir(), 'ccc-tests-'))
const filter = process.argv[2] ?? ''

function compileDir(dir) {
  for (const f of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, f.name)
    if (f.isDirectory()) {
      compileDir(rel)
      continue
    }
    if (!f.name.endsWith('.ts') || f.name.endsWith('.d.ts')) continue
    const src = readFileSync(join(root, rel), 'utf8')
    const r = ts.transpileModule(src, {
      fileName: rel,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        sourceMap: false
      }
    })
    const dest = join(out, rel.replace(/\.ts$/, '.js'))
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, r.outputText)
  }
}
compileDir('src/main')
compileDir('src/shared')
compileDir('tests')

// "electron" simulado: só o que os módulos testados usam
const el = join(out, 'node_modules', 'electron')
mkdirSync(el, { recursive: true })
writeFileSync(
  join(el, 'index.js'),
  `const path = require('path')
module.exports = {
  app: { getPath: () => process.env.CCC_TEST_USERDATA || path.join(require('os').tmpdir(), 'ccc-test-userdata'), getVersion: () => '0.0.0-test', isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => Buffer.from(b).toString()
  },
  Notification: class { static isSupported() { return false } show() {} on() {} },
  shell: { openExternal: async () => {} }
}
`
)

const files = readdirSync(join(out, 'tests'))
  .filter((f) => f.endsWith('.test.js') && f.includes(filter))
  .map((f) => join(out, 'tests', f))
if (!files.length) {
  console.error('Nenhum teste encontrado' + (filter ? ` com "${filter}"` : ''))
  process.exit(1)
}
console.log(`Rodando ${files.length} arquivo(s) de teste (${relative(root, out) ? out : ''})`)
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], {
  stdio: 'inherit',
  cwd: out,
  env: { ...process.env, CCC_TESTS_OUT: out }
})
if (!process.env.CCC_KEEP_TEST_OUT) rmSync(out, { recursive: true, force: true })
process.exit(r.status ?? 1)
