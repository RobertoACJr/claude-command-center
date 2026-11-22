import { useId } from 'react'
import { KNOT_BACK, KNOT_COLORS, KNOT_DIM, KNOT_FRONT, KNOT_FRONT_FULL } from './knotPaths'

/**
 * Logo da Hélice: três "C" entrelaçados (roxo, azul e rosa), o mesmo desenho do ícone.
 * Cada modo acende a sua cor: Online = os três; Ausente = o azul; Vigia = o rosa.
 */
export type HelixTone = 'online' | 'away' | 'vigia'

const LIT: Record<HelixTone, [boolean, boolean, boolean]> = {
  online: [true, true, true],
  away: [false, true, false],
  vigia: [false, false, true]
}

export function HelixLogo({ size = 36, tone = 'online', spin = false }: { size?: number; tone?: HelixTone; spin?: boolean }) {
  const mask = 'helix-' + useId().replace(/:/g, '')
  const color = (i: number) => (LIT[tone][i] ? KNOT_COLORS[i] : KNOT_DIM[i])
  const piece = ([c, d]: [number, string], k: number) => (
    <path key={k} d={d} fill="none" stroke={color(c)} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
  )
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Hélice">
      <rect x="2" y="2" width="116" height="116" rx="27" fill="#14111f" />
      <g
        className={spin ? 'origin-center animate-[spin_2.4s_linear_infinite]' : ''}
        style={{ transformBox: 'view-box', transformOrigin: '60px 60px' }}
      >
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <rect width="120" height="120" fill="#fff" />
          {KNOT_FRONT_FULL.map((d, k) => (
            <path key={k} d={d} fill="none" stroke="#000" strokeWidth={17} />
          ))}
        </mask>
        <g mask={`url(#${mask})`}>{KNOT_BACK.map(piece)}</g>
        {KNOT_FRONT.map(piece)}
      </g>
    </svg>
  )
}
