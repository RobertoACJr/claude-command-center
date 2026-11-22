import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explainTelegramError } from '../src/main/telegram'

test('erros do Telegram viram instrução do que fazer', () => {
  assert.match(explainTelegramError('Unauthorized'), /token/)
  assert.match(explainTelegramError('Bad Request: chat not found'), /Detectar/)
  assert.match(explainTelegramError('Forbidden: bot was blocked by the user'), /desbloqueie/)
  assert.match(explainTelegramError("Forbidden: bot can't initiate conversation with a user"), /Iniciar/)
  assert.match(explainTelegramError('Falha de rede.'), /api\.telegram\.org/)
  assert.match(explainTelegramError('algo novo'), /recusou: algo novo/)
})

test('token colado com sujeira é limpo', async () => {
  const { cleanToken } = await import('../src/main/telegram')
  const t = '123456789:AAHk-abcdefghijklmnopqrstuvwxyz_0123'
  assert.equal(cleanToken(`  ${t}  `), t)
  assert.equal(cleanToken(`bot${t}`), t)
  assert.equal(cleanToken(`"${t}"`), t)
  assert.equal(cleanToken(`https://api.telegram.org/bot${t}/getMe`), t)
  assert.match(explainTelegramError('Not Found'), /token/)
  assert.match(explainTelegramError('Bad Request: chat not found'), /Chat ID/)
})
