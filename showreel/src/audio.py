# Procedural score + sound design, beat-locked to the reel timeline (128 BPM, F minor)
import numpy as np, wave
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000; DUR = 15.0; N = int(SR * DUR)
B = 60 / 128; BAR = 4 * B
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def t_(d): return np.arange(int(d * SR)) / SR
def put(sig, t0, gain=1.0, pan=0.0):
    i = int(round(t0 * SR));
    if i >= N: return
    if i < 0: sig = sig[-i:]; i = 0
    n = min(len(sig), N - i)
    gl = gain * np.sqrt(0.5 * (1 - pan)); gr = gain * np.sqrt(0.5 * (1 + pan))
    L[i:i + n] += sig[:n] * gl; R[i:i + n] += sig[:n] * gr
def flt(x, kind, f, order=2):
    if isinstance(f, (list, tuple)): f = [min(v, SR / 2 - 100) for v in f]
    else: f = min(f, SR / 2 - 100)
    return sosfilt(butter(order, f, kind, fs=SR, output='sos'), x)
def noise(d): return rng.standard_normal(int(d * SR))
def midi(m): return 440 * 2 ** ((m - 69) / 12)
def saw(f, d, detune=(0,)):
    t = t_(d); out = np.zeros_like(t)
    for dt in detune:
        ph = (f * (1 + dt) * t + rng.random()) % 1.0; out += 2 * ph - 1
    return out / len(detune)
def env_ad(d, a, dec):
    t = t_(d); e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) * dec); return e

# ---------------- instruments ----------------
def kick(gain=1.0):
    d = 0.5; t = t_(d)
    f = 45 + 110 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 7.5)
    s += flt(noise(d), 'highpass', 2500) * np.exp(-t * 120) * 0.25
    return np.tanh(s * 1.6) * gain
def clap():
    d = 0.35; t = t_(d); n = flt(noise(d), 'bandpass', [900, 3500])
    e = np.zeros_like(t)
    for k, o in enumerate([0, 0.011, 0.022]): e += (t >= o) * np.exp(-np.maximum(0, t - o) * (180 if k < 2 else 16))
    return n * e * 0.6
def hat(open_=False):
    d = 0.25 if open_ else 0.06; t = t_(d)
    return flt(noise(d), 'highpass', 7000) * np.exp(-t * (14 if open_ else 70)) * 0.35
def bass(m, d):
    t = t_(d); f = midi(m)
    s = saw(f, d, (-0.004, 0.004)) * 0.6 + np.sin(2 * np.pi * f * t) * 0.7
    s = flt(s, 'lowpass', 900)
    return s * env_ad(d, 0.004, 5)
def pluck(m, d=0.22, bright=3500):
    t = t_(d); s = saw(midi(m), d, (-0.006, 0, 0.006))
    s = flt(s, 'lowpass', bright) * np.exp(-t * 16)
    return s
def pad(ms, d, cutoff=1800):
    s = sum(saw(midi(m), d, (-0.008, -0.003, 0.003, 0.008)) for m in ms) / len(ms)
    s = flt(s, 'lowpass', cutoff)
    t = t_(d); e = np.minimum(1, t / 0.25) * np.minimum(1, (d - t) / 0.4)
    return s * e
def stab(ms, d=0.35):
    s = sum(saw(midi(m), d, (-0.01, 0, 0.01)) for m in ms) / len(ms)
    t = t_(d); return flt(s, 'lowpass', 3000) * np.exp(-t * 9)
def impact(gain=1.0, d=1.6):
    t = t_(d)
    f = 38 + 90 * np.exp(-t * 18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6)
    nz = flt(noise(d), 'lowpass', 5000) * np.exp(-t * 9) * 0.6
    crack = flt(noise(d), 'highpass', 3000) * np.exp(-t * 40) * 0.5
    return np.tanh((sub * 1.4 + nz + crack) * 1.2) * gain
def whoosh(d, f0=300, f1=6000, gain=0.5):
    n = noise(d); t = t_(d); k = t / d
    lfc = np.log(f0) + (np.log(f1) - np.log(f0)) * k
    out = np.zeros_like(n)
    lo, hi = min(f0, f1), max(f0, f1)
    for fb in np.geomspace(lo, hi, 9):
        band = flt(n, 'bandpass', [fb / 1.35, fb * 1.35])
        out += band * np.exp(-((np.log(fb) - lfc) ** 2) / (2 * 0.35 ** 2))
    e = np.sin(np.pi * np.clip(k, 0, 1)) ** 2
    return out * e * gain
def riser(d):
    t = t_(d); k = t / d
    n = whoosh(d, 200, 9000, 0.6) * (k ** 1.5)
    f = 200 * (8 ** k); tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.18 * k ** 2
    return n + tone
def blip(f, d=0.05, gain=0.3):
    t = t_(d); return np.sin(2 * np.pi * f * t) * np.exp(-t * 60) * gain
def click(gain=0.25):
    d = 0.012; t = t_(d); return flt(noise(d), 'highpass', 3000) * np.exp(-t * 500) * gain
def bell(m, d=2.5, gain=0.35):
    t = t_(d); f = midi(m)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * 2.2 * np.exp(-t * 3)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t * 2.2) * gain
def sparkle_fx(d, gain=0.12):
    out = np.zeros(int(d * SR))
    for _ in range(int(d * 40)):
        o = rng.random() * d; f = rng.uniform(2500, 7000); s = blip(f, 0.08, 1) * rng.uniform(0.3, 1)
        i = int(o * SR); n = min(len(s), len(out) - i); out[i:i + n] += s[:n]
    return out * gain

# ---------------- arrangement ----------------
T1 = BAR  # drop
CH = {  # bar -> chord (midi), root
    1: ([53, 56, 60, 63], 41), 2: ([49, 53, 56, 60], 37), 3: ([48, 51, 56, 60], 44),
    4: ([51, 55, 58, 62], 39), 5: ([53, 56, 60, 65], 41), 6: ([49, 53, 56, 61], 37),
}
# intro: drone + typing + riser
put(pad([41, 48, 53, 56], BAR + 0.3, 900), 0, 0.4)
for i in range(12): put(click(0.5), 0.08 + i * 0.056, pan=rng.uniform(-0.3, 0.3)); put(blip(1800 + i * 40, 0.03, 0.08), 0.08 + i * 0.056)
put(whoosh(0.28, 4000, 300, 0.35), 0.83)
put(blip(1320, 0.4, 0.25), 1.1); put(blip(2640, 0.3, 0.12), 1.12)
put(riser(BAR - 0.9), 0.9, 1.5)

# drums & music, bars 1..6
for bar in range(1, 7):
    t0 = bar * BAR
    chord, root = CH[bar]
    put(stab(chord), t0, 0.32, -0.1); put(stab([m + 12 for m in chord]), t0, 0.12, 0.2)
    put(pad(chord, BAR, 1400 if bar != 5 else 900), t0, 0.12)
    for k in range(4):
        tb = t0 + k * B
        put(kick(), tb, 0.95)
        put(hat(), tb + B / 2, 0.55, 0.3)
        put(hat(), tb + B / 4, 0.18, -0.3); put(hat(), tb + 3 * B / 4, 0.22, -0.3)
        if k in (1, 3): put(clap(), tb, 0.7, 0.05)
        # off-beat pumping bass
        put(bass(root, B / 2 - 0.01), tb + B / 2, 0.55)
        put(bass(root + 12, B / 4), tb + 3 * B / 4, 0.18)
    # 16th arp
    arp = chord + [chord[1] + 12, chord[2] + 12, chord[0] + 12, chord[2]]
    for j in range(16):
        put(pluck(arp[j % len(arp)] + 12, 0.18, 2500 + 2500 * (j % 4 == 0)), t0 + j * B / 4, 0.09, 0.5 if j % 2 else -0.5)
    put(hat(True), t0 + 3 * B + B / 2, 0.4, 0.2)

# hits & transitions
put(impact(1.0), T1)
for k in range(1, 4): put(impact(0.35, 0.6), T1 + k * B)
put(whoosh(0.3, 400, 8000, 0.55), 2 * BAR - 0.27)               # paper bars
for i in range(12): put(blip(1400 + i * 90, 0.04, 0.16), 2 * BAR + 0.06 + i * 0.035, pan=(i % 3 - 1) * 0.5)
put(whoosh(0.3, 2000, 600, 0.25), 2 * BAR + 0.86)
put(click(0.7), 2 * BAR + 1.5); put(blip(900, 0.08, 0.25), 2 * BAR + 1.5)
put(whoosh(0.3, 300, 9000, 0.55), 3 * BAR - 0.28)               # zoom-through
for k in range(4):
    put(blip(140, 0.18, 0.4), 3 * BAR + k * B)                 # bounce landings
    if k: put(whoosh(0.25, 800, 5000, 0.25), 3 * BAR + k * B - 0.12)
put(whoosh(0.32, 200, 7000, 0.6), 4 * BAR - 0.3)                # square → blue
for j in range(60): put(click(0.18), 4 * BAR + 0.12 + j * 0.017 + rng.uniform(0, 0.006), pan=rng.uniform(-0.6, 0.6))
put(click(0.8), 4 * BAR + 1.5); put(bell(84, 0.6, 0.18), 4 * BAR + 1.58); put(bell(91, 0.6, 0.12), 4 * BAR + 1.64)
# glitch stutter + pan
g = flt(noise(0.03), 'bandpass', [800, 4000]) * 0.5
for j in range(8): put(g * (0.4 + j * 0.08), 5 * BAR - 0.2 + j * 0.026, pan=(-1) ** j * 0.6)
put(whoosh(0.36, 600, 9000, 0.6), 5 * BAR - 0.18)
put(sparkle_fx(0.85, 0.16), 5 * BAR)
put(riser(0.75) * 0.5, 5 * BAR)
put(impact(0.45, 0.8), 5 * BAR + 0.78); put(bell(77, 1.2, 0.2), 5 * BAR + 0.8); put(bell(84, 1.2, 0.14), 5 * BAR + 0.84)
for i in range(3): put(blip(2200, 0.05, 0.12), 5 * BAR + 0.94 + i * 0.08)
for i in range(5): put(blip(1200 + i * 200, 0.06, 0.14), 5 * BAR + 3 * B + i * 0.04)
put(whoosh(0.22, 500, 9000, 0.5), 6 * BAR - 0.2)               # slash wipe
# odometer ticks, decelerating
tt = 6 * BAR; dt = 0.018
while tt < 6 * BAR + 0.9: put(click(0.35), tt, pan=rng.uniform(-0.4, 0.4)); tt += dt; dt *= 1.09
put(impact(0.6, 0.9), 6 * BAR + 2 * B)
put(whoosh(0.2, 1000, 6000, 0.4), 6 * BAR + 3 * B - 0.05); put(impact(0.4, 0.6), 6 * BAR + 3 * B)
put(riser(0.6) * 0.8, 7 * BAR - 0.6)

# outro
T7 = 7 * BAR
put(impact(1.0, 2.2), T7)
put(pad([41, 53, 56, 60, 67], DUR - T7, 2200), T7, 0.22)
put(bass(29, 1.6) * 1.3, T7, 0.5)
put(bell(77, 2.0, 0.28), T7 + 0.24); put(bell(84, 2.0, 0.2), T7 + 0.3)
put(bell(89, 1.6, 0.16), T7 + 0.5, pan=0.3)
put(sparkle_fx(0.6, 0.12), T7 + 1.0)
for i, m in enumerate([72, 75, 77, 80, 84]): put(pluck(m, 0.4, 5000), T7 + 0.46 + i * 0.04, 0.1, (i - 2) * 0.3)

# ---------------- reverb + master ----------------
ir_t = t_(2.2); ir = rng.standard_normal((2, len(ir_t))) * np.exp(-ir_t * 3.0)
ir[:, :int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
ir = flt(ir, 'lowpass', 6000)
wetL = fftconvolve(L, ir[0])[:N]; wetR = fftconvolve(R, ir[1])[:N]
sc = np.max(np.abs(np.concatenate([L, R]))) or 1
mixL = L + wetL / np.max(np.abs(wetL)) * sc * 0.16
mixR = R + wetR / np.max(np.abs(wetR)) * sc * 0.16
st = np.stack([mixL, mixR])
st = flt(st, 'highpass', 25)
st = st / np.max(np.abs(st)) * 1.4
st = np.tanh(st)                       # soft limiter
fade = np.ones(N); fl = int(0.25 * SR); fade[-fl:] = np.linspace(1, 0, fl) ** 2
st *= fade
st = st / np.max(np.abs(st)) * 0.93
pcm = (st.T * 32767).astype(np.int16)
with wave.open('score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok', pcm.shape)
