"""Open the built single-file app in headless Chromium with CDN and Google Fonts served
from local node_modules (the workspace has no open internet), then take screenshots.
Usage: python3 scripts/shoot.py <out_dir> [steps...]"""
import base64, re, sys, os, json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
NM = ROOT / 'node_modules'

def font_css():
    parts = []
    for pkg, weights in [('hind', [400, 500, 600, 700]), ('kalam', [400, 700]), ('rozha-one', [400]), ('noto-sans-arabic', [400, 600])]:
        for w in weights:
            css = (NM / '@fontsource' / pkg / f'{w}.css').read_text()
            def rep(m):
                f = NM / '@fontsource' / pkg / 'files' / m.group(1)
                return "url(data:font/woff2;base64," + base64.b64encode(f.read_bytes()).decode() + ") format('woff2')"
            css = re.sub(r"url\(\./files/([^)]+\.woff2)\) format\('woff2'\), url\(\./files/[^)]+\.woff\) format\('woff'\)", rep, css)
            parts.append(css)
    return '\n'.join(parts)

CDN = {
    'react/18.3.1/umd/react.production.min.js': NM / 'react/umd/react.production.min.js',
    'react-dom/18.3.1/umd/react-dom.production.min.js': NM / 'react-dom/umd/react-dom.production.min.js',
    'html2canvas/1.4.1/html2canvas.min.js': NM / 'html2canvas/dist/html2canvas.min.js',
    'jspdf/2.5.1/jspdf.umd.min.js': NM / 'jspdf/dist/jspdf.umd.min.js',
}

def attach(page):
    fc = font_css()
    def handle(route):
        url = route.request.url
        if 'fonts.googleapis.com' in url:
            return route.fulfill(status=200, content_type='text/css', body=fc)
        for k, f in CDN.items():
            if k in url:
                return route.fulfill(status=200, content_type='application/javascript', body=f.read_text())
        if url.startswith('file://') or url.startswith('data:'):
            return route.continue_()
        return route.abort()
    page.route('**/*', handle)

def open_app(p, width=1440, height=900, dark=False, scale=1, start='demo'):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': width, 'height': height}, device_scale_factor=scale, color_scheme='dark' if dark else 'light')
    page = ctx.new_page()
    attach(page)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.goto('file://' + str(ROOT / 'dist/index.html'))
    page.wait_for_selector('.shell')
    if start == 'demo' and page.locator('.welcome').count():
        page.get_by_role('button', name='Open the demo').click()
    page.wait_for_timeout(2600)
    return b, page, errors

if __name__ == '__main__':
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b, page, errors = open_app(p)
        page.screenshot(path=str(out / 'desk.png'))
        print('errors:', errors)
        b.close()
