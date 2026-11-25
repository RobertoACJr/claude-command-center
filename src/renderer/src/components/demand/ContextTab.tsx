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

/** Aba Contexto: card do Jira, transcrições, imagens, dúvidas */
export function ContextTab(props: DemandTabProps) {
  const { d, isNew, tab, setTab, act, change, flush, projects, setResult, working, busy, editDesign, setEditDesign, base, setBase, companyRemote, splitRemotes, conflicts, setConflicts, currentBranch, git, goBranch, linkedProjects, msg, setMsg, onGitChanged, onOpenTerminal, onQueue, setLastSent, syncLinked, setSyncLinked } = props
  return (
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
  )
}
