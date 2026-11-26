import { useEffect, useState } from 'react'
import { FolderGit2, FolderOpen, Link2, Plus, X } from 'lucide-react'
import type { AccountProfile, ClaudePerms, Project, ProjectKind, ProjectVar } from '@shared/types'
import { cn } from '../lib/utils'
import { RuntimeFields, emptyRuntime, runtimeOf, type Runtime } from './ProjectRuntime'
import { ClaudePermsEditor } from './ClaudePermsEditor'
import { Button, Field, IconButton, Modal, Toggle, inputCls } from './ui'
import { uid } from '../lib/utils'

/** Sugestões de variáveis comuns (clicáveis) */
const VAR_SUGGESTIONS: ProjectVar[] = [
  { key: 'branch_principal', value: 'master' },
  { key: 'remoto_empresa', value: 'empresa' },
  { key: 'remoto_fork', value: 'origin' },
  { key: 'branch_beta', value: 'beta' },
  { key: 'apelidos', value: '' }
]

/** O que cada variável conhecida faz (aparece embaixo da linha) */
const VAR_HELP: Record<string, string> = {
  branch_principal:
    'Branch de produção no remoto da empresa (ex: master). A branch do card nasce dela e o "Atualizar" da demanda faz merge dela.',
  remoto_empresa:
    'Nome, no seu git, do remoto da empresa, o que tem o código de produção (veja com git remote -v; ex: empresa ou upstream). A branch do card (MAS-123) nasce lá e o PR vai para ela.',
  remoto_fork:
    'Seu fork pessoal (normalmente origin). Seus pushes vão para ele e o PR sai daqui: origin/MAS-123 → empresa/MAS-123.',
  remote: 'Nome antigo: vale como remoto_fork. Prefira remoto_empresa + remoto_fork.',
  branch_beta: 'Branch de homologação, para usar nas suas ações globais como {{projeto.branch_beta}}.',
  apelidos: 'Nomes que o pessoal usa no chat para este projeto, separados por vírgula: o Vigia reconhece o projeto por eles.'
}

export function ProjectModal({
  open,
  initial,
  onClose,
  onSave,
  projects,
  accounts = []
}: {
  /** Contas das IAs cadastradas (Configurações → IAs → Contas) */
  accounts?: AccountProfile[]
  /** Todos os projetos (para ligar este a outros) */
  projects: Project[]
  open: boolean
  initial: Project | null
  onClose: () => void
  onSave: (p: Project) => void
}) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [remoteEnabled, setRemoteEnabled] = useState(false)
  const [runCommand, setRunCommand] = useState('')
  const [port, setPort] = useState('')
  const [vars, setVars] = useState<ProjectVar[]>([])
  const [perms, setPerms] = useState<ClaudePerms>({ claudeMode: 'ask', allowedTools: [] })
  const [branch, setBranch] = useState<string | null>(null)
  const [guides, setGuides] = useState('')
  const [checkCommand, setCheckCommand] = useState('')
  const [kind, setKind] = useState<ProjectKind>('outro')
  const [localUrl, setLocalUrl] = useState('')
  const [routes, setRoutes] = useState('')
  const [mobileShots, setMobileShots] = useState(false)
  const [memoryFile, setMemoryFile] = useState('CLAUDE.md')
  const [guideOk, setGuideOk] = useState<boolean[]>([])
  const [linked, setLinked] = useState<string[]>([])
  const [runtime, setRuntime] = useState<Runtime>(emptyRuntime())
  const [accountId, setAccountId] = useState('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setPath(initial?.path ?? '')
    setRemoteEnabled(initial?.remoteEnabled ?? false)
    setRunCommand(initial?.runCommand ?? '')
    setPort(initial?.port ? String(initial.port) : '')
    setVars(initial?.vars ?? [])
    setPerms({ claudeMode: initial?.claudeMode ?? 'ask', allowedTools: initial?.allowedTools ?? [] })
    setGuides((initial?.guides ?? []).join('\n'))
    setCheckCommand(initial?.checkCommand ?? '')
    setKind(initial?.kind ?? 'outro')
    setAccountId(initial?.accountId ?? '')
    setLocalUrl(initial?.localUrl ?? '')
    setRoutes((initial?.routes ?? []).join('\n'))
    setMobileShots(initial?.mobileShots ?? false)
    setMemoryFile(initial?.memoryFile || 'CLAUDE.md')
    setLinked(initial?.linkedProjectIds ?? [])
    setRuntime(runtimeOf(initial))
  }, [open, initial])

  const guideList = guides
    .split('\n')
    .map((g) => g.trim())
    .filter(Boolean)
  const guideKey = guideList.join('|')
  useEffect(() => {
    let alive = true
    if (!path || !guideKey) return setGuideOk([])
    const t = setTimeout(() => window.api.checkGuides(path, guideKey.split('|')).then((r) => alive && setGuideOk(r)), 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [path, guideKey])

  useEffect(() => {
    let alive = true
    setBranch(null)
    if (path) window.api.gitBranch(path).then((b) => alive && setBranch(b))
    return () => {
      alive = false
    }
  }, [path])

  const pick = async () => {
    const dir = await window.api.pickFolder(path || undefined)
    if (dir) {
      setPath(dir)
      if (!name.trim()) setName(dir.split(/[\\/]/).filter(Boolean).pop() ?? '')
    }
  }

  const portNum = Number(port)
  const portValid = !port || (Number.isInteger(portNum) && portNum > 0 && portNum < 65536)
  const keys = vars.map((v) => v.key.trim()).filter(Boolean)
  const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i)
  const valid = name.trim() && path.trim() && portValid && dupKeys.length === 0

  const submit = () => {
    if (!valid) return
    onSave({
      id: initial?.id ?? uid(),
      createdAt: initial?.createdAt ?? Date.now(),
      name: name.trim(),
      path: path.trim(),
      remoteEnabled,
      runCommand: runCommand.trim(),
      port: port ? portNum : null,
      vars: vars
        .map((v) => ({ key: v.key.trim().replace(/[^\w.-]/g, '_'), value: v.value }))
        .filter((v) => v.key),
      claudeMode: perms.claudeMode,
      allowedTools: perms.allowedTools,
      guides: guideList,
      checkCommand: checkCommand.trim(),
      kind,
      localUrl: localUrl.trim().replace(/\/+$/, ''),
      routes: routes
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean),
      mobileShots,
      memoryFile: memoryFile.trim() || 'CLAUDE.md',
      linkedProjectIds: linked.filter((id) => projects.some((o) => o.id === id)),
      accountId: accounts.some((a) => a.id === accountId) ? accountId : '',
      ...runtime,
      stopCommand: runtime.stopCommand.trim(),
      healthUrl: runtime.healthUrl.trim(),
      dockerCommand: runtime.dockerCommand.trim() || 'docker compose',
      dockerCommands: runtime.dockerCommands.filter((c) => c.command.trim())
    })
    onClose()
  }

  const setVar = (i: number, patch: Partial<ProjectVar>) =>
    setVars((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)))

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={initial ? 'Editar projeto' : 'Novo projeto'}
      icon={<FolderGit2 size={16} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {initial ? 'Salvar' : 'Adicionar projeto'}
          </Button>
        </>
      }
    >
      <Field label="Nome do projeto">
        <input
          autoFocus
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: api-pagamentos"
        />
      </Field>

      <Field
        label="Pasta"
        hint={
          path ? (
            branch ? (
              <span>
                Repositório git detectado · branch <span className="text-purple">{branch}</span>
              </span>
            ) : (
              'Nenhum repositório git detectado nessa pasta.'
            )
          ) : undefined
        }
      >
        <div className="flex gap-2">
          <input
            className={inputCls + ' font-mono text-xs'}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Selecione a pasta…"
          />
          <Button onClick={pick} className="shrink-0">
            <FolderOpen size={15} /> Procurar
          </Button>
        </div>
      </Field>

      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Como executar" hint="Comando que sobe o projeto (fica rodando). Vazio = sem botão ▶.">
          <input
            className={inputCls + ' font-mono text-xs'}
            value={runCommand}
            onChange={(e) => setRunCommand(e.target.value)}
            placeholder="npm run dev"
            spellCheck={false}
          />
        </Field>
        <Field label="Porta" hint={portValid ? 'Opcional' : <span className="text-red-400">Porta inválida</span>}>
          <input
            className={inputCls + ' font-mono text-xs'}
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            placeholder="3000"
            inputMode="numeric"
          />
        </Field>
      </div>

      <RuntimeFields value={runtime} onChange={setRuntime} path={path} />

      <Field
        label="Variáveis do projeto"
        hint={dupKeys.length > 0 ? <span className="text-red-400">Chave repetida: {dupKeys[0]}</span> : undefined}
      >
        <div className="mb-2 rounded-lg border border-line bg-bg p-2.5 text-xs leading-relaxed text-zinc-400">
          São informações deste projeto que o app e as <b className="text-zinc-200">ações globais</b> usam: numa ação global,{' '}
          <code className="text-purple">{'{{projeto.remoto_fork}}'}</code> vira o valor deste projeto quando você roda aqui.
          As sugestões abaixo já têm significado para o app (passe o mouse ou veja a explicação embaixo de cada uma).
        </div>
        {keys.includes('remoto_empresa') && (
          <div className="mb-2 rounded-lg border border-violet/30 bg-violet/5 p-2.5 text-[11px] leading-relaxed text-zinc-300" data-testid="git-flow">
            <b className="text-purple">Fluxo com fork</b>, como o app faz em cada demanda (ex.: MAS-123):
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-zinc-400">
              <li>
                a branch <code>MAS-123</code> nasce no remoto da empresa a partir da principal (pelo site, ou o app cria se você
                confirmar);
              </li>
              <li>
                local: <code>git checkout -b MAS-123 {vars.find((v) => v.key === 'remoto_empresa')?.value || 'empresa'}/MAS-123</code>;
              </li>
              <li>
                commits e push no seu fork (<code>{vars.find((v) => v.key === 'remoto_fork')?.value || 'origin'}</code>);
              </li>
              <li>
                PR de <code>{vars.find((v) => v.key === 'remoto_fork')?.value || 'origin'}/MAS-123</code> para{' '}
                <code>{vars.find((v) => v.key === 'remoto_empresa')?.value || 'empresa'}/MAS-123</code>. "Atualizar" traz o que
                entrou em empresa/MAS-123 e na principal; a revisão compara com empresa/MAS-123 (o mesmo que o PR mostra).
              </li>
            </ol>
          </div>
        )}
        <div className="space-y-1.5">
          {vars.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] gap-2 px-1 text-[10px] uppercase tracking-wider text-zinc-600">
              <span>Chave (usada como {'{{projeto.chave}}'})</span>
              <span className="invisible">=</span>
              <span>Valor neste projeto</span>
              <span className="invisible w-7" />
            </div>
          )}
          {vars.map((v, i) => (
            // Grade: chave e valor meio a meio, "=" e o X no tamanho deles
            <div key={i} data-testid="var-row" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
              <input
                className={inputCls + ' min-w-0 font-mono text-xs'}
                value={v.key}
                onChange={(e) => setVar(i, { key: e.target.value })}
                placeholder="chave"
                spellCheck={false}
              />
              <span className="text-zinc-600">=</span>
              <input
                className={inputCls + ' min-w-0 font-mono text-xs'}
                value={v.value}
                onChange={(e) => setVar(i, { value: e.target.value })}
                placeholder="valor"
                spellCheck={false}
              />
              <IconButton title="Remover" tone="danger" onClick={() => setVars((vs) => vs.filter((_, j) => j !== i))}>
                <X size={13} />
              </IconButton>
              {VAR_HELP[v.key.trim()] && <div className="col-span-4 -mt-1 px-1 text-[11px] leading-snug text-zinc-500">{VAR_HELP[v.key.trim()]}</div>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => setVars((vs) => [...vs, { key: '', value: '' }])}>
              <Plus size={12} /> Variável
            </Button>
            {VAR_SUGGESTIONS.filter((s) => !keys.includes(s.key)).map((s) => (
              <button
                key={s.key}
                type="button"
                title={VAR_HELP[s.key]}
                onClick={() => setVars((vs) => [...vs, { ...s }])}
                className="cursor-pointer rounded-md border border-dashed border-line px-2 py-0.5 font-mono text-[11px] text-zinc-500 hover:border-violet/60 hover:text-zinc-300"
              >
                + {s.key}
              </button>
            ))}
          </div>
        </div>
      </Field>

      {projects.some((o) => o.id !== initial?.id) && (
        <Field
          label="Projetos ligados"
          hint="Executar este projeto também executa os marcados (ex.: o front liga o back); parar desliga os que subiram junto. Nas demandas, a branch do card também vai para eles quando existir lá."
        >
          <div className="flex flex-wrap gap-1.5" data-testid="project-links">
            {projects
              .filter((o) => o.id !== initial?.id)
              .map((o) => {
                const on = linked.includes(o.id)
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setLinked((l) => (on ? l.filter((x) => x !== o.id) : [...l, o.id]))}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors',
                      on ? 'border-violet/60 bg-violet/15 text-purple' : 'border-line text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    <Link2 size={12} />
                    {o.name}
                  </button>
                )
              })}
          </div>
        </Field>
      )}

      {accounts.length > 0 && (
        <Field
          label="Conta das IAs"
          hint="Tudo deste projeto (fila, fases, demandas, console, Remote Control) roda com o login desta conta. Conversas antigas ficam na conta onde foram feitas."
        >
          <select data-testid="project-account" className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Padrão deste PC</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field
        label="Tipo do projeto"
        hint="Libera recursos próprios: front-end tira prints das telas e pega erros do navegador; back-end checa as rotas da API. Rodam quando você pede, antes/depois das tarefas da fila e ao trazer o trabalho da fila."
      >
        <div className="flex overflow-hidden rounded-lg border border-line" data-testid="project-kind">
          {(
            [
              ['front', 'Front-end'],
              ['back', 'Back-end / API'],
              ['fullstack', 'Os dois'],
              ['outro', 'Outro']
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn('flex-1 cursor-pointer px-3 py-1.5 text-xs', kind === k ? 'bg-violet/20 text-purple' : 'text-zinc-400 hover:text-zinc-200')}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      {kind !== 'outro' && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Field label="Endereço local (com o projeto rodando)" hint={kind === 'back' ? 'Ex: http://localhost:3000' : 'Ex: http://localhost:5173'}>
            <input
              data-testid="project-url"
              className={inputCls + ' font-mono text-xs'}
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              placeholder={kind === 'back' ? 'http://localhost:3000' : 'http://localhost:5173'}
            />
          </Field>
          <Field
            label={kind === 'back' ? 'Rotas para checar' : kind === 'front' ? 'Telas para fotografar' : 'Telas / rotas'}
            hint={
              kind === 'back'
                ? 'Uma por linha: método, caminho e status esperado. Ex: GET /health 200'
                : kind === 'front'
                  ? 'Um caminho por linha. Ex: /pedidos'
                  : 'Front usa os caminhos (/pedidos); a API usa "GET /api/health 200".'
            }
          >
            <textarea
              data-testid="project-routes"
              rows={3}
              className={inputCls + ' h-auto py-2 font-mono text-xs'}
              value={routes}
              onChange={(e) => setRoutes(e.target.value)}
              placeholder={kind === 'back' ? 'GET /health 200\nGET /api/pedidos 200' : '/\n/pedidos'}
            />
          </Field>
        </div>
      )}
      {(kind === 'front' || kind === 'fullstack') && (
        <Toggle checked={mobileShots} onChange={setMobileShots} label="Tirar também o print em largura de celular (390px)" />
      )}

      <Field
        label="Comando de verificação (opcional)"
        hint="Roda no fim de cada tarefa da fila, na pasta onde o Claude trabalhou. O resultado entra no resumo (ex: npm run lint && npm test)."
      >
        <input
          data-testid="project-check"
          className={inputCls + ' font-mono text-xs'}
          value={checkCommand}
          onChange={(e) => setCheckCommand(e.target.value)}
          placeholder="npm run lint && npm test"
        />
      </Field>

      <Field
        label="Arquivo de memória"
        hint="Onde ficam os aprendizados (botão 'Ensinar ao projeto' na demanda). O padrão CLAUDE.md o Claude Code lê sozinho; os outros IAs recebem o conteúdo nas demandas."
      >
        <input className={inputCls + ' font-mono text-xs'} value={memoryFile} onChange={(e) => setMemoryFile(e.target.value)} placeholder="CLAUDE.md" />
      </Field>

      <Field
        label="Guias do projeto"
        hint={
          <>
            Um arquivo por linha, relativo à pasta do projeto (ex: <code>docs/STYLE_GUIDE.md</code>). O Claude recebe a
            instrução de ler e seguir esses guias em tudo que fizer aqui, e as Demandas levam o conteúdo deles na análise,
            no desenho e na implementação.
          </>
        }
      >
        <textarea
          data-testid="project-guides"
          rows={2}
          className={inputCls + ' h-auto py-2 font-mono text-xs'}
          value={guides}
          onChange={(e) => setGuides(e.target.value)}
          placeholder={'docs/STYLE_GUIDE.md\nCONTRIBUTING.md'}
        />
        {guideList.length > 0 && guideOk.length === guideList.length && (
          <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
            {guideList.map((g, i) => (
              <span key={g} className={guideOk[i] ? 'text-emerald-300' : 'text-amber-300'}>
                {guideOk[i] ? '✓' : '✗ não encontrado:'} {g}
              </span>
            ))}
          </div>
        )}
      </Field>

      <Field label="Permissões do Claude neste projeto">
        <ClaudePermsEditor value={perms} onChange={setPerms} />
      </Field>

      <Toggle
        checked={remoteEnabled}
        onChange={setRemoteEnabled}
        label="Ligar o Remote Control automaticamente no modo Ausente"
        hint="Você também pode ligar/desligar a qualquer hora pelo card do projeto."
      />
    </Modal>
  )
}
