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

import { AI_LABEL, DEMAND_STATUS, Md, areaCls, days, fmtBytes, inputCls, newDemand, realDays, statusInfo, REVIEW_LABEL, type Tab } from './demand/shared'
import { AiRow, DemandImages, DoubtsBox, LearnBox, PrBox, PrCommentsBox, QueueCopyBox } from './demand/boxes'
import { ReviewTab } from './demand/ReviewTab'
import { ContextTab } from './demand/ContextTab'
import { AnalysisTab } from './demand/AnalysisTab'
import { DesignTab } from './demand/DesignTab'
import { DevTab } from './demand/DevTab'
import type { DemandTabProps } from './demand/tabProps'

// Quem importa daqui continua funcionando
export { DEMAND_STATUS, newDemand, statusInfo }

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

  /** O que as abas (Contexto, Análise, Desenho, Dev) usam */
  const tabProps: DemandTabProps = { d, isNew, tab, setTab, act, change, flush, projects, setResult, working, busy, editDesign, setEditDesign, base, setBase, companyRemote, splitRemotes, conflicts, setConflicts, currentBranch, git, goBranch, linkedProjects, msg, setMsg, onGitChanged, onOpenTerminal, onQueue, setLastSent, syncLinked, setSyncLinked }

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
      {!isNew && <DemandWorkBar demandId={d.id} jiraKey={d.key} stage={d.status} onResult={setResult} />}
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
        <ContextTab {...tabProps} />
      )}

      {/* ---------------- Análise e estimativa ---------------- */}
      {!isNew && tab === 'analise' && (
        <AnalysisTab {...tabProps} />
      )}

      {/* ---------------- Desenho ---------------- */}
      {!isNew && tab === 'desenho' && (
        <DesignTab {...tabProps} />
      )}

      {/* ---------------- Implementação ---------------- */}
      {!isNew && tab === 'dev' && (
        <DevTab {...tabProps} />
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
