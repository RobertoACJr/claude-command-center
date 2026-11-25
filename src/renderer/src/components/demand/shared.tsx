// Peças comuns da janela da demanda (etapas, rótulos, markdown simples)
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

export const DEMAND_STATUS: Array<{ id: DemandStatus; label: string; cls: string }> = [
  { id: 'nova', label: 'Nova', cls: 'border-zinc-600 text-zinc-300' },
  { id: 'estimada', label: 'Estimada', cls: 'border-sky-500/50 text-sky-300' },
  { id: 'desenhada', label: 'Desenhada', cls: 'border-violet/60 text-purple' },
  { id: 'dev', label: 'Em dev', cls: 'border-amber-400/50 text-amber-300' },
  { id: 'teste', label: 'Em teste', cls: 'border-orange-400/50 text-orange-300' },
  { id: 'beta', label: 'Beta', cls: 'border-teal-400/50 text-teal-300' },
  { id: 'feita', label: 'Feita', cls: 'border-emerald-500/50 text-emerald-300' }
]

export const AI_LABEL: Record<DemandAi, string> = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini' }

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

export const days = (h: number) => `≈ ${Math.round((h / 8) * 10) / 10} dia(s)`

/** Markdown simples (títulos, listas, checklist, código) só para leitura */
export function Md({ text }: { text: string }) {
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

export type Tab = 'contexto' | 'analise' | 'desenho' | 'dev' | 'revisao' | 'telas' | 'linha'

export const areaCls =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet/60'
export const inputCls =
  'h-9 rounded-lg border border-line bg-bg px-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet/60'

/**
 * Uma demanda (card do Jira) de ponta a ponta: contexto → análise com dúvidas e estimativa → desenho → implementação
 * com o Claude numa branch com o nome do card.
 */

export function realDays(d: Demand): number | null {
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

export const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

/** Cópia separada onde a fila trabalha (git worktree) */

export const REVIEW_LABEL: Record<ReviewAi, string> = { claude: 'Claude', codex: 'ChatGPT', gemini: 'Gemini', dupla: 'ChatGPT → Claude' }
