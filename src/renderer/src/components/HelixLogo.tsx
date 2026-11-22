import { useEffect, useState } from 'react'
import { LOGO_PROMPT, LOGO_RINGS, LOGO_TILE } from './logoLayers'

/**
 * Logo da Hélice: três anéis entrelaçados (azul, roxo, rosa) com o >_ no meio, a mesma arte do ícone.
 * Cada modo acende a sua cor: Online = os três; Ausente = o azul; Vigia = o rosa.
 * Trabalhando (fila, Vigia, demanda): só os anéis giram; o fundo e o >_ ficam parados.
 * Ao parar, a volta em andamento termina: os anéis param exatamente onde começaram (sem pulo).
 */
export type HelixTone = 'online' | 'away' | 'vigia'

export function HelixLogo({ size = 36, tone = 'online', spin = false }: { size?: number; tone?: HelixTone; spin?: boolean }) {
  // `turning` segue `spin` para ligar, mas só desliga no fim de uma volta completa
  const [turning, setTurning] = useState(spin)
  useEffect(() => {
    if (spin) setTurning(true)
  }, [spin])
  const layer = 'pointer-events-none absolute inset-0 h-full w-full select-none'
  return (
    <span role="img" aria-label="Hélice" className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <img src={LOGO_TILE} alt="" draggable={false} className={layer} />
      <img
        src={LOGO_RINGS[tone]}
        alt=""
        draggable={false}
        className={layer + (turning ? ' animate-[spin_2.4s_linear_infinite]' : '')}
        onAnimationIteration={() => {
          if (!spin) setTurning(false)
        }}
      />
      <img src={LOGO_PROMPT} alt="" draggable={false} className={layer} />
    </span>
  )
}
