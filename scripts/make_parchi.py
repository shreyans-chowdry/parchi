# Renders the sample "photo of a handwritten parchi" used in the demo inbox.
import random, math, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(7)
FD = sys.argv[1]
W, H = 900, 1180
paper = Image.new('RGB', (W, H), (246, 242, 226))
d = ImageDraw.Draw(paper)
# paper grain
for _ in range(9000):
    x, y = random.randrange(W), random.randrange(H)
    c = random.randint(228, 246)
    d.point((x, y), fill=(c, c - 3, c - 16))
# printed pad header
hdr = ImageFont.truetype(FD + '/kalam-bold.ttf', 30)
d.rectangle((0, 0, W, 118), fill=(240, 232, 214))
d.text((48, 26), 'OKAFOR STATIONERS', font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 40), fill=(150, 38, 44))
d.text((50, 78), 'Balogun Market, Lagos   •   Order slip', font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20), fill=(150, 38, 44))
# ruled lines
for i in range(0, 12):
    y = 190 + i * 82
    d.line((0, y, W, y), fill=(170, 196, 214), width=2)
d.line((92, 118, 92, H), fill=(214, 120, 120), width=2)
ink = (34, 52, 140)
hand = ImageFont.truetype(FD + '/kalam.ttf', 50)
handb = ImageFont.truetype(FD + '/kalam-bold.ttf', 44)
d.text((640, 128), '15/10', font=handb, fill=ink)
lines = ['Stapler No.10 - 2 box', 'Cello tape - 3 dz', 'Gel pen - 100', 'Geometry box - 12', 'Sharpner - 5 box']
for i, line in enumerate(lines):
    x = 118 + random.randint(-6, 10)
    y = 190 + (i + 1) * 82 - 66
    for word in line.split(' '):
        layer = Image.new('RGBA', (420, 120), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.text((10, 20), word, font=hand, fill=ink + (235,))
        layer = layer.rotate(random.uniform(-3, 3), resample=Image.BICUBIC)
        paper.paste(layer, (x - 10, y - 20 + random.randint(-4, 4)), layer)
        x += int(d.textlength(word, font=hand)) + 18 + random.randint(-3, 5)
# tick marks and a scribble
d.text((690, 190 + 3 * 82 - 66), '✓', font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 44), fill=ink)
d.text((118, 190 + 7 * 82 - 66), '- Chidi', font=hand, fill=ink)
paper = paper.filter(ImageFilter.GaussianBlur(0.6))
# torn bottom edge
mask = Image.new('L', (W, H), 255)
md = ImageDraw.Draw(mask)
pts = [(0, H)] + [(x, H - 30 + random.randint(-12, 12)) for x in range(0, W + 30, 30)] + [(W, H)]
md.polygon(pts, fill=0)
# background: counter laminate
BW, BH = 1200, 1500
bg = Image.new('RGB', (BW, BH), (120, 94, 70))
bd = ImageDraw.Draw(bg)
for y in range(0, BH, 3):
    c = 110 + int(14 * math.sin(y / 23.0) + 8 * math.sin(y / 7.0)) + random.randint(-4, 4)
    bd.line((0, y, BW, y + random.randint(-2, 2)), fill=(c, int(c * 0.78), int(c * 0.58)))
bg = bg.filter(ImageFilter.GaussianBlur(1.2))
rgba = paper.convert('RGBA'); rgba.putalpha(mask)
rot = rgba.rotate(-4.5, resample=Image.BICUBIC, expand=True)
shadow = Image.new('RGBA', rot.size, (0, 0, 0, 0))
shadow.paste((0, 0, 0, 120), (0, 0), rot.split()[3])
shadow = shadow.filter(ImageFilter.GaussianBlur(18))
ox, oy = (BW - rot.width) // 2, (BH - rot.height) // 2
bg.paste(shadow, (ox + 18, oy + 26), shadow)
bg.paste(rot, (ox, oy), rot)
# light falloff
vig = Image.new('L', (BW, BH), 0)
vd = ImageDraw.Draw(vig)
for r in range(0, 700, 6):
    vd.ellipse((BW / 2 - 900 + r, BH / 2 - 1000 + r, BW / 2 + 900 - r, BH / 2 + 1000 - r), fill=int(r / 700 * 70))
dark = Image.new('RGB', (BW, BH), (20, 14, 10))
bg = Image.composite(bg, dark, vig.point(lambda v: 185 + v))
bg = bg.resize((720, 900), Image.LANCZOS)
bg.save(sys.argv[2], quality=74, optimize=True)
print('saved', bg.size)
