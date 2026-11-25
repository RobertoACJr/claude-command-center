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

/** Aba Desenho: a solução que a IA propõe antes de implementar */
export function DesignTab(props: DemandTabProps) {
  const { d, isNew, tab, setTab, act, change, flush, projects, setResult, working, busy, editDesign, setEditDesign, base, setBase, companyRemote, splitRemotes, conflicts, setConflicts, currentBranch, git, goBranch, linkedProjects, msg, setMsg, onGitChanged, onOpenTerminal, onQueue, setLastSent, syncLinked, setSyncLinked } = props
  return (
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
  )
}
