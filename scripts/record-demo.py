"""Record a captioned 1920x1080 product demo with a visible cursor.
Frames come from the Chrome DevTools screencast (sharper than Playwright's built-in
recorder); scripts/make-video.sh turns them into an MP4.
Usage: python3 scripts/record-demo.py <frames_dir>"""
import asyncio, base64, json, os, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from shoot import font_css, CDN  # noqa: E402

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob('*.jpg'): f.unlink()

OVERLAY = r"""
(() => {
  const c = document.createElement('div');
  c.id = '__cursor';
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L16 20l-3 1.4-3.5-7.4L4 18z" fill="#1c2133" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, {position:'fixed', left:'0', top:'0', zIndex: 99999, pointerEvents:'none', transform:'translate(-200px,-200px)', transition:'none'});
  const ring = document.createElement('div');
  Object.assign(ring.style, {position:'fixed', width:'34px', height:'34px', borderRadius:'50%', border:'3px solid #9b1c2c', zIndex:99998, pointerEvents:'none', opacity:'0', transform:'translate(-200px,-200px)'});
  const cap = document.createElement('div');
  cap.id = '__caption';
  Object.assign(cap.style, {position:'fixed', left:'50%', bottom:'28px', transform:'translateX(-50%)', zIndex:99997, background:'rgba(22,26,42,.92)', color:'#fff',
    font:'500 21px Hind, system-ui, sans-serif', padding:'12px 22px 10px', borderRadius:'12px', maxWidth:'1100px', textAlign:'center', lineHeight:'1.35',
    boxShadow:'0 10px 30px -10px rgba(0,0,0,.5)', transition:'opacity .25s ease', opacity:'0', pointerEvents:'none'});
  const add = () => { document.body.appendChild(c); document.body.appendChild(ring); document.body.appendChild(cap); };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  addEventListener('mousemove', e => { c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`; }, true);
  addEventListener('mousedown', e => {
    ring.style.transform = `translate(${e.clientX - 17}px, ${e.clientY - 17}px) scale(.6)`; ring.style.opacity = '1';
    ring.animate([{transform: ring.style.transform, opacity: 1}, {transform: `translate(${e.clientX - 17}px, ${e.clientY - 17}px) scale(1.4)`, opacity: 0}], {duration: 450});
    setTimeout(() => ring.style.opacity = '0', 440);
  }, true);
  window.__caption = (t) => { if (!t) { cap.style.opacity = '0'; return; } cap.textContent = t; cap.style.opacity = '1'; };
})();
"""


async def main():
    fc = font_css()
    frames = []
    caps_log = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1600, 'height': 900}, device_scale_factor=1.2)
        page = await ctx.new_page()

        async def handle(route):
            url = route.request.url
            if 'fonts.googleapis.com' in url:
                return await route.fulfill(status=200, content_type='text/css', body=fc)
            for k, f in CDN.items():
                if k in url:
                    return await route.fulfill(status=200, content_type='application/javascript', body=f.read_text())
            if url.startswith('file://') or url.startswith('data:'):
                return await route.continue_()
            return await route.abort()
        await page.route('**/*', handle)
        await page.add_init_script(OVERLAY)

        cdp = await ctx.new_cdp_session(page)
        idx = 0

        def on_frame(ev):
            nonlocal idx
            path = OUT / f'f{idx:05d}.jpg'
            path.write_bytes(base64.b64decode(ev['data']))
            frames.append((path.name, ev['metadata']['timestamp']))
            idx += 1
            asyncio.ensure_future(cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']}))
        cdp.on('Page.screencastFrame', on_frame)

        await page.goto('file://' + str(ROOT / 'dist/index.html'))
        await page.wait_for_selector('.shell')
        await page.wait_for_timeout(1500)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 90, 'maxWidth': 1920, 'maxHeight': 1080, 'everyNthFrame': 1})

        mouse = {'x': 800, 'y': 450}

        async def move_to(loc_or_xy, steps=28):
            if isinstance(loc_or_xy, tuple):
                x, y = loc_or_xy
            else:
                await loc_or_xy.scroll_into_view_if_needed()
                bb = await loc_or_xy.bounding_box()
                x, y = bb['x'] + min(bb['width'] / 2, 60), bb['y'] + bb['height'] / 2
            await page.mouse.move(x, y, steps=steps)
            mouse.update(x=x, y=y)

        async def click(loc, steps=28):
            await move_to(loc, steps)
            await page.wait_for_timeout(180)
            await page.mouse.down(); await page.mouse.up()

        async def cap(t, ms=0):
            if not os.environ.get('NOCAP'):
                await page.evaluate('t => window.__caption(t)', t)
            caps_log.append((t, time.time()))
            if ms: await page.wait_for_timeout(ms)

        async def main_scroll(y):
            await page.evaluate("y => document.querySelector('.main').scrollTo({top: y, behavior: 'smooth'})", y)
            await page.wait_for_timeout(700)

        # 1. the Hinglish order
        await page.mouse.move(800, 450)
        await cap('A Spanish WhatsApp order, already read: quantities, items, sizes and the deadline', 900)
        rows = page.locator('.lines tbody tr')
        for i in range(4):
            await move_to(rows.nth(i).locator('.asked'), 22)
            await page.wait_for_timeout(1300)
        await cap('Each line is matched to a product with a confidence score. Gift wrap is short, so it can be backordered', 0)
        await move_to(page.locator('.callout.warn'), 30)
        await page.wait_for_timeout(2600)
        await cap('The invoice builds itself: trade discount, tax by item rate, amount in words', 0)
        await move_to(page.locator('.bill .grand'), 30)
        await page.wait_for_timeout(2800)

        # 2. voice note
        await click(page.locator('.msg', has_text='Al Noor Hardware'))
        await cap('A voice note in Hindi trade slang: pechkas = screwdriver, plaas = pliers, taala = padlock', 0)
        await page.wait_for_timeout(1200)
        for i in range(4):
            await move_to(page.locator('.lines tbody tr').nth(i).locator('.pick'), 18)
            await page.wait_for_timeout(700)
        await page.wait_for_timeout(1000)

        # 3. photo of a handwritten slip
        await click(page.locator('.msg', has_text='Okafor Stationers'))
        await cap('A photo of a handwritten slip. Claude transcribes it, the rules engine reads it', 0)
        await move_to(page.locator('.media img'), 30)
        await page.wait_for_timeout(2600)
        await move_to(page.locator('.slip'), 30)
        await page.wait_for_timeout(2000)

        # 4. Devanagari, inter-state
        await click(page.locator('.msg', has_text='Al Amal'))
        await cap('Arabic with Arabic numerals: 2 cartons = 100 bulbs, 5 boxes = 50 packs, and the export is zero-rated', 0)
        await page.wait_for_timeout(1400)
        await move_to(page.locator('.lines tbody tr').nth(0).locator('.note').first, 26)
        await page.wait_for_timeout(1600)
        await move_to(page.locator('.bill .parties'), 30)
        await page.wait_for_timeout(2400)

        # 5. a new messy order typed in
        await main_scroll(0)
        await cap('Typos and ambiguity: Parchi asks instead of guessing', 0)
        await click(page.locator('#new-order'))
        await page.keyboard.type('pls send 2 doz umbrela, 1 gross ball pen blak, Steplar 10', delay=38)
        await page.wait_for_timeout(300)
        await move_to(page.locator('#new-party'), 20)
        await page.select_option('#new-party', 'P04')
        await page.wait_for_timeout(500)
        await click(page.get_by_role('button', name='Read order'))
        await page.wait_for_timeout(2600)
        review = page.locator('.lines tbody tr.review .pick').first
        await move_to(review, 26)
        await page.wait_for_timeout(1100)
        await cap('“Steplar 10” could be either stapler. One click settles it', 0)
        await click(review, 8)
        await page.wait_for_timeout(1300)
        await click(page.locator('.popover li button', has_text='Heavy stapler 24/6'))
        await page.wait_for_timeout(1500)

        # 6. confirm the first order
        await click(page.locator('.msg', has_text='Papelería'))
        await page.wait_for_timeout(1000)
        btn = page.get_by_role('button', name='Confirm and bill')
        await cap('Confirm: the bill is stamped, stock drops, the shortfall goes on backorder', 0)
        await click(btn)
        await page.wait_for_timeout(2600)
        await cap('…and the reply is ready in the customer’s own language', 0)
        await move_to(page.locator('.reply'), 40)
        await main_scroll(400)
        await page.wait_for_timeout(2600)

        # 7. stock and week
        await click(page.locator('.rail button', has_text='Stock'))
        await cap('Short items go straight onto the list for the next supplier order', 0)
        await page.wait_for_timeout(800)
        await move_to(page.locator('.reorder').first, 30)
        await page.wait_for_timeout(2600)
        await click(page.locator('.rail button', has_text='Week'))
        await cap('And the whole week at a glance: value, channels, languages, time saved', 0)
        await move_to(page.locator('.chart-card').first, 40)
        await page.wait_for_timeout(3200)
        await cap('', 600)

        await cdp.send('Page.stopScreencast')
        await page.wait_for_timeout(300)
        await b.close()

    (OUT / 'frames.json').write_text(json.dumps(frames))
    t0 = frames[0][1]
    (OUT / 'captions.json').write_text(json.dumps([(t, round(ts - t0, 1)) for t, ts in caps_log]))
    for t, ts in caps_log: print(f'{ts - t0:6.1f}s  {t}')
    print('frames', len(frames), 'duration', round(frames[-1][1] - frames[0][1], 1))

asyncio.run(main())
