import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  GitBranch,
  GitMerge,
  Copy,
  Lightbulb,
  MessageSquare,
  GitPullRequest,
  ListTodo,
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
import type { Demand, DemandAi, DemandBusy, DemandQueueCopy, DemandStatus, GitInfo, OpResult, PrComment, PrDraft, Project, ReviewAi } from '@shared/types'
import { looksLikeRule } from '@shared/text'
import { ShotsView } from './ShotsView'
import { cn, uid } from '../lib/utils'
import { onlyEnabled, useAis } from '../lib/ais'
import { DemandWorkBar } from './Worklog'
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
    review: null,
    reviewAi: 'claude',
    queueSessionId: null,
    prUrl: null,
    statusLog: [],
    type: 'feature',
    images: [],
    prCommentsDone: [],
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

type Tab = 'contexto' | 'analise' | 'desenho' | 'dev' | 'revisao' | 'telas' | 'linha'

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
  onDeleted,
  git,
  onGitChanged,
  onQueue
}: {
  onQueue: (d: Demand) => void
  git: GitInfo | null | undefined
  onGitChanged: () => void
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
  const [conflicts, setConflicts] = useState<string[]>([])
  /** Última mensagem que você mandou ao Claude (para sugerir "ensinar ao projeto") */
  const [lastSent, setLastSent] = useState('')
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

  // Quando a tarefa termina, some o aviso "Analisando…" (o resultado já aparece na própria aba)
  const busyWhat = busy?.what
  useEffect(() => {
    if (!busyWhat) setResult((r) => (r?.ok ? null : r))
  }, [busyWhat])

  const [syncLinked, setSyncLinked] = useState(true)

  if (!open || !draft) return null
  const d = draft
  const project = projects.find((p) => p.id === d.projectId)
  const working = !!busy
  // Remotos (variáveis remoto_empresa / remoto_fork) e projetos ligados, como o app principal calcula
  const varOf = (k: string) => project?.vars.find((v) => v.key === k)?.value.trim() || ''
  const forkRemote = varOf('remoto_fork') || varOf('remote') || 'origin'
  const companyRemote = varOf('remoto_empresa') || forkRemote
  const splitRemotes = companyRemote !== forkRemote
  const linkedProjects = project
    ? projects.filter(
        (o) => o.id !== project.id && ((project.linkedProjectIds ?? []).includes(o.id) || (o.linkedProjectIds ?? []).includes(project.id))
      )
    : []
  const goBranch = async (opts: { base?: string; createOnCompany?: boolean }) => {
    await flush(d)
    const r = await window.api.demandBranch(d.id, { ...opts, linked: syncLinked })
    if (r.needsCompanyBranch) {
      const ok = confirm(
        `${r.message}\n\nCriar ${d.key} no ${companyRemote} a partir da ${git?.base ?? 'principal'} de lá? ` +
          `É um push para o remoto da empresa, o mesmo que criar a branch pelo site.`
      )
      if (ok) {
        setResult(await window.api.demandBranch(d.id, { createOnCompany: true, linked: syncLinked }))
      } else {
        setResult({ ok: false, message: `Nada feito. Crie ${d.key} no site da empresa e clique de novo, ou crie só local.` })
      }
    } else setResult(r)
    onGitChanged()
  }
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
    ? {
        jira: 'Buscando no Jira…',
        analysis: `${AI_LABEL[d.ai]} analisando…`,
        design: `${AI_LABEL[d.ai]} desenhando…`,
        dev: 'Claude trabalhando…',
        branch: 'Mexendo no git…',
        review: 'Revisando o código…'
      }[busy.what]
    : ''

  const tabs: Array<[Tab, string]> = [
    ['contexto', 'Card e contexto'],
    ['analise', 'Análise e estimativa'],
    ['desenho', 'Desenho'],
    ['dev', 'Implementação'],
    ['revisao', 'Revisão'],
    ...(project && project.kind !== 'outro'
      ? [['telas', project.kind === 'back' ? 'API' : project.kind === 'front' ? 'Telas' : 'Telas e API'] as [Tab, string]]
      : []),
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
      {!isNew && <DemandWorkBar demandId={d.id} jiraKey={d.key} onResult={setResult} />}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
        <span>Projeto: {project?.name ?? '?'}</span>
        {d.hours && <span>· estimativa {d.hours}h ({days(d.hours)})</span>}
        {realDays(d) !== null && (
          <span title="Dias úteis desde que entrou em Em dev (até Feita, ou até hoje)">
            · real {String(realDays(d)).replace('.', ',')} dia(s) útil(eis)
          </span>
        )}
        {d.prUrl && (
          <button type="button" className="inline-flex cursor-pointer items-center gap-1 text-purple hover:underline" onClick={() => window.api.openExternal(d.prUrl!)}>
            · PR <ExternalLink size={10} />
          </button>
        )}
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

          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-300">Tipo</span>
            <div className="flex overflow-hidden rounded-lg border border-line" data-testid="demand-type">
              {(
                [
                  ['feature', 'Funcionalidade'],
                  ['bug', 'Bug']
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => change({ type: t })}
                  className={cn('cursor-pointer px-3 py-1 text-xs', d.type === t ? (t === 'bug' ? 'bg-red-500/15 text-red-300' : 'bg-violet/20 text-purple') : 'text-zinc-400 hover:text-zinc-200')}
                >
                  {label}
                </button>
              ))}
            </div>
            {d.type === 'bug' && (
              <span className="text-[11px] text-zinc-500">A análise procura a causa; a correção começa por um teste que reproduz o bug.</span>
            )}
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-300">{d.type === 'bug' ? 'Como reproduzir / erro' : 'Contexto extra'}</span>
            <span className="block text-[11px] text-zinc-500">
              {d.type === 'bug'
                ? 'Passo a passo, mensagem de erro, onde acontece. Cole prints aqui mesmo (Ctrl+V).'
                : 'Mensagens do chat, anotações suas, links, o que mais ajudar. Prints: cole aqui (Ctrl+V).'}
            </span>
            <textarea
              data-testid="demand-context"
              rows={5}
              className={areaCls}
              value={d.context}
              onChange={(e) => change({ context: e.target.value })}
              onPaste={async (e) => {
                const img = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
                if (!img || isNew) return
                e.preventDefault()
                const file = img.getAsFile()
                if (!file) return
                const dataUrl = await new Promise<string>((res) => {
                  const r = new FileReader()
                  r.onload = () => res(String(r.result))
                  r.readAsDataURL(file)
                })
                setResult(await window.api.demandAddImage(d.id, dataUrl))
              }}
              placeholder={d.type === 'bug' ? 'Ex: ao filtrar por data, a lista fica vazia… (cole prints com Ctrl+V)' : 'Cole aqui o que chegou pelo chat…'}
            />
          </label>
          {d.images.length > 0 && <DemandImages d={d} />}
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
          {d.analysis && !working && <DoubtsBox d={d} jira={!!d.jira} onResult={setResult} />}
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
            {currentBranch === d.key && git && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={working}
                    data-testid="demand-update-base"
                    onClick={async () => {
                      await flush(d)
                      const r = (await window.api.demandUpdateBase(d.id)) as OpResult & { conflicts?: string[] }
                      setResult(r)
                      setConflicts(r.conflicts ?? [])
                      onGitChanged()
                    }}
                  >
                    <GitMerge size={12} /> Atualizar com a {git.base}
                  </Button>
                  <span className="text-[11px] text-zinc-500">
                    {splitRemotes
                      ? `Busca ${companyRemote}/${d.key} e ${companyRemote}/${git.base} e faz merge nesta branch, sem push (precisa estar sem alterações pendentes).`
                      : `Busca a ${git.base} do ${companyRemote} e faz merge nesta branch (precisa estar sem alterações pendentes).`}
                    {git.changed > 0 && <span className="text-amber-300"> Agora há {git.changed} alterado(s) sem commit.</span>}
                  </span>
                </div>
                {conflicts.length > 0 && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-200">
                    Conflito em: {conflicts.join(', ')}
                    <div className="mt-1.5 flex gap-2">
                      <Button
                        size="sm"
                        disabled={working}
                        onClick={async () => {
                          setResult(
                            await window.api.demandImplement(
                              d.id,
                              `Atualizei a branch ${d.key} com a ${git.base} (merge) e deu conflito em: ${conflicts.join(', ')}. ` +
                                'Resolva os conflitos mantendo o que a demanda precisa e o que veio da ' +
                                git.base +
                                '. Depois de resolver, marque os arquivos com git add, mas NÃO faça o commit: eu confiro e commito.'
                            )
                          )
                          setConflicts([])
                        }}
                      >
                        Pedir ao Claude para resolver
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {currentBranch !== d.key && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="primary" disabled={working} data-testid="demand-branch" onClick={() => goBranch({})}>
                    <GitBranch size={12} /> Ir para {d.key}
                  </Button>
                  <span className="text-[11px] text-zinc-500">
                    {splitRemotes
                      ? `Se já existir aqui, só troca; senão busca ${companyRemote}/${d.key} (git checkout -b ${d.key} ${companyRemote}/${d.key}). Se não existir lá, pergunta antes de criar.`
                      : `Se já existir, só troca; senão busca ${companyRemote}/${d.key} ou cria a partir da branch atual.`}
                  </span>
                </div>
                {linkedProjects.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                    <input type="checkbox" checked={syncLinked} onChange={(e) => setSyncLinked(e.target.checked)} className="accent-violet-500" />
                    Levar também {linkedProjects.map((o) => o.name).join(', ')} para {d.key} (só se a branch existir lá; nada é criado)
                  </label>
                )}
                {splitRemotes && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    ou criar só local a partir de
                    <input
                      className={inputCls + ' h-7 w-40 font-mono text-xs'}
                      value={base}
                      onChange={(e) => setBase(e.target.value)}
                      placeholder={currentBranch || 'branch atual'}
                    />
                    <Button size="sm" disabled={working} onClick={() => goBranch({ base: base.trim() || currentBranch || 'HEAD' })}>
                      Criar local
                    </Button>
                  </div>
                )}
              </div>
            )}
            {currentBranch === d.key && linkedProjects.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                <Button size="sm" disabled={working} onClick={() => goBranch({})} data-testid="demand-branch-linked">
                  <GitBranch size={12} /> Levar {linkedProjects.map((o) => o.name).join(', ')} para {d.key}
                </Button>
                só troca onde a branch já existe
              </div>
            )}
          </div>

          <QueueCopyBox d={d} working={working} onResult={setResult} onGitChanged={onGitChanged} />

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
                    setLastSent(msg)
                    setMsg('')
                  }
                }
              }}
              placeholder={d.sessionId ? 'Ex: o botão ficou desalinhado no mobile… (Ctrl+Enter envia)' : 'Observação opcional para começar (Ctrl+Enter envia)'}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => onQueue(d)} title="Deixa para o Claude fazer depois (de preferência quando você estiver Ausente)">
                <ListTodo size={12} /> Pôr na fila
              </Button>
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
                  setLastSent(msg)
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

      {!isNew && tab === 'dev' && project && <LearnBox projectId={project.id} memoryFile={project.memoryFile} suggestion={looksLikeRule(lastSent) ? lastSent : ''} onResult={setResult} />}

      {/* ---------------- Revisão ---------------- */}
      {!isNew && tab === 'revisao' && (
        <>
          <ReviewTab d={d} working={working} reviewing={busy?.what === 'review'} onAi={(reviewAi) => change({ reviewAi })} onResult={setResult} flush={() => flush(d)} />
          <PrBox d={d} onResult={setResult} />
          <PrCommentsBox d={d} working={working} onResult={setResult} />
        </>
      )}

      {!isNew && tab === 'telas' && project && <ShotsView project={project} demandId={d.id} />}

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

/** Prints colados na demanda */
function DemandImages({ d }: { d: Demand }) {
  const [srcs, setSrcs] = useState<Record<string, string>>({})
  useEffect(() => {
    for (const f of d.images) if (!srcs[f]) window.api.shotImage(f).then((s) => s && setSrcs((x) => ({ ...x, [f]: s })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.images])
  return (
    <div className="flex flex-wrap gap-2" data-testid="demand-images">
      {d.images.map((f) => (
        <div key={f} className="relative">
          {srcs[f] ? <img src={srcs[f]} alt="" className="h-20 w-28 rounded-lg border border-line object-cover" /> : <div className="h-20 w-28 rounded-lg border border-line" />}
          <button
            type="button"
            title="Remover"
            onClick={() => window.api.demandRemoveImage(d.id, f)}
            className="absolute top-1 right-1 cursor-pointer rounded-full bg-black/70 p-0.5 text-zinc-300 hover:text-white"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Dúvidas da análise → mensagem pronta (copiar) ou comentário no card do Jira */
function DoubtsBox({ d, jira, onResult }: { d: Demand; jira: boolean; onResult: (r: OpResult) => void }) {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    window.api.demandDoubts(d.id).then(setText)
  }, [d.id, d.analysis])
  if (!text) return null
  return (
    <div data-testid="doubts" className="space-y-2 rounded-xl border border-line bg-bg/50 p-3">
      <div className="text-xs font-semibold text-zinc-200">Dúvidas para levar ao refinamento</div>
      <textarea rows={7} className={areaCls} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          onClick={async () => {
            await window.api.copyText(text)
            setCopied(true)
          }}
        >
          <Copy size={12} /> {copied ? 'Copiado' : 'Copiar para o chat'}
        </Button>
        {jira && (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              if (!confirm(`Comentar estas dúvidas no card ${d.key} do Jira?`)) return
              onResult(await window.api.demandCommentJira(d.id, text))
            }}
          >
            <Send size={12} /> Comentar no card
          </Button>
        )}
      </div>
    </div>
  )
}

/** Comentários do time no PR → Claude ajusta */
function PrCommentsBox({ d, working, onResult }: { d: Demand; working: boolean; onResult: (r: OpResult) => void }) {
  const [list, setList] = useState<PrComment[] | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    const r = await window.api.demandPrComments(d.id)
    setLoading(false)
    onResult(r)
    setList(r.comments ?? null)
    setSel((r.comments ?? []).filter((c) => !d.prCommentsDone.includes(c.id)).map((c) => c.id))
  }
  const send = async (toQueue: boolean) => {
    if (!list) return
    onResult(await window.api.demandSendPrComments(d.id, sel, list, toQueue))
    setList(null)
  }
  return (
    <div className="space-y-2 rounded-xl border border-line bg-bg/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-200">Comentários do time no PR</span>
        <Button size="sm" disabled={loading} onClick={load} data-testid="pr-comments">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} Buscar comentários
        </Button>
      </div>
      {list && list.length > 0 && (
        <>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {list.map((c) => {
              const done = d.prCommentsDone.includes(c.id)
              return (
                <label key={c.id} className={cn('flex cursor-pointer gap-2 rounded-lg border border-line px-2.5 py-2 text-xs', done && 'opacity-60')}>
                  <input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                  <span className="min-w-0 flex-1">
                    <span className="text-[11px] text-zinc-500">
                      <b className="text-zinc-300">{c.author}</b>
                      {c.path ? ` · ${c.path}${c.line ? `:${c.line}` : ''}` : c.kind === 'revisao' ? ' · revisão' : ''}
                      {done && ' · já mandado'}
                    </span>
                    <span className="block whitespace-pre-wrap text-zinc-200 [overflow-wrap:anywhere]">{c.body}</span>
                  </span>
                </label>
              )
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={!sel.length} onClick={() => send(true)}>
              <ListTodo size={12} /> Pôr na fila
            </Button>
            <Button size="sm" variant="primary" disabled={!sel.length || working} onClick={() => send(false)}>
              <Send size={12} /> Mandar para o Claude ajustar ({sel.length})
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Ensinar ao projeto: guarda uma regra no arquivo de memória (CLAUDE.md) */
function LearnBox({ projectId, memoryFile, suggestion, onResult }: { projectId: string; memoryFile: string; suggestion: string; onResult: (r: OpResult) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  useEffect(() => {
    if (suggestion) setText(suggestion)
  }, [suggestion])
  if (!open && !suggestion) {
    return (
      <div className="flex justify-end">
        <button type="button" className="cursor-pointer text-[11px] text-purple hover:underline" onClick={() => setOpen(true)} data-testid="learn-open">
          <Lightbulb size={11} className="inline" /> Ensinar ao projeto (guardar uma regra em {memoryFile || 'CLAUDE.md'})
        </button>
      </div>
    )
  }
  return (
    <div data-testid="learn" className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.04] p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
        <Lightbulb size={13} className="text-amber-300" />
        {suggestion && !open ? 'Isso parece uma regra do projeto. Guardar para as próximas vezes?' : 'Ensinar ao projeto'}
      </div>
      <textarea rows={2} className={areaCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex: aqui não usamos axios; use o cliente http de src/lib/api.ts" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-500">Vai para {memoryFile || 'CLAUDE.md'}, que o Claude lê em toda tarefa neste projeto.</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              setOpen(false)
              setText('')
            }}
          >
            Agora não
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!text.trim()}
            onClick={async () => {
              const r = await window.api.projectLearn(projectId, text)
              onResult(r)
              if (r.ok) {
                setOpen(false)
                setText('')
              }
            }}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Dias úteis de Em dev até Feita (ou até agora) */
function realDays(d: Demand): number | null {
  const start = d.statusLog.find((s) => s.status === 'dev')?.at
  if (!start) return null
  const end = d.status === 'feita' ? ([...d.statusLog].reverse().find((s) => s.status === 'feita')?.at ?? Date.now()) : Date.now()
  let total = 0
  for (let t = start; t < end; ) {
    const next = new Date(t)
    next.setHours(24, 0, 0, 0)
    const stop = Math.min(next.getTime(), end)
    const wd = new Date(t).getDay()
    if (wd !== 0 && wd !== 6) total += (stop - t) / 86_400_000
    t = stop
  }
  return Math.round(total * 10) / 10
}

const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

/** Cópia separada onde a fila trabalha (git worktree) */
function QueueCopyBox({
  d,
  working,
  onResult,
  onGitChanged
}: {
  d: Demand
  working: boolean
  onResult: (r: OpResult) => void
  onGitChanged: () => void
}) {
  const [copy, setCopy] = useState<DemandQueueCopy | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => window.api.demandQueueCopy(d.id).then(setCopy)
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id, d.updatedAt, working])
  if (!copy || (!copy.exists && !copy.ahead)) return null
  const act = async (fn: () => Promise<OpResult>) => {
    setBusy(true)
    onResult(await fn())
    setBusy(false)
    load()
    onGitChanged()
  }
  return (
    <div data-testid="queue-copy" className="space-y-2 rounded-xl border border-teal-500/30 bg-teal-500/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-200">
          Cópia da fila <code className="font-mono text-teal-300">fila/{d.key}</code>
          {copy.ahead > 0 ? (
            <span className="font-normal text-teal-300"> · {copy.ahead} commit(s) prontos para trazer</span>
          ) : (
            <span className="font-normal text-zinc-500"> · nada novo</span>
          )}
          {copy.exists && <span className="font-normal text-zinc-500"> · ocupa {fmtBytes(copy.bytes)}</span>}
        </span>
        <div className="flex gap-1.5">
          <Button size="sm" disabled={!copy.exists} onClick={() => window.api.openSystemTerminal(copy.dir)} title={copy.dir}>
            <SquareTerminal size={12} /> Terminal na cópia
          </Button>
          <Button size="sm" variant="primary" disabled={busy || working || !copy.ahead} onClick={() => act(() => window.api.demandBringQueue(d.id))}>
            <GitMerge size={12} /> Trazer para {d.key}
          </Button>
          <Button
            size="sm"
            disabled={busy || working}
            onClick={() => {
              if (copy.ahead && !confirm(`A cópia tem ${copy.ahead} commit(s) que ainda não estão em ${d.key}. Remover mesmo assim?`)) return
              act(() => window.api.demandRemoveQueueCopy(d.id))
            }}
          >
            <Trash2 size={12} /> Remover cópia
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        A fila trabalha numa pasta separada, sem mexer na sua (usando o node_modules do projeto, sem instalar de novo).
        A cópia some sozinha quando a demanda vira Feita e o trabalho já está na branch. Cada tarefa vira um commit local em fila/{d.key}; "Trazer"
        junta esses commits na branch {d.key} (se ela estiver aberta no card, faz merge; precisa estar sem alterações
        pendentes).
      </p>
    </div>
  )
}

/** Abrir o PR pelo app: título e descrição montados do card, desenho e revisão */
function PrBox({ d, onResult }: { d: Demand; onResult: (r: OpResult) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PrDraft | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [asDraft, setAsDraft] = useState(true)
  const [sending, setSending] = useState(false)
  const start = async () => {
    const p = await window.api.demandPrDraft(d.id)
    setDraft(p)
    setTitle(p?.title ?? d.key)
    setBody(p?.body ?? '')
    setOpen(true)
  }
  return (
    <div className="space-y-2 rounded-xl border border-line bg-bg/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-200">
          Pull request
          {d.prUrl && (
            <button type="button" className="ml-2 cursor-pointer font-normal text-purple hover:underline" onClick={() => window.api.openExternal(d.prUrl!)}>
              {d.prUrl.replace(/^https:\/\/github\.com\//, '')}
            </button>
          )}
        </span>
        {!open && (
          <Button size="sm" variant={d.prUrl ? 'outline' : 'primary'} onClick={start} data-testid="pr-start">
            <GitPullRequest size={12} /> {d.prUrl ? 'Abrir outro PR' : 'Abrir PR'}
          </Button>
        )}
      </div>
      {open && (
        <>
          <input className={inputCls + ' w-full'} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea rows={10} className={areaCls + ' font-mono'} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} /> Abrir como rascunho (draft)
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={sending || !title.trim()}
                onClick={async () => {
                  if (!confirm(`Enviar a branch ${d.key} (git push) e abrir o PR contra ${draft?.base ?? 'a principal'}?`)) return
                  setSending(true)
                  const r = await window.api.demandCreatePr(d.id, { title, body, draft: asDraft })
                  setSending(false)
                  onResult(r)
                  if (r.ok) setOpen(false)
                }}
              >
                {sending ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />} Enviar e abrir PR
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-zinc-500">
            Faz o push da branch {d.key} e abre o PR contra a {draft?.base} com o GitHub CLI (gh). Nada acontece antes de você
            confirmar.
          </p>
        </>
      )}
    </div>
  )
}

const REVIEW_LABEL: Record<ReviewAi, string> = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini', dupla: 'ChatGPT → Claude' }

function ReviewTab({
  d,
  working,
  reviewing,
  onAi,
  onResult,
  flush
}: {
  d: Demand
  working: boolean
  reviewing: boolean
  onAi: (a: ReviewAi) => void
  onResult: (r: OpResult) => void
  flush: () => Promise<void>
}) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState(d.review?.text ?? '')
  const [publishing, setPublishing] = useState(false)
  useEffect(() => setText(d.review?.text ?? ''), [d.review?.text])
  const ais = useAis()
  const rv = d.review
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line">
            {onlyEnabled(['claude', 'codex', 'gemini', 'dupla'] as ReviewAi[], ais, d.reviewAi)
              // A revisão dupla usa o ChatGPT e depois o Claude: só aparece com os dois ligados
              .filter((a) => a !== 'dupla' || d.reviewAi === 'dupla' || (ais.codex && ais.claude))
              .map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => onAi(a)}
                className={cn('cursor-pointer px-3 py-1.5 text-xs', d.reviewAi === a ? 'bg-violet/20 text-purple' : 'text-zinc-400 hover:text-zinc-200')}
              >
                {REVIEW_LABEL[a]}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={working}
            data-testid="demand-review"
            onClick={async () => {
              await flush()
              onResult(await window.api.demandReview(d.id))
            }}
          >
            <Search size={12} /> {rv ? 'Revisar de novo' : 'Revisar a branch'}
          </Button>
        </div>
        <p className="text-[11px] text-zinc-500">
          Compara a branch <code className="font-mono text-purple">{d.key}</code> com a principal (commits + o que ainda está sem
          commit) e revisa como num PR, seguindo o card, o desenho e o guia do projeto. Nada é alterado.{' '}
          <b className="text-zinc-400">ChatGPT → Claude</b>: o ChatGPT faz a primeira passada (mais barata) e o Claude confere e
          aprofunda.
        </p>
      </div>
      {reviewing && (
        <p className="flex items-center gap-2 text-xs text-purple">
          <Loader2 size={12} className="animate-spin" /> revisando…
        </p>
      )}
      {rv && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
            <span>
              {REVIEW_LABEL[rv.ai]} · {rv.scope} · commit <code className="font-mono">{rv.commit}</code> ·{' '}
              {new Date(rv.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              {rv.publishedAt && <span className="text-emerald-300"> · publicada no PR</span>}
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                onClick={async () => {
                  if (edit) await window.api.demandSaveReview(d.id, text)
                  setEdit(!edit)
                }}
              >
                <PenLine size={12} /> {edit ? 'Salvar' : 'Editar rascunho'}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={publishing || edit}
                onClick={async () => {
                  if (!confirm(`Publicar esta revisão como comentário no PR da branch ${d.key}?`)) return
                  setPublishing(true)
                  onResult(await window.api.demandPublishReview(d.id))
                  setPublishing(false)
                }}
              >
                {publishing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Publicar no PR
              </Button>
            </div>
          </div>
          {edit ? (
            <textarea rows={18} className={areaCls + ' font-mono'} value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <div data-testid="demand-review-text" className="max-h-[48vh] overflow-y-auto rounded-xl border border-line bg-bg/50 p-3">
              <Md text={rv.text} />
            </div>
          )}
          <p className="text-[11px] text-zinc-500">
            É um rascunho: nada vai para o GitHub sem você clicar em "Publicar no PR" (usa o GitHub CLI, <code>gh</code>, e o PR
            aberto da branch).
          </p>
        </>
      )}
    </div>
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
  const ais = useAis()
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {onlyEnabled(['claude', 'codex', 'gemini'] as DemandAi[], ais, ai).map((a) => (
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
