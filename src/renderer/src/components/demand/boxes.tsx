// Caixas da janela da demanda: imagens, dúvidas, comentários do PR, aprendizado, cópia da fila, PR, escolha da IA
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
import { ShotsView } from '../ShotsView'
import { cn, uid } from '../../lib/utils'
import { onlyEnabled, useAis } from '../../lib/ais'
import { DemandWorkBar } from '../Worklog'
import { Button, Modal } from '../ui'
import { DEMAND_STATUS, AI_LABEL, statusInfo, newDemand, days, Md, areaCls, inputCls, realDays, fmtBytes, REVIEW_LABEL, type Tab } from './shared'

export function DemandImages({ d }: { d: Demand }) {
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
export function DoubtsBox({ d, jira, onResult }: { d: Demand; jira: boolean; onResult: (r: OpResult) => void }) {
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
export function PrCommentsBox({ d, working, onResult }: { d: Demand; working: boolean; onResult: (r: OpResult) => void }) {
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
export function LearnBox({ projectId, memoryFile, suggestion, onResult }: { projectId: string; memoryFile: string; suggestion: string; onResult: (r: OpResult) => void }) {
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

export function QueueCopyBox({
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
export function PrBox({ d, onResult }: { d: Demand; onResult: (r: OpResult) => void }) {
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


export function AiRow({
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
