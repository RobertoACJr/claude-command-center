#!/usr/bin/env python3
"""Gera os ícones da Hélice (app, Windows .ico, bandeja girando) a partir do desenho em SVG.
Precisa de rsvg-convert e ImageMagick (convert). Uso: python3 scripts/make-icons.py"""
import base64, os, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ONLINE = ['#c4b5fd', '#8b5cf6', '#2dd4bf']   # roxo claro, roxo, azul-petróleo
AWAY = ['#99f6e4', '#2dd4bf', '#0f766e']     # tons de azul-petróleo (modo Ausente)
C = 'M74.1 29.9 A20 20 0 1 0 74.1 58.1'       # um "C" acima do centro (60,60), aberto para a direita

def helix(colors, stroke=9, angle=0, scale=1.0):
    parts = []
    for i, col in enumerate(colors):
        parts.append(f'<path d="{C}" transform="rotate({angle + i*120} 60 60)" fill="none" stroke="{col}" '
                     f'stroke-width="{stroke}" stroke-linecap="round"/>')
    g = ''.join(parts)
    if scale != 1.0:
        g = f'<g transform="translate(60 60) scale({scale}) translate(-60 -60)">{g}</g>'
    return g

def app_svg():
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">'
            '<rect x="2" y="2" width="116" height="116" rx="27" fill="#14111f"/>'
            '<rect x="2.5" y="2.5" width="115" height="115" rx="26.5" fill="none" stroke="#2a2540" stroke-width="1"/>'
            + helix(ONLINE, 9, 0, 1.18) + '</svg>')

def tray_svg(colors, angle):
    # Sem fundo; traço mais grosso para ler bem em 16-22px
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' + helix(colors, 13, angle, 1.32) + '</svg>')

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

# Bandeja: 12 quadros por estado (gira 30° por quadro), embutidos como data URL
frames = {'online': [], 'away': []}
tmp = tempfile.mkdtemp()
for state, colors in [('online', ONLINE), ('away', AWAY)]:
    for k in range(12):
        out = os.path.join(tmp, f'{state}{k}.png')
        render(tray_svg(colors, k * 30), 64, out)
        frames[state].append('data:image/png;base64,' + base64.b64encode(open(out, 'rb').read()).decode())
ts = ['// Gerado por scripts/make-icons.py: quadros da hélice na bandeja (64px). Não edite à mão.',
      'export const TRAY_FRAMES: Record<\'online\' | \'away\', string[]> = {']
for state in ['online', 'away']:
    ts.append(f'  {state}: [')
    ts += [f"    '{u}'," for u in frames[state]]
    ts.append('  ],')
ts.append('}')
open(os.path.join(ROOT, 'src', 'main', 'trayFrames.ts'), 'w').write('\n'.join(ts) + '\n')
# Prévia para conferir
render(app_svg(), 256, os.path.join(tmp, 'preview-app.png'))
print('ok', tmp)
