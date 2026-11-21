import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Demand, DemandAi, DemandBusy, DemandJira, DemandReview, DemandStatus, OpResult, Project, ReviewAi, RunEvent } from '../shared/types'
import { spawn } from 'child_process'
import { git, gitInfo, updateWithBase } from './git'
import { readGuides } from './guides'
import type { RunManager } from './runner'
import { secrets } from './secrets'
import { store } from './store'

const STATUSES: DemandStatus[] = ['nova', 'estimada', 'desenhada', 'dev', 'teste', 'beta', 'feita']
const AIS: DemandAi[] = ['claude', 'codex', 'gemini']
const REVIEW_AIS: ReviewAi[] = ['claude', 'codex', 'gemini', 'dupla']
/** Diff máximo colado no prompt da revisão (o resto a IA lê nos arquivos) */
const MAX_DIFF = 150_000

/** Marcadores que a IA usa para devolver o documento (o resto é a "conversa" dela enquanto lê o código) */
const OPEN = '<<<RESULTADO'
const CLOSE = 'RESULTADO>>>'

/** Número de card no formato do Jira, que também vira nome de branch */
export const CARD_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function normDemand(r: Partial<Demand>): Demand {
  const now = Date.now()
  return {
    id: str(r.id) || randomUUID(),
    projectId: str(r.projectId),
    key: str(r.key).trim().toUpperCase(),
    title: str(r.title),
    status: STATUSES.includes(r.status as DemandStatus) ? (r.status as DemandStatus) : 'nova',
    jira: r.jira && typeof r.jira === 'object' ? (r.jira as DemandJira) : null,
    context: str(r.context),
    transcript: str(r.transcript),
    refProjectIds: Array.isArray(r.refProjectIds) ? r.refProjectIds.filter((x) => typeof x === 'string') : [],
    ai: AIS.includes(r.ai as DemandAi) ? (r.ai as DemandAi) : 'claude',
    analysis: str(r.analysis),
    aiHours: num(r.aiHours),
    hours: num(r.hours),
    design: str(r.design),
    designApproved: Boolean(r.designApproved),
    sessionId: str(r.sessionId) || null,
    review: r.review && typeof r.review === 'object' && typeof (r.review as DemandReview).text === 'string' ? (r.review as DemandReview) : null,
    reviewAi: REVIEW_AIS.includes(r.reviewAi as ReviewAi) ? (r.reviewAi as ReviewAi) : 'claude',
    timeline: Array.isArray(r.timeline) ? r.timeline.slice(-200) : [],
    createdAt: num(r.createdAt) ?? now,
    updatedAt: num(r.updatedAt) ?? now
  }
}

/** Pega o documento entre os marcadores; sem marcadores, o texto inteiro */
export function extractResult(text: string): string {
  const a = text.lastIndexOf(OPEN)
  if (a < 0) return text.trim()
  const b = text.indexOf(CLOSE, a)
  return text.slice(a + OPEN.length, b < 0 ? undefined : b).trim()
}

/** "ESTIMATIVA_HORAS: 12" → 12 */
export function extractHours(text: string): number | null {
  const m = text.match(/ESTIMATIVA_HORAS:\s*([\d.,]+)/i)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

const hoursLabel = (h: number) => `${h}h (≈ ${Math.round((h / 8) * 10) / 10} dia${h > 8 ? 's' : ''})`

/** Contexto completo da demanda, em markdown, para a IA */
export function demandContext(d: Demand, project?: Project, refs: Project[] = []): string {
  const parts: string[] = [`# Demanda ${d.key}: ${d.jira?.summary || d.title}`]
  if (project) parts.push(`Projeto: ${project.name} (pasta atual: ${project.path}). Trabalho só no front-end.`)
  if (refs.length) {
    parts.push(
      'Projetos relacionados que você pode LER para conferir (nunca alterar):\n' +
        refs.map((r) => `- ${r.name}: ${r.path}`).join('\n')
    )
  }
  if (d.jira) {
    const j = d.jira
    parts.push(
      `## Card do Jira\nTipo: ${j.type || '?'} · Status: ${j.status || '?'} · Prioridade: ${j.priority || '?'}\n${j.url}\n\n### Descrição\n${j.description || '(sem descrição)'}`
    )
    if (j.comments.length) {
      parts.push('### Comentários\n' + j.comments.map((c) => `- **${c.author}** (${c.at}): ${c.body}`).join('\n'))
    }
    if (j.attachments.length) parts.push('### Anexos (nomes)\n' + j.attachments.map((a) => `- ${a}`).join('\n'))
  }
  if (project) {
    for (const g of readGuides(project)) {
      parts.push(
        `## Guia do projeto: ${g.path} (siga à risca)\n` + g.content + (g.truncated ? `\n\n(…cortado; leia o resto em ${g.path})` : '')
      )
    }
  }
  if (d.context.trim()) parts.push('## Contexto extra (chat, anotações)\n' + d.context.trim())
  if (d.transcript.trim()) parts.push('## Transcrição da call de apresentação\n' + d.transcript.trim())
  return parts.join('\n\n')
}

export function analysisPrompt(ctx: string): string {
  return `${ctx}

---
Você é um dev front-end sênior ajudando a entender e estimar esta demanda ANTES do refinamento com o time.
Leia o código do projeto na pasta atual (e dos relacionados, se precisar) para basear a análise. NÃO altere nenhum arquivo.

Responda em português, em markdown, com o documento inteiro entre uma linha "${OPEN}" e uma linha "${CLOSE}", nesta estrutura:

## Entendimento
2 a 4 frases: o que pedem e para quem.
## O que muda
Telas, componentes, rotas, estados e arquivos prováveis (com caminhos reais do projeto).
## Dúvidas para o refinamento
Lacunas, regras não ditas, casos de borda e possíveis falhas que valem levantar na call. Uma por item.
## Riscos
## Estimativa
Horas de desenvolvimento + testes, com uma justificativa curta (o que pesa mais).

Na última linha antes de "${CLOSE}", escreva exatamente: ESTIMATIVA_HORAS: <número>`
}

export function designPrompt(ctx: string, d: Demand): string {
  return `${ctx}

${d.analysis ? '## Análise anterior\n' + d.analysis + '\n' : ''}${d.hours ? `Estimativa combinada: ${hoursLabel(d.hours)}.\n` : ''}
---
Agora desenhe o que vai ser implementado no front-end. Leia o código para seguir os padrões que o projeto já usa
(componentes, estado, chamadas à API, estilos, testes). Se houver projeto da API relacionado, confira os contratos lá
(só leitura). NÃO altere nenhum arquivo.

Responda em português, em markdown, com o documento inteiro entre uma linha "${OPEN}" e uma linha "${CLOSE}":

## Objetivo
## Desenho da solução
Componentes novos e alterados, estado, rotas, chamadas à API (endpoint, payload, resposta), validações e mensagens.
## Arquivos
Lista com o caminho e o que muda em cada um.
## Passo a passo
Checklist em ordem de implementação ("- [ ] ..."), em passos pequenos que dá para testar.
## Como testar
Roteiro de teste manual (caminho feliz e casos de borda).
## Pendências
Dúvidas ainda em aberto ou fora do escopo.`
}

export function implementPrompt(ctx: string, d: Demand): string {
  return `${ctx}

## Desenho aprovado
${d.design || '(sem desenho: siga o card)'}

---
Implemente esta demanda no projeto da pasta atual (branch ${d.key}), seguindo o desenho aprovado e os padrões do projeto.
Trabalhe em passos pequenos e, ao terminar cada parte, diga em poucas linhas o que fez e como testar.
Não faça commit nem push: eu testo e peço ajustes nesta mesma conversa.`
}

export function reviewPrompt(d: Demand, ctx: string, scope: string, diff: string, truncated: boolean, firstPass?: string): string {
  return `${ctx}

${d.design ? '## Desenho aprovado\n' + d.design + '\n' : ''}
## O que revisar (${scope})
\`\`\`diff
${diff}
\`\`\`
${truncated ? '\n(O diff foi cortado por tamanho: leia os arquivos alterados na pasta para o resto.)\n' : ''}
${firstPass ? `## Primeira revisão (outra IA, mais barata)\n${firstPass}\n\nConfira cada ponto acima no código: descarte falsos positivos, confirme os reais e aprofunde o que ela não viu.\n` : ''}
---
Você é um revisor de código front-end sênior. Revise as mudanças acima como numa revisão de PR: bugs, regras do card
não atendidas, casos de borda, acessibilidade, performance, segurança, consistência com os padrões do projeto e com o
guia (se houver). Leia os arquivos inteiros quando precisar de contexto. NÃO altere nenhum arquivo.

Responda em português, em markdown, com o documento inteiro entre uma linha "${OPEN}" e uma linha "${CLOSE}":

## Resumo
O que a mudança faz, em 2-3 frases.
## Problemas
Um por item: **[alta|média|baixa]** \`arquivo:linha\`: o problema e a correção sugerida. Se não houver, diga.
## Sugestões
Melhorias que não bloqueiam.
## Guia do projeto
Pontos que não seguem o guia (se houver guia).
## Testes recomendados
## Veredito
"Pronto para PR" ou "Precisa de ajustes", com uma frase.`
}

// ---------------------------------------------------------------- Jira

/** Texto puro a partir do formato de texto do Jira (wiki markup) */
function cleanJira(s: string): string {
  return s
    .replace(/\{code(?::[^}]*)?\}([\s\S]*?)\{code\}/g, '```\n$1\n```')
    .replace(/\{noformat\}([\s\S]*?)\{noformat\}/g, '```\n$1\n```')
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$1 ($2)')
    .replace(/!([^!|\n]+)(\|[^!]*)?!/g, '[imagem: $1]')
    .replace(/^h([1-6])\.\s*/gm, (_m, n) => '#'.repeat(Number(n)) + ' ')
    .replace(/\r/g, '')
    .trim()
}

export async function fetchJiraIssue(key: string): Promise<{ ok: true; jira: DemandJira } | { ok: false; message: string }> {
  const j = store.get().integrations.jira
  const token = secrets.get('jira.token')
  if (!j.url || !j.email || !token) {
    return { ok: false, message: 'Configure o Jira (Configurações → Integrações) ou cole a descrição do card em Contexto.' }
  }
  const base = j.url.replace(/\/+$/, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(
      `${base}/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,description,comment,status,issuetype,priority,attachment`,
      {
        headers: { Authorization: 'Basic ' + Buffer.from(`${j.email}:${token}`).toString('base64'), Accept: 'application/json' },
        signal: ctrl.signal
      }
    )
    if (res.status === 404) return { ok: false, message: `Card ${key} não encontrado (ou sem acesso).` }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'O Jira recusou o acesso: confira o e-mail e o API token.' }
    if (!res.ok) return { ok: false, message: `O Jira respondeu HTTP ${res.status}.` }
    const data = (await res.json()) as { fields: Record<string, any> }
    const f = data.fields ?? {}
    return {
      ok: true,
      jira: {
        summary: str(f.summary),
        status: str(f.status?.name),
        type: str(f.issuetype?.name),
        priority: str(f.priority?.name),
        description: cleanJira(str(f.description)),
        comments: ((f.comment?.comments ?? []) as Array<Record<string, any>>).slice(-30).map((c) => ({
          author: str(c.author?.displayName) || '?',
          at: str(c.created).slice(0, 10),
          body: cleanJira(str(c.body))
        })),
        attachments: ((f.attachment ?? []) as Array<Record<string, any>>).map((a) => str(a.filename)).filter(Boolean),
        url: `${base}/browse/${key}`,
        fetchedAt: Date.now()
      }
    }
  } catch (err) {
    return { ok: false, message: (err as Error).name === 'AbortError' ? 'O Jira demorou demais para responder.' : 'Falha de rede ao falar com o Jira.' }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- gerenciador

/**
 * Demandas: um card do Jira por demanda, dentro do projeto. Junta o contexto, pede à IA a análise (dúvidas e estimativa)
 * e o desenho, e mantém uma conversa do Claude por demanda para implementar. Fica em demands.json, só no PC.
 */
export class DemandManager {
  private list: Demand[] = []
  private busy = new Map<string, DemandBusy>()
  /** runId → demanda + o que está sendo feito + texto da IA juntado até agora */
  private running = new Map<
    string,
    {
      demandId: string
      what: 'analysis' | 'design' | 'dev' | 'review' | 'review1'
      text: string[]
      /** Revisão: dados para guardar no fim (e para a segunda passada da revisão dupla) */
      review?: { base: string; commit: string; scope: string; diff: string; truncated: boolean; ai: ReviewAi }
    }
  >()
  private file: string

  constructor(
    base: string,
    private runs: RunManager,
    private onChange: (list: Demand[], busy: DemandBusy[]) => void
  ) {
    this.file = join(base, 'demands.json')
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        if (Array.isArray(raw)) this.list = raw.map(normDemand)
      }
    } catch {
      this.list = []
    }
  }

  all(): Demand[] {
    return this.list
  }

  busyList(): DemandBusy[] {
    return [...this.busy.values()]
  }

  get(id: string): Demand | undefined {
    return this.list.find((d) => d.id === id)
  }

  findByKey(key: string): Demand | undefined {
    const k = key.trim().toUpperCase()
    return this.list.find((d) => d.key === k)
  }

  private persist(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.list, null, 1))
    } catch {
      /* ignora */
    }
    this.onChange(this.list, this.busyList())
  }

  private note(d: Demand, text: string): void {
    d.timeline.push({ at: Date.now(), text })
    d.updatedAt = Date.now()
  }

  save(input: Demand): Demand[] {
    const d = normDemand(input)
    const i = this.list.findIndex((x) => x.id === d.id)
    if (i < 0) {
      this.note(d, 'Demanda criada')
      this.list.unshift(d)
    } else {
      const old = this.list[i]
      // Campos que só o app/IA escrevem: a interface não sobrescreve (ex: análise chegando enquanto você digita)
      d.jira = old.jira
      d.analysis = old.analysis
      d.aiHours = old.aiHours
      d.sessionId = old.sessionId
      d.timeline = old.timeline
      d.createdAt = old.createdAt
      if (this.busy.get(d.id)?.what === 'design') d.design = old.design
      d.review = old.review
      if (old.status !== d.status) this.note(d, `Etapa: ${d.status}`)
      if (old.hours !== d.hours && d.hours) this.note(d, `Estimativa: ${hoursLabel(d.hours)}`)
      if (!old.designApproved && d.designApproved) this.note(d, 'Desenho aprovado')
      d.updatedAt = Date.now()
      this.list[i] = d
    }
    this.persist()
    return this.list
  }

  delete(id: string): Demand[] {
    this.list = this.list.filter((d) => d.id !== id)
    this.persist()
    return this.list
  }

  private setBusy(id: string, b: DemandBusy | null): void {
    if (b) this.busy.set(id, b)
    else this.busy.delete(id)
    this.onChange(this.list, this.busyList())
  }

  private projectOf(d: Demand): Project | undefined {
    return store.get().projects.find((p) => p.id === d.projectId)
  }

  async fetchJira(id: string): Promise<OpResult> {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    if (!CARD_RE.test(d.key)) return { ok: false, message: 'Informe o número do card (ex: WEB-482).' }
    this.setBusy(id, { demandId: id, what: 'jira' })
    const r = await fetchJiraIssue(d.key)
    this.setBusy(id, null)
    if (!r.ok) return r
    d.jira = r.jira
    if (!d.title.trim()) d.title = r.jira.summary
    this.note(d, `Card atualizado do Jira (${r.jira.comments.length} comentário(s))`)
    this.persist()
    return { ok: true, message: `Card ${d.key} carregado do Jira.` }
  }

  private refs(d: Demand): Project[] {
    const ps = store.get().projects
    return d.refProjectIds.filter((x) => x !== d.projectId).map((x) => ps.find((p) => p.id === x)).filter((p): p is Project => !!p)
  }

  /** Análise (dúvidas + estimativa) ou desenho, com a IA escolhida na demanda. Só leitura. */
  analyze(id: string, what: 'analysis' | 'design'): OpResult {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    if (this.busy.has(id)) return { ok: false, message: 'Essa demanda já está com uma tarefa em andamento.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    if (!d.jira && !d.context.trim() && !d.transcript.trim()) {
      return { ok: false, message: 'Sem contexto: puxe o card do Jira ou cole a descrição em Contexto.' }
    }
    const refs = this.refs(d)
    const ctx = demandContext(d, p, refs)
    const content = what === 'analysis' ? analysisPrompt(ctx) : designPrompt(ctx, d)
    const runId = this.runs.start({
      kind: d.ai,
      tab: `demand:${d.id}`,
      title: `${d.key} · ${what === 'analysis' ? 'análise' : 'desenho'}`,
      content,
      cwd: p.path,
      projectId: p.id,
      origin: 'demanda',
      readOnly: true,
      addDirs: refs.map((r) => r.path)
    })
    this.running.set(runId, { demandId: id, what, text: [] })
    this.setBusy(id, { demandId: id, what, runId })
    return { ok: true, message: what === 'analysis' ? 'Analisando a demanda…' : 'Desenhando a solução…' }
  }

  /** Conversa do Claude da demanda: a primeira mensagem leva todo o contexto e o desenho */
  implement(id: string, message: string, fresh = false, origin: 'app' | 'telegram' | 'fila' = 'app'): OpResult & { runId?: string } {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    if (this.busy.has(id)) return { ok: false, message: 'O Claude ainda está trabalhando nesta demanda.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    if (fresh) d.sessionId = null
    const first = !d.sessionId
    const refs = this.refs(d)
    const content = first
      ? implementPrompt(demandContext(d, p, refs), d) + (message.trim() ? `\n\nObservação: ${message.trim()}` : '')
      : message.trim()
    if (!content) return { ok: false, message: 'Escreva o que o Claude deve fazer.' }
    const runId = this.runs.start({
      kind: 'claude',
      tab: `demand:${d.id}`,
      title: `${d.key} · Claude`,
      content,
      cwd: p.path,
      projectId: p.id,
      origin: origin === 'app' ? 'demanda' : origin,
      resumeSessionId: d.sessionId ?? undefined,
      addDirs: refs.map((r) => r.path)
    })
    this.running.set(runId, { demandId: id, what: 'dev', text: [] })
    this.setBusy(id, { demandId: id, what: 'dev', runId })
    if (first) this.note(d, 'Implementação começou com o Claude')
    if (d.status === 'nova' || d.status === 'estimada' || d.status === 'desenhada') d.status = 'dev'
    this.persist()
    return { ok: true, message: first ? 'O Claude começou a implementar.' : 'Mensagem enviada ao Claude.', runId }
  }

  async stop(id: string): Promise<void> {
    const b = this.busy.get(id)
    if (b?.runId) await this.runs.stop(b.runId)
  }

  /** Branch com o nome do card. Se já existe, só troca para ela. */
  async branch(id: string, base: string): Promise<OpResult> {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    if (!CARD_RE.test(d.key)) return { ok: false, message: 'O número do card não serve como nome de branch.' }
    const b = base.trim()
    if (b && !/^[\w./-]+$/.test(b)) return { ok: false, message: 'Nome da branch base inválido.' }
    this.setBusy(id, { demandId: id, what: 'branch' })
    try {
      const exists = (await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${d.key}`])).ok
      const r = exists ? await git(p.path, ['checkout', d.key]) : await git(p.path, ['checkout', '-b', d.key, ...(b ? [b] : [])])
      if (!r.ok) return { ok: false, message: `O git recusou: ${r.out.split('\n').slice(-3).join(' ')}` }
      this.note(d, exists ? `Voltou para a branch ${d.key}` : `Branch ${d.key} criada${b ? ` a partir de ${b}` : ''}`)
      this.persist()
      return { ok: true, message: exists ? `Branch ${d.key} já existia: agora você está nela.` : `Branch ${d.key} criada e ativa.` }
    } finally {
      this.setBusy(id, null)
    }
  }

  /** Traz a branch principal (ex: master) para a branch da demanda */
  async updateBase(id: string): Promise<OpResult> {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    if (this.busy.has(id)) return { ok: false, message: 'Espere a tarefa em andamento terminar.' }
    this.setBusy(id, { demandId: id, what: 'branch' })
    try {
      const r = await updateWithBase(p, d.key)
      if (r.ok && !/Já estava/.test(r.message)) this.note(d, r.message.split(' (')[0])
      if (r.conflicts?.length) this.note(d, `Conflito ao atualizar com a principal: ${r.conflicts.length} arquivo(s)`)
      this.persist()
      return r
    } finally {
      this.setBusy(id, null)
    }
  }

  // ---------------------------------------------------------------- revisão

  /** Revisão da branch da demanda contra a principal (commits + alterações ainda sem commit) */
  async review(id: string): Promise<OpResult> {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    if (this.busy.has(id)) return { ok: false, message: 'Espere a tarefa em andamento terminar.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    const info = await gitInfo(p)
    if (!info) return { ok: false, message: 'A pasta do projeto não é um repositório git.' }
    const hasBranch = (await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${d.key}`])).ok
    if (!hasBranch) return { ok: false, message: `A branch ${d.key} ainda não existe.` }
    const base = info.base
    const remoteBase = (await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`])).ok
    const ref = remoteBase ? `origin/${base}` : base
    const committed = await git(p.path, ['diff', `${ref}...${d.key}`], 30_000)
    const onBranch = info.branch === d.key
    const pending = onBranch ? await git(p.path, ['diff', 'HEAD'], 30_000) : { ok: true, out: '' }
    const log = await git(p.path, ['log', '--oneline', `${ref}..${d.key}`], 10_000)
    const parts: string[] = []
    if (committed.ok && committed.out.trim()) parts.push(committed.out)
    if (pending.ok && pending.out.trim()) parts.push('# ---- alterações ainda sem commit ----\n' + pending.out)
    if (!parts.length) return { ok: false, message: `Nada para revisar: ${d.key} não tem diferença para a ${ref}.` }
    let diff = parts.join('\n')
    const truncated = diff.length > MAX_DIFF
    if (truncated) diff = diff.slice(0, MAX_DIFF)
    const commits = log.ok ? log.out.split('\n').filter(Boolean).length : 0
    const scope = `${commits} commit(s) contra ${ref}${pending.out.trim() ? ' + alterações sem commit' : ''}`
    const commit = (await git(p.path, ['rev-parse', '--short', d.key])).out.trim()
    const ai = d.reviewAi
    const first: DemandAi = ai === 'dupla' ? 'codex' : ai
    const ctx = demandContext({ ...d, transcript: '' }, p, this.refs(d))
    const runId = this.runs.start({
      kind: first,
      tab: `demand:${d.id}`,
      title: `${d.key} · revisão${ai === 'dupla' ? ' (1ª passada, ChatGPT)' : ''}`,
      content: reviewPrompt(d, ctx, scope, diff, truncated),
      cwd: p.path,
      projectId: p.id,
      origin: 'demanda',
      readOnly: true,
      addDirs: this.refs(d).map((r) => r.path)
    })
    this.running.set(runId, {
      demandId: id,
      what: ai === 'dupla' ? 'review1' : 'review',
      text: [],
      review: { base: ref, commit, scope, diff, truncated, ai }
    })
    this.setBusy(id, { demandId: id, what: 'review', runId })
    return { ok: true, message: `Revisando ${scope}…` }
  }

  saveReview(id: string, text: string): void {
    const d = this.get(id)
    if (!d?.review) return
    d.review = { ...d.review, text }
    this.persist()
  }

  /** Publica a revisão como comentário no PR da branch (gh pr comment) */
  async publishReview(id: string): Promise<OpResult> {
    const d = this.get(id)
    if (!d?.review) return { ok: false, message: 'Sem revisão para publicar.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    const body = `### Revisão com IA (${d.review.ai === 'dupla' ? 'ChatGPT + Claude' : d.review.ai})\n\n${d.review.text}\n\n<sub>Revisado no commit ${d.review.commit} · Claude Command Center</sub>`
    const r = await new Promise<{ ok: boolean; out: string; missing?: boolean }>((resolve) => {
      const child = spawn('gh', ['pr', 'comment', d.key, '--body-file', '-'], { cwd: p.path, windowsHide: true })
      let out = ''
      child.stdout?.on('data', (b) => (out += b))
      child.stderr?.on('data', (b) => (out += b))
      child.on('error', () => resolve({ ok: false, out: '', missing: true }))
      child.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }))
      child.stdin?.on('error', () => {})
      child.stdin?.end(body)
    })
    if (r.missing) return { ok: false, message: 'O GitHub CLI (gh) não está instalado. Veja em Configurações → Começar.' }
    if (!r.ok) {
      if (/no pull requests found|no open pull requests/i.test(r.out)) return { ok: false, message: `Não achei um PR aberto da branch ${d.key}. Abra o PR e tente de novo.` }
      if (/auth|login/i.test(r.out)) return { ok: false, message: 'O gh não está logado: rode "gh auth login" (Configurações → Começar).' }
      return { ok: false, message: 'O gh recusou: ' + r.out.split('\n').slice(-2).join(' ') }
    }
    d.review = { ...d.review, publishedAt: Date.now() }
    this.note(d, 'Revisão publicada no PR')
    this.persist()
    return { ok: true, message: 'Revisão publicada como comentário no PR.' + (r.out ? ` ${r.out.split('\n').pop()}` : '') }
  }

  handleRunEvent(e: RunEvent): void {
    const r = this.running.get(e.runId)
    if (!r) return
    const d = this.get(r.demandId)
    if (e.type === 'lines') {
      for (const l of e.lines) if (l.kind === 'claude') r.text.push(l.text)
      return
    }
    if (e.type === 'session' && r.what === 'dev' && d) {
      d.sessionId = e.sessionId
      return
    }
    if (e.type !== 'exit') return
    this.running.delete(e.runId)
    this.busy.delete(r.demandId)
    if (!d) return this.onChange(this.list, this.busyList())
    const text = r.text.join('\n')
    const ok = !e.killed && e.code === 0
    // Revisão dupla: a 1ª passada (ChatGPT) terminou → o Claude confere e aprofunda
    if (r.what === 'review1' && r.review && ok && text.trim()) {
      const p = this.projectOf(d)
      if (p) {
        const ctx = demandContext({ ...d, transcript: '' }, p, this.refs(d))
        const runId = this.runs.start({
          kind: 'claude',
          tab: `demand:${d.id}`,
          title: `${d.key} · revisão (2ª passada, Claude)`,
          content: reviewPrompt(d, ctx, r.review.scope, r.review.diff, r.review.truncated, extractResult(text)),
          cwd: p.path,
          projectId: p.id,
          origin: 'demanda',
          readOnly: true,
          addDirs: this.refs(d).map((x) => x.path)
        })
        this.running.set(runId, { demandId: d.id, what: 'review', text: [], review: r.review })
        this.setBusy(d.id, { demandId: d.id, what: 'review', runId })
        return
      }
    }
    if (r.what === 'review' || r.what === 'review1') {
      if (!ok || !text.trim()) {
        this.note(d, `Revisão ${e.killed ? 'interrompida' : 'falhou'}: veja a aba da demanda nos terminais`)
      } else {
        const rv = r.review!
        d.review = { at: Date.now(), ai: rv.ai, base: rv.base, commit: rv.commit, scope: rv.scope, text: extractResult(text) }
        this.note(d, `Revisão pronta (${rv.scope})`)
      }
      this.persist()
      return
    }
    if (r.what === 'dev') {
      this.note(d, e.killed ? 'Claude interrompido' : ok ? 'Claude respondeu' : `Claude falhou (código ${e.code ?? '?'})`)
    } else if (!ok || !text.trim()) {
      this.note(d, `${r.what === 'analysis' ? 'Análise' : 'Desenho'} ${e.killed ? 'interrompido' : 'falhou'}: veja a aba da demanda nos terminais`)
    } else if (r.what === 'analysis') {
      d.analysis = extractResult(text).replace(/^ESTIMATIVA_HORAS:.*$/im, '').trim()
      d.aiHours = extractHours(text)
      if (d.status === 'nova') d.status = 'estimada'
      this.note(d, `Análise pronta${d.aiHours ? ` · sugestão: ${hoursLabel(d.aiHours)}` : ''}`)
    } else {
      d.design = extractResult(text)
      d.designApproved = false
      this.note(d, 'Desenho pronto para revisar')
    }
    this.persist()
  }
}
