import { useEffect, useState } from 'react'
import { KeyRound, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import type { OpResult, PlainToken } from '@shared/types'
import { Button } from '../ui'
import { Result, Section } from './shared'

const WHERE: Record<PlainToken['scope'], string> = {
  user: 'Claude Code, seu usuário (~/.claude.json)',
  local: 'Claude Code, só nesta pasta (~/.claude.json)',
  project: '.mcp.json do projeto (vai junto se for commitado!)'
}

/** Onde estão seus tokens: o cofre do app e os que ficaram em texto aberto na configuração de MCP do Claude Code */
export function TokenCheck() {
  const [data, setData] = useState<{ plain: PlainToken[]; encrypted: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<OpResult | null>(null)
  const load = async () => setData(await window.api.tokenCheck())
  useEffect(() => {
    void load()
  }, [])

  const remove = async (t: PlainToken) => {
    const what = t.server === 'ccc-github' ? '\n\nA integração do GitHub do app também será desligada.' : t.server === 'ccc-jira' ? '\n\nO MCP do Jira do app também será desligado (a conta do Jira para as demandas continua).' : ''
    if (!confirm(`Remover o MCP "${t.server}" do Claude Code? O token sai junto.${what}`)) return
    setBusy(`${t.scope}:${t.projectPath ?? ''}:${t.server}`)
    try {
      setResult(await window.api.tokenRemove({ server: t.server, scope: t.scope, projectPath: t.projectPath }))
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section icon={<KeyRound size={15} />} title="Onde estão seus tokens">
      <div className="space-y-2" data-testid="token-check">
        {!data ? (
          <div className="text-xs text-zinc-500">
            <Loader2 size={12} className="mr-1 inline animate-spin" /> Procurando…
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 text-xs">
              {data.encrypted ? <ShieldCheck size={15} className="shrink-0 text-purple" /> : <ShieldAlert size={15} className="shrink-0 text-amber-300" />}
              <span className="text-zinc-300">
                {data.encrypted
                  ? 'Tokens do app (Telegram, Jira, GitHub, Google): criptografados no cofre do sistema.'
                  : 'Tokens do app: este PC não tem cofre do sistema (ex.: Linux sem chaveiro), então ficam só disfarçados no disco.'}
              </span>
            </div>
            {!data.plain.length ? (
              <div className="flex items-start gap-2 text-xs">
                <ShieldCheck size={15} className="shrink-0 text-purple" />
                <span className="text-zinc-300">Nenhum token em texto aberto nas configurações de MCP do Claude Code.</span>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-2 text-xs">
                  <ShieldAlert size={15} className="shrink-0 text-amber-300" />
                  <span className="text-zinc-300">
                    {data.plain.length} servidor(es) MCP com token em <b>texto aberto</b>. Qualquer programa com acesso aos seus arquivos consegue ler. Remova os que você
                    não usa; os que usa, prefira tokens com permissão mínima e data para expirar.
                  </span>
                </div>
                <div className="divide-y divide-line rounded-lg border border-line">
                  {data.plain.map((t) => {
                    const key = `${t.scope}:${t.projectPath ?? ''}:${t.server}`
                    return (
                      <div key={key} className="flex items-center gap-2 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-zinc-100">{t.server}</div>
                          <div className="truncate text-[11px] text-zinc-500" title={t.projectPath ?? t.file}>
                            {WHERE[t.scope]}
                            {t.projectPath ? ` · ${t.projectPath}` : ''} · {t.fields.join(', ')}
                          </div>
                        </div>
                        <Button size="sm" variant="danger" disabled={!!busy} onClick={() => remove(t)}>
                          {busy === key ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remover
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw size={12} /> Verificar de novo
            </Button>
            <Result r={result} />
          </>
        )}
      </div>
    </Section>
  )
}
