#!/usr/bin/env python3
"""Gera os ícones da Hélice (app, Windows .ico, bandeja girando, logo do app) a partir do desenho.
O desenho: três "C" entrelaçados formando um nó de três voltas (roxo, azul e rosa).
Cada modo acende a sua cor: Online = os três; Ausente = o azul; Vigia = o rosa.
Precisa de rsvg-convert e ImageMagick (convert). Uso: python3 scripts/make-icons.py"""
import base64, math, os, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = '#14111f'
PURPLE, BLUE, PINK = '#a78bfa', '#3b82f6', '#f472b6'
COLORS = [PURPLE, BLUE, PINK]
# Opacidade de cada fio por modo (o fio "do modo" fica aceso, os outros apagados)
TONES = {
    'online': [1, 1, 1],
    'away': [0.28, 1, 0.28],
    'vigia': [0.28, 0.28, 1],
}


def knot_pieces(scale=12.0, rot=-90, offset=-0.35, n=720):
    """Nó de trevo dividido em 3 fios (um "C" por cor). Devolve os pedaços do fundo e da frente.
    Cada pedaço: (índice da cor, caminho). A frente também volta inteira para recortar o fundo nos cruzamentos."""
    pts = []
    a = math.radians(rot)
    xs, ys = [], []
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        x = math.sin(t) + 2 * math.sin(2 * t)
        y = math.cos(t) - 2 * math.cos(2 * t)
        z = -math.sin(3 * t)
        xr = x * math.cos(a) - y * math.sin(a)
        yr = x * math.sin(a) + y * math.cos(a)
        xs.append(xr)
        ys.append(yr)
        pts.append([xr, yr, z, t])
    # centraliza pela caixa do desenho
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    for p in pts:
        p[0] = 60 + scale * (p[0] - cx)
        p[1] = 60 + scale * (p[1] - cy)

    def col(t):
        return int(((t + offset) % (2 * math.pi)) / (2 * math.pi / 3)) % 3

    def path(ps):
        return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y, _, _ in ps)

    runs, cur, lay = [], [pts[0]], pts[0][2] >= 0
    for p in pts[1:]:
        cur.append(p)
        if (p[2] >= 0) != lay:
            runs.append((lay, cur))
            cur, lay = [p], p[2] >= 0
    runs.append((lay, cur))

    back, front, front_full = [], [], []
    for is_front, run in runs:
        pieces = []
        piece = [run[0]]
        for p in run[1:]:
            piece.append(p)
            if col(p[3]) != col(piece[0][3]) or p is run[-1]:
                pieces.append((col(piece[min(1, len(piece) - 1)][3]), path(piece)))
                piece = [p]
        (front if is_front else back).extend(pieces)
        if is_front:
            front_full.append(path(run))
    return back, front, front_full


BACK, FRONT, FRONT_FULL = knot_pieces()


def mix(a, b, t):
    """Cor a misturada com b (t = quanto de b)"""
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(ca, cb))


# Fio apagado: cor sólida acinzentada (opacidade deixaria as emendas aparecendo)
DIM = '#71717a'


def knot_svg(tone='online', stroke=9.0, gap=16.0, angle=0, mask_id='m'):
    """Sem fundo: o cruzamento é um recorte (máscara), então funciona em bandeja clara ou escura"""
    op = TONES[tone]
    cols = [COLORS[i] if op[i] == 1 else mix(COLORS[i], DIM, 0.75) for i in range(3)]

    def piece(c, d):
        return (f'<path d="{d}" fill="none" stroke="{cols[c]}" '
                f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>')

    mask = (f'<mask id="{mask_id}" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">'
            '<rect width="120" height="120" fill="#fff"/>'
            + ''.join(f'<path d="{d}" fill="none" stroke="#000" stroke-width="{gap}" stroke-linecap="butt"/>' for d in FRONT_FULL)
            + '</mask>')
    return (f'<g transform="rotate({angle} 60 60)">{mask}'
            f'<g mask="url(#{mask_id})">' + ''.join(piece(c, d) for c, d in BACK) + '</g>'
            + ''.join(piece(c, d) for c, d in FRONT) + '</g>')


def app_svg():
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">'
            f'<rect x="2" y="2" width="116" height="116" rx="27" fill="{BG}"/>'
            '<rect x="2.5" y="2.5" width="115" height="115" rx="26.5" fill="none" stroke="#2a2540" stroke-width="1"/>'
            + knot_svg('online', 9.5, 16) + '</svg>')


def tray_svg(tone, angle):
    # Sem fundo; maior e com traço mais grosso para ler bem em 16-22px
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">'
            '<g transform="translate(60 60) scale(1.22) translate(-60 -60)">'
            + knot_svg(tone, 13, 21, angle) + '</g></svg>')


def render(svg, size, out):
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False) as f:
        f.write(svg)
    subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), f.name, '-o', out], check=True)
    os.unlink(f.name)


icons = os.path.join(ROOT, 'build', 'icons')
os.makedirs(icons, exist_ok=True)
open(os.path.join(ROOT, 'build', 'icon.svg'), 'w').write(app_svg())
for s in [16, 32, 48, 64, 128, 256, 512, 1024]:
    render(app_svg(), s, os.path.join(icons, f'{s}x{s}.png'))
render(app_svg(), 512, os.path.join(ROOT, 'build', 'icon.png'))
subprocess.run(['convert'] + [os.path.join(icons, f'{s}x{s}.png') for s in [16, 32, 48, 64, 128, 256]]
               + [os.path.join(ROOT, 'build', 'icon.ico')], check=True)

# Bandeja: 12 quadros por modo (gira 30° por quadro), embutidos como data URL
frames = {k: [] for k in TONES}
tmp = tempfile.mkdtemp()
for tone in TONES:
    for k in range(12):
        out = os.path.join(tmp, f'{tone}{k}.png')
        render(tray_svg(tone, k * 30), 64, out)
        frames[tone].append('data:image/png;base64,' + base64.b64encode(open(out, 'rb').read()).decode())
ts = ['// Gerado por scripts/make-icons.py: quadros da hélice na bandeja (64px). Não edite à mão.',
      "export type TrayTone = 'online' | 'away' | 'vigia'",
      'export const TRAY_FRAMES: Record<TrayTone, string[]> = {']
for tone in TONES:
    ts.append(f'  {tone}: [')
    ts += [f"    '{u}'," for u in frames[tone]]
    ts.append('  ],')
ts.append('}')
open(os.path.join(ROOT, 'src', 'main', 'trayFrames.ts'), 'w').write('\n'.join(ts) + '\n')

# Logo do app (React): os mesmos pedaços do nó
lg = ['// Gerado por scripts/make-icons.py: pedaços do nó da Hélice. Não edite à mão.',
      f"export const KNOT_COLORS = ['{PURPLE}', '{BLUE}', '{PINK}'] as const",
      "export const KNOT_DIM = [" + ', '.join(f"'{mix(c, DIM, 0.75)}'" for c in COLORS) + '] as const',
      'export const KNOT_BACK: Array<[number, string]> = [']
lg += [f"  [{c}, '{d}']," for c, d in BACK]
lg += [']', 'export const KNOT_FRONT: Array<[number, string]> = [']
lg += [f"  [{c}, '{d}']," for c, d in FRONT]
lg += [']', 'export const KNOT_FRONT_FULL: string[] = [']
lg += [f"  '{d}'," for d in FRONT_FULL]
lg += [']']
open(os.path.join(ROOT, 'src', 'renderer', 'src', 'components', 'knotPaths.ts'), 'w').write('\n'.join(lg) + '\n')

# Prévia para conferir: app grande, app 32px e a bandeja nos três modos (fundo claro e escuro)
render(app_svg(), 256, os.path.join(tmp, 'p-app.png'))
render(app_svg(), 32, os.path.join(tmp, 'p-32.png'))
for tone in TONES:
    render(tray_svg(tone, 0), 96, os.path.join(tmp, f'p-{tone}.png'))
print('ok', tmp)
