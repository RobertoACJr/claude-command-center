import { renameSync, rmSync, writeFileSync } from 'fs'

/**
 * Grava sem risco de corromper: escreve num arquivo temporário ao lado e troca de nome de uma vez.
 * Se o PC desligar no meio, fica o arquivo antigo inteiro (nunca um pela metade).
 */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
