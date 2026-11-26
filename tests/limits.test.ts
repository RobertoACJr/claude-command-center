import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LimitsTracker, claudeTierArgs, computeSchedule, isLimitError, parseRateLimitEvent, parseStatusline, toMs } from '../src/main/limits'
import { normPlan, parsePlan, phaseMessage, PlanRunner } from '../src/main/plan'
import { pickNext } from '../src/main/queue'
import { statuslineScript } from '../src/main/statusline'
import type { AiConfig, Demand, DemandPlan, QueueTask } from '../src/shared/types'
import { tempDir } from './helpers'

const AI: AiConfig = {
  geminiCommand: 'gemini',
  codexCommand: 'codex',
  claudeModel: '',
  claudeEffort: '',
  economy: false,
  lightModel: 'sonnet',
  lightEffort: 'low',
  sessionCapPct: 90,
  paceWarnPct: 80,
  statusLine: false
}

test('toMs aceita segundos, milissegundos e ISO', () => {
  assert.equal(toMs(1_800_000_000), 1_800_000_000_000)
  assert.equal(toMs(1_800_000_000_000), 1_800_000_000_000)
  assert.equal(toMs('2026-11-25T16:40:00Z'), Date.parse('2026-11-25T16:40:00Z'))
  assert.equal(toMs('1800000000'), 1_800_000_000_000)
  assert.equal(toMs(null), null)
})

test('lê o rate_limit_event do stream-json', () => {
  const u = parseRateLimitEvent({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed_warning', resetsAt: 1_800_000_000, rateLimitType: 'five_hour', utilization: 0.82 }
  })
  assert.deepEqual(u, [{ window: 'five_hour', status: 'aviso', resetsAt: 1_800_000_000_000, pct: 82 }])
  const r = parseRateLimitEvent({ rate_limit_info: { status: 'rejected', resetsAt: 1_800_000_000_000, rateLimitType: 'seven_day' } })
  assert.equal(r[0].window, 'seven_day')
  assert.equal(r[0].status, 'bloqueado')
  const both = parseRateLimitEvent({
    rate_limit_info: {
      status: 'allowed',
      rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1_800_000_000 }, seven_day: { utilization: 0.1, resetsAt: 1_800_500_000 } }
    }
  })
  assert.equal(both.length, 2)
  assert.equal(both.find((x) => x.window === 'seven_day')?.pct, 10)
  assert.deepEqual(parseRateLimitEvent({}), [])
})

test('lê o JSON da linha de status e detecta erro de limite', () => {
  const u = parseStatusline({ rate_limits: { five_hour: { used_percentage: 62.5, resets_at: 1_800_000_000 }, seven_day: { used_percentage: 100, resets_at: '2026-11-28T00:00:00Z' } } })
  assert.equal(u[0].pct, 62.5)
  assert.equal(u[1].status, 'bloqueado')
  assert.equal(isLimitError({ is_error: true, result: "You've hit your usage limit · resets 4pm" }), true)
  assert.equal(isLimitError({ is_error: true, api_error_status: 429 }), true)
  assert.equal(isLimitError({ is_error: false, result: 'limit' }), false)
  assert.equal(isLimitError({ is_error: true, result: 'Erro de sintaxe' }), false)
})

test('modelo e esforço por peso da tarefa', () => {
  assert.deepEqual(claudeTierArgs(AI, 'heavy'), [])
  assert.deepEqual(claudeTierArgs({ ...AI, claudeModel: 'opus', claudeEffort: 'high' }, 'light'), ['--model', 'opus', '--effort', 'high'])
  assert.deepEqual(claudeTierArgs({ ...AI, claudeModel: 'opus', economy: true }, 'light'), ['--model', 'sonnet', '--effort', 'low'])
  assert.deepEqual(claudeTierArgs({ ...AI, claudeModel: 'opus', economy: true }, 'heavy'), ['--model', 'opus'])
})

test('agenda: fases que não cabem vão para depois do reset', () => {
  const now = 1_000_000
  const reset = now + 3600_000
  const phases = [
    { id: 'a', estPct: 20, status: 'pendente' as const },
    { id: 'b', estPct: 30, status: 'pendente' as const },
    { id: 'c', estPct: 40, status: 'pendente' as const },
    { id: 'd', estPct: 60, status: 'pendente' as const }
  ]
  const s = computeSchedule(phases, { pct: 30, resetsAt: reset }, 90, now)
  assert.deepEqual(
    s.map((x) => [x.id, x.at, x.window]),
    [
      ['a', now, 0],
      ['b', now, 0],
      ['c', reset, 1],
      ['d', reset + 5 * 3600_000, 2]
    ]
  )
  // Janela já resetou: começa do zero
  const s2 = computeSchedule(phases.slice(0, 2), { pct: 95, resetsAt: now - 1 }, 90, now)
  assert.equal(s2[1].at, now)
  // Feitas ficam de fora
  assert.equal(computeSchedule([{ id: 'x', estPct: 10, status: 'feita' }], null, 90, now).length, 0)
})

test('rastreador: bloqueio, teto e aviso de ritmo uma vez por janela', () => {
  const dir = tempDir()
  let cfg = { ...AI }
  const paces: number[] = []
  const t = new LimitsTracker(dir, { config: () => cfg, onChange: () => {}, onPace: (p) => paces.push(p) })
  const now = Date.now()
  t.update([{ window: 'five_hour', status: 'ok', resetsAt: now + 3600_000, pct: 50 }], now)
  assert.equal(t.blockedUntil(now), null)
  t.update([{ window: 'five_hour', status: 'aviso', resetsAt: now + 3600_000, pct: 85 }], now)
  t.update([{ window: 'five_hour', status: 'aviso', resetsAt: now + 3600_000, pct: 88 }], now)
  assert.deepEqual(paces, [85])
  t.update([{ window: 'five_hour', status: 'aviso', resetsAt: now + 3600_000, pct: 91 }], now)
  assert.equal(t.blockedUntil(now), now + 3600_000, 'passou do teto de 90%')
  cfg = { ...cfg, sessionCapPct: 100 }
  assert.equal(t.blockedUntil(now), null)
  t.markBlocked()
  assert.equal(t.blockedUntil(now), now + 3600_000, 'bloqueado mantém o horário de reset conhecido')
  // Depois do reset, livre de novo
  assert.equal(t.blockedUntil(now + 3600_001), null)
  // Persistiu
  const t2 = new LimitsTracker(dir, { config: () => cfg, onChange: () => {}, onPace: () => {} })
  assert.equal(t2.state(now).fiveHour?.status, 'bloqueado')
})

test('fila: respeita o horário agendado e deixa fases rodarem com você Online', () => {
  const now = 1000
  const mk = (id: string, extra: Partial<QueueTask> = {}): QueueTask => ({ id, projectId: 'p', prompt: id, status: 'pendente', createdAt: 0, origin: 'app', ...extra })
  assert.equal(pickNext([mk('a'), mk('b')], now, false).task?.id, 'a')
  const later = pickNext([mk('a', { notBefore: 5000 }), mk('b')], now, false)
  assert.equal(later.task?.id, 'b')
  const wait = pickNext([mk('a', { notBefore: 5000 })], now, false)
  assert.equal(wait.task, null)
  assert.equal(wait.wakeAt, 5000)
  const online = pickNext([mk('a'), mk('b', { planPhaseId: 'f1' })], now, true)
  assert.equal(online.task?.id, 'b')
  assert.equal(pickNext([mk('a')], now, true).awayBlocked, true)
})

test('lê as fases que a IA devolveu', () => {
  const text = `Pensei assim.\n<<<FASES\n[{"title":"Migration","prompt":"criar tabela","tier":"heavy","estPct":25},{"title":"Testes","prompt":"cobrir","tier":"light","estPct":300}]\nFASES>>>\nfim`
  const p = parsePlan(text)
  assert.equal(p.length, 2)
  assert.equal(p[1].tier, 'light')
  assert.equal(p[1].estPct, 100)
  assert.equal(p[0].status, 'pendente')
  assert.deepEqual(parsePlan('sem json'), [])
  assert.equal(normPlan({ phases: [] }), null)
  const plan = normPlan({ phases: p, mode: 'auto' })!
  plan.phases[0].status = 'feita'
  const msg = phaseMessage(plan, plan.phases[1])
  assert.match(msg, /Fase 2 de 2/)
  assert.match(msg, /Já feitas:\n- Migration/)
})

test('plano: modo manual espera liberar, automático segue sozinho', () => {
  const plan: DemandPlan = normPlan({
    phases: [
      { title: 'A', prompt: 'a', estPct: 10 },
      { title: 'B', prompt: 'b', estPct: 10 },
      { title: 'C', prompt: 'c', estPct: 10 }
    ],
    mode: 'manual'
  })!
  const d = { id: 'd1', key: 'WEB-1', projectId: 'p', plan } as Demand
  const added: Array<{ planPhaseId: string; notBefore?: number }> = []
  const asked: string[] = []
  const runner = new PlanRunner({
    get: () => d,
    all: () => [d],
    setPlan: (_id, p) => {
      d.plan = p
    },
    queue: {
      add: (t) => {
        added.push(t)
        return { ok: true, message: 'ok', taskId: 't' + added.length }
      },
      cancel: () => {}
    },
    limits: () => ({ fiveHour: null, sevenDay: null, blockedUntil: null, capPct: 90, statusLine: false }),
    notify: () => {},
    askRelease: (_d, ph) => asked.push(ph.title)
  })
  assert.equal(runner.start('d1').ok, true)
  assert.equal(added.length, 1)
  assert.equal(added[0].notBefore, undefined, 'cabe agora')
  assert.equal(d.plan!.phases[0].status, 'agendada')
  const task = (n: number, status: QueueTask['status']): QueueTask => ({
    id: 't' + n,
    projectId: 'p',
    demandId: 'd1',
    prompt: '',
    status,
    createdAt: 0,
    origin: 'app',
    planPhaseId: d.plan!.phases[n - 1].id
  })
  runner.taskStarted(task(1, 'rodando'))
  assert.equal(d.plan!.phases[0].status, 'rodando')
  runner.taskDone(task(1, 'feita'))
  assert.equal(d.plan!.phases[1].status, 'aguardando')
  assert.deepEqual(asked, ['B'])
  assert.equal(added.length, 1, 'manual não enfileira sozinho')
  assert.equal(runner.waiting().length, 1)
  assert.equal(runner.release('d1').ok, true)
  assert.equal(added.length, 2)
  // Troca para automático: a C entra sozinha
  d.plan = { ...d.plan!, mode: 'auto' }
  runner.taskDone(task(2, 'feita'))
  assert.equal(added.length, 3)
  // Falha pausa o plano
  runner.taskDone({ ...task(3, 'falhou'), error: 'x' })
  assert.equal(d.plan!.running, false)
  assert.equal(d.plan!.phases[2].status, 'falhou')
})

test('script da linha de status grava o JSON e repassa para a anterior', () => {
  const sh = statuslineScript("echo 'oi'", false)
  assert.match(sh, /helice-limits\.json/)
  assert.match(sh, /sh -c 'echo '\\''oi'\\'''/)
  assert.doesNotMatch(statuslineScript(null, false), /sh -c/)
  const ps = statuslineScript("node 'x.js'", true)
  assert.match(ps, /cmd \/c 'node ''x\.js'''/)
})

test('limites separados por conta: uma estourada não segura a outra', () => {
  const dir = tempDir()
  const t = new LimitsTracker(dir, { config: () => AI, onChange: () => {}, onPace: () => {} })
  const now = Date.now()
  t.update([{ window: 'five_hour', status: 'bloqueado', resetsAt: now + 3600_000, pct: 100 }], now, 'pes')
  assert.equal(t.blockedUntil(now, 'pes'), now + 3600_000)
  assert.equal(t.blockedUntil(now, ''), null)
  const s = t.state(now)
  assert.equal(s.fiveHour, null, 'a padrão continua sem dados')
  assert.equal(s.accounts.find((a) => a.id === 'pes')?.fiveHour?.pct, 100)
  const mk = (id: string, projectId: string): QueueTask => ({ id, projectId, prompt: id, status: 'pendente', createdAt: 0, origin: 'app' })
  const pick = pickNext([mk('a', 'pessoal'), mk('b', 'empresa')], now, false, (q) => (q.projectId === 'pessoal' ? now + 1000 : null))
  assert.equal(pick.task?.id, 'b')
  const wait = pickNext([mk('a', 'pessoal')], now, false, () => now + 1000)
  assert.equal(wait.limitWait, true)
  assert.equal(wait.wakeAt, now + 1000)
})
