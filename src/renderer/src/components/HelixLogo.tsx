/** Logo da Hélice: três "C" girados 120° (Claude, Código, Comando). Ausente = tons de azul-petróleo. */
const C = 'M74.1 29.9 A20 20 0 1 0 74.1 58.1'

export function HelixLogo({ size = 36, away = false, spin = false }: { size?: number; away?: boolean; spin?: boolean }) {
  const colors = away ? ['#99f6e4', '#2dd4bf', '#0f766e'] : ['#c4b5fd', '#8b5cf6', '#2dd4bf']
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Hélice">
      <rect x="2" y="2" width="116" height="116" rx="27" fill="#14111f" />
      <g
        className={spin ? 'origin-center animate-[spin_2.4s_linear_infinite]' : ''}
        style={{ transformBox: 'view-box', transformOrigin: '60px 60px' }}
      >
        <g transform="translate(60 60) scale(1.18) translate(-60 -60)">
          {colors.map((c, i) => (
            <path key={i} d={C} transform={`rotate(${i * 120} 60 60)`} fill="none" stroke={c} strokeWidth={9} strokeLinecap="round" />
          ))}
        </g>
      </g>
    </svg>
  )
}
