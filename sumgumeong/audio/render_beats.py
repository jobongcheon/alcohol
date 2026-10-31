#!/usr/bin/env python3
# 숨구멍 「랩으로 불러 줘」 비트 렌더러: 진짜 악기 샘플(FluidR3 GM, MIT)과 실제 타악 녹음(Berklee, CC BY),
# 그리고 808·하이햇처럼 원래 합성으로 만드는 소리를 섞어 8마디 루프 10종을 만들어요. 결과물은 sumgumeong/audio/beats/
import os, sys, math, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render import SR, load, save_mp3, sec, fade, Instrument, Track, reverb_ir, lowpass_fast, peak_limit, rms_norm, midi_of, TI

HERE = os.path.dirname(os.path.abspath(__file__))
GM = os.path.join(HERE, "gm")
BK = os.path.join(HERE, "tonejs-audio", "berklee")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out", "beats")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(2024)

# ---------- 기본 도구 ----------
def gate(a, dur_s, rel=0.06):
    """샘플을 dur 길이로 자르고 끝을 짧게 풀어요(스타카토·스탭용)."""
    n = min(len(a), sec(dur_s + rel)); a = a[:n].copy()
    k = min(n, sec(rel)); a[n - k:] *= np.linspace(1, 0, k, dtype=np.float32)[:, None] ** 1.2
    return a

def highpass_fast(arr, cutoff_hz):
    n = len(arr); F = np.fft.rfft(arr, axis=0); f = np.fft.rfftfreq(n, 1 / SR)
    g = (f / cutoff_hz) ** 2 / (1 + (f / cutoff_hz) ** 2)
    return np.fft.irfft(F * g[:, None], n=n, axis=0).astype(np.float32)

def softclip(a, drive=1.0):
    return (np.tanh(a * drive) / math.tanh(drive)).astype(np.float32)

def stereo(mono): return np.stack([mono, mono], axis=1).astype(np.float32)

def noise(dur): return rng.standard_normal(sec(dur)).astype(np.float32)

def env_exp(dur, tau):
    t = np.arange(sec(dur)) / SR; return np.exp(-t / tau).astype(np.float32)

def sine(freq, dur): return np.sin(2 * np.pi * freq * np.arange(sec(dur)) / SR).astype(np.float32)

def oneshot(name, cap=None, hp=None, lp=None, gain=1.0, trim_start=0.0):
    a = load(os.path.join(BK, name))
    if trim_start: a = a[sec(trim_start):]
    # 앞의 무음을 잘라 타이밍을 정확히
    thr = np.max(np.abs(a)) * 0.02; i = int(np.argmax(np.abs(a).max(axis=1) > thr)); a = a[max(0, i - 20):]
    if cap: a = fade(a[:sec(cap)], 0, min(0.05, cap * 0.3))
    if hp: a = highpass_fast(a, hp)
    if lp: a = lowpass_fast(a, lp)
    return a * gain

# ---------- 합성 드럼(원래 합성으로 만드는 소리들) ----------
def hat(open_=False, tone=1.0):
    dur = 0.45 if open_ else 0.08
    t = np.arange(sec(dur)) / SR
    m = np.zeros(sec(dur), dtype=np.float32)
    for f in [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]:  # TR-808식 비조화 사각파 묶음
        m += np.sign(np.sin(2 * np.pi * f * tone * 7.2 * t)).astype(np.float32)
    m = m / 6 + noise(dur) * 0.6
    m *= env_exp(dur, 0.12 if open_ else 0.022)
    a = highpass_fast(stereo(m), 7000); return lowpass_fast(a, 16000) * 0.9

def snare_synth(tone=185.0):
    dur = 0.28
    body = sine(tone, dur) * env_exp(dur, 0.045) * 0.9 + sine(tone * 1.6, dur) * env_exp(dur, 0.03) * 0.3
    nz = noise(dur) * env_exp(dur, 0.075)
    a = stereo(body * 0.7) + highpass_fast(stereo(nz), 1800) * 0.9
    return softclip(a, 1.6) * 0.8

def sub808(freq, dur=0.9, glide_from=None, decay=0.55, drive=2.2):
    n = sec(dur); t = np.arange(n) / SR
    f = np.full(n, freq, dtype=np.float64)
    f[: sec(0.03)] *= np.linspace(2.4, 1.0, sec(0.03))  # 클릭감 있는 피치 드롭
    if glide_from: k = min(n, sec(0.12)); f[:k] = np.linspace(glide_from, freq, k) * (f[:k] / freq)
    ph = np.cumsum(2 * np.pi * f / SR)
    a = np.sin(ph) * np.exp(-t / decay)
    a = softclip(a.astype(np.float32), drive)
    return stereo(a) * 0.6

def kick_synth(freq=52.0, dur=0.42):
    n = sec(dur); t = np.arange(n) / SR
    f = freq + 160 * np.exp(-t / 0.028); ph = np.cumsum(2 * np.pi * f / SR)
    a = np.sin(ph) * np.exp(-t / 0.16); a[: sec(0.004)] += noise(0.004)[: sec(0.004)] * 0.4
    return stereo(softclip(a.astype(np.float32), 1.8)) * 0.95

def crackle(dur, density=18.0, gain=0.5):
    n = sec(dur); a = np.zeros(n, dtype=np.float32)
    idx = rng.integers(0, n, int(dur * density)); a[idx] = rng.uniform(-1, 1, len(idx)).astype(np.float32)
    a += noise(dur) * 0.012
    return lowpass_fast(stereo(a), 4000) * gain

def riser(dur):
    n = sec(dur); nz = noise(dur) * np.linspace(0.05, 1, n, dtype=np.float32)
    F = np.fft.rfft(nz); f = np.fft.rfftfreq(n, 1 / SR); F *= (f / 2500) ** 1.5 / (1 + (f / 2500) ** 3)
    return stereo(np.fft.irfft(F, n=n).astype(np.float32)) * 0.6

def crackle_fx(dur): return crackle(dur)

# ---------- 시퀀서 ----------
class Beat:
    def __init__(self, name, bpm, bars=8, swing=0.0, seed=1):
        self.name, self.bpm, self.bars, self.swing = name, bpm, bars, swing
        self.step = 60 / bpm / 4; self.len_s = self.step * 16 * bars
        self.t = Track(self.len_s, seed); self.buses = {}
        self.sc = np.ones(sec(self.len_s), dtype=np.float32)  # 사이드체인 곡선
    def at(self, bar, beat, sixteenth=0):
        s = (bar * 16 + beat * 4 + sixteenth) * self.step
        if self.swing and sixteenth % 2 == 1: s += self.step * self.swing
        return s + rng.uniform(-0.004, 0.004)
    def hit(self, a, bar, beat, six=0, vel=1.0, pan=0.0, bus=None):
        tm = self.at(bar, beat, six)
        if bus is not None: self.buses.setdefault(bus, Track(self.len_s)).put(a, tm, vel, pan)
        else: self.t.put(a, tm, vel, pan)
    def every(self, a, bars, pattern, vel=1.0, pan=0.0, bus=None, velf=None, humanize=0.12):
        """pattern: 16칸 문자열. 'x' 세게 'o' 보통 '.' 쉼, 또는 (step, vel) 목록"""
        for b in bars:
            if isinstance(pattern, str):
                for i, ch in enumerate(pattern):
                    if ch == ".": continue
                    v = {"x": 1.0, "o": 0.72, "-": 0.45}.get(ch, 1.0) * vel * rng.uniform(1 - humanize, 1)
                    if velf: v *= velf(b, i)
                    self.hit(a, b, i // 4, i % 4, v, pan, bus)
            else:
                for i, v in pattern: self.hit(a, b, i // 4, i % 4, v * vel, pan, bus)
    def note(self, inst, midi, bar, beat, six, dur_beats, vel=0.8, pan=0.0, bus=None, rel=0.08, lp=None):
        a = gate(inst.play(midi), dur_beats * self.step * 4, rel)
        if lp: a = lowpass_fast(a, lp)
        self.hit(a, bar, beat, six, vel, pan, bus)
    def chord(self, inst, midis, bar, beat, six, dur_beats, vel=0.7, spread=0.0, bus=None, lp=None, rel=0.1):
        for j, m in enumerate(midis): self.note(inst, m, bar, beat, six, dur_beats, vel * rng.uniform(0.9, 1), pan=(j - (len(midis) - 1) / 2) * spread, bus=bus, lp=lp, rel=rel)
    def sidechain(self, bars, beats=(0, 1, 2, 3), depth=0.72, rel=0.32):
        n = len(self.sc); t = np.arange(sec(rel)) / SR; curve = 1 - depth * np.exp(-t / (rel * 0.35))
        for b in bars:
            for bt in beats:
                s = max(0, sec(self.at(b, bt))); k = min(len(curve), n - s)
                if k > 0: self.sc[s:s + k] = np.minimum(self.sc[s:s + k], curve[:k])
    def mix(self, bus_fx, master_drive=1.15, rms_db=-15.5):
        for name, tr in self.buses.items():
            fx = bus_fx.get(name, {})
            if "lp" in fx: tr.buf = lowpass_fast(tr.buf, fx["lp"])
            if "hp" in fx: tr.buf = highpass_fast(tr.buf, fx["hp"])
            if "rev" in fx: tr.reverb(fx["rev"][0], wet=fx["rev"][1], dry=1.0)
            if fx.get("sc"): tr.buf = tr.buf * self.sc[:, None]
            self.t.buf += tr.buf * fx.get("gain", 1.0)
        out = softclip(self.t.buf, master_drive)
        out = lowpass_fast(out, 12500)
        return peak_limit(rms_norm(out, rms_db), 0.9)

# 음 이름 → 미디
N = midi_of
def chord_midis(root, kind):
    K = {"m7": [0, 3, 7, 10], "m9": [0, 3, 7, 10, 14], "maj7": [0, 4, 7, 11], "maj9": [0, 4, 7, 11, 14], "7": [0, 4, 7, 10], "m": [0, 3, 7], "M": [0, 4, 7], "5": [0, 7, 12], "sus2": [0, 2, 7], "m6": [0, 3, 7, 9], "dim": [0, 3, 6]}
    return [N(root) + i for i in K[kind]]

# ---------- 악기 불러오기(필요한 것만) ----------
_cache = {}
def gm(name, cap=3.0, lp=None, gain=1.0):
    k = (name, cap, lp, gain)
    if k not in _cache: _cache[k] = Instrument(os.path.join(GM, name), ".mp3", cap_s=cap, fade_out=0.25, lp=lp, gain=gain, norm=True)
    return _cache[k]
def piano():
    if "piano" not in _cache: _cache["piano"] = Instrument(os.path.join(TI, "piano"), ".wav", cap_s=6, fade_out=1.5, norm=True)
    return _cache["piano"]

def drums():
    if "drums" in _cache: return _cache["drums"]
    d = {
        "kick_a": oneshot("kick1.mp3", cap=0.45, gain=1.1), "kick_b": oneshot("kick2.mp3", cap=0.4, gain=1.1),
        "clap": oneshot("clap_1.mp3", cap=0.3, hp=600, gain=1.2), "brush": oneshot("snare_brush_2.mp3", cap=0.35, hp=300, gain=0.9),
        "tamb": oneshot("tambourine2.mp3", cap=0.3, hp=2000, gain=0.6), "shaker": oneshot("shaker5.mp3", cap=0.25, hp=3000, gain=0.7),
        "crash": oneshot("crash_cymbal3.mp3", cap=3.0, hp=1500, gain=0.5), "china": oneshot("china_cymbal2.mp3", cap=1.8, hp=1500, gain=0.5),
        "cowbell": oneshot("cowbell2_small.mp3", cap=0.3, hp=800, gain=0.55), "conga1": oneshot("conga_1.mp3", cap=0.5, gain=0.8), "conga2": oneshot("conga_3.mp3", cap=0.4, gain=0.8),
        "tabla1": oneshot("tabla_1.mp3", cap=0.5, gain=0.8), "woodslap": oneshot("wood_slap_1.mp3", cap=0.3, hp=500, gain=0.7), "woodclap": oneshot("wooden_clap1.mp3", cap=0.3, gain=0.8),
        "vinyl": oneshot("vinyl_hit_1.mp3", cap=1.0, gain=0.6), "scratch": oneshot("scratching2.mp3", cap=0.5, hp=800, gain=0.7, trim_start=1.0),
        "hat_c": hat(False), "hat_o": hat(True), "hat_hi": hat(False, 1.25), "snare": snare_synth(), "snare_lo": snare_synth(165), "k808": kick_synth(),
    }
    d["snare_full"] = d["snare"] * 0.8 + np.pad(d["clap"], ((0, max(0, len(d["snare"]) - len(d["clap"]))), (0, 0)))[: len(d["snare"])] * 0.7 if len(d["clap"]) <= len(d["snare"]) else d["snare"] * 0.8 + d["clap"][: len(d["snare"])] * 0.7
    _cache["drums"] = d; return d

ROOM = reverb_ir(1.1, 2.6, 5000, 0.01)
HALL = reverb_ir(2.6, 2.2, 3600, 0.02)
PLATE = reverb_ir(1.8, 2.4, 6000, 0.005)

# ---------- 스타일 10종 ----------
def boom_bap():
    b = Beat("boombap", 92, swing=0.22, seed=11); D = drums(); bars = range(8)
    ep = gm("electric_piano_1", lp=3800); bass = gm("acoustic_bass", cap=1.5)
    b.every(D["kick_a"], bars, "x..o..x...x..o..", bus="drum")
    b.every(D["k808"], bars, "x.....x...x.....", vel=0.6, bus="drum")
    b.every(D["snare_full"], bars, "....x.......x...", bus="snare")
    b.every(D["hat_c"], bars, "o.o.o.o.o.o.o.o.", vel=0.55, bus="hat", velf=lambda br, i: 1.25 if i % 4 == 0 else 1)
    b.every(D["hat_o"], bars, "..........o.....", vel=0.35, bus="hat")
    b.every(D["scratch"], [3, 7], "..............x.", vel=0.5, bus="fx")
    CH = [("A3", "m7"), ("D3", "m7"), ("E3", "m7"), ("A3", "m7"), ("F3", "maj7"), ("G3", "7"), ("A3", "m7"), ("A3", "m7")]
    for i, (r, k) in enumerate(CH):
        m = chord_midis(r, k)
        b.chord(ep, m, i, 1, 2, 1.5, vel=0.55, spread=0.25, bus="keys"); b.chord(ep, m, i, 3, 2, 1.2, vel=0.45, spread=0.25, bus="keys")
        root = N(r) - 12
        for bt, six, mm, dur in [(0, 0, root, 1.5), (1, 2, root + 7, 1), (2, 0, root, 1.5), (3, 0, root + 10 if k != "maj7" else root + 11, 0.5), (3, 2, root + 7, 0.5)]:
            b.note(bass, mm, i, bt, six, dur, vel=0.85, bus="bass")
    b.t.buf += crackle(b.len_s, 22, 0.35)
    return b.mix({"drum": {"gain": 1.0}, "snare": {"rev": (ROOM, 0.3), "gain": 0.95}, "hat": {"hp": 5000, "gain": 0.6}, "keys": {"rev": (PLATE, 0.3), "gain": 1.1}, "bass": {"lp": 900, "gain": 0.85}, "fx": {"gain": .7}})

def trap():
    b = Beat("trap", 140, swing=0.0, seed=12); D = drums(); bars = range(8)
    strings = gm("string_ensemble_1", lp=4000); lead = gm("lead_2_sawtooth", lp=3000)
    # 하프타임: 스네어는 3박
    b.every(D["k808"], bars, "x......x..x.....", vel=0.7, bus="drum")
    b.every(D["snare_full"], bars, "........x.......", bus="snare")
    for br in bars:
        pat = "oooooooooooooooo" if br % 2 == 0 else "ooooooo.oooooooo"
        b.every(D["hat_c"], [br], pat, vel=0.5, bus="hat", velf=lambda b_, i: 1.3 if i % 4 == 0 else 0.8)
        if br % 2 == 1:  # 하이햇 롤(32분)
            for k in range(8): b.hit(D["hat_hi"], br, 1, 3, 0.45 + 0.05 * k, bus="hat") if False else None
            for k in range(6): b.buses.setdefault("hat", Track(b.len_s)).put(D["hat_hi"] * (0.35 + 0.08 * k), b.at(br, 1, 3) + k * b.step / 2, 1.0)
    b.every(D["hat_o"], bars, "......o.........", vel=0.4, bus="hat")
    roots = ["F1", "F1", "Ab1", "Ab1", "Db1", "Db1", "Eb1", "C1"]
    for i, r in enumerate(roots):
        f0 = 440 * 2 ** ((N(r) - 69) / 12)
        for bt, six, dur, gl in [(0, 0, 1.6, None), (1, 3, 0.7, f0 * 1.5), (2, 2, 1.2, None), (3, 2, 0.5, f0 * 0.75)]:
            b.hit(sub808(f0 if not gl else f0, dur=dur, glide_from=gl, decay=0.6), i, bt, six, 0.95, bus="sub")
    CH = [("F3", "m"), ("F3", "m"), ("Ab3", "M"), ("Ab3", "M"), ("Db3", "M"), ("Db3", "M"), ("Eb3", "M"), ("C3", "m")]
    for i, (r, k) in enumerate(CH): b.chord(strings, chord_midis(r, k), i, 0, 0, 4, vel=0.32, spread=0.4, bus="pad", rel=0.6)
    mel = [("F5", 0, 0, 0, 1), ("Ab5", 0, 1, 2, .5), ("G5", 0, 2, 0, 1.5), ("F5", 2, 0, 0, 1), ("C6", 2, 1, 2, .5), ("Ab5", 2, 2, 0, 2), ("Eb5", 4, 0, 0, 1), ("F5", 4, 1, 2, .5), ("Db5", 4, 2, 0, 1.5), ("C5", 6, 0, 0, 2.5), ("Eb5", 6, 3, 0, 1)]
    for n_, br, bt, six, dur in mel: b.note(lead, N(n_), br, bt, six, dur, vel=0.28, bus="lead", rel=0.2)
    return b.mix({"drum": {"gain": 1.0}, "snare": {"rev": (PLATE, 0.25)}, "hat": {"hp": 6500, "gain": 0.7}, "sub": {"lp": 160, "gain": 0.4}, "pad": {"rev": (HALL, 0.5), "gain": 1.2}, "lead": {"rev": (HALL, 0.55), "gain": 1.0}})

def drill():
    b = Beat("drill", 142, seed=13); D = drums(); bars = range(8)
    pno = piano(); strings = gm("synth_strings_1", lp=3500)
    b.every(D["k808"], bars, "x.....x...x....x", vel=0.85, bus="drum")
    b.every(D["snare_lo"], bars, "........x.....x.", vel=0.9, bus="snare")  # 드릴 특유의 당기는 스네어
    for br in bars:
        for i in range(16):
            v = 0.5 if i % 2 == 0 else 0.35
            if i in (6, 14): continue
            b.hit(D["hat_c"], br, i // 4, i % 4, v, bus="hat")
            if i in (5, 13): b.buses.setdefault("hat", Track(b.len_s)).put(D["hat_hi"] * 0.4, b.at(br, i // 4, i % 4) + b.step * 2 / 3, 1.0)
    roots = ["E1", "E1", "G1", "G1", "C1", "C1", "D1", "B0"]
    for i, r in enumerate(roots):
        f0 = 440 * 2 ** ((N(r) - 69) / 12)
        b.hit(sub808(f0, 1.0, decay=0.7), i, 0, 0, 0.95, bus="sub"); b.hit(sub808(f0 * 2 ** (3 / 12), 0.5, glide_from=f0, decay=0.5), i, 1, 2, 0.9, bus="sub"); b.hit(sub808(f0, 0.8, glide_from=f0 * 1.5, decay=0.6), i, 2, 3, 0.9, bus="sub"); b.hit(sub808(f0, 0.5, decay=0.4), i, 3, 2, 0.8, bus="sub")
    riff = [("E5", 0, 0), ("G5", 0, 2), ("B4", 1, 0), ("E5", 1, 2), ("D5", 2, 0), ("B4", 2, 3), ("G4", 3, 1)]
    for br in bars:
        for n_, bt, six in riff: b.note(pno, N(n_) - (12 if br >= 4 else 0), br, bt, six, 0.9, vel=0.5, bus="keys", rel=0.15)
    CH = [("E3", "m"), ("E3", "m"), ("G3", "M"), ("G3", "M"), ("C3", "M"), ("C3", "M"), ("D3", "M"), ("B2", "m")]
    for i, (r, k) in enumerate(CH): b.chord(strings, chord_midis(r, k), i, 0, 0, 4, vel=0.22, spread=0.4, bus="pad", rel=0.6)
    return b.mix({"drum": {}, "snare": {"rev": (PLATE, 0.3)}, "hat": {"hp": 6500, "gain": 0.65}, "sub": {"lp": 170, "gain": 0.4}, "keys": {"rev": (HALL, 0.5), "gain": 1.3}, "pad": {"rev": (HALL, 0.5), "gain": 0.9}})

def trot():
    b = Beat("trot", 128, seed=14); D = drums(); bars = range(8)
    acc = gm("accordion", lp=5000); brass = gm("brass_section"); bass = gm("electric_bass_finger", cap=1.2); bell = gm("tinkle_bell")
    b.every(D["kick_a"], bars, "x...x...x...x...", bus="drum")
    b.every(D["snare_full"], bars, "..x...x...x...x.", vel=0.85, bus="snare")  # 쿵짝쿵짝
    b.every(D["tamb"], bars, "o.o.o.o.o.o.o.o.", vel=0.4, bus="hat")
    b.every(D["hat_c"], bars, ".o.o.o.o.o.o.o.o", vel=0.4, bus="hat")
    CH = [("C3", "M"), ("C3", "M"), ("F3", "M"), ("G3", "7"), ("C3", "M"), ("A3", "m"), ("F3", "M"), ("G3", "7")]
    for i, (r, k) in enumerate(CH):
        root = N(r) - 12; fifth = root + 7
        for bt, mm in [(0, root), (1, fifth), (2, root), (3, fifth)]: b.note(bass, mm, i, bt, 0, 0.8, vel=0.9, bus="bass")
        for bt in (1, 3): b.chord(brass, [m + 12 for m in chord_midis(r, k)], i, bt, 0, 0.45, vel=0.3, spread=0.3, bus="brass", rel=0.05)
    # 뽕짝 멜로디(꺾기 흉내: 짧은 앞꾸밈음)
    mel = [("E5", 0, 0, 0, 1), ("G5", 0, 1, 0, .5), ("E5", 0, 1, 2, .5), ("D5", 0, 2, 0, 1), ("C5", 0, 3, 0, 1), ("D5", 1, 0, 0, 1.5), ("E5", 1, 1, 2, .5), ("D5", 1, 2, 0, 2),
           ("F5", 2, 0, 0, 1), ("A5", 2, 1, 0, .5), ("F5", 2, 1, 2, .5), ("E5", 2, 2, 0, 1), ("D5", 2, 3, 0, 1), ("G5", 3, 0, 0, 1.5), ("F5", 3, 1, 2, .5), ("E5", 3, 2, 0, 1), ("D5", 3, 3, 0, 1),
           ("C5", 4, 0, 0, 1), ("E5", 4, 1, 0, 1), ("G5", 4, 2, 0, 2), ("A5", 5, 0, 0, 1), ("G5", 5, 1, 0, .5), ("E5", 5, 1, 2, .5), ("C5", 5, 2, 0, 2),
           ("F5", 6, 0, 0, 1), ("E5", 6, 1, 0, 1), ("D5", 6, 2, 0, 1), ("C5", 6, 3, 0, 1), ("D5", 7, 0, 0, 1), ("B4", 7, 1, 0, 1), ("C5", 7, 2, 0, 2)]
    for n_, br, bt, six, dur in mel:
        m = N(n_); b.note(acc, m - 1, br, bt, six, 0.12, vel=0.3, bus="acc", rel=0.03); b.note(acc, m, br, bt, six + 0.35 if six < 3 else six, dur, vel=0.5, bus="acc", rel=0.1)
    for br in (1, 3, 5, 7): b.hit(bell["play"](N("C6")) if False else bell.play(N("C6")), br, 3, 2, 0.35, bus="acc")
    return b.mix({"drum": {}, "snare": {"rev": (ROOM, 0.3)}, "hat": {"hp": 3000, "gain": 0.4}, "bass": {"lp": 1200, "gain": 1.0}, "brass": {"rev": (ROOM, 0.3), "gain": 1.1}, "acc": {"rev": (PLATE, 0.35), "gain": 1.5}})

def gugak():
    b = Beat("gugak", 96, swing=0.1, seed=15); D = drums(); bars = range(8)
    koto = gm("koto"); sham = gm("shamisen"); taiko = gm("taiko_drum", cap=1.0); wood = gm("woodblock", cap=0.5)
    b.every(D["kick_a"], bars, "x..x..x...x.x...", vel=0.9, bus="drum")
    b.every(D["snare_full"], bars, "....x.......x...", vel=0.8, bus="snare")
    for br in bars:  # 북(taiko) 덩-덩-쿵덕
        for bt, six, m, v in [(0, 0, 45, 1.0), (1, 2, 45, 0.6), (2, 0, 45, 0.9), (3, 0, 43, 0.6), (3, 2, 45, 0.7)]: b.note(taiko, m, br, bt, six, 0.6, vel=v * 0.8, bus="drum", rel=0.2)
        for i in range(16):  # 장구 채편 느낌(우드블록)과 꽹과리(우드슬랩)
            if i % 2 == 1: b.note(wood, 72 if i % 4 == 1 else 76, br, i // 4, i % 4, 0.15, vel=0.35, bus="perc")
        b.every(D["woodslap"], [br], "x...o.x.x...o.x.", vel=0.45, bus="perc", humanize=0.2)
    pent = ["E4", "G4", "A4", "B4", "D5", "E5"]
    riff = [(0, 0, 0, "E4", 1), (0, 1, 0, "G4", .5), (0, 1, 2, "A4", .5), (0, 2, 0, "B4", 1.5), (0, 3, 2, "A4", .5), (1, 0, 0, "G4", 1), (1, 1, 2, "E4", 2), (2, 0, 0, "B4", .5), (2, 0, 2, "D5", .5), (2, 1, 0, "E5", 1.5), (2, 2, 2, "D5", .5), (2, 3, 0, "B4", 1), (3, 0, 0, "A4", 1), (3, 1, 0, "G4", .5), (3, 1, 2, "E4", 2.5)]
    for br0 in (0, 4):
        for br, bt, six, n_, dur in riff:
            b.note(koto, N(n_) + (12 if br0 else 0), br0 + br, bt, six, dur, vel=0.6, bus="koto", rel=0.15)
            if br0 == 4: b.note(sham, N(n_), br0 + br, bt, six, dur * 0.8, vel=0.4, bus="koto", rel=0.1)
    b.hit(D["crash"], 0, 0, 0, 0.5, bus="snare"); b.hit(D["china"], 4, 0, 0, 0.5, bus="snare")
    f0 = 440 * 2 ** ((N("E1") - 69) / 12)
    for br in bars:
        for bt, six, mul, dur in [(0, 0, 1, 1.2), (2, 0, 1, 1.0), (3, 2, 1.5, 0.6)]: b.hit(sub808(f0 * mul, dur, decay=0.5), br, bt, six, 0.85, bus="sub")
    return b.mix({"drum": {}, "snare": {"rev": (HALL, 0.35)}, "perc": {"rev": (ROOM, 0.3), "gain": 1.0}, "koto": {"rev": (HALL, 0.45), "gain": 1.4}, "sub": {"lp": 150, "gain": 0.3}})

def rock():
    b = Beat("rock", 150, seed=16); D = drums(); bars = range(8)
    gtr = gm("distortion_guitar", cap=2.5); gtr2 = gm("overdriven_guitar", cap=2.5); bass = gm("electric_bass_finger", cap=1.2)
    b.every(D["kick_a"], bars, "x...x..xx...x...", bus="drum"); b.every(D["k808"], bars, "x...x..xx...x...", vel=0.25, bus="drum")
    b.every(D["snare_full"], bars, "....x.......x...", vel=1.0, bus="snare")
    b.every(D["hat_c"], bars, "x.o.x.o.x.o.x.o.", vel=0.6, bus="hat")
    b.hit(D["crash"], 0, 0, 0, 0.6, bus="snare"); b.hit(D["crash"], 4, 0, 0, 0.6, bus="snare")
    for i in range(4): b.hit(D["snare_lo"], 7, 3, i, 0.7 + i * 0.08, bus="snare")  # 마지막 필
    CH = ["E2", "E2", "G2", "A2", "E2", "E2", "C3", "D3"]
    for i, r in enumerate(CH):
        pc = [N(r), N(r) + 7, N(r) + 12]
        for s in range(0, 16, 2):
            dur = 0.45 if s not in (6, 14) else 0.9
            b.chord(gtr if i < 4 else gtr2, pc, i, s // 4, s % 4, dur, vel=0.42 if s % 4 == 0 else 0.34, spread=0.5, bus="gtr", rel=0.05)
        for s in range(0, 16, 2): b.note(bass, N(r) - 12, i, s // 4, s % 4, 0.45, vel=0.9, bus="bass")
    return b.mix({"drum": {}, "snare": {"rev": (ROOM, 0.35), "gain": 1.05}, "hat": {"hp": 5000}, "gtr": {"hp": 90, "lp": 7000, "gain": 1.3}, "bass": {"lp": 1500, "gain": 0.8}}, master_drive=1.5)

def funk():
    b = Beat("funk", 112, swing=0.08, seed=17); D = drums(); bars = range(8)
    slap = gm("slap_bass_1", cap=1.0); clav = gm("clavinet", cap=0.6); mg = gm("electric_guitar_muted", cap=0.4); brass = gm("brass_section")
    b.every(D["kick_a"], bars, "x..x..x.x..x..x.", bus="drum")
    b.every(D["snare_full"], bars, "....x.......x..o", vel=0.9, bus="snare")
    b.every(D["hat_c"], bars, "o.o.o.o.o.o.o.o.", vel=0.5, bus="hat"); b.every(D["hat_o"], bars, "..o...o...o...o.", vel=0.35, bus="hat")
    b.every(D["tamb"], bars, "..o...o...o...o.", vel=0.4, bus="hat"); b.every(D["cowbell"], [1, 3, 5, 7], "......x.......x.", vel=0.5, bus="hat")
    root = N("E1")
    line = [(0, 0, root, .5, 1), (0, 2, root, .25, .8), (0, 3, root + 12, .25, .7), (1, 2, root + 10, .5, .9), (2, 0, root, .5, 1), (2, 3, root + 7, .25, .8), (3, 0, root + 10, .25, .8), (3, 1, root + 12, .25, .7), (3, 2, root + 14, .5, .9)]
    for br in bars:
        for bt, six, m, dur, v in line: b.note(slap, m + (5 if br in (2, 6) else 0), br, bt, six, dur, vel=v * 0.95, bus="bass", rel=0.04)
        ch = chord_midis("E3" if br not in (2, 6) else "A3", "m7")
        for i in range(16):
            if i % 4 in (1, 3) or i in (6, 14): b.chord(clav, [m + 12 for m in ch][:3], br, i // 4, i % 4, 0.2, vel=0.28, spread=0.3, bus="keys", rel=0.03)
            if i % 2 == 0: b.chord(mg, ch[:3], br, i // 4, i % 4, 0.15, vel=0.3 if i % 4 == 0 else 0.22, spread=0.2, bus="gtr", rel=0.02)
        if br in (3, 7):
            for bt, six, dur in [(2, 2, .4), (3, 0, .4), (3, 2, 1.0)]: b.chord(brass, [m + 12 for m in ch], br, bt, six, dur, vel=0.38, spread=0.3, bus="brass", rel=0.05)
    return b.mix({"drum": {}, "snare": {"rev": (ROOM, 0.3)}, "hat": {"hp": 4000, "gain": 0.5}, "bass": {"lp": 2500, "gain": 0.9}, "keys": {"rev": (ROOM, 0.2), "gain": 1.2}, "gtr": {"hp": 400, "gain": 1.0}, "brass": {"rev": (ROOM, 0.35), "gain": 1.1}})

def lofi():
    b = Beat("lofi", 82, swing=0.28, seed=18); D = drums(); bars = range(8)
    ep = gm("electric_piano_1", lp=2600); vib = gm("vibraphone", lp=3000); bass = gm("acoustic_bass", cap=1.5)
    b.every(D["kick_a"], bars, "x......x..x.....", vel=0.8, bus="drum")
    b.every(D["brush"], bars, "....x.......x...", vel=0.9, bus="snare")
    b.every(D["hat_c"], bars, "o.-.o.-.o.-.o.-.", vel=0.4, bus="hat"); b.every(D["shaker"], bars, "..o...o...o...o.", vel=0.35, bus="hat")
    CH = [("D3", "m9"), ("G3", "m9"), ("C3", "maj9"), ("F3", "maj7"), ("D3", "m9"), ("G3", "m9"), ("Bb2", "maj7"), ("A2", "7")]
    for i, (r, k) in enumerate(CH):
        m = chord_midis(r, k)
        b.chord(ep, m, i, 0, 0, 3.2, vel=0.5, spread=0.35, bus="keys", rel=0.4); b.chord(ep, m[1:], i, 2, 2, 1.2, vel=0.3, spread=0.35, bus="keys", rel=0.3)
        root = N(r) - 12; b.note(bass, root, i, 0, 0, 1.8, vel=0.8, bus="bass"); b.note(bass, root + 7, i, 2, 2, 1.0, vel=0.65, bus="bass")
    mel = [("A5", 0, 1, 2, 1), ("F5", 0, 3, 0, 1.5), ("D5", 1, 1, 0, 2), ("E5", 2, 0, 2, 1), ("G5", 2, 2, 0, 2), ("A5", 3, 1, 2, 2.5), ("F5", 5, 0, 0, 1.5), ("D5", 5, 2, 0, 1), ("C5", 6, 1, 0, 2), ("A4", 7, 0, 2, 3)]
    for n_, br, bt, six, dur in mel: b.note(vib, N(n_), br, bt, six, dur, vel=0.32, bus="lead", rel=0.5)
    b.t.buf += crackle(b.len_s, 30, 0.5)
    return b.mix({"drum": {"lp": 5000}, "snare": {"rev": (ROOM, 0.35), "lp": 6000}, "hat": {"hp": 4000, "lp": 9000, "gain": 0.8}, "keys": {"rev": (HALL, 0.4), "gain": 1.15}, "bass": {"lp": 700, "gain": 0.75}, "lead": {"rev": (HALL, 0.55), "gain": 0.9}}, master_drive=1.3)

def edm():
    b = Beat("edm", 128, seed=19); D = drums(); bars = range(8)
    saw = gm("lead_2_sawtooth", lp=6000); sbass = gm("synth_bass_2", cap=0.5)
    b.every(D["kick_b"], bars, "x...x...x...x...", bus="drum"); b.every(D["k808"], bars, "x...x...x...x...", vel=0.4, bus="drum")
    b.every(D["clap"], bars, "....x.......x...", vel=1.0, bus="snare")
    b.every(D["hat_o"], bars, "..o...o...o...o.", vel=0.45, bus="hat"); b.every(D["hat_c"], bars, "o.o.o.o.o.o.o.o.", vel=0.35, bus="hat")
    b.sidechain(bars)
    CH = [("A3", "m"), ("F3", "M"), ("C3", "M"), ("G3", "M"), ("A3", "m"), ("F3", "M"), ("C3", "M"), ("G3", "M")]
    for i, (r, k) in enumerate(CH):
        m = chord_midis(r, k); m = m + [m[0] + 12]
        for det in (-0.08, 0, 0.08):  # 슈퍼소 느낌으로 살짝 어긋나게 3겹
            for j, mm in enumerate(m): b.hit(gate(saw.play(mm + det), b.step * 16, 0.2), i, 0, 0, 0.16, pan=(j - 2) * 0.2 + det * 2, bus="pad")
        for s in range(0, 16, 2): b.note(sbass, N(r) - 24 + (12 if s % 4 == 2 else 0), i, s // 4, s % 4, 0.4, vel=0.8, bus="bass", rel=0.03)
    b.hit(riser(b.step * 16), 7, 0, 0, 0.8, bus="fx"); b.hit(D["crash"], 0, 0, 0, 0.6, bus="snare"); b.hit(D["crash"], 4, 0, 0, 0.5, bus="snare")
    return b.mix({"drum": {}, "snare": {"rev": (PLATE, 0.35)}, "hat": {"hp": 6000, "gain": 0.9}, "pad": {"rev": (HALL, 0.4), "sc": True, "gain": 2.2}, "bass": {"lp": 2000, "sc": True, "gain": 0.6}, "fx": {"hp": 1500, "gain": 0.6}}, master_drive=1.35)

def ballad():
    b = Beat("ballad", 72, seed=20); D = drums(); bars = range(8)
    pno = piano(); strings = gm("string_ensemble_1", lp=4500); bass = gm("acoustic_bass", cap=2.0)
    b.every(D["kick_a"], bars, "x.......x.......", vel=0.6, bus="drum")
    b.every(D["brush"], bars, "....x.......x...", vel=0.6, bus="snare")
    b.every(D["hat_c"], bars, "..o...o...o...o.", vel=0.25, bus="hat")
    CH = [("C3", "M"), ("G2", "M"), ("A2", "m"), ("E3", "m"), ("F2", "M"), ("C3", "M"), ("D3", "m7"), ("G2", "7")]
    for i, (r, k) in enumerate(CH):
        m = chord_midis(r, k); arp = [m[0] + 12, m[1] + 12, m[2] + 12, m[0] + 24, m[2] + 12, m[1] + 12, m[0] + 12, m[2] + 12]
        for s, mm in enumerate(arp): b.note(pno, mm, i, s // 2, (s % 2) * 2, 1.2, vel=0.42 if s % 4 == 0 else 0.32, bus="keys", rel=0.4)
        b.chord(strings, [x + 12 for x in m], i, 0, 0, 4, vel=0.22, spread=0.4, bus="pad", rel=0.8)
        b.note(bass, N(r) - 12, i, 0, 0, 2.5, vel=0.7, bus="bass"); b.note(bass, N(r) - 12 + 7, i, 2, 2, 1.2, vel=0.5, bus="bass")
    return b.mix({"drum": {"lp": 4000}, "snare": {"rev": (HALL, 0.45)}, "hat": {"hp": 5000}, "keys": {"rev": (HALL, 0.5), "gain": 0.9}, "pad": {"rev": (HALL, 0.6), "gain": 0.8}, "bass": {"lp": 800, "gain": 1.0}}, rms_db=-17)

STYLES = {
    "boombap": (boom_bap, "붐뱁", 92), "trap": (trap, "트랩", 140), "drill": (drill, "드릴", 142), "trot": (trot, "뽕짝", 128), "gugak": (gugak, "국악 힙합", 96),
    "rock": (rock, "록", 150), "funk": (funk, "펑크", 112), "lofi": (lofi, "로파이", 82), "edm": (edm, "EDM", 128), "ballad": (ballad, "발라드", 72),
}

if __name__ == "__main__":
    which = sys.argv[2:] or list(STYLES)
    meta = {}
    for k in which:
        fn, name, bpm = STYLES[k]
        print(k, name, bpm)
        out = fn()
        save_mp3(out, os.path.join(OUT, f"{k}.mp3"), 112)
        meta[k] = {"name": name, "bpm": bpm, "bars": 8, "len": round(len(out) / SR, 4)}
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False))
