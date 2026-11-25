import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Boxes,
  ChevronDown,
  FileCog,
  GitMerge,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Sparkles,
  Star,
  SquareTerminal,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import type { DockerStatus, OpResult, PortOwner, Project, WorkProfile } from '@shared/types'
import { Button, IconButton, Modal, Toggle, inputCls } from './ui'
import { lineStore, useLines } from '../lib/lineStore'
import { dangerQuestion, isDangerous } from '@shared/danger'
import { cn, uid } from '../lib/utils'

// ---------------------------------------------------------------- Menu simples (abre ao clicar)

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, close])
  return ref
}

// ---------------------------------------------------------------- Sincronizar branches (projeto + ligados)

export function SyncLinkedMenu({ p, names, onResult }: { p: Project; names: string[]; onResult: (r: OpResult) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  const run = async (target: 'branch' | 'main') => {
    setOpen(false)
    setBusy(true)
    try {
      onResult(await window.api.projectsSyncBranches(p.id, target))
    } finally {
      setBusy(false)
    }
  }
  const all = [p.name, ...names].join(' e ')
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="sync-linked"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        title={`Atualizar ${all} de uma vez com o remoto da empresa`}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <GitMerge size={11} />} Sincronizar
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-80 rounded-xl border border-line bg-card p-1 shadow-2xl">
          <MenuItem
            title="Com a branch de mesmo nome no remoto da empresa"
            sub={`Cada um (${all}) traz o que entrou em empresa/<branch atual dele>. Merge, sem push.`}
            onClick={() => run('branch')}
          />
          <MenuItem title="Com o código principal (master/main)" sub={`${all} trazem a principal do remoto da empresa. Merge, sem push.`} onClick={() => run('main')} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left hover:bg-white/5">
      <div className="text-xs text-zinc-100">{title}</div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </button>
  )
}

// ---------------------------------------------------------------- Porta ocupada

export function PortOwnerChip({ port, onResult }: { port: number; onResult: (r: OpResult) => void }) {
  const [owner, setOwner] = useState<PortOwner | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const look = async () => {
    setBusy(true)
    try {
      setOwner(await window.api.portOwner(port))
    } finally {
      setBusy(false)
    }
  }
  if (owner === undefined) {
    return (
      <button type="button" onClick={look} className="cursor-pointer text-[11px] text-purple underline decoration-dotted underline-offset-2">
        {busy ? 'procurando…' : `quem está na porta ${port}?`}
      </button>
    )
  }
  if (owner === null) return <span className="text-[11px] text-zinc-500">não deu para saber quem usa a porta {port}</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
      porta {port}: <b className="text-zinc-200">{owner.name}</b> (PID {owner.pid})
      <button
        type="button"
        onClick={async () => {
          if (!confirm(`Encerrar ${owner.name} (PID ${owner.pid}), que está usando a porta ${port}?`)) return
          onResult(await window.api.portKill(port))
          setOwner(undefined)
        }}
        className="cursor-pointer rounded border border-red-500/40 px-1.5 text-red-300 hover:bg-red-500/10"
      >
        Encerrar
      </button>
    </span>
  )
}

// ---------------------------------------------------------------- Ambiente: Docker, atalhos e .env

const STATE_LOOK: Record<string, string> = {
  running: 'bg-violet',
  restarting: 'bg-amber-400 animate-pulse',
  paused: 'bg-amber-400',
  exited: 'bg-zinc-600',
  created: 'bg-zinc-600',
  none: 'bg-zinc-700',
  dead: 'bg-red-400'
}

export function EnvModal({ p, onClose, onResult }: { p: Project | null; onClose: () => void; onResult: (r: OpResult) => void }) {
  const [st, setSt] = useState<DockerStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [env, setEnv] = useState<{ files: string[]; active: string | null } | null>(null)
  const [cmd, setCmd] = useState('')
  const [svc, setSvc] = useState('')

  const load = async () => {
    if (!p) return
    setLoading(true)
    try {
      const [d, e] = await Promise.all([window.api.dockerStatus(p.id), window.api.envProfiles(p.id)])
      setSt(d)
      setEnv(e)
      if (!svc && d.services.length) setSvc((d.services.find((s) => s.state === 'running') ?? d.services[0]).name)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    setSt(null)
    setEnv(null)
    setSvc('')
    if (p) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id])

  /** Comando no container: confirma se for perigoso ou se o .env em uso parece de produção */
  const runIn = (key: string, service: string, command: string) => {
    const prodEnv = env?.active && /prod|production/i.test(env.active)
    if (isDangerous(command) && !confirm(dangerQuestion(command, `${p?.name} · ${service}`))) return
    if (prodEnv && !confirm(`Atenção: o .env em uso é o ${env!.active} (produção?).\n\nRodar "${command}" mesmo assim?`)) return
    void act(key, () => window.api.dockerExec(p!.id, service, command))
  }
  const act = async (key: string, fn: () => Promise<OpResult>, reload = false) => {
    setBusy(key)
    try {
      const r = await fn()
      onResult(r)
      if (reload) await load()
    } finally {
      setBusy(null)
    }
  }
  if (!p) return null
  const services = st?.services ?? []

  return (
    <Modal open={!!p} onClose={onClose} width="max-w-3xl" title={`Ambiente · ${p.name}`} icon={<Boxes size={16} />}>
      <div className="space-y-4" data-testid="env-modal">
        {/* Docker */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Containers</div>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Atualizar
            </Button>
          </div>
          {!st ? (
            <div className="text-xs text-zinc-500">Consultando o Docker…</div>
          ) : !st.compose ? (
            <div className="rounded-lg border border-line bg-bg p-3 text-xs text-zinc-400">
              Nenhum docker compose nesta pasta. Se o arquivo tem outro nome ou fica em outra pasta, ajuste o "Comando do Docker Compose" no
              cadastro do projeto (ex.: <code>docker compose -f docker/dev.yml</code>).
            </div>
          ) : !st.ok ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/5 p-3 text-xs text-amber-200">{st.message}</div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line">
              {services.map((s) => (
                <div key={s.name} className="flex items-center gap-2 px-3 py-2">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', STATE_LOOK[s.state] ?? 'bg-zinc-600')} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-100">
                      {s.name}
                      {s.ports && <span className="ml-2 font-mono text-[11px] text-zinc-500">{s.ports}</span>}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {s.status || s.state}
                      {s.cpu && ` · CPU ${s.cpu}`}
                      {s.mem && ` · ${s.mem}`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={s.state !== 'running' || !!busy}
                    title="Abre o terminal do sistema dentro do container (bash, ou sh se não tiver)"
                    onClick={() => act(`sh:${s.name}`, () => window.api.dockerShell(p.id, s.name))}
                  >
                    <SquareTerminal size={12} /> Shell
                  </Button>
                  <Button size="sm" disabled={!!busy} title="Mostra o log deste serviço ao vivo" onClick={() => act(`log:${s.name}`, async () => {
                    const r = await window.api.logOpen(p.id, { kind: 'docker', service: s.name })
                    if (r.ok) window.dispatchEvent(new CustomEvent('helice:open-log', { detail: p.id }))
                    return r
                  })}>
                    <ScrollText size={12} /> Log
                  </Button>
                  <Button
                    size="sm"
                    disabled={s.state === 'none' || !!busy}
                    onClick={() => act(`rs:${s.name}`, () => window.api.dockerRestart(p.id, s.name), true)}
                    title="docker compose restart"
                  >
                    {busy === `rs:${s.name}` ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reiniciar
                  </Button>
                </div>
              ))}
              {!services.length && <div className="px-3 py-2 text-xs text-zinc-500">O compose não tem serviços.</div>}
            </div>
          )}
        </div>

        {/* Atalhos e comando avulso */}
        {st?.compose && st.ok && services.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Comandos no container</div>
            {p.dockerCommands.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {p.dockerCommands.map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    disabled={!!busy}
                    title={`${c.service || svc}: ${c.command}`}
                    onClick={() => runIn(`c:${c.id}`, c.service || svc, c.command)}
                  >
                    <Zap size={12} /> {c.name}
                  </Button>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <select className={inputCls + ' h-8 w-36 text-xs'} value={svc} onChange={(e) => setSvc(e.target.value)}>
                {services.map((s) => (
                  <option key={s.name} value={s.name} className="bg-card">
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                className={inputCls + ' h-8 flex-1 font-mono text-xs'}
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && cmd.trim() && runIn('cmd', svc, cmd.trim())}
                placeholder="comando (ex.: php artisan migrate:status)"
                spellCheck={false}
              />
              <Button size="sm" variant="primary" disabled={!cmd.trim() || !svc || !!busy} onClick={() => runIn('cmd', svc, cmd.trim())}>
                <Play size={12} /> Rodar
              </Button>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">A saída aparece no terminal do projeto. Atalhos fixos ficam no cadastro do projeto.</div>
          </div>
        )}

        {/* .env */}
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Ambiente (.env)</div>
          {!env ? (
            <div className="text-xs text-zinc-500">…</div>
          ) : !env.files.length ? (
            <div className="text-xs text-zinc-500">
              Crie arquivos <code>.env.local</code>, <code>.env.homolog</code>… na pasta do projeto para trocar de ambiente com um clique.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {env.files.map((f) => {
                const on = env.active === f
                const prod = /prod|production/i.test(f)
                return (
                  <button
                    key={f}
                    type="button"
                    disabled={on || !!busy}
                    onClick={() => {
                      if (!confirm(`Trocar o .env pelo ${f}?${prod ? '\n\nAtenção: parece ser de PRODUÇÃO.' : ''}\nO atual fica guardado em .env.anterior.`)) return
                      void act(`env:${f}`, async () => {
                        const r = await window.api.envSwitch(p.id, f)
                        setEnv(await window.api.envProfiles(p.id))
                        return r
                      })
                    }}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-xs disabled:cursor-default',
                      on ? 'border-violet/60 bg-violet/15 text-purple' : prod ? 'border-red-500/40 text-red-300 hover:bg-red-500/10' : 'border-line text-zinc-300 hover:text-zinc-100'
                    )}
                  >
                    <FileCog size={12} /> {f}
                    {on && <span className="font-sans text-[10px]">(em uso)</span>}
                  </button>
                )
              })}
              {env.active === null && <span className="text-[11px] text-amber-300">o .env atual não é igual a nenhum deles</span>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- Log da aplicação

type Level = 'todos' | 'erros' | 'avisos'
const ERR = /(\.(ERROR|CRITICAL|ALERT|EMERGENCY):|Fatal error|Uncaught|Unhandled|Exception|\bERROR\b|"level(_name)?":\s*"?(error|critical)|^\s*(Error|TypeError|ReferenceError|SyntaxError):)/i
const WARN = /(\.(WARNING|NOTICE):|\bWARN(ING)?\b|Deprecated|"level(_name)?":\s*"?warn)/i

export function LogModal({ p, onClose, onResult }: { p: Project | null; onClose: () => void; onResult: (r: OpResult) => void }) {
  const key = p ? `applog:${p.id}` : ''
  const lines = useLines(key)
  const [q, setQ] = useState('')
  const [level, setLevel] = useState<Level>('todos')
  const [paused, setPaused] = useState<typeof lines | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    if (!p) return
    setPaused(null)
    void window.api.logOpen(p.id).then((r) => !r.ok && onResult(r))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id])

  const src = paused ?? lines
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return src
      .filter((l) => (level === 'erros' ? ERR.test(l.text) : level === 'avisos' ? WARN.test(l.text) || ERR.test(l.text) : true))
      .filter((l) => !n || l.text.toLowerCase().includes(n))
      .slice(-1500)
  }, [src, q, level])

  useEffect(() => {
    const el = boxRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [shown])

  if (!p) return null
  const close = () => {
    // Com alerta de erro ligado o log continua correndo em segundo plano
    if (!p.logAlerts) void window.api.logClose(p.id)
    onClose()
  }
  const analyze = async () => {
    const sel = window.getSelection()?.toString().trim()
    const text = sel || shown.slice(-120).map((l) => l.text).join('\n')
    onResult(await window.api.logAnalyze(p.id, text))
  }

  return (
    <Modal open={!!p} onClose={close} width="max-w-5xl" title={`Log · ${p.name}`} icon={<ScrollText size={16} />}>
      <div className="space-y-2" data-testid="log-modal">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[200px] flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className={inputCls + ' h-8 pl-7 text-xs'} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar (ex.: SQLSTATE, /api/pedidos)" />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['todos', 'avisos', 'erros'] as Level[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={cn('cursor-pointer px-2.5 py-1.5 text-xs', level === l ? 'bg-violet/20 text-purple' : 'text-zinc-400 hover:text-zinc-200')}
              >
                {l === 'todos' ? 'Tudo' : l === 'avisos' ? 'Avisos e erros' : 'Só erros'}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setPaused(paused ? null : lines)} title="Congela a tela para ler com calma (o log continua chegando)">
            {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Continuar' : 'Pausar'}
          </Button>
          <IconButton title="Limpar a tela" onClick={() => lineStore.clear(key)}>
            <Trash2 size={13} />
          </IconButton>
          <Button size="sm" variant="primary" onClick={analyze} title="Manda o trecho selecionado (ou as últimas linhas filtradas) para o Claude explicar. Só leitura.">
            <Sparkles size={12} /> Analisar com o Claude
          </Button>
        </div>
        <div
          ref={boxRef}
          onScroll={(e) => {
            const el = e.currentTarget
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
          className="selectable h-[60vh] overflow-y-auto rounded-lg border border-line bg-bg p-2 font-mono text-[11.5px] leading-relaxed"
        >
          {shown.length === 0 && <div className="text-zinc-600">{src.length ? 'Nada com esse filtro.' : 'Esperando o log…'}</div>}
          {shown.map((l) => (
            <div
              key={l.id}
              className={cn('whitespace-pre-wrap break-all', ERR.test(l.text) ? 'text-red-300' : WARN.test(l.text) ? 'text-amber-200' : 'text-zinc-300')}
            >
              {l.text}
            </div>
          ))}
        </div>
        <div className="text-[11px] text-zinc-500">
          {paused ? 'Pausado. ' : ''}Selecione um trecho com o mouse para analisar só ele. {p.logAlerts ? 'O alerta de erro está ligado: o log continua acompanhado ao fechar.' : ''}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- Perfis de trabalho

export function ProfilesMenu({ profiles, projects, onResult }: { profiles: WorkProfile[]; projects: Project[]; onResult: (r: OpResult) => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useOutside(open, () => setOpen(false))
  const run = async (pr: WorkProfile) => {
    setOpen(false)
    setBusy(pr.id)
    try {
      onResult(await window.api.profileRun(pr.id))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div ref={ref} className="relative">
      <IconButton title="Perfis de trabalho: sobem vários projetos de uma vez" onClick={() => setOpen((o) => !o)} data-testid="profiles-menu">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
      </IconButton>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-line bg-card p-1 shadow-2xl">
          {profiles.map((pr) => (
            <button
              key={pr.id}
              type="button"
              onClick={() => run(pr)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
            >
              <Play size={12} className="text-purple" />
              <div className="min-w-0">
                <div className="text-xs text-zinc-100">{pr.name}</div>
                <div className="truncate text-[11px] text-zinc-500">
                  {pr.projectIds.map((id) => projects.find((x) => x.id === id)?.name).filter(Boolean).join(', ') || 'sem projetos'}
                  {pr.withLinked ? ' + ligados' : ''}
                </div>
              </div>
            </button>
          ))}
          {!profiles.length && <div className="px-2.5 py-2 text-[11px] text-zinc-500">Nenhum perfil ainda. Ex.: "Bom dia" sobe o back e o front.</div>}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setEditing(true)
            }}
            className="mt-1 w-full cursor-pointer rounded-lg border-t border-line px-2.5 py-2 text-left text-xs text-purple hover:bg-white/5"
          >
            Gerenciar perfis…
          </button>
        </div>
      )}
      <ProfilesModal open={editing} profiles={profiles} projects={projects} onClose={() => setEditing(false)} />
    </div>
  )
}

function ProfilesModal({ open, profiles, projects, onClose }: { open: boolean; profiles: WorkProfile[]; projects: Project[]; onClose: () => void }) {
  const [list, setList] = useState<WorkProfile[]>([])
  useEffect(() => {
    if (open) setList(profiles.length ? profiles : [{ id: uid(), name: 'Bom dia', projectIds: [], withLinked: true }])
  }, [open, profiles])
  const set = (i: number, patch: Partial<WorkProfile>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const save = async () => {
    await window.api.saveProfiles(list.filter((x) => x.name.trim()).map((x) => ({ ...x, name: x.name.trim() })))
    onClose()
  }
  const runnable = projects.filter((p) => p.runCommand)
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title="Perfis de trabalho"
      icon={<Star size={16} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Um clique (ou <code>/subir nome</code> no Telegram) sobe todos os projetos do perfil. Projetos sem "Como executar" não aparecem.
        </p>
        {list.map((pr, i) => (
          <div key={pr.id} className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex items-center gap-2">
              <input className={inputCls + ' h-8 flex-1 text-sm'} value={pr.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Nome do perfil" />
              <IconButton title="Excluir perfil" tone="danger" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                <X size={13} />
              </IconButton>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {runnable.map((p) => {
                const on = pr.projectIds.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set(i, { projectIds: on ? pr.projectIds.filter((x) => x !== p.id) : [...pr.projectIds, p.id] })}
                    className={cn(
                      'cursor-pointer rounded-lg border px-2.5 py-1 text-xs',
                      on ? 'border-violet/60 bg-violet/15 text-purple' : 'border-line text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    {p.name}
                  </button>
                )
              })}
              {!runnable.length && <span className="text-[11px] text-zinc-500">Nenhum projeto com "Como executar".</span>}
            </div>
            <Toggle checked={pr.withLinked} onChange={(v) => set(i, { withLinked: v })} label="Subir também os projetos ligados a cada um" />
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setList((l) => [...l, { id: uid(), name: '', projectIds: [], withLinked: true }])}>
          + Perfil
        </Button>
      </div>
    </Modal>
  )
}
