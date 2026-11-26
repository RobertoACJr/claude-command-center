// Configurações → IAs → Contas: cada conta tem a própria pasta de login do Claude (e do Codex, se quiser).
// Cada projeto escolhe a conta no cadastro dele; tudo daquele projeto roda com ela.
import { useEffect, useState } from 'react'
import { LogIn, Plus, Trash2, UsersRound } from 'lucide-react'
import type { AccountInfo, AccountProfile, AppConfig } from '@shared/types'
import { Button, Field, inputCls } from '../ui'
import { uid } from '../../lib/utils'
import { AccountLine } from './AiTab'
import { HelpTip, Section, type SaveFn } from './shared'

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'conta'

export function AccountsSection({ config, save }: { config: AppConfig; save: SaveFn }) {
  const [infos, setInfos] = useState<AccountInfo[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const list = config.accounts
  const reload = () => void window.api.accounts().then(setInfos)
  useEffect(reload, [config.accounts])
  // Volta do terminal de login: relê ao focar a janela
  useEffect(() => {
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [])

  const update = (id: string, patch: Partial<AccountProfile>) => save({ accounts: list.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
  const add = () => {
    const name = `Conta ${list.length + 2}`
    void save({ accounts: [...list, { id: uid(), name, claudeDir: `~/.claude-${slug(name)}`, codexDir: '' }] })
  }
  const remove = (a: AccountProfile) => {
    const used = config.projects.filter((p) => p.accountId === a.id).length
    if (!window.confirm(`Apagar a conta "${a.name}"?${used ? `\n\n${used} projeto(s) voltam para a conta padrão do PC.` : ''}\n\nA pasta de login (${a.claudeDir || 'padrão'}) não é apagada.`)) return
    void save({ accounts: list.filter((x) => x.id !== a.id) })
  }
  const login = async (a: AccountProfile, tool: 'claude' | 'codex') => {
    const r = await window.api.accountLogin(a.id, tool)
    setMsg(r.ok ? `Terminal aberto. ${tool === 'claude' ? 'Faça o /login lá' : 'Entre com a conta do ChatGPT'} e volte aqui.` : r.message)
  }
  const info = (accountId: string, service: AccountInfo['service']) => infos.find((i) => i.accountId === accountId && i.service === service)
  const projectsOf = (id: string) => config.projects.filter((p) => (p.accountId || '') === id).map((p) => p.name)

  return (
    <Section icon={<UsersRound size={15} />} title="Contas">
      <p className="text-[11px] text-zinc-500">
        Use quando você tem mais de uma conta (ex.: a da empresa e a pessoal). Cada projeto escolhe a conta no cadastro dele, e tudo daquele
        projeto (fila, fases, demandas, console, Remote Control) roda com ela. Cada conta tem a própria janela de 5h.
        <HelpTip>
          Por baixo, cada conta é uma pasta de login separada: o Claude Code usa a variável CLAUDE_CONFIG_DIR e o Codex a CODEX_HOME. Na
          primeira vez, clique em "Fazer login" e entre com a outra conta no terminal. As conversas antigas (retomar sessão) ficam na conta onde
          foram feitas.
        </HelpTip>
      </p>

      <div className="rounded-lg border border-line bg-bg/50 p-3">
        <div className="text-sm text-zinc-100">Padrão deste PC</div>
        <AccountLine a={info('', 'claude')} />
        <div className="mt-0.5 text-[11px] text-zinc-500">
          Projetos sem conta escolhida usam esta{projectsOf('').length ? `: ${projectsOf('').join(', ')}` : ''}.
        </div>
      </div>

      {list.map((a) => (
        <div key={a.id} className="space-y-2 rounded-lg border border-line bg-bg/50 p-3" data-testid="account-row">
          <div className="flex items-center gap-2">
            <input
              key={a.id + a.name}
              className={inputCls + ' h-8 flex-1 text-sm'}
              defaultValue={a.name}
              aria-label="Nome da conta"
              onBlur={(e) => e.target.value.trim() && e.target.value !== a.name && update(a.id, { name: e.target.value.trim() })}
            />
            <Button size="sm" variant="ghost" onClick={() => remove(a)} title="Apagar conta">
              <Trash2 size={12} />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Pasta de login do Claude" hint="Vazio = a padrão (~/.claude).">
              <input
                key={a.id + a.claudeDir}
                className={inputCls + ' font-mono text-xs'}
                defaultValue={a.claudeDir}
                placeholder="~/.claude-pessoal"
                onBlur={(e) => e.target.value.trim() !== a.claudeDir && update(a.id, { claudeDir: e.target.value.trim() })}
              />
            </Field>
            <Field label="Pasta de login do Codex (opcional)" hint="Vazio = a padrão (~/.codex).">
              <input
                key={a.id + a.codexDir}
                className={inputCls + ' font-mono text-xs'}
                defaultValue={a.codexDir}
                placeholder="~/.codex-pessoal"
                onBlur={(e) => e.target.value.trim() !== a.codexDir && update(a.id, { codexDir: e.target.value.trim() })}
              />
            </Field>
          </div>
          {a.claudeDir && <AccountLine a={info(a.id, 'claude')} />}
          {a.codexDir && <AccountLine a={info(a.id, 'codex')} />}
          <div className="flex flex-wrap items-center gap-2">
            {a.claudeDir && (
              <Button size="sm" onClick={() => void login(a, 'claude')}>
                <LogIn size={12} /> Fazer login no Claude
              </Button>
            )}
            {a.codexDir && (
              <Button size="sm" onClick={() => void login(a, 'codex')}>
                <LogIn size={12} /> Fazer login no Codex
              </Button>
            )}
            <span className="text-[11px] text-zinc-500">
              {projectsOf(a.id).length ? `Projetos: ${projectsOf(a.id).join(', ')}` : 'Nenhum projeto usa ainda (escolha no cadastro do projeto).'}
            </span>
          </div>
        </div>
      ))}
      {msg && <p className="text-[11px] text-zinc-400">{msg}</p>}
      <Button size="sm" onClick={add} data-testid="account-add">
        <Plus size={12} /> Nova conta
      </Button>
    </Section>
  )
}
