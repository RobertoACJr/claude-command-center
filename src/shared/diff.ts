// Diff unificado → linhas numeradas (usado na tela de mudanças)
export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  text: string
  oldNo: number | null
  newNo: number | null
}

/** Diff unificado → linhas com numeração (antes/depois) */
export function parseUnified(text: string): DiffLine[] {
  const out: DiffLine[] = []
  let o = 0
  let n = 0
  let inHunk = false
  for (const line of text.replace(/\n$/, '').split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (h) {
      o = Number(h[1])
      n = Number(h[2])
      inHunk = true
      out.push({ kind: 'hunk', text: line, oldNo: null, newNo: null })
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) out.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: n++ })
    else if (line.startsWith('-')) out.push({ kind: 'del', text: line.slice(1), oldNo: o++, newNo: null })
    else if (line.startsWith('\\')) out.push({ kind: 'meta', text: line, oldNo: null, newNo: null })
    else if (line.startsWith('diff --git')) inHunk = false
    else out.push({ kind: 'ctx', text: line.slice(1), oldNo: o++, newNo: n++ })
  }
  return out
}
