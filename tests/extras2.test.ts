import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fakeRuns, listen, readBody, tempDir, useTempUserData } from './helpers'

useTempUserData()
const { store } = require('../src/main/store') as typeof import('../src/main/store')
const { secrets } = require('../src/main/secrets') as typeof import('../src/main/secrets')
const { DemandManager, normDemand, parsePrComments, prCommentsPrompt, doubtsMessage } = require('../src/main/demands') as typeof import('../src/main/demands')
const { appendLesson, learn, readGuides, guidesInstruction } = require('../src/main/guides') as typeof import('../src/main/guides')
const { looksLikeRule } = require('../src/shared/text') as typeof import('../src/shared/text')
const { transcribe, cleanTranscript } = require('../src/main/tgcontrol') as typeof import('../src/main/tgcontrol')

test('comentários do PR: tira os meus e os de robôs; inclui linha e arquivo', () => {
  const view = {
    comments: [
      { id: 1, author: { login: 'ana' }, body: 'Faltou tratar lista vazia', createdAt: '2026-11-20T10:00:00Z' },
      { id: 2, author: { login: 'eu' }, body: 'ok', createdAt: '2026-11-20T11:00:00Z' },
      { id: 3, author: { login: 'sonar[bot]' }, body: 'quality gate', createdAt: '2026-11-20T09:00:00Z' }
    ],
    reviews: [{ id: 9, author: { login: 'bia' }, body: '', state: 'APPROVED' }]
  }
  const inline = [{ id: 7, user: { login: 'bia' }, body: 'Use o hook useFiltro', path: 'src/Pedidos.tsx', line: 42, created_at: '2026-11-20T12:00:00Z' }]
  const list = parsePrComments(view, inline, 'eu')
  assert.deepEqual(
    list.map((c) => `${c.author}:${c.kind}`),
    ['ana:geral', 'bia:linha']
  )
  const d = normDemand({ key: 'WEB-1' })
  const p = prCommentsPrompt(d, list)
  assert.match(p, /2\. bia em `src\/Pedidos\.tsx:42`:\n   Use o hook useFiltro/)
  assert.match(p, /Não faça commit nem push/)
})

test('dúvidas da análise viram mensagem pronta', () => {
  const d = normDemand({ key: 'WEB-1', title: 'Filtro', analysis: '## Entendimento\nx\n## Dúvidas para o refinamento\n- Pode filtrar data futura?\n2. E fuso horário?\n## Riscos\ny' })
  const m = doubtsMessage(d)
  assert.match(m, /Sobre a WEB-1 \(Filtro\)/)
  assert.match(m, /1\. Pode filtrar data futura\?\n2\. E fuso horário\?/)
  assert.equal(doubtsMessage(normDemand({ key: 'X-1', analysis: 'sem dúvidas' })), '')
})

test('bug: análise de causa, correção com teste primeiro, prints anexados e comentário no Jira', async () => {
  const posted: any[] = []
  const jira = await listen(async (req, res) => {
    posted.push({ url: req.url, body: JSON.parse(await readBody(req)) })
    res.statusCode = 201
    res.end('{}')
  })
  store.saveSettings({ integrations: { jira: { enabled: false, url: jira.url, email: 'e@x' } } })
  secrets.set('jira.token', 't')
  store.saveProject({ id: 'p', name: 'web', path: tempDir(), vars: [], guides: [] } as any)
  const runs = fakeRuns()
  const m = new DemandManager(tempDir(), runs as any, () => {})
  m.save(normDemand({ id: 'b1', projectId: 'p', key: 'WEB-9', type: 'bug', context: 'lista some ao filtrar' }))
  const img = m.addImage('b1', 'data:image/png;base64,' + Buffer.from('png').toString('base64'))
  assert.equal(img.ok, true)
  assert.equal(m.addImage('b1', 'data:text/plain;base64,eA==').ok, false)
  assert.equal(m.analyze('b1', 'analysis').ok, true)
  const a = runs.started[0].req
  assert.match(a.content, /Isto é um BUG/)
  assert.match(a.content, /## Como reproduzir \/ erro\nlista some ao filtrar/)
  assert.match(a.content, /Prints anexados/)
  assert.ok(a.addDirs.includes(m.imagesDir('b1')), 'o Claude pode abrir os prints')
  m.handleRunEvent({ runId: runs.started[0].id, tab: 'demand:b1', type: 'exit', code: 0, signal: null, killed: false })
  m.implement('b1', '')
  assert.match(runs.started[1].req.content, /Primeiro escreva um teste que reproduz o bug/)
  m.removeImage('b1', img.file!)
  assert.equal(existsSync(img.file!), false)
  const c = await m.commentJira('b1', 'dúvidas aqui')
  assert.equal(c.ok, true, c.message)
  assert.equal(posted[0].url, '/rest/api/2/issue/WEB-9/comment')
  assert.deepEqual(posted[0].body, { body: 'dúvidas aqui' })
  jira.server.close()
})

test('memória do projeto: cria e acrescenta na seção; vira guia para as outras IAs', () => {
  const t1 = appendLesson('', 'não use axios', new Date('2026-11-21T12:00:00'))
  assert.match(t1, /# Memória do projeto/)
  assert.match(t1, /## Aprendizados \(anotados pela Hélice\)\n\n- não use axios _\(21\/11\/2026\)_/)
  const existing = '# Projeto\n\nRegras.\n\n## Aprendizados (anotados pela Hélice)\n\n- a\n\n## Outra seção\nx\n'
  const t2 = appendLesson(existing, 'b')
  assert.ok(t2.indexOf('- b') < t2.indexOf('## Outra seção'), 'entra dentro da seção')
  const dir = tempDir()
  writeFileSync(join(dir, 'GUIA.md'), 'guia')
  const p = { id: 'p', name: 'w', path: dir, guides: ['GUIA.md'], memoryFile: 'CLAUDE.md' } as any
  assert.equal(learn(p, 'sempre use o tema').ok, true)
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /- sempre use o tema/)
  assert.deepEqual(
    readGuides(p).map((g) => g.path),
    ['GUIA.md', 'CLAUDE.md'],
    'Gemini/ChatGPT recebem a memória nas demandas'
  )
  assert.doesNotMatch(guidesInstruction(p) ?? '', /CLAUDE\.md/, 'o Claude já lê o CLAUDE.md sozinho')
  assert.equal(learn({ ...p, memoryFile: '../fora.md' }, 'x').ok, false)
  assert.ok(looksLikeRule('aqui não usamos axios'))
  assert.ok(looksLikeRule('O padrão é kebab-case'))
  assert.ok(!looksLikeRule('ajusta o botão no mobile'))
})

test('áudio: comando de transcrição com {{arquivo}}, saída limpa ou .txt gravado', async () => {
  const dir = tempDir()
  const audio = join(dir, 'voz.ogg')
  writeFileSync(audio, 'fake')
  const node = 'node'
  const out = await transcribe(`${node} -e "console.log('[00:00.000 --> 00:02.000]  ajusta o filtro'); console.log(process.argv[1].endsWith('voz.ogg'))" {{arquivo}}`, audio, dir)
  assert.equal(out, 'ajusta o filtro true')
  const viaTxt = await transcribe(`${node} -e "require('fs').writeFileSync('voz.txt', 'texto do arquivo')"`, audio, dir)
  assert.equal(viaTxt, 'texto do arquivo')
  await assert.rejects(transcribe(`${node} -e "process.exit(3)"`, audio, tempDir()), /código 3/)
  assert.equal(cleanTranscript('Detected language: Portuguese\n[00:00.000 --> 00:01.000] oi\n'), 'oi')
})
