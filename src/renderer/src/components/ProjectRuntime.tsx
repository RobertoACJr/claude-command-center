import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { DockerCommand, LogSource, LogSourceKind, Project } from '@shared/types'
import { Button, Field, IconButton, Toggle, inputCls } from './ui'
import { cn, uid } from '../lib/utils'

/** Parte do cadastro sobre como o projeto roda: parar, saúde, Ausente, Docker e log */
export type Runtime = Pick<
  Project,
  'stopCommand' | 'stopTimeoutSec' | 'awayStop' | 'healthUrl' | 'dockerCommand' | 'dockerCommands' | 'logSource' | 'logAlerts'
>

export const emptyRuntime = (): Runtime => ({
  stopCommand: '',
  stopTimeoutSec: 10,
  awayStop: false,
  healthUrl: '',
  dockerCommand: 'docker compose',
  dockerCommands: [],
  logSource: { kind: 'none', service: '', path: '', command: '' },
  logAlerts: false
})

export const runtimeOf = (p: Project | null): Runtime =>
  p
    ? {
        stopCommand: p.stopCommand ?? '',
        stopTimeoutSec: p.stopTimeoutSec ?? 10,
        awayStop: p.awayStop ?? false,
        healthUrl: p.healthUrl ?? '',
        dockerCommand: p.dockerCommand || 'docker compose',
        dockerCommands: p.dockerCommands ?? [],
        logSource: p.logSource ?? emptyRuntime().logSource,
        logAlerts: p.logAlerts ?? false
      }
    : emptyRuntime()

const LOG_KINDS: Array<[LogSourceKind, string]> = [
  ['none', 'Nenhum'],
  ['docker', 'Serviço do Docker'],
  ['file', 'Arquivo'],
  ['command', 'Comando']
]

export function RuntimeFields({ value, onChange, path }: { value: Runtime; onChange: (v: Runtime) => void; path: string }) {
  const [open, setOpen] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [services, setServices] = useState<string[]>([])
  const [note, setNote] = useState('')
  const set = (patch: Partial<Runtime>) => onChange({ ...value, ...patch })
  const setLog = (patch: Partial<LogSource>) => set({ logSource: { ...value.logSource, ...patch } })
  const setCmd = (i: number, patch: Partial<DockerCommand>) =>
    set({ dockerCommands: value.dockerCommands.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  /** Olha a pasta e preenche o que der (sem apagar o que você já escreveu) */
  const suggest = async () => {
    if (!path) return setNote('Escolha a pasta do projeto antes.')
    setSuggesting(true)
    try {
      const s = await window.api.projectSuggest(path, value.dockerCommand)
      setServices(s.services)
      const patch: Partial<Runtime> = {}
      const main = s.services.find((x) => /^(app|api|laravel|php|web|backend)$/i.test(x)) ?? s.services[0] ?? ''
      if (s.compose && !value.stopCommand) patch.stopCommand = `${value.dockerCommand || 'docker compose'} stop`
      if (value.logSource.kind === 'none') {
        if (s.logPath) patch.logSource = { ...value.logSource, kind: 'file', path: s.logPath }
        else if (s.compose && main) patch.logSource = { ...value.logSource, kind: 'docker', service: main }
      }
      const have = new Set(value.dockerCommands.map((c) => c.command))
      const add = s.compose ? s.commands.filter((c) => !have.has(c.command)).map((c) => ({ id: uid(), name: c.name, service: main, command: c.command })) : []
      if (add.length) patch.dockerCommands = [...value.dockerCommands, ...add]
      onChange({ ...value, ...patch })
      setNote(
        s.compose
          ? `Compose encontrado${s.services.length ? ` (serviços: ${s.services.join(', ')})` : ''}. Revise o que foi preenchido.`
          : s.logPath || s.commands.length
            ? 'Sem docker compose na pasta; preenchi o que deu.'
            : 'Não achei nada para sugerir nesta pasta.'
      )
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <div className="rounded-xl border border-line" data-testid="runtime-fields">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-200"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Parar, saúde, Docker e log
        <span className="ml-auto text-[11px] text-zinc-500">
          {[
            value.stopCommand && 'comando de parar',
            value.healthUrl && 'saúde',
            value.dockerCommands.length && `${value.dockerCommands.length} atalho(s)`,
            value.logSource.kind !== 'none' && 'log',
            value.awayStop && 'para no Ausente'
          ]
            .filter(Boolean)
            .join(' · ') || 'opcional'}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={suggest} disabled={suggesting}>
              {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Sugerir pela pasta
            </Button>
            <span className="text-[11px] text-zinc-500">{note || 'Detecta docker compose, Laravel (log e artisan) e scripts do npm.'}</span>
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Comando de parar" hint="Roda depois de interromper o processo, e também quando o projeto roda fora do app. Ex.: docker compose stop (mantém os containers) ou docker compose down (remove).">
              <input className={inputCls + ' font-mono text-xs'} value={value.stopCommand} onChange={(e) => set({ stopCommand: e.target.value })} placeholder="docker compose stop" spellCheck={false} />
            </Field>
            <Field label="Esperar (s)" hint="Antes de forçar.">
              <input
                className={inputCls + ' font-mono text-xs'}
                value={String(value.stopTimeoutSec)}
                onChange={(e) => set({ stopTimeoutSec: Math.max(1, Math.min(300, Number(e.target.value.replace(/\D/g, '')) || 1)) })}
                inputMode="numeric"
              />
            </Field>
          </div>

          <Field label="Endereço de saúde (opcional)" hint="Se responder, o card mostra que a API está no ar; ao subir os projetos ligados, quem depende espera ele responder. Vazio = usa a porta.">
            <input className={inputCls + ' font-mono text-xs'} value={value.healthUrl} onChange={(e) => set({ healthUrl: e.target.value })} placeholder="http://localhost:8000/up" spellCheck={false} />
          </Field>

          <Toggle
            checked={value.awayStop}
            onChange={(v) => set({ awayStop: v })}
            label="Parar este projeto ao ficar Ausente (e religar ao voltar)"
            hint="Não para se a fila estiver usando o projeto. Bom para containers pesados."
          />

          <Field label="Comando do Docker Compose" hint='Padrão: docker compose. Use -f para outro arquivo, ex.: docker compose -f docker/dev.yml.'>
            <input className={inputCls + ' font-mono text-xs'} value={value.dockerCommand} onChange={(e) => set({ dockerCommand: e.target.value })} placeholder="docker compose" spellCheck={false} />
          </Field>

          <Field label="Atalhos de comando nos containers" hint="Aparecem em Ambiente, no card. Rodam com docker compose exec; a saída vai para o terminal do projeto.">
            <div className="space-y-1.5">
              {value.dockerCommands.map((c, i) => (
                <div key={c.id} className="grid grid-cols-[1fr_110px_1.6fr_auto] gap-1.5">
                  <input className={inputCls + ' h-8 text-xs'} value={c.name} onChange={(e) => setCmd(i, { name: e.target.value })} placeholder="Nome" />
                  <input
                    className={inputCls + ' h-8 font-mono text-xs'}
                    value={c.service}
                    onChange={(e) => setCmd(i, { service: e.target.value })}
                    placeholder="serviço"
                    list="ccc-services"
                    spellCheck={false}
                  />
                  <input className={inputCls + ' h-8 font-mono text-xs'} value={c.command} onChange={(e) => setCmd(i, { command: e.target.value })} placeholder="php artisan migrate" spellCheck={false} />
                  <IconButton title="Remover" tone="danger" onClick={() => set({ dockerCommands: value.dockerCommands.filter((_, j) => j !== i) })}>
                    <X size={13} />
                  </IconButton>
                </div>
              ))}
              <datalist id="ccc-services">
                {services.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <Button size="sm" variant="ghost" onClick={() => set({ dockerCommands: [...value.dockerCommands, { id: uid(), name: '', service: services[0] ?? '', command: '' }] })}>
                <Plus size={12} /> Atalho
              </Button>
            </div>
          </Field>

          <Field label="Onde fica o log da aplicação" hint="O botão Log do card mostra ao vivo, com filtro e análise pelo Claude.">
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">
                {LOG_KINDS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setLog({ kind: k })}
                    className={cn(
                      'cursor-pointer rounded-lg border px-2.5 py-1 text-xs',
                      value.logSource.kind === k ? 'border-violet/60 bg-violet/15 text-purple' : 'border-line text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {value.logSource.kind === 'docker' && (
                <input className={inputCls + ' font-mono text-xs'} value={value.logSource.service} onChange={(e) => setLog({ service: e.target.value })} placeholder="serviço do compose (ex.: app)" list="ccc-services" spellCheck={false} />
              )}
              {value.logSource.kind === 'file' && (
                <input className={inputCls + ' font-mono text-xs'} value={value.logSource.path} onChange={(e) => setLog({ path: e.target.value })} placeholder="storage/logs/laravel.log (relativo à pasta do projeto)" spellCheck={false} />
              )}
              {value.logSource.kind === 'command' && (
                <input className={inputCls + ' font-mono text-xs'} value={value.logSource.command} onChange={(e) => setLog({ command: e.target.value })} placeholder="comando que fica mostrando o log" spellCheck={false} />
              )}
            </div>
          </Field>

          {value.logSource.kind !== 'none' && (
            <Toggle
              checked={value.logAlerts}
              onChange={(v) => set({ logAlerts: v })}
              label="Avisar quando aparecer erro no log"
              hint="Com o projeto no ar, o app acompanha o log e avisa no sino (e no Telegram quando você estiver Ausente), no máximo um aviso por minuto."
            />
          )}
        </div>
      )}
    </div>
  )
}
