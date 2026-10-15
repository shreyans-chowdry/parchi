"""App screenshots for the Devpost gallery (3:2, 2250x1500)."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from shoot import open_app

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
W, H, S = 1500, 1000, 1.5

with sync_playwright() as p:
    b, page, errors = open_app(p, width=W, height=H, scale=S)
    def pick(name):
        page.locator('.msg', has_text=name).first.click(); page.wait_for_timeout(2700)
    def shot(n): page.screenshot(path=str(out / n)); print('saved', n)
    # 1 Hinglish order read, hover the gift wrap line
    page.locator('.lines tbody tr').nth(1).hover(); page.wait_for_timeout(300)
    shot('02-spanish-order.png')
    pick('Al Noor Hardware'); page.mouse.move(5, 5); shot('03-voice-note.png')
    pick('Okafor Stationers'); page.mouse.move(5, 5); shot('04-handwritten-slip.png')
    # ambiguous order typed in
    page.locator('.tries button', has_text='Ambiguous').click()
    page.get_by_role('button', name='Read order').click(); page.wait_for_timeout(2700)
    page.locator('.pick').first.click(); page.wait_for_timeout(400)
    shot('05-check-a-line.png')
    page.keyboard.press('Escape')
    # Devanagari, inter-state
    pick('Al Amal'); page.mouse.move(5, 5); shot('06-arabic-export.png')
    pick('Bebê'); page.mouse.move(5, 5); shot('13-portuguese.png')
    pick('Maison du Cadeau'); page.mouse.move(5, 5); shot('14-french-repeat.png')
    pick('Papelería')
    page.get_by_role('button', name='Confirm and bill').click(); page.wait_for_timeout(1200)
    page.evaluate("document.querySelector('.billpane').scrollIntoView({block:'start'})"); page.wait_for_timeout(300)
    page.evaluate("window.scrollBy(0, -80)"); page.mouse.move(5, 5); page.wait_for_timeout(200)
    shot('07-billed-whatsapp-reply.png')
    for v, n in [('Stock', '08-stock-reorder.png'), ('Week', '09-week.png'), ('Bills', '10-bills.png'), ('Plans', '11-plans.png')]:
        page.locator('.rail button', has_text=v).click(); page.wait_for_timeout(600); shot(n)
    print('errors', errors)
    b.close()
    # dark + mobile pair for a composite
    b, page, errors = open_app(p, width=W, height=H, scale=S, dark=True)
    page.locator('.lines tbody tr').nth(0).hover(); page.wait_for_timeout(300)
    shot('12-dark.png'); b.close()
    b, page, errors = open_app(p, width=390, height=844, scale=3)
    page.locator('.msg', has_text='Al Noor Hardware').first.click(); page.wait_for_timeout(2900)
    page.screenshot(path=str(out / '_mobile-1.png'))
    page.mouse.wheel(0, 520); page.wait_for_timeout(400)
    page.screenshot(path=str(out / '_mobile-2.png'))
    b.close()
