/**
 * Comandos que apagam dados ou derrubam coisas sem volta. O app pede confirmação antes de rodar
 * (scripts, atalhos do Docker, comando avulso, console e Telegram).
 */
const RULES: Array<[RegExp, string]> = [
  [/\brm\s+(-\w*[rf]\w*\s+)+/i, 'apaga arquivos (rm -rf)'],
  [/\bRemove-Item\b[^\n]*-Recurse/i, 'apaga pastas (Remove-Item -Recurse)'],
  [/\b(migrate:fresh|migrate:reset|db:wipe|migrate:refresh)\b/i, 'apaga e recria o banco (Laravel)'],
  [/\b(prisma\s+migrate\s+reset|sequelize\s+db:drop|typeorm\s+schema:drop)\b/i, 'apaga o banco'],
  [/\bdrop\s+(database|schema|table)\b/i, 'apaga dados do banco (DROP)'],
  [/\btruncate\s+(table\s+)?\w+/i, 'esvazia uma tabela (TRUNCATE)'],
  [/\bdelete\s+from\s+\w+\s*(;|$)/im, 'apaga todas as linhas de uma tabela (DELETE sem WHERE)'],
  [/\bdocker(-|\s+)compose\b[^\n]*\bdown\b[^\n]*(-v\b|--volumes)/i, 'remove os containers e os volumes (dados do banco)'],
  [/\bdocker\s+(system|volume|image|container)\s+prune\b/i, 'limpa recursos do Docker'],
  [/\bdocker\s+volume\s+rm\b/i, 'apaga volumes do Docker'],
  [/\bgit\s+push\b[^\n]*(\s-f\b|--force)/i, 'força o push (pode apagar commits no remoto)'],
  [/\bgit\s+reset\s+--hard\b/i, 'descarta alterações (git reset --hard)'],
  [/\bgit\s+clean\s+-\w*[fdx]/i, 'apaga arquivos não versionados (git clean)'],
  [/\bgit\s+branch\s+-D\b/i, 'apaga uma branch sem conferir'],
  [/\bmkfs\b|\bdd\s+if=/i, 'escreve direto no disco'],
  [/\b(shutdown|reboot)\b/i, 'desliga ou reinicia o PC']
]

/** Motivos pelos quais o comando é perigoso (vazio = tranquilo) */
export function dangerReasons(command: string): string[] {
  const out: string[] = []
  for (const [re, why] of RULES) if (re.test(command) && !out.includes(why)) out.push(why)
  return out
}

export function isDangerous(command: string): boolean {
  return dangerReasons(command).length > 0
}

/** Texto da pergunta de confirmação */
export function dangerQuestion(command: string, where = ''): string {
  const why = dangerReasons(command)
  return `Este comando parece perigoso${where ? ` (${where})` : ''}:\n\n${command.trim().slice(0, 400)}\n\n${why.map((w) => `• ${w}`).join('\n')}\n\nRodar mesmo assim?`
}
