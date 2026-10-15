import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from shoot import open_app

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
which = sys.argv[2:] or ['all']
def want(n): return 'all' in which or n in which

with sync_playwright() as p:
    b, page, errors = open_app(p)
    if want('desk'): page.screenshot(path=str(out / '01-desk.png'))
    def pick(name):
        page.locator('.msg', has_text=name).first.click(); page.wait_for_timeout(2700)
    if want('voice'): pick('Al Noor Hardware'); page.screenshot(path=str(out / '02-voice.png'))
    if want('photo'): pick('Okafor Stationers'); page.screenshot(path=str(out / '03-photo.png'))
    if want('typos'): pick('Kariuki'); page.screenshot(path=str(out / '04-typos.png'))
    if want('devanagari'): pick('Al Amal'); page.screenshot(path=str(out / '05-devanagari.png'))
    if want('confirm'):
        pick('Papelería')
        page.get_by_role('button', name='Confirm and bill').click(); page.wait_for_timeout(900)
        page.screenshot(path=str(out / '06-billed.png'))
    if want('ambiguous'):
        page.get_by_role('button', name='Ambiguous').click()
        page.get_by_role('button', name='Read order').click(); page.wait_for_timeout(2700)
        page.screenshot(path=str(out / '07-ambiguous.png'))
        page.locator('.pick').first.click(); page.wait_for_timeout(300)
        page.screenshot(path=str(out / '08-picker.png'))
        page.keyboard.press('Escape')
    for v, n in [('Bills', '09-bills'), ('Stock', '10-stock'), ('Week', '11-week'), ('Plans', '12-plans')]:
        if want(n[3:]) or want('views'):
            page.locator('.rail button', has_text=v).click(); page.wait_for_timeout(500)
            page.screenshot(path=str(out / f'{n}.png'), full_page=False)
    print('errors:', errors)
    b.close()
    if want('mobile'):
        b, page, errors = open_app(p, width=390, height=844, scale=2)
        page.screenshot(path=str(out / '13-mobile.png'), full_page=False)
        page.mouse.wheel(0, 700); page.wait_for_timeout(300)
        page.screenshot(path=str(out / '14-mobile-2.png'), full_page=False)
        print('mobile errors:', errors, page.evaluate('document.documentElement.scrollWidth'), page.evaluate('document.querySelector(".main").scrollWidth'))
        b.close()
    if want('dark'):
        b, page, errors = open_app(p, dark=True)
        page.screenshot(path=str(out / '15-dark.png'))
        b.close()
