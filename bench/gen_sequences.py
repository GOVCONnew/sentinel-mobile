"""Generate motion benchmark sequences (160x120 grayscale, 10 fps) -> seq/<name>.bin + seq/index.json.
Real: foliage_wind_{1,2,3}.mp4 (Wikimedia Commons). Synthetic (from an empty-forest eval image): sway, lighting ramp/cloud, camera shake,
and positives with a composited walking 'intruder' patch (cut from a person eval image)."""
import json, subprocess, numpy as np, cv2, os, glob
W, H, FPS = 160, 120, 10
def read_video(p):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', p, '-vf', f'scale={W}:{H},fps={FPS}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W)
gt = json.load(open('eval/ground_truth.json'))
bg = cv2.imread('eval/img/' + next(g['file'] for g in gt if not g['labels'] and 'Forest_path' in g['file'] or (not g['labels'] and g is gt[5])), cv2.IMREAD_GRAYSCALE)
bg = cv2.resize(bg, (W + 16, H + 16), interpolation=cv2.INTER_AREA).astype(np.float32)
per = cv2.imread('eval/img/' + next(g['file'] for g in gt if g['labels'] == ['person'] and not g['tags']), cv2.IMREAD_GRAYSCALE)
rng = np.random.default_rng(7); N = 140
yy, xx = np.mgrid[0:H + 16, 0:W + 16].astype(np.float32)
def sway(t, amp=2.5):
    # spatially varying periodic displacement (branches swaying at different phases), stronger in upper half (canopy)
    ph = (np.sin(xx / 9.0) + np.cos(yy / 7.0)) * 2.0; k = np.clip(1.2 - yy / (H + 16), 0.2, 1.0)
    dx = amp * k * np.sin(2 * np.pi * 0.7 * t + ph); dy = 0.5 * amp * k * np.cos(2 * np.pi * 0.5 * t + ph)
    return cv2.remap(bg, xx + dx, yy + dy, cv2.INTER_LINEAR)
def crop(img, ox=8, oy=8): return img[int(oy):int(oy) + H, int(ox):int(ox) + W]
def add_intruder(fr, t, t0=4.0, t1=11.0):
    if not (t0 <= t <= t1): return fr
    ph = cv2.resize(per, (14, 30)).astype(np.float32) * 0.6  # darker clothing patch ~ 30px tall person at 160px
    x = int(10 + (t - t0) / (t1 - t0) * (W - 30)); y = 70
    fr = fr.copy(); fr[y:y + 30, x:x + 14] = ph; return fr
seqs = {}
def make(name, fn, positive=None):
    frames = np.stack([np.clip(fn(i / FPS), 0, 255).astype(np.uint8) for i in range(N)]); seqs[name] = (frames, positive)
make('synth_sway', lambda t: crop(sway(t)))
make('synth_sway_strong', lambda t: crop(sway(t, 6)))
fl = np.clip(rng.normal(1, 0.18, N), 0.6, 1.4)
make('synth_sunflicker', lambda t: crop(bg * fl[int(t * FPS)]))
make('synth_light', lambda t: crop(bg * (0.55 + 0.45 * (0.5 + 0.5 * np.cos(2 * np.pi * t / 7))) + 8 * np.sin(2 * np.pi * t / 1.3)))  # cloud ramp + flicker
cloud = cv2.GaussianBlur(rng.random((H + 16, W + 16)).astype(np.float32), (0, 0), 18); cloud = (cloud - cloud.min()) / (np.ptp(cloud) + 1e-6)
make('synth_shadow', lambda t: crop(bg * (1 - 0.45 * np.roll(cloud, int(t * 6), axis=1))))  # moving cloud shadow
sh = rng.normal(0, 1.6, (N, 2)).cumsum(0) * 0.35; sh = np.clip(sh, -6, 6)
make('synth_shake', lambda t: crop(bg, 8 + sh[int(t * FPS)][0], 8 + sh[int(t * FPS)][1]))
make('synth_sway_light_shake', lambda t: crop(sway(t) * (0.7 + 0.3 * np.cos(2 * np.pi * t / 6)), 8 + sh[int(t * FPS)][0] * .6, 8 + sh[int(t * FPS)][1] * .6))
make('pos_intruder_sway', lambda t: add_intruder(crop(sway(t, 6)), t), [4.0, 11.0])
make('pos_intruder_shake_light', lambda t: add_intruder(crop(bg * (0.7 + 0.3 * np.cos(2 * np.pi * t / 6)), 8 + sh[int(t * FPS)][0] * .6, 8 + sh[int(t * FPS)][1] * .6), t), [4.0, 11.0])
for p in sorted(glob.glob('clips/foliage_wind_*.mp4')):
    f = read_video(p); seqs[os.path.basename(p)[:-4]] = (f[:N], None)
f = read_video('clips/foliage_wind_1.mp4')[:N]; seqs['pos_intruder_realfoliage'] = (np.stack([add_intruder(f[i], i / FPS) for i in range(len(f))]), [4.0, 11.0])
idx = {}
for k, (fr, pos) in seqs.items():
    fr.tofile(f'seq/{k}.bin'); idx[k] = dict(w=W, h=H, fps=FPS, n=int(len(fr)), intruder=pos)
json.dump(idx, open('seq/index.json', 'w'), indent=1); print({k: v['n'] for k, v in idx.items()})
# a few colour frames of lighting/shake for detector-FP set
img = cv2.imread('eval/img/' + gt[5]['file'])
for i, g in enumerate([0.35, 0.6, 1.0, 1.4]): cv2.imwrite(f'negframes/light_{i}.jpg', np.clip(img.astype(np.float32) * g, 0, 255).astype(np.uint8))
