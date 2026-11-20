import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  PenLine,
  Play,
  RotateCcw,
  Search,
  Send,
  Square,
  SquareTerminal,
  Trash2
} from 'lucide-react'
import type { Demand, DemandAi, DemandBusy, DemandStatus, OpResult, Project } from '@shared/types'
import { cn, uid } from '../lib/utils'
import { Button, Modal } from './ui'

export const DEMAND_STATUS: Array<{ id: DemandStatus; label: string; cls: string }> = [
  { id: 'nova', label: 'Nova', cls: 'border-zinc-600 text-zinc-300' },
  { id: 'estimada', label: 'Estimada', cls: 'border-sky-500/50 text-sky-300' },
  { id: 'desenhada', label: 'Desenhada', cls: 'border-violet/60 text-purple' },
  { id: 'dev', label: 'Em dev', cls: 'border-amber-400/50 text-amber-300' },
  { id: 'teste', label: 'Em teste', cls: 'border-orange-400/50 text-orange-300' },
  { id: 'beta', label: 'Beta', cls: 'border-teal-400/50 text-teal-300' },
  { id: 'feita', label: 'Feita', cls: 'border-emerald-500/50 text-emerald-300' }
]

const AI_LABEL: Record<DemandAi, string> = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini' }

export function statusInfo(s: DemandStatus) {
  return DEMAND_STATUS.find((x) => x.id === s) ?? DEMAND_STATUS[0]
}

export function newDemand(projectId: string): Demand {
  const now = Date.now()
  return {
    id: uid(),
    projectId,
    key: '',
    title: '',
    status: 'nova',
    jira: null,
    context: '',
    transcript: '',
    refProjectIds: [],
    ai: 'claude',
    analysis: '',
    aiHours: null,
    hours: null,
    design: '',
    designApproved: false,
    sessionId: null,
    timeline: [],
    createdAt: now,
    updatedAt: now
  }
}

const days = (h: number) => `≈ ${Math.round((h / 8) * 10) / 10} dia(s)`

/** Markdown simples (títulos, listas, checklist, código) só para leitura */
function Md({ text }: { text: string }) {
  const out: ReactNode[] = []
  let code: string[] | null = null
  text.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      if (code) {
        out.push(
          <pre key={i} className="my-1 overflow-x-auto rounded-lg bg-bg p-2 font-mono text-[11px] text-zinc-300">
            {code.join('\n')}
          </pre>
        )
        code = null
      } else code = []
      return
    }
    if (code) return void code.push(line)
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) return void out.push(<div key={i} className="mt-3 mb-1 text-sm font-semibold text-zinc-100">{h[2]}</div>)
    const cb = line.match(/^\s*- \[( |x)\]\s+(.*)/i)
    if (cb) {
      return void out.push(
        <div key={i} className="flex gap-2 pl-1 text-xs text-zinc-300">
          <span className="text-zinc-500">{cb[1].trim() ? '☑' : '☐'}</span>
          <span>{cb[2]}</span>
        </div>
      )
    }
    const li = line.match(/^(\s*)[-*]\s+(.*)/)
    if (li) {
      return void out.push(
        <div key={i} className="flex gap-2 text-xs text-zinc-300" style={{ paddingLeft: 4 + li[1].length * 6 }}>
          <span className="text-zinc-600">•</span>
          <span>{li[2]}</span>
        </div>
      )
    }
    out.push(
      line.trim() ? (
        <p key={i} className="text-xs leading-relaxed text-zinc-300">
          {line}
        </p>
      ) : (
        <div key={i} className="h-1.5" />
      )
    )
  })
  return <div className="selectable [overflow-wrap:anywhere]">{out}</div>
}

type Tab = 'contexto' | 'analise' | 'desenho' | 'dev' | 'linha'

const areaCls =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet/60'
const inputCls =
  'h-9 rounded-lg border border-line bg-bg px-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet/60'

/**
 * Uma demanda (card do Jira) de ponta a ponta: contexto → análise com dúvidas e estimativa → desenho → implementação
 * com o Claude numa branch com o nome do card.
 */
export function DemandModal({
  open,
  demand,
  isNew,
  busy,
  projects,
  currentBranch,
  onClose,
  onCreated,
  onOpenTerminal,
  onDeleted
}: {
  open: boolean
  demand: Demand | null
  isNew: boolean
  busy: DemandBusy | undefined
  projects: Project[]
  currentBranch: string | null | undefined
  onClose: () => void
  onCreated: (d: Demand) => void
  onOpenTerminal: (d: Demand) => void
  onDeleted: () => void
}) {
  const [draft, setDraft] = useState<Demand | null>(demand)
  const [tab, setTab] = useState<Tab>('contexto')
  const [result, setResult] = useState<OpResult | null>(null)
  const [msg, setMsg] = useState('')
  const [base, setBase] = useState('')
  const [editDesign, setEditDesign] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastId = useRef<string | null>(null)

  // Troca de demanda: recomeça; atualização vinda do app (IA terminou): aceita se não houver edição pendente
  useEffect(() => {
    if (!demand) return setDraft(null)
    if (lastId.current !== demand.id) {
      lastId.current = demand.id
      setDraft(demand)
      setTab(demand.analysis || !isNew ? (demand.analysis ? 'analise' : 'contexto') : 'contexto')
      setResult(null)
      setMsg('')
      setEditDesign(false)
      return
    }
    if (!timer.current) setDraft(demand)
  }, [demand, isNew])

  useEffect(() => setBase(currentBranch && currentBranch !== demand?.key ? currentBranch : ''), [currentBranch, demand?.key])

  if (!open || !draft) return null
  const d = draft
  const project = projects.find((p) => p.id === d.projectId)
  const working = !!busy
  const keyOk = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(d.key.trim())

  const flush = async (next: Demand) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!isNew) await window.api.saveDemand(next)
  }
  const change = (patch: Partial<Demand>) => {
    const next = { ...d, ...patch }
    setDraft(next)
    if (isNew) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      window.api.saveDemand(next)
    }, 600)
  }
  const act = async (fn: () => Promise<OpResult>) => {
    await flush(d)
    setResult(await fn())
  }

  const create = async () => {
    const fresh = { ...d, key: d.key.trim().toUpperCase() }
    await window.api.saveDemand(fresh)
    onCreated(fresh)
    const r = await window.api.demandFetchJira(fresh.id)
    setResult(r.ok ? r : { ok: false, message: r.message + ' Você pode colar a descrição em Contexto.' })
  }

  const busyLabel = busy
    ? { jira: 'Buscando no Jira…', analysis: `${AI_LABEL[d.ai]} analisando…`, design: `${AI_LABEL[d.ai]} desenhando…`, dev: 'Claude trabalhando…', branch: 'Criando branch…' }[busy.what]
    : ''

  const tabs: Array<[Tab, string]> = [
    ['contexto', 'Card e contexto'],
    ['analise', 'Análise e estimativa'],
    ['desenho', 'Desenho'],
    ['dev', 'Implementação'],
    ['linha', 'Linha do tempo']
  ]

  return (
    <Modal
      open={open}
      onClose={async () => {
        await flush(d)
        onClose()
      }}
      title={isNew ? 'Nova demanda' : `${d.key} · ${d.title || d.jira?.summary || 'Demanda'}`}
      icon={<ClipboardList size={16} />}
      width="max-w-5xl"
      footer={
        isNew ? (
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!keyOk} onClick={create} data-testid="demand-create">
              Criar demanda
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              onClick={async () => {
                if (!confirm(`Excluir a demanda ${d.key}? A branch e o código não são tocados.`)) return
                await window.api.deleteDemand(d.id)
                onDeleted()
              }}
            >
              <Trash2 size={12} /> Excluir
            </Button>
            <span className="text-[11px] text-zinc-500">Salva sozinho · fica só neste PC</span>
          </div>
        )
      }
    >
      {/* Cabeçalho: número, título, etapa, IA */}
      <div className="grid grid-cols-[140px_minmax(0,1fr)_150px] gap-2">
        <input
          data-testid="demand-key"
          className={inputCls + ' font-mono uppercase'}
          value={d.key}
          disabled={!isNew}
          placeholder="WEB-482"
          onChange={(e) => change({ key: e.target.value.toUpperCase().replace(/\s/g, '') })}
          title="Número do card no Jira. Também vira o nome da branch."
        />
        <input
          className={inputCls}
          value={d.title}
          placeholder={d.jira?.summary || 'Título (vem do Jira se estiver configurado)'}
          onChange={(e) => change({ title: e.target.value })}
        />
        <select
          className={inputCls}
          value={d.status}
          onChange={(e) => change({ status: e.target.value as DemandStatus })}
          title="Etapa da demanda"
        >
          {DEMAND_STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span>Projeto: {project?.name ?? '?'}</span>
        {d.hours && <span>· estimativa {d.hours}h ({days(d.hours)})</span>}
        {d.jira?.url && (
          <button type="button" className="inline-flex cursor-pointer items-center gap-1 text-purple hover:underline" onClick={() => window.api.openExternal(d.jira!.url)}>
            · abrir no Jira <ExternalLink size={10} />
          </button>
        )}
        {working && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-purple">
            <Loader2 size={12} className="animate-spin" /> {busyLabel}
            {busy?.runId && (
              <>
                <button type="button" className="cursor-pointer underline" onClick={() => onOpenTerminal(d)}>
                  ver ao vivo
                </button>
                <button type="button" className="cursor-pointer underline" onClick={() => window.api.demandStop(d.id)}>
                  parar
                </button>
              </>
            )}
          </span>
        )}
      </div>

      {!isNew && (
        <div className="flex gap-1 border-b border-line">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              data-testid={`demand-tab-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px cursor-pointer border-b-2 px-3 py-2 text-xs',
                tab === id ? 'border-violet text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {result && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-xs',
            result.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200' : 'border-amber-400/30 bg-amber-400/5 text-amber-200'
          )}
        >
          {result.message}
        </div>
      )}

      {/* ---------------- Card e contexto ---------------- */}
      {(isNew || tab === 'contexto') && (
        <div className="space-y-3">
          {!isNew && (
            <div className="rounded-xl border border-line bg-bg/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-200">Card do Jira</span>
                <Button size="sm" disabled={working} onClick={() => act(() => window.api.demandFetchJira(d.id))}>
                  <Download size={12} /> {d.jira ? 'Atualizar do Jira' : 'Puxar do Jira'}
                </Button>
              </div>
              {d.jira ? (
                <div className="space-y-1.5">
                  <div className="text-sm text-zinc-100">{d.jira.summary}</div>
                  <div className="text-[11px] text-zinc-500">
                    {d.jira.type} · {d.jira.status} · prioridade {d.jira.priority || '?'} · {d.jira.comments.length} comentário(s)
                    {d.jira.attachments.length > 0 && ` · ${d.jira.attachments.length} anexo(s)`} · atualizado{' '}
                    {new Date(d.jira.fetchedAt).toLocaleString()}
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg bg-bg p-2">
                    <Md text={d.jira.description || '(sem descrição)'} />
                    {d.jira.comments.length > 0 && (
                      <>
                        <div className="mt-3 mb-1 text-xs font-semibold text-zinc-200">Comentários</div>
                        {d.jira.comments.map((c, i) => (
                          <p key={i} className="mb-1 text-xs text-zinc-400">
                            <b className="text-zinc-300">{c.author}</b> ({c.at}): {c.body}
                          </p>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  Ainda não carregado. Precisa do Jira configurado (Configurações → Integrações); sem ele, cole a descrição do
                  card no campo abaixo.
                </p>
              )}
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-300">Contexto extra</span>
            <span className="block text-[11px] text-zinc-500">Mensagens do chat, anotações suas, links, o que mais ajudar.</span>
            <textarea
              data-testid="demand-context"
              rows={5}
              className={areaCls}
              value={d.context}
              onChange={(e) => change({ context: e.target.value })}
              placeholder="Cole aqui o que chegou pelo chat…"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-300">Transcrição da apresentação</span>
            <span className="block text-[11px] text-zinc-500">Quando teve call: cole a transcrição que chegou no e-mail.</span>
            <textarea
              rows={5}
              className={areaCls}
              value={d.transcript}
              onChange={(e) => change({ transcript: e.target.value })}
              placeholder="Cole a transcrição…"
            />
          </label>
          {projects.length > 1 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-zinc-300">Projetos que a IA pode consultar (só leitura)</span>
              <span className="block text-[11px] text-zinc-500">Ex: o projeto da API, para conferir rotas e contratos.</span>
              <div className="flex flex-wrap gap-2">
                {projects
                  .filter((p) => p.id !== d.projectId)
                  .map((p) => {
                    const on = d.refProjectIds.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          change({ refProjectIds: on ? d.refProjectIds.filter((x) => x !== p.id) : [...d.refProjectIds, p.id] })
                        }
                        className={cn(
                          'cursor-pointer rounded-lg border px-2.5 py-1 text-xs',
                          on ? 'border-violet/60 bg-violet/15 text-purple' : 'border-line text-zinc-400 hover:text-zinc-200'
                        )}
                      >
                        {on ? '✓ ' : ''}
                        {p.name}
                      </button>
                    )
                  })}
              </div>
            </div>
          )}
          {!isNew && (
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setTab('analise')}>
                Próximo: análise →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---------------- Análise e estimativa ---------------- */}
      {!isNew && tab === 'analise' && (
        <div className="space-y-3">
          <AiRow
            ai={d.ai}
            onAi={(ai) => change({ ai })}
            disabled={working}
            label={d.analysis ? 'Analisar de novo' : 'Analisar'}
            onRun={() => act(() => window.api.demandAnalyze(d.id, 'analysis'))}
            hint="Lê o card, o contexto e o código (sem alterar nada) e devolve o entendimento, o que muda, as dúvidas para o refinamento, os riscos e uma estimativa."
            testid="demand-analyze"
          />
          {d.analysis ? (
            <div data-testid="demand-analysis" className="max-h-[42vh] overflow-y-auto rounded-xl border border-line bg-bg/50 p-3">
              <Md text={d.analysis} />
            </div>
          ) : (
            !working && <p className="text-xs text-zinc-500">Ainda sem análise.</p>
          )}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg/50 p-3">
            <span className="text-xs text-zinc-300">Sua estimativa</span>
            <input
              data-testid="demand-hours"
              type="number"
              min={0}
              step={0.5}
              className={inputCls + ' w-24'}
              value={d.hours ?? ''}
              placeholder={d.aiHours ? String(d.aiHours) : 'horas'}
              onChange={(e) => change({ hours: e.target.value === '' ? null : Number(e.target.value) })}
            />
            <span className="text-xs text-zinc-500">horas {d.hours ? days(d.hours) : ''}</span>
            {d.aiHours && (
              <button
                type="button"
                className="cursor-pointer text-xs text-purple hover:underline"
                onClick={() => change({ hours: d.aiHours, status: d.status === 'nova' ? 'estimada' : d.status })}
              >
                usar a sugestão da IA ({d.aiHours}h, {days(d.aiHours)})
              </button>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => setTab('desenho')}>
              Próximo: desenho →
            </Button>
          </div>
        </div>
      )}

      {/* ---------------- Desenho ---------------- */}
      {!isNew && tab === 'desenho' && (
        <div className="space-y-3">
          <AiRow
            ai={d.ai}
            onAi={(ai) => change({ ai })}
            disabled={working}
            label={d.design ? 'Desenhar de novo' : 'Desenhar a solução'}
            onRun={() => act(() => window.api.demandAnalyze(d.id, 'design'))}
            hint="A IA lê o código e descreve o que vai ser implementado: componentes, arquivos, chamadas à API e um passo a passo. Você revisa, ajusta e aprova."
            testid="demand-design"
          />
          {d.design || editDesign ? (
            <>
              <div className="flex items-center justify-between">
                <Button size="sm" onClick={() => setEditDesign(!editDesign)} disabled={busy?.what === 'design'}>
                  <PenLine size={12} /> {editDesign ? 'Ver formatado' : 'Editar'}
                </Button>
                <Button
                  size="sm"
                  variant={d.designApproved ? 'outline' : 'primary'}
                  disabled={!d.design.trim()}
                  onClick={() =>
                    change({
                      designApproved: !d.designApproved,
                      status: !d.designApproved && (d.status === 'nova' || d.status === 'estimada') ? 'desenhada' : d.status
                    })
                  }
                  data-testid="demand-approve"
                >
                  <CheckCircle2 size={12} /> {d.designApproved ? 'Aprovado (desfazer)' : 'Aprovar desenho'}
                </Button>
              </div>
              {editDesign ? (
                <textarea
                  rows={18}
                  className={areaCls + ' font-mono'}
                  value={d.design}
                  onChange={(e) => change({ design: e.target.value, designApproved: false })}
                />
              ) : (
                <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-line bg-bg/50 p-3">
                  <Md text={d.design} />
                </div>
              )}
            </>
          ) : (
            !working && (
              <p className="text-xs text-zinc-500">
                Ainda sem desenho.{' '}
                <button type="button" className="cursor-pointer text-purple hover:underline" onClick={() => setEditDesign(true)}>
                  Escrever eu mesmo
                </button>
              </p>
            )
          )}
          {d.designApproved && (
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setTab('dev')}>
                Próximo: implementar →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---------------- Implementação ---------------- */}
      {!isNew && tab === 'dev' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-bg/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <GitBranch size={13} /> Branch <code className="font-mono text-purple">{d.key}</code>
              {currentBranch === d.key && <span className="font-normal text-emerald-300">· você está nela</span>}
            </div>
            {currentBranch !== d.key && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">criar a partir de</span>
                <input className={inputCls + ' w-48 font-mono text-xs'} value={base} onChange={(e) => setBase(e.target.value)} placeholder="branch atual" />
                <Button size="sm" disabled={working} onClick={() => act(() => window.api.demandBranch(d.id, base))}>
                  <GitBranch size={12} /> Criar / ir para {d.key}
                </Button>
                <span className="text-[11px] text-zinc-500">Se a branch já existir, o app só troca para ela.</span>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-line bg-bg/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200">Conversa com o Claude</span>
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => onOpenTerminal(d)}>
                  <SquareTerminal size={12} /> Abrir no terminal
                </Button>
                {d.sessionId && (
                  <Button
                    size="sm"
                    disabled={working}
                    onClick={() => {
                      if (confirm('Começar outra conversa? A próxima mensagem leva o card, o contexto e o desenho de novo.')) {
                        act(() => window.api.demandImplement(d.id, msg, true))
                        setMsg('')
                      }
                    }}
                  >
                    <RotateCcw size={12} /> Nova conversa
                  </Button>
                )}
              </div>
            </div>
            {!d.sessionId && (
              <p className="text-[11px] text-zinc-500">
                A primeira mensagem leva o card, o contexto, a transcrição e o desenho{d.designApproved ? ' aprovado' : ' (ainda não aprovado)'}. O
                Claude implementa sem commit nem push; você testa e pede ajustes aqui, no terminal da demanda ou pelo Telegram
                (/demanda {d.key} texto).
              </p>
            )}
            <textarea
              data-testid="demand-msg"
              rows={3}
              className={areaCls}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  if (!working && (msg.trim() || !d.sessionId)) {
                    act(() => window.api.demandImplement(d.id, msg))
                    setMsg('')
                  }
                }
              }}
              placeholder={d.sessionId ? 'Ex: o botão ficou desalinhado no mobile… (Ctrl+Enter envia)' : 'Observação opcional para começar (Ctrl+Enter envia)'}
            />
            <div className="flex justify-end gap-2">
              {busy?.what === 'dev' && (
                <Button size="sm" onClick={() => window.api.demandStop(d.id)}>
                  <Square size={12} /> Parar
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                disabled={working || (!!d.sessionId && !msg.trim())}
                data-testid="demand-send"
                onClick={() => {
                  act(() => window.api.demandImplement(d.id, msg))
                  setMsg('')
                }}
              >
                {d.sessionId ? (
                  <>
                    <Send size={12} /> Enviar
                  </>
                ) : (
                  <>
                    <Play size={12} /> Começar a implementação
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Linha do tempo ---------------- */}
      {!isNew && tab === 'linha' && (
        <div className="space-y-1">
          {[...d.timeline].reverse().map((t, i) => (
            <div key={i} className="flex gap-3 text-xs">
              <span className="w-32 shrink-0 text-zinc-500">{new Date(t.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="text-zinc-300">{t.text}</span>
            </div>
          ))}
          {!d.timeline.length && <p className="text-xs text-zinc-500">Nada ainda.</p>}
          <p className="pt-2 text-[11px] text-zinc-500">
            <MessageSquarePlus size={11} className="inline" /> Execuções desta demanda também ficam no Histórico (busque por {d.key}).
          </p>
        </div>
      )}
    </Modal>
  )
}

function AiRow({
  ai,
  onAi,
  disabled,
  label,
  onRun,
  hint,
  testid
}: {
  ai: DemandAi
  onAi: (a: DemandAi) => void
  disabled: boolean
  label: string
  onRun: () => void
  hint: string
  testid: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(['claude', 'codex', 'gemini'] as DemandAi[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onAi(a)}
              className={cn('cursor-pointer px-3 py-1.5 text-xs', ai === a ? 'bg-violet/20 text-purple' : 'text-zinc-400 hover:text-zinc-200')}
            >
              {AI_LABEL[a]}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" disabled={disabled} onClick={onRun} data-testid={testid}>
          <Search size={12} /> {label} com {AI_LABEL[ai]}
        </Button>
      </div>
      <p className="text-[11px] text-zinc-500">{hint}</p>
    </div>
  )
}
