import { useEffect, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, Loader2, Trash2, X, XCircle } from 'lucide-react'
import type { OpResult, Project, ShotItem, ShotSet } from '@shared/types'
import { cn } from '../lib/utils'
import { Button, Modal } from './ui'

function Thumb({ item, onOpen }: { item: ShotItem; onOpen: (src: string) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  // Lista carrega a miniatura leve; o print inteiro só quando você clica
  useEffect(() => {
    const f = item.thumb ?? item.file
    if (f) window.api.shotImage(f).then(setSrc)
  }, [item.thumb, item.file])
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-lg border bg-bg', item.ok ? 'border-line' : 'border-red-500/40')}>
      <button
        type="button"
        disabled={!src}
        onClick={async () => {
          const full = item.thumb && item.file ? await window.api.shotImage(item.file) : src
          if (full) onOpen(full)
        }}
        className="block w-full cursor-zoom-in"
      >
        {src ? (
          <img src={src} alt={item.route} className="h-36 w-full object-cover object-top" />
        ) : (
          <div className="flex h-36 items-center justify-center text-[11px] text-zinc-600">{item.file ? 'carregando…' : 'sem imagem'}</div>
        )}
      </button>
      <div className="space-y-0.5 px-2 py-1.5">
        <div className="truncate font-mono text-[11px] text-zinc-300">
          {item.route} {item.width < 800 && <span className="text-zinc-500">· celular</span>}
        </div>
        {item.errors.slice(0, 3).map((e, i) => (
          <div key={i} className="truncate text-[10px] text-red-300" title={e}>
            {e}
          </div>
        ))}
        {item.errors.length > 3 && <div className="text-[10px] text-red-300">+{item.errors.length - 3} erro(s)</div>}
      </div>
    </div>
  )
}

/** Prints das telas (front) e checagem da API (back), do projeto ou da demanda */
export function ShotsView({ project, demandId }: { project: Project; demandId?: string }) {
  const [sets, setSets] = useState<ShotSet[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<OpResult | null>(null)
  const [big, setBig] = useState<string | null>(null)
  const scope = demandId ? { demandId } : { projectId: project.id }
  const load = () => window.api.shots(scope).then((l) => setSets([...l].reverse()))
  useEffect(() => {
    load()
    return window.api.onShots((s) => {
      if ((demandId && s.demandId === demandId) || (!demandId && s.projectId === project.id)) load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, demandId])
  const front = project.kind === 'front' || project.kind === 'fullstack'
  const back = project.kind === 'back' || project.kind === 'fullstack'
  const ready = !!project.localUrl && project.routes.length > 0 && project.kind !== 'outro'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !ready}
          data-testid="take-shots"
          onClick={async () => {
            setBusy(true)
            setMsg(await window.api.takeShots({ projectId: project.id, demandId, label: 'manual' }))
            setBusy(false)
          }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}{' '}
          {front && back ? 'Prints + checar a API' : front ? 'Tirar prints agora' : 'Checar a API agora'}
        </Button>
        <span className="text-[11px] text-zinc-500">
          {ready
            ? `${project.localUrl} · ${project.routes.length} rota(s). Também roda antes/depois das tarefas da fila e ao trazer o trabalho da fila.`
            : 'Edite o projeto: escolha o tipo (front/back), o endereço local e as rotas.'}
        </span>
      </div>
      {msg && <p className={cn('text-[11px]', msg.ok ? 'text-emerald-300' : 'text-amber-300')}>{msg.message}</p>}
      {!sets.length && <p className="text-xs text-zinc-500">Nenhuma captura ainda.</p>}
      <div data-testid="shot-sets" className="space-y-3">
        {sets.slice(0, 12).map((s) => {
          const bad = s.items.filter((i) => !i.ok).length
          return (
            <div key={s.id} className="rounded-xl border border-line bg-bg/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-zinc-200">
                  {s.error || bad ? <AlertTriangle size={13} className="text-amber-300" /> : <CheckCircle2 size={13} className="text-emerald-400" />}
                  <b className="font-medium">{s.kind === 'telas' ? 'Telas' : 'API'}</b> · {s.label} ·{' '}
                  {new Date(s.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  {bad > 0 && <span className="text-red-300"> · {bad} com problema</span>}
                </span>
                <button type="button" title="Apagar" className="cursor-pointer p-1 text-zinc-500 hover:text-white" onClick={() => window.api.deleteShots(s.id).then(load)}>
                  <Trash2 size={13} />
                </button>
              </div>
              {s.error && <p className="text-[11px] text-amber-300">{s.error}</p>}
              {s.kind === 'telas' ? (
                <div className="grid grid-cols-3 gap-2">
                  {s.items.map((it, i) => (
                    <Thumb key={i} item={it} onOpen={setBig} />
                  ))}
                </div>
              ) : (
                <table className="w-full text-[11px]">
                  <tbody>
                    {s.items.map((it, i) => (
                      <tr key={i} className="border-t border-line/50">
                        <td className="py-1 pr-2">{it.ok ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}</td>
                        <td className="py-1 pr-2 font-mono text-zinc-300">{it.route}</td>
                        <td className="py-1 pr-2 text-zinc-400 tabular-nums">
                          {it.status ?? '—'} {it.expected && it.status !== it.expected ? `(esperava ${it.expected})` : ''}
                        </td>
                        <td className="py-1 pr-2 text-right text-zinc-500 tabular-nums">{it.ms} ms</td>
                        <td className="max-w-[240px] truncate py-1 text-red-300" title={it.errors[0]}>
                          {it.ok ? '' : it.errors[0]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>
      {big && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-black/80 p-6" onClick={() => setBig(null)}>
          <button type="button" className="fixed top-4 right-4 cursor-pointer rounded-full bg-card p-2 text-zinc-300" aria-label="Fechar">
            <X size={16} />
          </button>
          <img src={big} alt="" className="max-w-full rounded-lg" />
        </div>
      )}
    </div>
  )
}

/** Janela de telas/API de um projeto (sem demanda) */
export function ShotsModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  return (
    <Modal open={!!project} onClose={onClose} title={project ? `Telas e API · ${project.name}` : ''} icon={<Camera size={16} />} width="max-w-5xl">
      {project && <ShotsView project={project} />}
    </Modal>
  )
}
