// Contas que um projeto usa (git e Claude), com uma ajudinha para usar outra conta só nele
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, GitCommitHorizontal, Loader2, SquareTerminal, UserRound } from 'lucide-react'
import type { Project, ProjectAccounts as Accounts } from '@shared/types'
import { Button } from './ui'
import { Copy } from './SetupTab'
import { AccountLine } from './settings/AiTab'

const SCOPE: Record<NonNullable<Accounts['git']['scope']>, string> = {
  projeto: 'só deste projeto',
  global: 'global: vale para todos os seus projetos',
  sistema: 'do sistema'
}

function Cmd({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-1 font-mono text-[11px] text-zinc-300">
      <span className="selectable min-w-0 flex-1 truncate">{text}</span>
      <Copy text={text} />
    </div>
  )
}

export function ProjectAccounts({ p }: { p: Project }) {
  const [a, setA] = useState<Accounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [help, setHelp] = useState(false)
  useEffect(() => {
    setLoading(true)
    void window.api.projectAccounts(p.id).then((r) => {
      setA(r)
      setLoading(false)
    })
  }, [p.id])

  const parent = p.path.replace(/[\\/][^\\/]+[\\/]?$/, '')
  const sep = p.path.includes('\\') ? '\\' : '/'

  return (
    <div data-testid="project-accounts">
      <div className="mb-1.5 text-xs font-semibold tracking-wider text-zinc-500 uppercase">Contas deste projeto</div>
      <div className="space-y-2 rounded-lg border border-line bg-bg/50 p-3 text-xs">
        {loading ? (
          <div className="flex items-center gap-1.5 text-zinc-500">
            <Loader2 size={12} className="animate-spin" /> Lendo…
          </div>
        ) : !a ? (
          <div className="text-zinc-500">Não deu para ler (a pasta existe?).</div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <GitCommitHorizontal size={14} className="mt-0.5 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <div className="text-zinc-300">
                  Commits saem como{' '}
                  {a.git.email ? (
                    <span className="selectable font-medium text-zinc-100">
                      {a.git.name ?? '(sem nome)'} &lt;{a.git.email}&gt;
                    </span>
                  ) : (
                    <span className="text-red-300">ninguém: o git não tem e-mail configurado</span>
                  )}
                </div>
                {a.git.scope && <div className="text-[11px] text-zinc-500">Configuração {SCOPE[a.git.scope]}.</div>}
                <div className="text-[11px] text-zinc-500">
                  {a.git.remote ? `Remoto: ${a.git.remote} (${a.git.ssh ? 'SSH' : 'HTTPS'})` : 'Sem remoto "origin".'}
                  {a.git.remote && ' · quem faz o push é a chave SSH ou o login guardado no seu PC para esse site'}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <UserRound size={14} className="mt-0.5 shrink-0 text-zinc-500" />
              <div className="min-w-0">
                <AccountLine a={a.claude} compact />
                <div className="text-[11px] text-zinc-500">Por enquanto o Claude usa a mesma conta em todos os projetos deste PC.</div>
              </div>
            </div>
          </>
        )}

        <button type="button" onClick={() => setHelp(!help)} className="flex cursor-pointer items-center gap-1 text-[11px] text-purple">
          {help ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Como usar outra conta do git só neste projeto
        </button>
        {help && (
          <div className="space-y-2.5 border-t border-line pt-2 text-[11px] text-zinc-400">
            <div>
              <div className="mb-1 text-zinc-300">1. Nome e e-mail dos commits só aqui (os outros projetos não mudam)</div>
              <div className="mb-1">Rode dentro da pasta do projeto:</div>
              <div className="space-y-1">
                <Cmd text={`git config user.name "Seu Nome"`} />
                <Cmd text={`git config user.email "voce@empresa.com"`} />
              </div>
              <Button size="sm" className="mt-1.5" onClick={() => void window.api.openSystemTerminal(p.path)}>
                <SquareTerminal size={12} /> Abrir terminal na pasta
              </Button>
            </div>
            <div>
              <div className="mb-1 text-zinc-300">2. Para todos os projetos de uma pasta (ex.: tudo da empresa)</div>
              <div className="mb-1">
                No seu <code>~/.gitconfig</code>, acrescente (troque a pasta se quiser outra; a barra no fim é obrigatória):
              </div>
              <pre className="selectable rounded-md border border-line bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap text-zinc-300">
                {`[includeIf "gitdir:${parent.replace(/\\/g, '/')}/"]\n  path = ~/.gitconfig-empresa`}
              </pre>
              <div className="mt-1">
                E crie o <code>~/.gitconfig-empresa</code> com o <code>[user]</code> (name e email) da empresa. Todo repositório dentro de{' '}
                <code>{parent + sep}</code> passa a usar essa identidade.
              </div>
            </div>
            <div>
              <div className="mb-1 text-zinc-300">3. Login diferente para o push (outra conta do GitHub)</div>
              <div>
                O e-mail do commit não muda quem faz o push. Com <b>HTTPS</b>, o gerenciador de senhas do git guarda um login por site; para duas
                contas no mesmo site, coloque o usuário na URL: <code>git remote set-url origin https://SEU_USUARIO@github.com/dono/repo.git</code>.
                Com <b>SSH</b>, crie uma chave para cada conta e um apelido no <code>~/.ssh/config</code> (ex.: <code>Host github-empresa</code>) e use{' '}
                <code>git@github-empresa:dono/repo.git</code> no remoto.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
