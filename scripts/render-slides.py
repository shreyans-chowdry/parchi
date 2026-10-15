"""Render each slide to PNG: 1920x1080 for the video, 2250x1500 (3:2) for the gallery."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from shoot import attach

ROOT = Path(__file__).resolve().parent.parent
SLIDES = ['cover', 'problem', 'architecture', 'code-extract', 'code-match', 'code-invoice', 'scale', 'business', 'close']
mode = sys.argv[1]  # video | gallery
out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
only = sys.argv[3:] or SLIDES
size = {'video': (1920, 1080, 1), 'gallery': (1500, 1000, 1.5)}[mode]
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': size[0], 'height': size[1]}, device_scale_factor=size[2])
    page = ctx.new_page(); attach(page)
    for s in only:
        page.goto(f'file://{ROOT}/submission/slides/slides.html#{s}')
        page.wait_for_timeout(700)
        page.screenshot(path=str(out / f'{s}.png'))
        print('rendered', s)
    b.close()
