"""Edit a talking-head recording into the Parchi demo video.

    python3 scripts/edit/edit.py --face me.mp4 --slides <slides_dir> --demo <frames_dir> --out final.mp4 [--transcript t.json]

1. Transcribes the recording with word timestamps (faster-whisper).
2. Finds each script unit by its anchor phrase. When a unit was said more than once,
   the last take is kept and earlier takes are cut.
3. Removes long pauses inside a unit (jump cuts).
4. Composes every frame: you full-screen, or slides/demo full-screen with you in a
   rounded picture-in-picture at the bottom right, with animated morphs between the two,
   punch-in zooms, word-by-word captions, section titles, a lower third, stat stickers,
   chat-bubble pop-ups, a progress bar and an end card.
5. Cleans and levels the voice, adds whoosh/pop sound effects, and encodes 1080p30 H.264.
"""
import argparse, difflib, json, math, os, re, subprocess, sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1920, 1080, 30
SR = 48000
HERE = Path(__file__).resolve().parent
FONTS = Path(os.environ.get('PARCHI_FONTS', '/tmp/claude-0/-home-claude/20c314ee-0d72-54ad-b187-8c2aaefbe143/scratchpad/fonts'))
INTER = '/usr/share/fonts/opentype/inter/'

BRAND = (155, 28, 44)        # ledger red
BRAND_L = (224, 89, 106)
INK = (28, 33, 51)
PAPER = (238, 240, 232)
SLIP = (255, 248, 220)
CARBON = (58, 63, 180)
HILITE = (255, 210, 63)      # caption active word

PIP = 400                    # picture-in-picture size
PIP_M = 36                   # margin
MORPH = 0.5                  # seconds for full <-> pip morph


def font(path, size):
    return ImageFont.truetype(str(path), size)


F_CAP = lambda s: font(INTER + 'Inter-Black.otf', s)
F_BOLD = lambda s: font(INTER + 'Inter-Bold.otf', s)
F_SEMI = lambda s: font(INTER + 'Inter-SemiBold.otf', s)
F_DISP = lambda s: font(FONTS / 'rozha.ttf', s)
F_HAND = lambda s: font(FONTS / 'kalam.ttf', s)
F_AR = lambda s: font(FONTS / 'arabic.ttf', s)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def back_out(x, k=1.70158):
    x = min(1.0, max(0.0, x)) - 1
    return 1 + (k + 1) * x ** 3 + k * x ** 2


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


# ----------------------------------------------------------------------------- transcript

def norm_tokens(word):
    w = word.lower().replace('’', '').replace("'", '').replace('-', ' ')
    return re.findall(r'[a-z0-9]+|[؀-ۿ]+', w)


def transcribe(face, out_json):
    from faster_whisper import WhisperModel
    model = WhisperModel('small.en', device='cpu', compute_type='int8')
    segs, _ = model.transcribe(str(face), word_timestamps=True, beam_size=5, vad_filter=False,
                               initial_prompt='Parchi, wholesalers, QuickBooks, Xero, Claude, Postgres, WhatsApp, pechkas, taala, Steplar, tokenizer.')
    words = []
    for s in segs:
        for w in s.words:
            words.append({'w': w.word.strip(), 's': float(w.start), 'e': float(w.end)})
    Path(out_json).write_text(json.dumps(words, indent=1))
    return words


def tokenize(words):
    toks = []
    for i, w in enumerate(words):
        for t in norm_tokens(w['w']):
            toks.append({'t': t, 'wi': i})
    return toks


def find_occurrences(toks, phrase, thr=0.72):
    a = phrase.split()
    n = len(a)
    hits = []
    for i in range(0, max(0, len(toks) - n + 1)):
        b = [t['t'] for t in toks[i:i + n]]
        r = difflib.SequenceMatcher(None, a, b).ratio()
        if r >= thr:
            hits.append((i, r))
    # keep the best index in each cluster of nearby hits
    out = []
    for i, r in hits:
        if out and i - out[-1][0] <= 3:
            if r > out[-1][1]:
                out[-1] = (i, r)
        else:
            out.append((i, r))
    return [i for i, _ in out]


def best_occurrence(toks, phrase, after):
    a = phrase.split()
    n = len(a)
    best, bi = 0.0, None
    for i in range(after, max(after, len(toks) - n + 1)):
        r = difflib.SequenceMatcher(None, a, [t['t'] for t in toks[i:i + n]]).ratio()
        if r > best:
            best, bi = r, i
    return bi if best >= 0.45 else None


# ----------------------------------------------------------------------------- planning

def plan(words, script, tail=4.0):
    toks = tokenize(words)
    units = []
    for si, sec in enumerate(script['sections']):
        for ui, u in enumerate(sec['units']):
            units.append({'sec': si, 'mode': sec['mode'], 'title': sec['title'] if ui == 0 else None,
                          'anchor': u['anchor'], 'broll': u['broll'], 'first_of_sec': ui == 0})
    occ = [find_occurrences(toks, u['anchor']) for u in units]
    N = len(units)
    pos = 0
    bounds = []
    for k in range(N):
        cands = [c for c in occ[k] if c >= pos]
        if not cands:
            b = best_occurrence(toks, units[k]['anchor'], pos)
            cands = [b] if b is not None else []
        ref = cands[0] if cands else pos
        nxt = None
        for v in range(k + 1, N):
            later = [c for c in occ[v] if c > ref]
            if later:
                nxt = later[0]
                break
        end = nxt if nxt is not None else len(toks)
        start = max([c for c in cands if c < end], default=(cands[0] if cands else pos))
        bounds.append((start, end))
        units[k]['found'] = bool(cands)
        pos = end
    # token ranges -> word index ranges -> kept source intervals (jump-cut long pauses)
    segments = []
    for k, (a, b) in enumerate(bounds):
        if b <= a:
            continue
        wis = sorted({toks[i]['wi'] for i in range(a, b)})
        ws = [words[i] for i in wis]
        cur_s = ws[0]['s'] - 0.12
        for i in range(len(ws)):
            last = i == len(ws) - 1
            if last or ws[i + 1]['s'] - ws[i]['e'] > 0.6:
                segments.append({'src_s': max(0.0, cur_s), 'src_e': ws[i]['e'] + (0.25 if last else 0.15), 'unit': k,
                                 'words': [w for w in ws if cur_s - 0.01 <= w['s'] <= ws[i]['e'] + 0.01]})
                if not last:
                    cur_s = ws[i + 1]['s'] - 0.12
    # make segments non-overlapping and lay out the output timeline
    t = 0.0
    prev_end = -1
    for s in segments:
        s['src_s'] = max(s['src_s'], prev_end)
        prev_end = s['src_e']
        s['out_s'] = t
        t += s['src_e'] - s['src_s']
        s['out_e'] = t
    total = t + tail
    # output-time words
    owords = []
    for s in segments:
        for w in s['words']:
            o = s['out_s'] + (w['s'] - s['src_s'])
            owords.append({'w': w['w'], 's': o, 'e': s['out_s'] + (w['e'] - s['src_s']), 'unit': s['unit']})
    # unit spans in output time
    for k, u in enumerate(units):
        ss = [s for s in segments if s['unit'] == k]
        u['out_s'] = ss[0]['out_s'] if ss else None
        u['out_e'] = ss[-1]['out_e'] if ss else None
    return units, segments, owords, total


# ----------------------------------------------------------------------------- sources

class FaceReader:
    def __init__(self, path):
        probe = run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', 'scale=-2:1080', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'])
        n = len(probe.stdout)
        self.h = 1080
        self.w = n // (3 * 1080)
        self.p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', f'fps={FPS},scale={self.w}:1080', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'],
                                  stdout=subprocess.PIPE)
        self.idx = -1
        self.frame = np.zeros((self.h, self.w, 3), np.uint8)
        self.size = self.w * self.h * 3

    def get(self, t):
        want = int(round(t * FPS))
        while self.idx < want:
            buf = self.p.stdout.read(self.size)
            if len(buf) < self.size:
                break
            self.frame = np.frombuffer(buf, np.uint8).reshape(self.h, self.w, 3)
            self.idx += 1
        return self.frame


def face_box(path, w, h):
    """Median face centre and size from a few frames (falls back to the frame centre)."""
    model = os.environ.get('PARCHI_YUNET', '/tmp/claude-0/-home-claude/20c314ee-0d72-54ad-b187-8c2aaefbe143/scratchpad/models/yunet.onnx')
    dur = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]).stdout or 10)
    cx, cy, sz = [], [], []
    try:
        det = cv2.FaceDetectorYN_create(model, '', (w, h), 0.7)
    except Exception:
        det = None
    for k in range(12):
        if det is None:
            break
        t = dur * (k + 0.5) / 12
        r = run(['ffmpeg', '-v', 'error', '-ss', f'{t:.2f}', '-i', str(path), '-vf', f'scale={w}:{h}', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'])
        if len(r.stdout) != w * h * 3:
            continue
        img = np.frombuffer(r.stdout, np.uint8).reshape(h, w, 3)
        _, faces = det.detect(img)
        if faces is not None and len(faces):
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])[:4]
            cx.append(x + fw / 2); cy.append(y + fh / 2); sz.append(fh)
    if not cx:
        return w / 2, h * 0.42, h * 0.3
    return float(np.median(cx)), float(np.median(cy)), float(np.median(sz))


class Demo:
    def __init__(self, folder):
        self.folder = Path(folder)
        fr = json.loads((self.folder / 'frames.json').read_text())
        t0 = fr[0][1]
        self.names = [n for n, _ in fr]
        self.times = np.array([t - t0 for _, t in fr])
        self.cache = (None, None)

    def at(self, t):
        i = int(np.searchsorted(self.times, t, side='right') - 1)
        i = max(0, min(i, len(self.names) - 1))
        if self.cache[0] != i:
            img = cv2.imread(str(self.folder / self.names[i]))
            if img.shape[1] != W:
                img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
            self.cache = (i, img)
        return self.cache[1]


# ----------------------------------------------------------------------------- drawing helpers

def zoom_img(img, z, cx=0.5, cy=0.5):
    if abs(z - 1) < 1e-3:
        return img
    h, w = img.shape[:2]
    cw, ch = w / z, h / z
    x0 = min(max(cx * w - cw / 2, 0), w - cw)
    y0 = min(max(cy * h - ch / 2, 0), h - ch)
    M = np.float32([[z, 0, -x0 * z], [0, z, -y0 * z]])
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


_mask_cache = {}


def round_mask(w, h, r):
    key = (w, h, int(r))
    if key not in _mask_cache:
        m = np.zeros((h, w), np.uint8)
        r = int(max(0, min(r, w // 2, h // 2)))
        if r == 0:
            m[:] = 255
        else:
            cv2.rectangle(m, (r, 0), (w - r - 1, h - 1), 255, -1)
            cv2.rectangle(m, (0, r), (w - 1, h - r - 1), 255, -1)
            for (x, y) in [(r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)]:
                cv2.circle(m, (x, y), r, 255, -1, lineType=cv2.LINE_AA)
        if len(_mask_cache) > 200:
            _mask_cache.clear()
        _mask_cache[key] = m
    return _mask_cache[key]


def paste(dst, src, x, y, mask=None, alpha=1.0):
    """Alpha-paste src (BGR or BGRA) onto dst at (x, y), clipped."""
    h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    if s.shape[2] == 4:
        a = s[:, :, 3:4].astype(np.float32) / 255.0
        rgb = s[:, :, :3]
    else:
        a = np.ones((y1 - y0, x1 - x0, 1), np.float32)
        rgb = s
    if mask is not None:
        a = a * (mask[y0 - y:y1 - y, x0 - x:x1 - x, None].astype(np.float32) / 255.0)
    if alpha < 1:
        a = a * alpha
    d = dst[y0:y1, x0:x1].astype(np.float32)
    dst[y0:y1, x0:x1] = (d * (1 - a) + rgb.astype(np.float32) * a).astype(np.uint8)


def pil_to_bgra(im):
    a = np.array(im.convert('RGBA'))
    return a[:, :, [2, 1, 0, 3]].copy()


def scaled(bgra, s):
    if abs(s - 1) < 1e-3:
        return bgra
    h, w = bgra.shape[:2]
    return cv2.resize(bgra, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_LINEAR)


_shadow_cache = {}


def shadow_for(w, h, r, blur=28, off=14, strength=110):
    key = (w, h, int(r))
    if key in _shadow_cache:
        return _shadow_cache[key]
    if len(_shadow_cache) > 100:
        _shadow_cache.clear()
    _shadow_cache[key] = _shadow(w, h, r, blur, off, strength)
    return _shadow_cache[key]


def _shadow(w, h, r, blur, off, strength):
    pad = blur * 2
    m = np.zeros((h + pad * 2, w + pad * 2), np.uint8)
    m[pad:pad + h, pad:pad + w] = round_mask(w, h, r)
    m = cv2.GaussianBlur(m, (0, 0), blur)
    out = np.zeros((m.shape[0], m.shape[1], 4), np.uint8)
    out[:, :, 3] = (m.astype(np.float32) * strength / 255).astype(np.uint8)
    return out, pad - off // 2, pad - off


# ----------------------------------------------------------------------------- graphics

class Graphics:
    def __init__(self, script):
        self.script = script
        self.cache = {}

    def get(self, key, fn):
        if key not in self.cache:
            self.cache[key] = fn()
        return self.cache[key]

    def caption(self, words, active, pop):
        def make():
            f = F_CAP(66)
            fa = F_CAP(int(66 * pop))
            space = 20
            sizes = []
            for i, w in enumerate(words):
                ff = fa if i == active else f
                bb = ff.getbbox(w, stroke_width=7)
                sizes.append((bb[2] - bb[0], ff))
            tw = sum(s for s, _ in sizes) + space * (len(words) - 1)
            im = Image.new('RGBA', (tw + 40, 130), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            x = 20
            for i, (w, (sw, ff)) in enumerate(zip(words, sizes)):
                col = HILITE if i == active else (255, 255, 255)
                bb = ff.getbbox(w, stroke_width=7)
                y = 98 - bb[3]
                d.text((x - bb[0], y), w, font=ff, fill=col, stroke_width=7, stroke_fill=(16, 18, 28))
                x += sw + space
            return pil_to_bgra(im)
        return self.get(('cap', tuple(words), active, round(pop, 2)), make)

    def pill(self, text):
        def make():
            f = F_BOLD(34)
            bb = f.getbbox(text)
            w, h = bb[2] - bb[0] + 64, 66
            im = Image.new('RGBA', (w + 8, h + 8), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((0, 0, w, h), radius=33, fill=BRAND + (255,))
            d.ellipse((22, h // 2 - 6, 34, h // 2 + 6), fill=(255, 255, 255, 255))
            d.text((46 - bb[0], (h - (bb[3] - bb[1])) // 2 - bb[1]), text, font=f, fill=(255, 255, 255))
            return pil_to_bgra(im)
        return self.get(('pill', text), make)

    def lower_third(self, name, role):
        def make():
            f1, f2 = F_BOLD(46), F_SEMI(30)
            w = max(f1.getbbox(name)[2], f2.getbbox(role)[2]) + 80
            im = Image.new('RGBA', (w, 150), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((0, 0, w - 1, 149), radius=18, fill=(251, 251, 247, 245))
            d.rectangle((0, 0, 12, 149), fill=BRAND + (255,))
            d.text((40, 24), name, font=f1, fill=INK)
            d.text((40, 88), role, font=f2, fill=BRAND)
            return pil_to_bgra(im)
        return self.get(('lt', name, role), make)

    def stat(self, text, sub):
        def make():
            f1, f2 = F_DISP(96), F_SEMI(30)
            b1, b2 = f1.getbbox(text), f2.getbbox(sub)
            w = max(b1[2] - b1[0], b2[2] - b2[0]) + 90
            h = 210
            im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((0, 0, w - 1, h - 1), radius=26, fill=(251, 251, 247, 250), outline=BRAND + (255,), width=5)
            d.text((45 - b1[0], 26 - b1[1] + 8), text, font=f1, fill=BRAND)
            d.text((45 - b2[0], 150 - b2[1]), sub, font=f2, fill=INK)
            return pil_to_bgra(im)
        return self.get(('stat', text, sub), make)

    def bubble(self, text, rtl=False):
        def make():
            f = F_AR(44) if rtl else F_HAND(44)
            bb = f.getbbox(text)
            w, h = bb[2] - bb[0] + 70, bb[3] - bb[1] + 70
            im = Image.new('RGBA', (w + 30, h + 40), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((0, 0, w, h), radius=28, fill=(220, 248, 198, 255))
            d.polygon([(30, h - 4), (14, h + 26), (64, h - 4)], fill=(220, 248, 198, 255))
            d.text((35 - bb[0], 35 - bb[1]), text, font=f, fill=(20, 30, 20))
            return pil_to_bgra(im)
        return self.get(('bubble', text), make)

    def photo(self, path):
        def make():
            im = Image.open(path).convert('RGBA')
            im.thumbnail((330, 420))
            fr = Image.new('RGBA', (im.width + 24, im.height + 24), (255, 255, 255, 255))
            fr.paste(im, (12, 12))
            return pil_to_bgra(fr.rotate(7, expand=True, resample=Image.BICUBIC))
        return self.get(('photo', str(path)), make)

    def logo(self):
        def make():
            f1, f2 = F_DISP(200), F_BOLD(52)
            t1, t2 = 'Parchi', 'Chat orders in. Invoices out.'
            b1, b2 = f1.getbbox(t1), f2.getbbox(t2)
            w = max(b1[2], b2[2]) + 120
            im = Image.new('RGBA', (w, 420), (0, 0, 0, 0))
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((0, 0, w - 1, 419), radius=40, fill=(251, 251, 247, 245))
            d.line((40, 30, w - 40, 30), fill=BRAND + (255,), width=5)
            d.line((40, 42, w - 40, 42), fill=BRAND + (255,), width=5)
            d.text(((w - (b1[2] - b1[0])) // 2 - b1[0], 70 - b1[1] + 20), t1, font=f1, fill=BRAND)
            d.text(((w - (b2[2] - b2[0])) // 2 - b2[0], 330 - b2[1]), t2, font=f2, fill=INK)
            return pil_to_bgra(im)
        return self.get(('logo',), make)

    def end_card(self, card):
        def make():
            im = Image.new('RGB', (W, H), PAPER)
            d = ImageDraw.Draw(im)
            d.line((0, 10, W, 10), fill=BRAND, width=6)
            d.line((0, 24, W, 24), fill=BRAND, width=6)
            f1, f2, f3 = F_DISP(260), F_BOLD(64), F_SEMI(42)
            for txt, f, y, col in [(card['title'], f1, 250, BRAND), (card['tag'], f2, 600, INK), ('Try it: ' + card['link'], f3, 760, CARBON)]:
                bb = f.getbbox(txt)
                d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], y - bb[1]), txt, font=f, fill=col)
            f4 = F_SEMI(30)
            t = 'Next Founders Hackathon 2026  ·  Shreyans Chowdry'
            bb = f4.getbbox(t)
            d.text(((W - (bb[2] - bb[0])) // 2, 960), t, font=f4, fill=(120, 126, 140))
            return np.array(im)[:, :, ::-1].copy()
        return self.get(('end',), make)


# ----------------------------------------------------------------------------- sound

def sfx_track(total, events):
    n = int(total * SR) + SR
    out = np.zeros(n, np.float32)
    rng = np.random.default_rng(7)
    for kind, t in events:
        i = int(max(0, t) * SR)
        if kind == 'whoosh':
            L = int(0.55 * SR)
            noise = rng.standard_normal(L).astype(np.float32)
            spec = np.fft.rfft(noise)
            fr = np.fft.rfftfreq(L, 1 / SR)
            spec[(fr < 300) | (fr > 6000)] = 0
            x = np.fft.irfft(spec, L).astype(np.float32)
            env = np.sin(np.linspace(0, np.pi, L)) ** 3
            x = x / (np.abs(x).max() + 1e-6) * env * 0.35
        elif kind == 'pop':
            L = int(0.12 * SR)
            tt = np.arange(L) / SR
            f = 900 * np.exp(-tt * 18) + 380
            x = (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 30) * 0.4).astype(np.float32)
        elif kind == 'thump':
            L = int(0.45 * SR)
            tt = np.arange(L) / SR
            x = (np.sin(2 * np.pi * (55 + 60 * np.exp(-tt * 20)) * tt) * np.exp(-tt * 9) * 0.7).astype(np.float32)
        else:
            continue
        j = min(n, i + len(x))
        out[i:j] += x[:j - i]
    return out


def voice_track(face, segments, total):
    raw = run(['ffmpeg', '-v', 'error', '-i', str(face), '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']).stdout
    a = np.frombuffer(raw, np.float32)
    out = np.zeros(int(total * SR) + SR, np.float32)
    fade = int(0.012 * SR)
    for s in segments:
        x = a[int(s['src_s'] * SR):int(s['src_e'] * SR)].copy()
        if len(x) > 2 * fade:
            x[:fade] *= np.linspace(0, 1, fade)
            x[-fade:] *= np.linspace(1, 0, fade)
        i = int(s['out_s'] * SR)
        if i >= len(out):
            continue
        n = min(len(x), len(out) - i)
        out[i:i + n] += x[:n]
    return out


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', str(path)], input=x.astype(np.float32).tobytes())


# ----------------------------------------------------------------------------- main render

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--face', required=True)
    ap.add_argument('--slides', required=True)
    ap.add_argument('--demo', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--transcript')
    ap.add_argument('--work', default='/tmp/claude-0/-home-claude/20c314ee-0d72-54ad-b187-8c2aaefbe143/scratchpad/edit_work')
    ap.add_argument('--slip', default=str(HERE.parent.parent / 'assets' / 'sample-parchi.jpg'))
    ap.add_argument('--limit', type=float, default=0, help='render only the first N seconds (preview)')
    args = ap.parse_args()
    work = Path(args.work); work.mkdir(parents=True, exist_ok=True)
    script = json.loads((HERE / 'script.json').read_text())

    words = json.loads(Path(args.transcript).read_text()) if args.transcript else transcribe(args.face, work / 'transcript.json')
    units, segments, owords, total = plan(words, script)
    missing = [u['anchor'] for u in units if not u['found']]
    print(f'units: {len(units)}  segments: {len(segments)}  output: {total:.1f}s  missing anchors: {missing}')
    (work / 'plan.json').write_text(json.dumps({'units': units, 'segments': [{k: v for k, v in s.items() if k != 'words'} for s in segments]}, indent=1, default=str))
    if args.limit:
        total = min(total, args.limit)

    face = FaceReader(args.face)
    fcx, fcy, fsz = face_box(args.face, face.w, face.h)
    print(f'face: {face.w}x{face.h} centre=({fcx:.0f},{fcy:.0f}) size={fsz:.0f}')
    portrait = face.w / face.h < 1.3
    demo = Demo(args.demo)
    slides = {}
    gfx = Graphics(script)

    def slide(name):
        if name not in slides:
            img = cv2.imread(str(Path(args.slides) / f'{name}.png'))
            slides[name] = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA) if img.shape[1] != W else img
        return slides[name]

    # --- timeline lookups
    used_units = [u for u in units if u['out_s'] is not None]
    unit_starts = [(u['out_s'], i) for i, u in enumerate(units) if u['out_s'] is not None]

    def unit_at(t):
        cur = None
        for s, i in unit_starts:
            if s <= t + 1e-6:
                cur = i
        return cur if cur is not None else unit_starts[0][1]

    def seg_at(t):
        for s in segments:
            if s['out_s'] <= t < s['out_e']:
                return s
        return None

    # section boundaries for morphs / transitions / titles
    boundaries = []   # (t, prev_unit, unit)
    for (s, i), (s0, i0) in zip(unit_starts[1:], unit_starts[:-1]):
        boundaries.append((s, i0, i))

    def mode_val(u):
        return 1.0 if units[u]['mode'] == 'pip' else 0.0

    def layout_m(t):
        u = unit_at(t)
        m = mode_val(u)
        for tb, a, b in boundaries:
            if tb <= t < tb + MORPH and mode_val(a) != mode_val(b):
                return mode_val(a) + (mode_val(b) - mode_val(a)) * ease((t - tb) / MORPH)
        return m

    # jump-cut punch-ins in full mode: toggle zoom at every sentence end and every cut
    zoom_marks = []
    z = 1.0
    for w in owords:
        if units[w['unit']]['mode'] != 'full':
            continue
        if re.search(r'[.?!]$', w['w']):
            zoom_marks.append((w['e'] + 0.05, None))
    for s in segments[1:]:
        if units[s['unit']]['mode'] == 'full':
            zoom_marks.append((s['out_s'], None))
    zoom_marks.sort()
    zlevels = []
    lvl = [1.0, 1.16, 1.06, 1.22]
    for k, (tm, _) in enumerate(zoom_marks):
        zlevels.append((tm, lvl[(k + 1) % len(lvl)]))

    def punch(t):
        zz = 1.0
        for tm, lv in zlevels:
            if tm <= t:
                zz = lv
        return zz

    # captions: chunk words
    chunks = []
    cur = []
    for w in owords:
        if cur and (len(cur) >= 4 or w['s'] - cur[-1]['e'] > 0.35 or re.search(r'[.?!,;:]$', cur[-1]['w'])):
            chunks.append(cur); cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    cap_windows = []
    for k, c in enumerate(chunks):
        end = c[-1]['e'] + 0.2
        if k + 1 < len(chunks):
            end = min(end, chunks[k + 1][0]['s'])
        cap_windows.append((c[0]['s'], end, c))

    # stickers and lower third triggers
    toks_out = []
    for i, w in enumerate(owords):
        for t in norm_tokens(w['w']):
            toks_out.append((t, i))
    tok_text = [t for t, _ in toks_out]

    def phrase_time(ph, sec_id=None):
        a = ph.split()
        for i in range(len(tok_text) - len(a) + 1):
            if tok_text[i:i + len(a)] == a:
                w = owords[toks_out[i][1]]
                if sec_id and script['sections'][units[w['unit']]['sec']]['id'] != sec_id:
                    continue
                return w['s']
        return None

    sticker_events = []
    for st in script['stickers']:
        t0 = None
        for ph in st['on']:
            t0 = phrase_time(' '.join(norm_tokens(ph)), st.get('section'))
            if t0 is not None:
                break
        if t0 is not None:
            sticker_events.append((t0, st))
    lt = script['lower_third']
    lt_t = None
    for ph in lt['on']:
        lt_t = phrase_time(' '.join(norm_tokens(ph)))
        if lt_t is not None:
            break
    hook_end = next((u['out_e'] for u in units if script['sections'][u['sec']]['id'] == 'hook' and u['out_e']), 12)
    logo_t = next((t0 for t0, st in sticker_events if st['kind'] == 'logo'), None)
    bubbles_end = min(hook_end, logo_t) if logo_t else hook_end
    speech_end = segments[-1]['out_e']

    # sound events
    sfx = []
    for tb, a, b in boundaries:
        if units[a]['sec'] != units[b]['sec'] or units[a]['broll'] != units[b]['broll']:
            sfx.append(('whoosh', tb - 0.18))
    for t0, st in sticker_events:
        sfx.append(('thump' if st['kind'] == 'logo' else 'pop', t0))
    sfx.append(('thump', speech_end + 0.1))

    # --- broll frame at time t for unit u
    def broll_frame(u, t):
        b = units[u]['broll']
        if not b:
            return None
        us, ue = units[u]['out_s'], units[u]['out_e']
        p = (t - us) / max(0.01, ue - us)
        if 'slide' in b:
            return zoom_img(slide(b['slide']), 1.0 + 0.05 * min(1, max(0, p)))
        a, e = b['demo']
        return demo.at(a + min(1, max(0, p)) * (e - a))

    # face crops (source pixel rects) and destination rects
    def full_layout():
        if portrait:
            dw = int(H * face.w / face.h)
            return (0, 0, face.w, face.h), ((W - dw) // 2, 0, dw, H)
        sw, sh = face.w, face.h
        cw = min(sw, sh * W / H)
        ch = cw * H / W
        x0 = min(max(fcx - cw / 2, 0), sw - cw)
        y0 = min(max(fcy - ch / 2, 0), sh - ch)
        return (x0, y0, cw, ch), (0, 0, W, H)

    def pip_crop():
        side = min(face.h, face.w, fsz * 2.7)
        x0 = min(max(fcx - side / 2, 0), face.w - side)
        y0 = min(max(fcy - side * 0.45, 0), face.h - side)
        return (x0, y0, side, side)

    FULL_CROP, FULL_DST = full_layout()
    PIP_CROP = pip_crop()
    PIP_DST = (W - PIP_M - PIP, H - PIP_M - PIP, PIP, PIP)
    lerp = lambda a, b, k: tuple(x + (y - x) * k for x, y in zip(a, b))

    enc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                            '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', str(work / 'video.mp4')], stdin=subprocess.PIPE)
    nframes = int(total * FPS)
    end_bg = gfx.end_card(script['end_card'])
    slip_path = Path(args.slip)
    last_face = None

    for fi in range(nframes):
        t = fi / FPS
        frame = np.empty((H, W, 3), np.uint8)
        frame[:] = PAPER[::-1]
        if t >= speech_end:
            # end card
            k = ease((t - speech_end) / 0.6)
            frame = end_bg.copy()
            if last_face is not None and k < 1:
                paste(frame, last_face, 0, 0, alpha=1 - k)
            enc.stdin.write(frame.tobytes())
            continue

        u = unit_at(t)
        seg = seg_at(t)
        src_t = seg['src_s'] + (t - seg['out_s']) if seg else 0
        m = layout_m(t)

        # 1) b-roll layer
        if m > 0:
            br = None
            uu = u
            if units[u]['broll'] is None:
                # morphing out of a pip section into full: keep showing the previous unit's b-roll
                for tb, a, b in boundaries:
                    if b == u and units[a]['broll']:
                        uu = a
                br = broll_frame(uu, min(t, units[uu]['out_e'] - 0.01)) if units[uu]['broll'] else None
            else:
                br = broll_frame(u, t)
                for tb, a, b in boundaries:
                    if b == u and tb <= t < tb + 0.32 and units[a]['broll'] and units[a]['broll'] != units[u]['broll']:
                        q = ease((t - tb) / 0.32)
                        old = zoom_img(broll_frame(a, units[a]['out_e'] - 0.01), 1 + 0.18 * q)
                        new = zoom_img(br, 1.12 - 0.12 * q)
                        br = cv2.addWeighted(old, 1 - q, new, q, 0)
                    elif b == u and tb <= t < tb + MORPH and units[a]['mode'] == 'full':
                        q = ease((t - tb) / MORPH)
                        br = zoom_img(br, 1.15 - 0.15 * q)
            if br is not None:
                if m >= 1:
                    frame = br.copy()
                else:
                    frame = cv2.addWeighted(frame, 1 - m, br, m, 0)

        # 2) face layer
        src = face.get(src_t)
        last_face = None
        zf = punch(t) if m < 1 else 1.0
        fc = FULL_CROP
        if zf > 1:
            cx, cy = fcx, fcy
            cw, ch = fc[2] / zf, fc[3] / zf
            fc = (min(max(cx - cw / 2, fc[0]), fc[0] + fc[2] - cw), min(max(cy - ch * 0.42, fc[1]), fc[1] + fc[3] - ch), cw, ch)
        crop = lerp(fc, PIP_CROP, m)
        dst = lerp(FULL_DST, PIP_DST, m)
        x0, y0, cw, ch = [int(round(v)) for v in crop]
        dx, dy, dw, dh = [int(round(v)) for v in dst]
        piece = src[max(0, y0):y0 + ch, max(0, x0):x0 + cw]
        if piece.size and dw > 0 and dh > 0:
            piece = cv2.resize(piece, (dw, dh), interpolation=cv2.INTER_LINEAR if dw > piece.shape[1] else cv2.INTER_AREA)
            if portrait and m < 1:
                bg = cv2.resize(src, (W, int(W * face.h / face.w)))
                bg = cv2.GaussianBlur(cv2.resize(bg, (W // 8, bg.shape[0] // 8)), (0, 0), 6)
                bg = cv2.resize(bg, (W, H))
                frame = cv2.addWeighted(frame, m, bg, 1 - m, 0)
            r = 44 * m
            if m > 0.02:
                sh, ox, oy = shadow_for(dw, dh, r)
                paste(frame, sh, dx - ox, dy - oy)
                bw = int(round(7 * m))
                if bw:
                    wm = round_mask(dw + 2 * bw, dh + 2 * bw, r + bw)
                    white = np.full((dh + 2 * bw, dw + 2 * bw, 3), 255, np.uint8)
                    paste(frame, white, dx - bw, dy - bw, mask=wm)
                paste(frame, piece, dx, dy, mask=round_mask(dw, dh, r))
            else:
                paste(frame, piece, dx, dy)
        if m < 0.02:
            last_face = frame.copy()

        # 3) hook graphics (full screen only)
        for t0, st in sticker_events:
            if st['kind'] in ('bubble', 'photo') and t0 <= t < bubbles_end + 0.3:
                k = back_out((t - t0) / 0.35)
                out_k = 1 - ease((t - bubbles_end) / 0.3) if t > bubbles_end else 1
                idx = [s for _, s in sticker_events if s['kind'] in ('bubble', 'photo')].index(st)
                g = gfx.bubble(st['text'], st.get('rtl')) if st['kind'] == 'bubble' else gfx.photo(slip_path)
                g = scaled(g, max(0.05, k))
                pos = [(110, 170), (110, 400), (1460, 120)][idx % 3]
                paste(frame, g, pos[0], pos[1], alpha=max(0, min(1, k)) * out_k)
            if st['kind'] == 'logo' and t0 <= t < t0 + 2.6:
                k = back_out((t - t0) / 0.4)
                fade = 1 - ease((t - t0 - 2.2) / 0.4)
                g = scaled(gfx.logo(), 0.55 + 0.45 * max(0, k))
                paste(frame, g, (W - g.shape[1]) // 2, 120, alpha=fade)

        # 4) stat stickers
        for t0, st in sticker_events:
            if st['kind'] == 'stat' and t0 <= t < t0 + 2.4:
                k = back_out((t - t0) / 0.32)
                fade = 1 - ease((t - t0 - 2.0) / 0.4)
                g = scaled(gfx.stat(st['text'], st['sub']), max(0.05, 0.6 + 0.4 * k))
                x = W - 60 - g.shape[1] if m > 0.5 else 80
                y = 70 if m > 0.5 else 300
                paste(frame, g, x, y, alpha=fade * min(1, k))

        # 5) section title pill
        for tb, a, b in boundaries + [(units[unit_starts[0][1]]['out_s'], None, unit_starts[0][1])]:
            title = units[b]['title']
            if title and tb <= t < tb + 2.8:
                k = ease((t - tb - 0.15) / 0.35)
                outk = ease((t - tb - 2.4) / 0.35)
                g = gfx.pill(title)
                x = int(-g.shape[1] + (g.shape[1] + 48) * k - (g.shape[1] + 48) * outk)
                paste(frame, g, x, 46)

        # 6) lower third
        if lt_t is not None and lt_t <= t < lt_t + 4.2:
            k = ease((t - lt_t) / 0.4)
            outk = ease((t - lt_t - 3.8) / 0.4)
            g = gfx.lower_third(lt['name'], lt['role'])
            x = int(-g.shape[1] + (g.shape[1] + 70) * k - (g.shape[1] + 70) * outk)
            paste(frame, g, x, H - 360)

        # 7) captions
        for cs, ce, c in cap_windows:
            if cs <= t < ce:
                act = max([i for i, w in enumerate(c) if w['s'] <= t] or [0])
                since = t - c[act]['s']
                pop = 1.0 + 0.12 * (1 - ease(since / 0.14))
                g = gfx.caption([w['w'] for w in c], act, round(pop * 25) / 25)
                maxw = 1180 if m > 0.5 else 1500
                if g.shape[1] > maxw:
                    g = scaled(g, maxw / g.shape[1])
                cx = (W - PIP - PIP_M * 2) / 2 * m + (W / 2) * (1 - m)
                y = H - 70 - g.shape[0] if m > 0.5 else H - 110 - g.shape[0]
                paste(frame, g, int(cx - g.shape[1] / 2), int(y))
                break

        # 8) progress bar
        pw = int(W * t / total)
        frame[0:7, 0:pw] = BRAND[::-1]

        enc.stdin.write(frame.tobytes())
        if fi % 300 == 0:
            print(f'  frame {fi}/{nframes}', flush=True)

    enc.stdin.close()
    enc.wait()

    # --- audio
    vt = voice_track(args.face, segments, total)
    write_wav(work / 'voice.wav', vt)
    write_wav(work / 'sfx.wav', sfx_track(total, sfx))
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(work / 'video.mp4'), '-i', str(work / 'voice.wav'), '-i', str(work / 'sfx.wav'),
         '-filter_complex',
         '[1:a]highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-15:TP=-1.5:LRA=9[v];'
         '[2:a]volume=0.55[s];[v][s]amix=inputs=2:normalize=0:duration=first,aresample=48000[a]',
         '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', args.out])
    print('done', args.out, f'{total:.1f}s')


if __name__ == '__main__':
    main()
