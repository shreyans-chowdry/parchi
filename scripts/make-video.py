"""Assemble the 1080p demo video: slide stills + the recorded app demo.
Usage: python3 scripts/make-video.py <slides_dir> <frames_dir> <out.mp4>"""
import json, subprocess, sys
from pathlib import Path

slides, frames, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
work = out.parent / '_segments'; work.mkdir(parents=True, exist_ok=True)

# (kind, source, seconds) — timings match submission/video-script.md
PLAN = [
    ('slide', 'cover', 10),
    ('slide', 'problem', 30),
    ('demo', None, None),
    ('slide', 'architecture', 24),
    ('slide', 'code-extract', 16),
    ('slide', 'code-match', 16),
    ('slide', 'code-invoice', 16),
    ('slide', 'scale', 28),
    ('slide', 'business', 38),
    ('slide', 'close', 14),
]
ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30']

def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

parts = []
for i, (kind, src, secs) in enumerate(PLAN):
    seg = work / f'{i:02d}.mp4'
    if kind == 'slide':
        run(['ffmpeg', '-y', '-loop', '1', '-t', str(secs), '-i', str(slides / f'{src}.png'),
             '-vf', f'scale=1920:1080,fade=t=in:st=0:d=0.35,fade=t=out:st={secs - 0.35}:d=0.35', *ENC, str(seg)])
    else:
        # resample the variable-rate screencast onto an exact 30 fps timeline
        fr = json.loads((frames / 'frames.json').read_text())
        seq = work / 'seq'; seq.mkdir(exist_ok=True)
        for f in seq.glob('*.jpg'): f.unlink()
        t0 = fr[0][1]
        dur = fr[-1][1] - t0 + 1.5
        j = 0
        for n in range(int(dur * 30)):
            t = t0 + n / 30
            while j + 1 < len(fr) and fr[j + 1][1] <= t: j += 1
            (seq / f'{n:05d}.jpg').symlink_to((frames / fr[j][0]).resolve())
        run(['ffmpeg', '-y', '-framerate', '30', '-i', str(seq / '%05d.jpg'),
             '-vf', f'scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.35,fade=t=out:st={dur - 0.4}:d=0.35', *ENC, str(seg)])
    parts.append(seg)
    print('segment', i, kind, src or 'demo')

cl = work / 'all.txt'
cl.write_text('\n'.join(f"file '{p.resolve()}'" for p in parts))
run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(cl),
     '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
     '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', str(out)])
dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(out)], capture_output=True, text=True).stdout.strip()
print('video', out, round(float(dur), 1), 's')
