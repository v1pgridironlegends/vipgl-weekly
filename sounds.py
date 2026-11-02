# Original broadcast audio for V1PGL Weekly: intro sting, transition whoosh, music bed (all synthesized here, no samples)
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile
SR = 48000
rng = np.random.default_rng(7)
def lp(x, f, o=4): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=4): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
def t_(d): return np.arange(int(d * SR)) / SR
def note(n): return 440 * 2 ** ((n - 69) / 12)
def saw(f, t, det=(0,)):
    return sum(2 * ((t * f * (1 + d)) % 1) - 1 for d in det) / len(det)
def reverb(x, secs=2.2, mix=.3):
    ir = rng.standard_normal(int(secs * SR)) * np.exp(-t_(secs) * 3.2)
    ir = lp(ir, 6000); ir /= np.abs(ir).sum() ** .5 * 6
    wet = fftconvolve(x, ir)[:len(x)]
    return x * (1 - mix) + wet * mix
def sweep_bp(x, freqs, q=1.4):   # state-variable band-pass with a smoothly moving center (no clicks)
    lo = bd = 0.0; out = np.zeros(len(x))
    for i in range(len(x)):
        f = 2 * np.sin(np.pi * min(freqs[i], SR / 6) / SR)
        hi_ = x[i] - lo - bd / q; bd += f * hi_; lo += f * bd; out[i] = bd
    return out
def stereo(l, r=None): r = l if r is None else r; return np.stack([l, r], 1)
def norm(x, peak=.89): return x / (np.abs(x).max() + 1e-9) * peak
def write(name, x): wavfile.write(name, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))

# ---- intro sting: riser (0-0.9s) -> impact at 0.9s -> gold chord with tail
D = 4.2; t = t_(D); out = np.zeros((len(t), 2))
hit = .9
ris = t < hit
nz = rng.standard_normal(len(t))
sweep = sweep_bp(nz, 300 + 5500 * np.clip(t / hit, 0, 1) ** 2)
sweep *= np.where(ris, (t / hit) ** 2.2, 0)
out += stereo(sweep * .35)
ta = t - hit; on = ta >= 0; ta = np.where(on, ta, 0)
boom = np.sin(2 * np.pi * (48 * ta + 40 * (1 - np.exp(-ta * 9)) / 9 * 3)) * np.exp(-ta * 3.2) * on
click = lp(rng.standard_normal(len(t)), 3000) * np.exp(-ta * 40) * on
chord = [note(n) for n in (50, 57, 62, 66, 69, 74)]          # D major voicing
pad = sum(saw(f, t, (-.004, 0, .005)) for f in chord) / len(chord)
pad = lp(pad, 2600) * np.exp(-ta * 1.1) * on
bell = sum(np.sin(2 * np.pi * f * 2 * t) * np.exp(-ta * (2.5 + i)) for i, f in enumerate(chord[2:])) * on * .25
mono = boom * 1.0 + click * .5 + pad * .55 + bell
out += stereo(reverb(mono, 2.6, .35))
out[:, 0] += reverb(pad * .15 * np.sin(2 * np.pi * .7 * t), 2, .5); out[:, 1] -= reverb(pad * .15 * np.sin(2 * np.pi * .7 * t), 2, .5)
out *= np.minimum(1, (D - t) / .6)[:, None]
write('sting.wav', norm(out))

# ---- whoosh: 0.9 s, peak at 0.45 s, pans left to right
D = .9; t = t_(D); env = np.exp(-((t - .45) / .17) ** 2)
nz = rng.standard_normal(len(t)); w = sweep_bp(nz, 500 + 3000 * env)
w = w * env; pan = t / D
write('whoosh.wav', norm(stereo(w * (1 - pan) ** .5, w * pan ** .5), .7))

# ---- music bed: 100 BPM, 16 bars of Dm - Bb - F - C, kick/clap/hats, bass, pads, a pluck hook (loops seamlessly)
BPM = 100; beat = 60 / BPM; bars = 16; D = bars * 4 * beat; t = t_(D); N = len(t)
L = np.zeros(N); R = np.zeros(N)
def place(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR); n = min(len(sig), N - i)
    if n <= 0: return
    L[i:i+n] += sig[:n] * gain * (1 - max(0, pan)); R[i:i+n] += sig[:n] * gain * (1 + min(0, pan))
kt = t_(.45); kick = np.sin(2 * np.pi * (45 * kt + 110 * (1 - np.exp(-kt * 30)) / 30)) * np.exp(-kt * 7)
ct = t_(.3); clap = hp(rng.standard_normal(len(ct)), 900) * np.exp(-ct * 18); clap = reverb(clap, .6, .3)
ht = t_(.08); hat = hp(rng.standard_normal(len(ht)), 7000) * np.exp(-ht * 70)
chords = [(50, 53, 57, 62), (46, 50, 53, 58), (53, 57, 60, 65), (48, 52, 55, 60)]   # Dm Bb F C
roots = [38, 34, 41, 36]
for b in range(bars):
    bt = b * 4 * beat
    for k in range(4):
        place(kick, bt + k * beat, .9)
        if k in (1, 3): place(clap, bt + k * beat, .32)
        for h in range(2): place(hat, bt + k * beat + h * beat / 2, .10 if h else .06, .3)
    if b % 2: place(kick, bt + 3.5 * beat, .5)
    ch = chords[(b // 2) % 4]; dur = 4 * beat; pt = t_(dur)
    padw = sum(saw(note(n + 12), pt, (-.006, .006)) for n in ch) / 4
    padw = lp(padw, 1400) * np.minimum(1, pt / .4) * np.minimum(1, (dur - pt) / .3)
    place(padw, bt, .16, -.2); place(padw, bt, .16, .2)
    r = roots[(b // 2) % 4]
    for k, off in enumerate((0, 1.5, 2, 3, 3.5)):
        bd = beat * (.45 if off % 1 else .8); btt = t_(bd)
        bs = lp(saw(note(r), btt), 500) + np.sin(2 * np.pi * note(r) * btt) * .6
        place(bs * np.exp(-btt * 4), bt + off * beat, .38)
    if b >= 4:   # pluck hook enters after 4 bars
        mel = [ch[3] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12]
        for k in range(4):
            pt2 = t_(.5); pl = lp(saw(note(mel[k] + 12), pt2), 3000) * np.exp(-pt2 * 9)
            place(reverb(pl, .8, .4), bt + k * beat + (beat / 2 if k % 2 else 0), .12, .35 if k % 2 else -.35)
bed = np.stack([L, R], 1)
bed = np.stack([lp(bed[:, 0], 9000), lp(bed[:, 1], 9000)], 1)
write('bed.wav', norm(bed, .8))
print('ok')
