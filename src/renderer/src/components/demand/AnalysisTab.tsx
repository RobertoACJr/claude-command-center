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

import { AI_LABEL, DEMAND_STATUS, Md, areaCls, days, fmtBytes, inputCls, newDemand, realDays, statusInfo, REVIEW_LABEL, type Tab } from './shared'
import { AiRow, DemandImages, DoubtsBox, LearnBox, PrBox, PrCommentsBox, QueueCopyBox } from './boxes'
import { ReviewTab } from './ReviewTab'

// Quem importa daqui continua funcionando
export { DEMAND_STATUS, newDemand, statusInfo }

import type { DemandTabProps } from './tabProps'

/** Aba Análise: estimativa e dúvidas que a IA levantou */
export function AnalysisTab(props: DemandTabProps) {
  const { d, isNew, tab, setTab, act, change, flush, projects, setResult, working, busy, editDesign, setEditDesign, base, setBase, companyRemote, splitRemotes, conflicts, setConflicts, currentBranch, git, goBranch, linkedProjects, msg, setMsg, onGitChanged, onOpenTerminal, onQueue, setLastSent, syncLinked, setSyncLinked } = props
  return (
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
  )
}
