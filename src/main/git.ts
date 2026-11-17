import { execFile } from 'child_process'
import { existsSync } from 'fs'

/** Branch atual via `git rev-parse --abbrev-ref HEAD`. Retorna null se não for repo git. */
export function getGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!cwd || !existsSync(cwd)) return resolve(null)
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null)
        const branch = stdout.toString().trim()
        resolve(branch === 'HEAD' ? '(detached)' : branch || null)
      }
    )
  })
}
