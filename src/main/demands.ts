import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { join } from 'path'
import type { Demand, DemandAi, DemandPlan, DemandBusy, DemandJira, DemandQueueCopy, DemandReview, DemandStatus, DemandTiming, OpResult, PrComment, PrDraft, Project, ReviewAi, RunEvent, TaskTier } from '../shared/types'
import { spawn } from 'child_process'
import { baseBranch, bringQueueToBranch, dirSize, fetchRemoteBranch, git, gitInfo, githubRepoOf, goToDemandBranch, linkedProjectsOf, queueAhead, remotesOf, remoteUrl, removeWorktree, updateWithBase, type DemandBranchResult } from './git'
import { readGuides } from './guides'
import type { RunManager } from './runner'
import { normPlan, parsePlan, planPrompt } from './plan'
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
    queueSessionId: str(r.queueSessionId) || null,
    prUrl: str(r.prUrl) || null,
    statusLog: Array.isArray(r.statusLog) ? r.statusLog.filter((x) => x && typeof x.at === 'number').slice(-100) : [],
    type: r.type === 'bug' ? 'bug' : 'feature',
    images: Array.isArray(r.images) ? r.images.filter((x) => typeof x === 'string').slice(0, 20) : [],
    prCommentsDone: Array.isArray(r.prCommentsDone) ? r.prCommentsDone.filter((x) => typeof x === 'string').slice(-500) : [],
    timeline: Array.isArray(r.timeline) ? r.timeline.slice(-200) : [],
    plan: normPlan(r.plan),
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
  if (d.images?.length) {
    parts.push('## Prints anexados (abra e veja cada imagem)\n' + d.images.map((f) => `- ${f}`).join('\n'))
  }
  if (d.context.trim()) parts.push(`## ${d.type === 'bug' ? 'Como reproduzir / erro' : 'Contexto extra (chat, anotações)'}\n` + d.context.trim())
  if (d.transcript.trim()) parts.push('## Transcrição da call de apresentação\n' + d.transcript.trim())
  return parts.join('\n\n')
}

export function bugAnalysisPrompt(ctx: string): string {
  return `${ctx}

---
Isto é um BUG. Você é um dev front-end sênior investigando. Leia o código (e os prints, se houver) para achar a causa.
NÃO altere nenhum arquivo.

Responda em português, em markdown, com o documento inteiro entre uma linha "${OPEN}" e uma linha "${CLOSE}":

## Sintoma
O que acontece e o que deveria acontecer.
## Como reproduzir
Passo a passo (confirme pelo código; diga se algo não bate com o relato).
## Causa provável
Com \`arquivo:linha\` e o porquê. Se houver mais de uma hipótese, ordene da mais provável.
## Correção proposta
O que mudar, em poucos passos.
## Teste que garante
Um teste que falha hoje e passa com a correção.
## Dúvidas para o refinamento
O que precisa ser confirmado com quem relatou.
## Estimativa
Horas para corrigir + testar.

Na última linha antes de "${CLOSE}", escreva exatamente: ESTIMATIVA_HORAS: <número>`
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
  if (d.type === 'bug') {
    return `${ctx}

${d.analysis ? '## Investigação\n' + d.analysis + '\n' : ''}${d.design ? '## Plano aprovado\n' + d.design + '\n' : ''}
---
Corrija este bug no projeto da pasta atual (branch ${d.key}):
1. Primeiro escreva um teste que reproduz o bug e confirme que ele falha.
2. Corrija a causa (não só o sintoma), seguindo os padrões do projeto.
3. Rode o teste de novo e mostre que passa; procure o mesmo problema em outros lugares parecidos.
Diga em poucas linhas o que encontrou, o que mudou e como testar. Não faça commit nem push.`
  }
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

/** Monta o PR a partir do card, do desenho e da revisão (você edita antes de abrir) */
export function buildPrDraft(d: Demand, base: string): PrDraft {
  const section = (md: string, name: RegExp) => {
    const m = md.match(new RegExp(`##\\s*${name.source}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'))
    return m ? m[1].trim() : ''
  }
  const title = `${d.key}: ${d.title || d.jira?.summary || 'ajustes'}`
  const parts: string[] = []
  if (d.jira?.url) parts.push(`**Card:** [${d.key}](${d.jira.url})`)
  const goal = section(d.design, /Objetivo/) || section(d.analysis, /Entendimento/) || d.jira?.summary || ''
  if (goal) parts.push(`## O que muda\n${goal}`)
  const sol = section(d.design, /Desenho da solu/)
  if (sol) parts.push(`## Como foi feito\n${sol}`)
  const test = section(d.design, /Como testar/)
  if (test) parts.push(`## Como testar\n${test}`)
  const verdict = d.review ? section(d.review.text, /Veredito/) : ''
  if (verdict) parts.push(`## Revisão com IA\n${verdict}`)
  return { title, body: parts.join('\n\n') || title, base }
}

/** Dias úteis (seg-sex) entre dois instantes, com fração */
export function businessDays(from: number, to: number): number {
  if (to <= from) return 0
  let total = 0
  let t = from
  while (t < to) {
    const d = new Date(t)
    const next = new Date(d)
    next.setHours(24, 0, 0, 0)
    const end = Math.min(next.getTime(), to)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) total += (end - t) / 86_400_000
    t = end
  }
  return Math.round(total * 10) / 10
}

/** Estimado × real: do primeiro "Em dev" até o último "Feita" (ou até agora) */
export function demandTiming(d: Demand, now = Date.now()): DemandTiming {
  const startedAt = d.statusLog.find((s) => s.status === 'dev')?.at ?? null
  const doneEntry = [...d.statusLog].reverse().find((s) => s.status === 'feita')
  const done = d.status === 'feita'
  const doneAt = done ? (doneEntry?.at ?? null) : null
  return {
    demandId: d.id,
    key: d.key,
    title: d.title || d.jira?.summary || '',
    estimateHours: d.hours,
    realDays: startedAt ? businessDays(startedAt, doneAt ?? now) : null,
    done,
    startedAt,
    doneAt
  }
}

/** Roda o gh com texto no stdin */
function ghRun(cwd: string, args: string[], input: string): Promise<{ ok: boolean; out: string; missing?: boolean }> {
  return new Promise((resolve) => {
    const child = spawn('gh', args, { cwd, windowsHide: true })
    let out = ''
    child.stdout?.on('data', (b) => (out += b))
    child.stderr?.on('data', (b) => (out += b))
    child.on('error', () => resolve({ ok: false, out: '', missing: true }))
    child.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }))
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

/** Junta comentários gerais, revisões e comentários de linha do PR (tira os seus e os de robôs) */
export function parsePrComments(view: any, inline: any[], me: string): PrComment[] {
  const out: PrComment[] = []
  const skip = (login?: string) => !login || login === me || /\[bot\]$|-bot$/i.test(login)
  for (const c of view?.comments ?? []) {
    if (skip(c.author?.login) || !String(c.body ?? '').trim()) continue
    out.push({ id: `c:${c.id ?? c.url}`, author: c.author.login, body: String(c.body).trim(), at: String(c.createdAt ?? ''), url: c.url, kind: 'geral' })
  }
  for (const r of view?.reviews ?? []) {
    if (skip(r.author?.login) || !String(r.body ?? '').trim()) continue
    out.push({ id: `r:${r.id}`, author: r.author.login, body: String(r.body).trim(), at: String(r.submittedAt ?? ''), kind: 'revisao' })
  }
  for (const c of inline ?? []) {
    if (skip(c.user?.login) || !String(c.body ?? '').trim()) continue
    out.push({
      id: `l:${c.id}`,
      author: c.user.login,
      body: String(c.body).trim(),
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      at: String(c.created_at ?? ''),
      url: c.html_url,
      kind: 'linha'
    })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

export function prCommentsPrompt(d: Demand, comments: PrComment[]): string {
  const list = comments
    .map((c, i) => `${i + 1}. ${c.author}${c.path ? ` em \`${c.path}${c.line ? `:${c.line}` : ''}\`` : c.kind === 'revisao' ? ' (revisão)' : ''}:\n${c.body.split('\n').map((l) => '   ' + l).join('\n')}`)
    .join('\n\n')
  return `O time comentou no PR da ${d.key}. Ajuste o código para atender cada comentário abaixo (na branch ${d.key}).
Se discordar de algum ou ele estiver ambíguo, não mude: explique e sugira uma resposta para eu mandar.
No fim, liste por número o que fez em cada comentário (para eu responder no PR). Não faça commit nem push.

${list}`
}

/** Mensagem pronta com as dúvidas da análise, para mandar antes do refinamento */
export function doubtsMessage(d: Demand): string {
  const m = d.analysis.match(/##\s*Dúvidas[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i)
  const items = (m?.[1] ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
  const title = d.title || d.jira?.summary || ''
  if (!items.length) return ''
  return [
    `Oi, pessoal! Sobre a ${d.key}${title ? ` (${title})` : ''}, ficaram algumas dúvidas antes de começar:`,
    '',
    ...items.map((x, i) => `${i + 1}. ${x}`),
    '',
    'Podemos alinhar na apresentação ou por aqui. Obrigado!'
  ].join('\n')
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

export async function postJiraComment(key: string, body: string): Promise<OpResult> {
  const j = store.get().integrations.jira
  const token = secrets.get('jira.token')
  if (!j.url || !j.email || !token) return { ok: false, message: 'Configure o Jira (Configurações → Integrações).' }
  try {
    const res = await fetch(`${j.url.replace(/\/+$/, '')}/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${j.email}:${token}`).toString('base64'),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ body })
    })
    if (res.status === 201 || res.ok) return { ok: true, message: `Comentado no card ${key}.` }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'O Jira recusou: sem permissão para comentar neste card.' }
    return { ok: false, message: `O Jira respondeu HTTP ${res.status}.` }
  } catch {
    return { ok: false, message: 'Falha de rede ao falar com o Jira.' }
  }
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

/** O que mudou na lista (para mandar à tela só o necessário) */
export interface DemandChange {
  upsert?: Demand
  removed?: string
  all?: boolean
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
      what: 'analysis' | 'design' | 'dev' | 'review' | 'review1' | 'plan'
      text: string[]
      /** Revisão: dados para guardar no fim (e para a segunda passada da revisão dupla) */
      review?: { base: string; commit: string; scope: string; diff: string; truncated: boolean; ai: ReviewAi }
      sessionField?: 'sessionId' | 'queueSessionId'
    }
  >()
  private dir: string

  constructor(
    private base: string,
    private runs: RunManager,
    private onChange: (list: Demand[], busy: DemandBusy[], change?: DemandChange) => void
  ) {
    this.dir = join(base, 'demands')
    const legacy = join(base, 'demands.json')
    try {
      if (existsSync(this.dir)) {
        for (const f of readdirSync(this.dir)) {
          if (!f.endsWith('.json')) continue
          try {
            this.list.push(normDemand(JSON.parse(readFileSync(join(this.dir, f), 'utf8'))))
          } catch {
            /* arquivo corrompido: pula só ele */
          }
        }
        this.list.sort((a, b) => b.createdAt - a.createdAt)
      } else if (existsSync(legacy)) {
        // Versões antigas guardavam tudo num arquivo só: separa e guarda o antigo como .migrado
        const raw = JSON.parse(readFileSync(legacy, 'utf8'))
        if (Array.isArray(raw)) this.list = raw.map(normDemand)
        mkdirSync(this.dir, { recursive: true })
        for (const d of this.list) writeFileAtomic(this.fileOf(d.id), JSON.stringify(d))
        renameSync(legacy, legacy + '.migrado')
      }
    } catch {
      /* começa vazio */
    }
  }

  all(): Demand[] {
    return this.list
  }

  busyList(): DemandBusy[] {
    return [...this.busy.values()]
  }

  /**
   * Status que veio do Jira na sincronização. Se o card foi concluído lá, a demanda vira Feita aqui.
   * Devolve true quando a demanda foi finalizada agora.
   */
  applyJiraStatus(id: string, status: string, done: boolean): boolean {
    const d = this.get(id)
    if (!d) return false
    let changed = false
    if (d.jira && d.jira.status !== status) {
      d.jira = { ...d.jira, status }
      changed = true
    }
    let finished = false
    if (done && d.status !== 'feita') {
      d.status = 'feita'
      d.statusLog.push({ at: Date.now(), status: 'feita' })
      this.note(d, `Finalizada no Jira (${status})`)
      void this.cleanupCopy(d.id)
      finished = true
      changed = true
    }
    if (changed) {
      d.updatedAt = Date.now()
      this.persist(d)
    }
    return finished
  }

  /** Status do card no Jira mudou por aqui (transição): guarda sem buscar o card de novo */
  setJiraStatus(id: string, status: string): void {
    const d = this.get(id)
    if (!d?.jira) return
    d.jira = { ...d.jira, status }
    this.note(d, `Jira: ${status}`)
    this.persist(d)
  }

  get(id: string): Demand | undefined {
    return this.list.find((d) => d.id === id)
  }

  findByKey(key: string): Demand | undefined {
    const k = key.trim().toUpperCase()
    return this.list.find((d) => d.key === k)
  }

  private fileOf(id: string): string {
    return join(this.dir, `${id.replace(/[^\w-]/g, '')}.json`)
  }

  /**
   * Grava só a demanda que mudou (um arquivo por demanda, gravação segura) e avisa a tela só dela.
   * Sem argumento: grava todas (ex: depois da sincronização entre PCs).
   */
  private persist(d?: Demand): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      if (d) writeFileAtomic(this.fileOf(d.id), JSON.stringify(d))
      else {
        const keep = new Set(this.list.map((x) => `${x.id.replace(/[^\w-]/g, '')}.json`))
        for (const x of this.list) writeFileAtomic(this.fileOf(x.id), JSON.stringify(x))
        for (const f of readdirSync(this.dir)) if (f.endsWith('.json') && !keep.has(f)) rmSync(join(this.dir, f), { force: true })
      }
    } catch {
      /* disco cheio etc.: tenta de novo na próxima mudança */
    }
    this.onChange(this.list, this.busyList(), d ? { upsert: d } : { all: true })
  }

  private setStatus(d: Demand, s: DemandStatus): void {
    if (d.status === s) return
    d.status = s
    d.statusLog.push({ at: Date.now(), status: s })
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
      d.queueSessionId = old.queueSessionId
      d.images = old.images
      d.prCommentsDone = old.prCommentsDone
      d.prUrl = old.prUrl
      d.statusLog = old.statusLog
      // O plano por fases muda só pelos botões dele (o estado das fases vem da fila)
      d.plan = old.plan
      if (old.status !== d.status) {
        this.note(d, `Etapa: ${d.status}`)
        d.statusLog.push({ at: Date.now(), status: d.status })
        if (d.status === 'feita') void this.cleanupCopy(d.id)
      }
      if (old.hours !== d.hours && d.hours) this.note(d, `Estimativa: ${hoursLabel(d.hours)}`)
      if (!old.designApproved && d.designApproved) this.note(d, 'Desenho aprovado')
      d.updatedAt = Date.now()
      this.list[i] = d
    }
    this.persist(d)
    return this.list
  }

  /** Lista que veio da sincronização entre PCs */
  replaceAll(list: Demand[]): void {
    this.list = list.map(normDemand)
    this.persist()
  }

  delete(id: string): Demand[] {
    this.list = this.list.filter((d) => d.id !== id)
    rmSync(this.fileOf(id), { force: true })
    this.onChange(this.list, this.busyList(), { removed: id })
    return this.list
  }

  private setBusy(id: string, b: DemandBusy | null): void {
    if (b) this.busy.set(id, b)
    else this.busy.delete(id)
    this.onChange(this.list, this.busyList(), {})
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
    this.persist(d)
    return { ok: true, message: `Card ${d.key} carregado do Jira.` }
  }

  /** Pastas extras que o Claude pode ler: projetos de consulta + prints da demanda */
  private extraDirs(d: Demand): string[] {
    const dirs = this.refs(d).map((r) => r.path)
    if (d.images.length) dirs.push(this.imagesDir(d.id))
    return dirs
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
    const content = what === 'analysis' ? (d.type === 'bug' ? bugAnalysisPrompt(ctx) : analysisPrompt(ctx)) : designPrompt(ctx, d)
    const runId = this.runs.start({
      kind: d.ai,
      tab: `demand:${d.id}`,
      title: `${d.key} · ${what === 'analysis' ? 'análise' : 'desenho'}`,
      content,
      cwd: p.path,
      projectId: p.id,
      origin: 'demanda',
      readOnly: true,
      addDirs: this.extraDirs(d)
    })
    this.running.set(runId, { demandId: id, what, text: [] })
    this.setBusy(id, { demandId: id, what, runId })
    return { ok: true, message: what === 'analysis' ? 'Analisando a demanda…' : 'Desenhando a solução…' }
  }

  /** A IA divide a demanda em fases com custo estimado (plano por fases) */
  planPhases(id: string): OpResult {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    if (this.busy.has(id)) return { ok: false, message: 'Essa demanda já está com uma tarefa em andamento.' }
    if (d.plan?.running) return { ok: false, message: 'Pause o plano atual antes de planejar de novo.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    if (!d.design.trim() && !d.analysis.trim() && !d.context.trim() && !d.jira) {
      return { ok: false, message: 'Sem contexto: faça a análise ou o desenho antes de planejar as fases.' }
    }
    const runId = this.runs.start({
      kind: 'claude',
      tab: `demand:${d.id}`,
      title: `${d.key} · plano por fases`,
      content: planPrompt(demandContext(d, p, this.refs(d)), d),
      cwd: p.path,
      projectId: p.id,
      origin: 'demanda',
      readOnly: true,
      addDirs: this.extraDirs(d)
    })
    this.running.set(runId, { demandId: id, what: 'plan', text: [] })
    this.setBusy(id, { demandId: id, what: 'plan', runId })
    return { ok: true, message: 'Dividindo a demanda em fases…' }
  }

  /** Grava o plano por fases (vem do PlanRunner) */
  setPlan(id: string, plan: DemandPlan | null, note?: string): void {
    const d = this.get(id)
    if (!d) return
    d.plan = plan
    if (note) this.note(d, note)
    d.updatedAt = Date.now()
    this.persist(d)
  }

  /** Conversa do Claude da demanda: a primeira mensagem leva todo o contexto e o desenho */
  implement(
    id: string,
    message: string,
    fresh = false,
    origin: 'app' | 'telegram' | 'fila' = 'app',
    /** Fila na cópia separada: outra pasta e outra conversa */
    opts: { cwd?: string; queueCopy?: boolean; tier?: TaskTier } = {}
  ): OpResult & { runId?: string } {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    if (this.busy.has(id)) return { ok: false, message: 'O Claude ainda está trabalhando nesta demanda.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    const field = opts.queueCopy ? 'queueSessionId' : 'sessionId'
    if (fresh) d[field] = null
    const session = d[field]
    const first = !session
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
      cwd: opts.cwd ?? p.path,
      projectId: p.id,
      origin: origin === 'app' ? 'demanda' : origin,
      resumeSessionId: session ?? undefined,
      addDirs: this.extraDirs(d),
      tier: opts.tier
    })
    this.running.set(runId, { demandId: id, what: 'dev', text: [], sessionField: field })
    this.setBusy(id, { demandId: id, what: 'dev', runId })
    if (first) this.note(d, opts.queueCopy ? 'A fila começou a trabalhar na cópia separada' : 'Implementação começou com o Claude')
    if (d.status === 'nova' || d.status === 'estimada' || d.status === 'desenhada') this.setStatus(d, 'dev')
    this.persist(d)
    return { ok: true, message: first ? 'O Claude começou a implementar.' : 'Mensagem enviada ao Claude.', runId }
  }

  async stop(id: string): Promise<void> {
    const b = this.busy.get(id)
    if (b?.runId) await this.runs.stop(b.runId)
  }

  /**
   * Vai para a branch do card (fluxo empresa + fork, veja goToDemandBranch) e leva junto
   * os projetos ligados (ex.: o back) para a mesma branch, quando ela existir lá.
   */
  async branch(
    id: string,
    opts: { base?: string; createOnCompany?: boolean; linked?: boolean } = {}
  ): Promise<DemandBranchResult & { linked?: Array<{ project: string; ok: boolean; message: string }> }> {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const p = this.projectOf(d)
    if (!p) return { ok: false, message: 'O projeto desta demanda não existe mais.' }
    if (!CARD_RE.test(d.key)) return { ok: false, message: 'O número do card não serve como nome de branch.' }
    this.setBusy(id, { demandId: id, what: 'branch' })
    try {
      const r = await goToDemandBranch(p, d.key, { base: opts.base, createOnCompany: opts.createOnCompany })
      if (!r.ok) return r
      this.note(d, r.message)
      const linked: Array<{ project: string; ok: boolean; message: string }> = []
      if (opts.linked !== false) {
        for (const lp of linkedProjectsOf(p, store.get().projects)) {
          if (!lp.path) continue
          const lr = await goToDemandBranch(lp, d.key, { onlyExisting: true })
          linked.push({ project: lp.name, ok: lr.ok, message: lr.message })
          if (lr.ok && !lr.skipped) this.note(d, `${lp.name}: ${lr.message}`)
        }
      }
      this.persist(d)
      const extra = linked.length ? ' ' + linked.map((l) => `${l.project}: ${l.message}`).join(' ') : ''
      return { ...r, message: r.message + extra, linked }
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
      this.persist(d)
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
    // Compara com o destino do PR: empresa/KEY (fluxo com fork), senão a principal da empresa
    const base = info.base
    const { company, split } = remotesOf(p)
    const ref = split && (await fetchRemoteBranch(p, company, d.key))
      ? `${company}/${d.key}`
      : (await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/remotes/${company}/${base}`])).ok
        ? `${company}/${base}`
        : base
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
      addDirs: this.extraDirs(d)
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
    this.persist(d)
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
    this.persist(d)
    return { ok: true, message: 'Revisão publicada como comentário no PR.' + (r.out ? ` ${r.out.split('\n').pop()}` : '') }
  }

  // ---------------------------------------------------------------- cópia da fila

  /** Pasta da cópia da fila desta demanda (fora do projeto, na pasta de dados do app) */
  queueCopyDir(d: Demand): string {
    const p = this.projectOf(d)
    const slug = (p?.name ?? 'projeto').normalize('NFD').replace(/[^\w-]+/g, '-').toLowerCase()
    return join(this.base, 'worktrees', `${slug}-${d.key}`)
  }

  async queueCopy(id: string): Promise<DemandQueueCopy | null> {
    const d = this.get(id)
    const p = d && this.projectOf(d)
    if (!d || !p) return null
    const dir = this.queueCopyDir(d)
    const exists = existsSync(dir)
    return { dir, exists, ahead: await queueAhead(p, d.key), bytes: exists ? dirSize(dir) : 0 }
  }

  async bringQueue(id: string): Promise<OpResult> {
    const d = this.get(id)
    const p = d && this.projectOf(d)
    if (!d || !p) return { ok: false, message: 'Demanda não encontrada.' }
    const r = await bringQueueToBranch(p, d.key)
    if (r.ok && !/Nada novo/.test(r.message)) {
      this.note(d, r.message)
      this.persist(d)
    }
    return r
  }

  /** Demanda feita: apaga a cópia da fila se todo o trabalho dela já está na branch do card */
  async cleanupCopy(id: string): Promise<boolean> {
    const d = this.get(id)
    const p = d && this.projectOf(d)
    if (!d || !p || !existsSync(this.queueCopyDir(d))) return false
    if ((await queueAhead(p, d.key)) > 0) return false
    const r = await removeWorktree(p, d.key, this.queueCopyDir(d))
    if (r.ok) {
      d.queueSessionId = null
      this.note(d, 'Cópia da fila removida sozinha (demanda feita e trabalho já na branch)')
      this.persist(d)
    }
    return r.ok
  }

  async removeQueueCopy(id: string): Promise<OpResult> {
    const d = this.get(id)
    const p = d && this.projectOf(d)
    if (!d || !p) return { ok: false, message: 'Demanda não encontrada.' }
    const r = await removeWorktree(p, d.key, this.queueCopyDir(d))
    if (r.ok) {
      d.queueSessionId = null
      this.note(d, 'Cópia da fila removida')
      this.persist(d)
    }
    return r
  }

  // ---------------------------------------------------------------- PR

  async prDraft(id: string): Promise<PrDraft | null> {
    const d = this.get(id)
    const p = d && this.projectOf(d)
    if (!d || !p) return null
    const { company, split } = remotesOf(p)
    // No fluxo com fork o PR vai de fork/KEY para empresa/KEY
    return buildPrDraft(d, split ? `${company}/${d.key}` : await baseBranch(p))
  }

  /** "dono/repo" do remoto no GitHub, para o gh saber onde abrir/ler o PR */
  private async ghRepos(p: Project): Promise<{ company: string | null; fork: string | null }> {
    const { company, fork } = remotesOf(p)
    const cu = await remoteUrl(p, company)
    const fu = await remoteUrl(p, fork)
    return { company: cu ? githubRepoOf(cu) : null, fork: fu ? githubRepoOf(fu) : null }
  }

  /** Envia a branch (push) e abre o PR com o gh */
  async createPr(id: string, pr: { title: string; body: string; draft: boolean }): Promise<OpResult> {
    const d = this.get(id)
    const p = d && this.projectOf(d)
    if (!d || !p) return { ok: false, message: 'Demanda não encontrada.' }
    if (!(await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${d.key}`])).ok) return { ok: false, message: `A branch ${d.key} ainda não existe.` }
    const { company, fork, split } = remotesOf(p)
    const push = await git(p.path, ['push', '-u', fork, d.key], 180_000)
    if (!push.ok) return { ok: false, message: `O push da branch para o ${fork} falhou: ` + push.out.split('\n').slice(-2).join(' ') }
    let args: string[]
    if (split) {
      const repos = await this.ghRepos(p)
      if (!repos.company || !repos.fork) {
        this.note(d, `Branch enviada para o ${fork}`)
        this.persist(d)
        return {
          ok: false,
          message: `Branch enviada para o ${fork}. O app só abre PR sozinho no GitHub: abra pelo site, de ${fork}/${d.key} para ${company}/${d.key}.`
        }
      }
      if (!(await fetchRemoteBranch(p, company, d.key))) {
        return { ok: false, message: `Branch enviada para o ${fork}, mas ${d.key} não existe no ${company} para receber o PR. Crie lá (botão da branch) e tente de novo.` }
      }
      const forkOwner = repos.fork.split('/')[0]
      args = ['pr', 'create', '--repo', repos.company, '--base', d.key, '--head', `${forkOwner}:${d.key}`, '--title', pr.title.trim() || `${d.key}`, '--body-file', '-']
    } else {
      const base = await baseBranch(p)
      args = ['pr', 'create', '--base', base, '--head', d.key, '--title', pr.title.trim() || `${d.key}`, '--body-file', '-']
    }
    if (pr.draft) args.push('--draft')
    const r = await ghRun(p.path, args, pr.body)
    if (r.missing) return { ok: false, message: 'O GitHub CLI (gh) não está instalado. Veja em Configurações → Começar.' }
    if (!r.ok) {
      const existing = r.out.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0]
      if (/already exists/i.test(r.out) && existing) {
        d.prUrl = existing
        this.persist(d)
        return { ok: true, message: `Já existia um PR desta branch: ${existing}` }
      }
      if (/auth|login/i.test(r.out)) return { ok: false, message: 'O gh não está logado: rode "gh auth login" (Configurações → Começar).' }
      return { ok: false, message: 'O gh recusou: ' + r.out.split('\n').slice(-2).join(' ') }
    }
    const url = r.out.match(/https:\/\/\S+\/pull\/\d+/)?.[0] ?? r.out.split('\n').pop() ?? ''
    d.prUrl = url || null
    this.note(d, `PR aberto${pr.draft ? ' (rascunho)' : ''}: ${url}`)
    this.persist(d)
    return { ok: true, message: `PR aberto: ${url}` }
  }

  // ---------------------------------------------------------------- comentários do PR

  async prComments(id: string): Promise<OpResult & { comments?: PrComment[] }> {
    const d = this.get(id)
    const p = d && this.projectOf(d)
    if (!d || !p) return { ok: false, message: 'Demanda não encontrada.' }
    const { split } = remotesOf(p)
    const repo = split ? (await this.ghRepos(p)).company : null
    const view = await ghRun(p.path, ['pr', 'view', d.key, ...(repo ? ['--repo', repo] : []), '--json', 'number,url,comments,reviews'], '')
    if (view.missing) return { ok: false, message: 'O GitHub CLI (gh) não está instalado. Veja em Configurações → Começar.' }
    if (!view.ok) {
      if (/no pull requests found|no open pull/i.test(view.out)) return { ok: false, message: `Não achei PR da branch ${d.key}.` }
      if (/auth|login/i.test(view.out)) return { ok: false, message: 'O gh não está logado: rode "gh auth login".' }
      return { ok: false, message: 'O gh recusou: ' + view.out.split('\n').slice(-1)[0] }
    }
    let data: any
    try {
      data = JSON.parse(view.out)
    } catch {
      return { ok: false, message: 'Resposta estranha do gh.' }
    }
    if (data.url) d.prUrl = data.url
    const inline = await ghRun(p.path, ['api', `repos/${repo ?? '{owner}/{repo}'}/pulls/${data.number}/comments`, '--paginate'], '')
    const me = (await ghRun(p.path, ['api', 'user', '--jq', '.login'], '')).out.trim()
    let lines: any[] = []
    try {
      lines = inline.ok ? JSON.parse(inline.out.replace(/\]\s*\[/g, ',')) : []
    } catch {
      lines = []
    }
    const comments = parsePrComments(data, lines, me)
    const fresh = comments.filter((c) => !d.prCommentsDone.includes(c.id)).length
    this.persist(d)
    return { ok: true, message: comments.length ? `${comments.length} comentário(s), ${fresh} ainda não mandado(s) ao Claude.` : 'Nenhum comentário do time no PR.', comments }
  }

  /** Texto para o Claude e marca os comentários como tratados */
  prCommentsMessage(id: string, comments: PrComment[]): string | null {
    const d = this.get(id)
    if (!d || !comments.length) return null
    d.prCommentsDone = [...new Set([...d.prCommentsDone, ...comments.map((c) => c.id)])]
    this.note(d, `${comments.length} comentário(s) do PR mandados ao Claude`)
    this.persist(d)
    return prCommentsPrompt(d, comments)
  }

  // ---------------------------------------------------------------- dúvidas e Jira

  doubts(id: string): string {
    const d = this.get(id)
    return d ? doubtsMessage(d) : ''
  }

  async commentJira(id: string, text: string): Promise<OpResult> {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const r = await postJiraComment(d.key, text)
    if (r.ok) {
      this.note(d, 'Dúvidas comentadas no card do Jira')
      this.persist(d)
    }
    return r
  }

  // ---------------------------------------------------------------- prints colados

  imagesDir(id: string): string {
    return join(this.base, 'demand-images', id.replace(/[^\w-]/g, ''))
  }

  addImage(id: string, dataUrl: string): OpResult & { file?: string } {
    const d = this.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/)
    if (!m) return { ok: false, message: 'Só imagens (PNG, JPG, WEBP, GIF).' }
    const buf = Buffer.from(m[2], 'base64')
    if (buf.length > 8_000_000) return { ok: false, message: 'Imagem grande demais (máx. 8 MB).' }
    if (d.images.length >= 20) return { ok: false, message: 'Máximo de 20 imagens por demanda.' }
    const dir = this.imagesDir(id)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
    writeFileSync(file, buf)
    d.images = [...d.images, file]
    this.persist(d)
    return { ok: true, message: 'Imagem anexada.', file }
  }

  removeImage(id: string, file: string): void {
    const d = this.get(id)
    if (!d || !d.images.includes(file)) return
    d.images = d.images.filter((f) => f !== file)
    rmSync(file, { force: true })
    this.persist(d)
  }

  // ---------------------------------------------------------------- estimado × real

  timings(now = Date.now()): DemandTiming[] {
    return this.list.map((d) => demandTiming(d, now))
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
      d[r.sessionField ?? 'sessionId'] = e.sessionId
      return
    }
    if (e.type !== 'exit') return
    this.running.delete(e.runId)
    this.busy.delete(r.demandId)
    if (!d) return this.onChange(this.list, this.busyList(), {})
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
          addDirs: this.extraDirs(d)
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
      this.persist(d)
      return
    }
    if (r.what === 'plan') {
      const phases = ok ? parsePlan(text) : []
      if (phases.length) {
        d.plan = { phases, mode: d.plan?.mode ?? 'manual', running: false, createdAt: Date.now() }
        this.note(d, `Plano por fases pronto: ${phases.length} fase(s), ~${phases.reduce((a, p) => a + p.estPct, 0)}% da janela de 5h no total`)
      } else this.note(d, `Plano por fases ${e.killed ? 'interrompido' : 'falhou'}: a IA não devolveu as fases (veja a aba da demanda nos terminais)`)
      this.persist(d)
      return
    }
    if (r.what === 'dev') {
      this.note(d, e.killed ? 'Claude interrompido' : ok ? 'Claude respondeu' : `Claude falhou (código ${e.code ?? '?'})`)
    } else if (!ok || !text.trim()) {
      this.note(d, `${r.what === 'analysis' ? 'Análise' : 'Desenho'} ${e.killed ? 'interrompido' : 'falhou'}: veja a aba da demanda nos terminais`)
    } else if (r.what === 'analysis') {
      d.analysis = extractResult(text).replace(/^ESTIMATIVA_HORAS:.*$/im, '').trim()
      d.aiHours = extractHours(text)
      if (d.status === 'nova') this.setStatus(d, 'estimada')
      this.note(d, `Análise pronta${d.aiHours ? ` · sugestão: ${hoursLabel(d.aiHours)}` : ''}`)
    } else {
      d.design = extractResult(text)
      d.designApproved = false
      this.note(d, 'Desenho pronto para revisar')
    }
    this.persist(d)
  }
}
