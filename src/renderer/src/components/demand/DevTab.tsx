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

/** Aba Dev: branch, conversa com o Claude, fila, atualizar com a principal, PR */
export function DevTab(props: DemandTabProps) {
  const { d, isNew, tab, setTab, act, change, flush, projects, setResult, working, busy, editDesign, setEditDesign, base, setBase, companyRemote, splitRemotes, conflicts, setConflicts, currentBranch, git, goBranch, linkedProjects, msg, setMsg, onGitChanged, onOpenTerminal, onQueue, setLastSent, syncLinked, setSyncLinked } = props
  return (
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
  )
}
