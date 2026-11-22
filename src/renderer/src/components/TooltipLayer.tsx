import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Tooltip do app inteiro: um único listener no documento e um único elemento na tela.
 * Pega qualquer elemento com `title` (ou `data-tip`), troca o `title` por `data-tip`
 * para o balão nativo não aparecer, e mostra o nosso depois de um instante.
 * Nada é criado por botão, então não pesa mesmo com centenas de títulos.
 */
const DELAY = 380

interface Tip {
  text: string
  /** Retângulo do elemento */
  top: number
  bottom: number
  cx: number
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: HTMLElement | null = null

    const hide = () => {
      if (timer) clearTimeout(timer)
      timer = null
      current = null
      setTip(null)
    }
    const owner = (t: EventTarget | null): HTMLElement | null =>
      t instanceof Element ? (t.closest('[title],[data-tip]') as HTMLElement | null) : null

    const over = (e: MouseEvent) => {
      const el = owner(e.target)
      if (el === current) return
      hide()
      if (!el) return
      const native = el.getAttribute('title')
      if (native !== null) {
        if (native) el.setAttribute('data-tip', native)
        el.removeAttribute('title')
      }
      if (!el.getAttribute('data-tip')) return
      current = el
      timer = setTimeout(() => {
        if (!current || !current.isConnected) return
        const text = current.getAttribute('data-tip')
        if (!text) return
        const r = current.getBoundingClientRect()
        setTip({ text, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2 })
      }, DELAY)
    }
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) hide()
    }

    document.addEventListener('mouseover', over, true)
    document.addEventListener('mouseout', out, true)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over, true)
      document.removeEventListener('mouseout', out, true)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Posiciona depois de medir: embaixo do elemento, ou em cima se não couber; nunca sai da janela
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!tip || !box) return
    const w = box.offsetWidth
    const h = box.offsetHeight
    const gap = 6
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.min(Math.max(8, tip.cx - w / 2), vw - w - 8)
    const below = tip.bottom + gap + h <= vh - 8
    const top = below ? tip.bottom + gap : Math.max(8, tip.top - gap - h)
    box.style.left = `${left}px`
    box.style.top = `${top}px`
    box.style.opacity = '1'
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={boxRef}
      role="tooltip"
      data-testid="tooltip"
      style={{ left: 0, top: 0, opacity: 0 }}
      className="pointer-events-none fixed z-[9999] max-w-xs whitespace-pre-line rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] leading-snug text-zinc-200 shadow-2xl transition-opacity duration-100"
    >
      {tip.text}
    </div>
  )
}
