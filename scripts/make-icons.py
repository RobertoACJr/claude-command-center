#!/usr/bin/env python3
"""Gera os ícones da Hélice a partir da arte em build/icon-source.png (1024x1024):
três anéis entrelaçados (azul, roxo, rosa) com o >_ no meio.

- App (.png de vários tamanhos e .ico): a arte com os cantos transparentes.
- Bandeja e logo do app: os anéis são separados do fundo para girar sozinhos,
  e cada modo acende a sua cor: Online = os três; Ausente = o azul; Vigia = o rosa.
Precisa de Pillow e numpy. Uso: python3 scripts/make-icons.py"""
import base64, io, os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'build', 'icon-source.png')
DIM = np.array([113, 113, 122], float)  # cinza para onde vão os anéis apagados
TONES = {'online': ('blue', 'purple', 'pink'), 'away': ('blue',), 'vigia': ('pink',)}

src = np.array(Image.open(SRC).convert('RGB')).astype(float)
lum = src.sum(2)
mx, mn = src.max(2), src.min(2)

# Cantos: a arte vem com preto fora do quadrado arredondado
tile_alpha = np.clip((lum - 12) / 30, 0, 1)

# Anéis: pixels coloridos (o fundo é escuro e quase sem cor)
ring_alpha = np.clip(((mx - mn) - 45) / 45, 0, 1) * np.clip((mx - 60) / 60, 0, 1)
# >_ do meio: pixels claros e sem cor
prompt_alpha = np.clip((mn - 150) / 60, 0, 1) * (ring_alpha < 0.5)

# Matiz de cada pixel para saber de qual anel ele é
r, g, b = src[..., 0], src[..., 1], src[..., 2]
d = np.where(mx - mn == 0, 1, mx - mn)
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
group = np.where((hue >= 195) & (hue < 240), 'blue', np.where((hue >= 240) & (hue < 300), 'purple', 'pink'))


def tone_rgb(tone):
    """Cores dos anéis no modo: os anéis que não são do modo viram cinza"""
    lit = np.isin(group, TONES[tone])
    out = src.copy()
    gray = src.mean(2, keepdims=True) * 0.25 + DIM * 0.75
    out[~lit] = gray[~lit]
    return out


def rgba(rgb, alpha):
    a = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha, 0, 1) * 255]).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')


def data_url(img):
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


# ---- App
app = rgba(src, tile_alpha)
icons = os.path.join(ROOT, 'build', 'icons')
os.makedirs(icons, exist_ok=True)
for s in [16, 32, 48, 64, 128, 256, 512, 1024]:
    app.resize((s, s), Image.LANCZOS).save(os.path.join(icons, f'{s}x{s}.png'))
app.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, 'build', 'icon.png'))
app.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
svg = os.path.join(ROOT, 'build', 'icon.svg')
if os.path.exists(svg):
    os.remove(svg)

# ---- Camadas: fundo (quadrado), anéis (giram) e >_ (fixo)
TILE_RGB = np.array([26, 25, 40], float)
tile = rgba(np.broadcast_to(TILE_RGB, src.shape).copy(), tile_alpha)
prompt = rgba(np.broadcast_to(np.array([244, 244, 245], float), src.shape).copy(), prompt_alpha)
rings = {t: rgba(tone_rgb(t), ring_alpha) for t in TONES}

# Centro do buraco do meio (onde fica o >_): o ponto mais longe de qualquer anel perto do centro.
# Os anéis e o >_ são deslocados para esse ponto ficar no centro do quadrado; assim, ao girar,
# os anéis rodam em volta do >_ (e não em volta do centro da imagem).
ry, rx = np.where(ring_alpha > 0.3)
pts = np.stack([rx, ry], 1)[::7].astype(float)
best = (0, 512, 512)
for yy in range(380, 650, 4):
    for xx in range(380, 650, 4):
        dist = np.hypot(pts[:, 0] - xx, pts[:, 1] - yy).min()
        if dist > best[0]:
            best = (dist, xx, yy)
DX, DY = 512 - best[1], 512 - best[2]


def centered(img):
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (DX, DY))
    return out


rings = {t: centered(im) for t, im in rings.items()}
prompt = centered(prompt)


def tray_frame(tone, angle, size=64):
    base = tile.copy()
    base.alpha_composite(rings[tone].rotate(-angle, resample=Image.BICUBIC))
    base.alpha_composite(prompt)
    return base.resize((size, size), Image.LANCZOS)


ts = ['// Gerado por scripts/make-icons.py: quadros da hélice na bandeja (64px). Não edite à mão.',
      "export type TrayTone = 'online' | 'away' | 'vigia'",
      'export const TRAY_FRAMES: Record<TrayTone, string[]> = {']
for tone in TONES:
    ts.append(f'  {tone}: [')
    ts += [f"    '{data_url(tray_frame(tone, k * 30))}'," for k in range(12)]
    ts.append('  ],')
ts.append('}')
open(os.path.join(ROOT, 'src', 'main', 'trayFrames.ts'), 'w').write('\n'.join(ts) + '\n')

# ---- Logo do app (React): anéis de cada modo, o >_ e o fundo, 144px (nítido em telas 2x)
lg = ['// Gerado por scripts/make-icons.py: camadas do logo da Hélice. Não edite à mão.',
      "export const LOGO_RINGS: Record<'online' | 'away' | 'vigia', string> = {"]
for tone in TONES:
    lg.append(f"  {tone}: '{data_url(rings[tone].resize((144, 144), Image.LANCZOS))}',")
lg.append('}')
lg.append(f"export const LOGO_PROMPT = '{data_url(prompt.resize((144, 144), Image.LANCZOS))}'")
lg.append(f"export const LOGO_TILE = '{data_url(tile.resize((144, 144), Image.LANCZOS))}'")
open(os.path.join(ROOT, 'src', 'renderer', 'src', 'components', 'logoLayers.ts'), 'w').write('\n'.join(lg) + '\n')
old = os.path.join(ROOT, 'src', 'renderer', 'src', 'components', 'knotPaths.ts')
if os.path.exists(old):
    os.remove(old)

# Prévia para conferir
os.makedirs('/tmp/ic', exist_ok=True)
prev = Image.new('RGBA', (256 + 64 * 3 + 30, 256), (240, 240, 240, 255))
prev.alpha_composite(app.resize((256, 256), Image.LANCZOS), (0, 0))
for i, t in enumerate(TONES):
    prev.alpha_composite(tray_frame(t, 0, 64), (276 + i * 64, 20))
    prev.alpha_composite(tray_frame(t, 60, 64), (276 + i * 64, 100))
    prev.alpha_composite(app.resize((32, 32), Image.LANCZOS), (276 + i * 64 + 16, 190))
prev.save('/tmp/ic/preview-final.png')
print('ok', 'centro do buraco', best[1:], 'deslocamento', (DX, DY))
