// Aba Revisão da demanda (revisão de código pela IA)
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
import { AiRow, PrBox, PrCommentsBox } from './boxes'

export function ReviewTab({
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
