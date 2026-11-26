import { useEffect, useState } from 'react'
import { LOGO_PROMPT, LOGO_RINGS, LOGO_TILE } from './logoLayers'

/**
 * Logo da Hélice: três anéis entrelaçados (azul, roxo, lavanda) com o >_ no meio, a mesma arte do ícone.
 * Cada modo acende a sua cor: Online = os três; Ausente = o azul; Vigia = o lavanda.
 * Trabalhando (fila, Vigia, demanda): só os anéis giram; o fundo e o >_ ficam parados.
 * Ao parar, a volta em andamento termina: os anéis param exatamente onde começaram (sem pulo).
 */
export type HelixTone = 'online' | 'away' | 'vigia'

export function HelixLogo({
  size = 36,
  tone = 'online',
  spin = false,
  hover: outerHover
}: {
  size?: number
  tone?: HelixTone
  spin?: boolean
  /** Hover controlado por fora (ex: o mouse no nome ao lado também gira) */
  hover?: boolean
}) {
  // Gira trabalhando (`spin`) ou com o mouse em cima; ao parar, termina a volta (para na mesma posição)
  const [ownHover, setHover] = useState(false)
  const hover = outerHover ?? ownHover
  const want = spin || hover
  const [turning, setTurning] = useState(spin)
  // Só do mouse: volta mais rápida. A velocidade é escolhida ao começar, para não dar tranco no meio.
  const [fast, setFast] = useState(false)
  useEffect(() => {
    if (want && !turning) {
      setFast(!spin)
      setTurning(true)
    }
  }, [want, turning, spin])
  const layer = 'pointer-events-none absolute inset-0 h-full w-full select-none'
  return (
    <span
      role="img"
      aria-label="Hélice"
      className={'relative inline-block shrink-0 transition-transform duration-300' + (hover ? ' scale-105' : '')}
      style={{ width: size, height: size }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <img src={LOGO_TILE} alt="" draggable={false} className={layer} />
      <img
        src={LOGO_RINGS[tone]}
        alt=""
        draggable={false}
        className={layer + (turning ? (fast ? ' animate-[spin_1.2s_ease-in-out_infinite]' : ' animate-[spin_2.4s_linear_infinite]') : '')}
        onAnimationIteration={() => {
          if (!want) setTurning(false)
          else if (fast && spin) setFast(false)
        }}
      />
      <img src={LOGO_PROMPT} alt="" draggable={false} className={layer} />
    </span>
  )
}
