// Utilidades de texto usadas no app e no processo principal

/** A mensagem parece uma regra do projeto? (para sugerir guardar na memória) */
export function looksLikeRule(text: string): boolean {
  return /(?:^|[\s,.;:!?(])(nunca|sempre|não use|nao use|evite|prefira|aqui (?:a gente|nós|nos|usamos|não|nao)|o padrão (?:é|e|daqui)|use sempre|não pode|nao pode)(?=$|[\s,.;:!?)])/i.test(text)
}
