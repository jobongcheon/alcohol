#!/usr/bin/env python3
# 숨구멍 수면 음악 렌더러: 실제 녹음(비·파도·바람)과 실제 악기 샘플(피아노·하프·첼로·플루트·패드)로
# 끊김 없이 이어지는 루프 mp3를 만들어요. 결과물은 sumgumeong/audio/ 에 들어가요.
import subprocess, sys, os, json, math
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
TI = os.path.join(HERE, "ti", "samples")
PAD = os.path.join(HERE, "pad")
BLANKET = os.path.join(HERE, "blanket", "data", "resources", "sounds")
MOODIST = os.path.join(HERE, "moodist", "public", "sounds")

def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float32)

def save_mp3(arr, path, kbps=112):
    arr = np.clip(arr, -0.98, 0.98).astype(np.float32)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-", "-codec:a", "libmp3lame", "-b:a", f"{kbps}k", "-joint_stereo", "1", path], input=arr.tobytes(), check=True)
    print(f"  -> {os.path.relpath(path, OUT)}  {len(arr)/SR:.1f}s  {os.path.getsize(path)/1e6:.2f}MB")

def sec(s): return int(round(s * SR))

def fade(arr, a_in, a_out):
    arr = arr.copy(); n = len(arr)
    if a_in: k = min(n, sec(a_in)); arr[:k] *= np.linspace(0, 1, k, dtype=np.float32)[:, None] ** 1.5
    if a_out: k = min(n, sec(a_out)); arr[n - k:] *= np.linspace(1, 0, k, dtype=np.float32)[:, None] ** 1.5
    return arr

def make_loop(arr, length_s, xf_s=4.0, start_s=0.0):
    """앞부분 length+xf 초를 잘라, 꼬리 xf 초를 머리에 겹쳐 녹여 끊김 없는 루프를 만들어요."""
    L, X, S = sec(length_s), sec(xf_s), sec(start_s)
    body = arr[S:S + L + X]
    assert len(body) == L + X, "source too short"
    out = body[:L].copy()
    w = np.sin(np.linspace(0, math.pi / 2, X, dtype=np.float32))[:, None]
    out[:X] = out[:X] * w + body[L:L + X] * np.flip(w)
    return out

def rms_norm(arr, target_db):
    r = float(np.sqrt(np.mean(arr ** 2))) + 1e-9
    return arr * (10 ** (target_db / 20) / r)

def peak_limit(arr, peak=0.9):
    p = float(np.max(np.abs(arr))) + 1e-9
    return arr * min(1.0, peak / p)

def lowpass(arr, cutoff_hz):
    """단순 1차 저역 통과(두 번 통과). 샘플을 부드럽게 할 때 써요."""
    a = math.exp(-2 * math.pi * cutoff_hz / SR)
    out = np.empty_like(arr)
    for ch in range(arr.shape[1]):
        y = 0.0; col = arr[:, ch]; o = out[:, ch]
        # 벡터화된 1차 IIR: 누적 필터를 위해 scipy 없이 청크 반복
        buf = col.astype(np.float64)
        res = np.empty_like(buf)
        for i in range(len(buf)):
            y = a * y + (1 - a) * buf[i]; res[i] = y
        o[:] = res
    return out

def lowpass_fast(arr, cutoff_hz):
    """FFT로 하는 부드러운 저역 통과(1차 기울기 흉내)."""
    n = len(arr); F = np.fft.rfft(arr, axis=0); f = np.fft.rfftfreq(n, 1 / SR)
    g = 1 / np.sqrt(1 + (f / cutoff_hz) ** 2)
    return np.fft.irfft(F * g[:, None], n=n, axis=0).astype(np.float32)

def reverb_ir(seconds=6.0, decay=2.2, dark=3200, pre=0.02, width=0.9):
    rng = np.random.default_rng(7)
    n = sec(seconds); t = np.arange(n) / SR
    env = np.exp(-t / (seconds / decay)) * (t > pre)
    noise = rng.standard_normal((n, 2)).astype(np.float32)
    mid = noise.mean(axis=1, keepdims=True); side = (noise - mid) * width
    ir = (mid + side) * env[:, None]
    ir = lowpass_fast(ir, dark)
    # 시간이 갈수록 더 어두워지게 한 번 더
    tilt = np.exp(-t / (seconds * 0.55))[:, None]
    ir = ir * (0.35 + 0.65 * tilt)
    ir /= (np.sqrt(np.sum(ir ** 2)) + 1e-9) * 0.7
    return ir.astype(np.float32)

def convolve_blocks(x, ir, block=1 << 18):
    """메모리를 아끼는 분할 FFT 합성곱(채널별 overlap-add)."""
    m = len(ir); nfft = 1
    while nfft < block + m - 1: nfft <<= 1
    out = np.zeros((len(x) + m - 1, 2), dtype=np.float32)
    for ch in range(2):
        IR = np.fft.rfft(ir[:, ch], nfft)
        for s in range(0, len(x), block):
            seg = x[s:s + block, ch]
            y = np.fft.irfft(np.fft.rfft(seg, nfft) * IR, nfft)[:len(seg) + m - 1]
            out[s:s + len(y), ch] += y.astype(np.float32)
    return out

NOTE_IDX = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
def midi_of(name):
    i = NOTE_IDX[name[0]]; rest = name[1:]
    if rest.startswith("s") or rest.startswith("#"): i += 1; rest = rest[1:]
    elif rest.startswith("b"): i -= 1; rest = rest[1:]
    return 12 * (int(rest) + 1) + i

class Instrument:
    def __init__(self, folder, ext, cap_s=None, fade_out=2.5, lp=None, gain=1.0):
        self.notes = {}
        for f in sorted(os.listdir(folder)):
            if not f.endswith(ext) or " " in f: continue
            name = f[:-len(ext)]
            try: m = midi_of(name)
            except Exception: continue
            a = load(os.path.join(folder, f))
            if cap_s and len(a) > sec(cap_s): a = a[:sec(cap_s)]
            a = fade(a, 0.0, min(fade_out, len(a) / SR * 0.5))
            if lp: a = lowpass_fast(a, lp)
            self.notes[m] = a * gain
        self.keys = np.array(sorted(self.notes))
        print(f"  {os.path.basename(folder)}: {len(self.notes)} samples")
    def play(self, midi):
        k = int(self.keys[np.argmin(np.abs(self.keys - midi))])
        a = self.notes[k]; st = midi - k
        if st == 0: return a
        r = 2 ** (st / 12); n = int(len(a) / r)
        idx = np.arange(n) * r
        return np.stack([np.interp(idx, np.arange(len(a)), a[:, c]) for c in range(2)], axis=1).astype(np.float32)

class Track:
    def __init__(self, length_s, seed=1):
        self.L = sec(length_s); self.buf = np.zeros((self.L, 2), dtype=np.float32); self.rng = np.random.default_rng(seed)
    def put(self, arr, at_s, gain=1.0, pan=0.0):
        """루프 길이를 넘는 꼬리는 처음으로 접어 넣어서, 반복 지점이 자연스러워요."""
        a = arr * gain
        if pan: a = a * np.array([1 - max(0, pan), 1 - max(0, -pan)], dtype=np.float32) ** 0.5
        s = sec(at_s) % self.L; n = len(a); i = 0
        while i < n:
            take = min(n - i, self.L - s)
            self.buf[s:s + take] += a[i:i + take]; i += take; s = 0
    def reverb(self, ir, wet=0.4, dry=1.0):
        w = convolve_blocks(self.buf, ir)
        out = self.buf * dry
        # 꼬리를 루프 머리로 접기
        tail = w[self.L:]; w = w[:self.L].copy()
        s = 0
        while len(tail):
            take = min(len(tail), self.L); w[s:s + take] += tail[:take]; tail = tail[take:]
        self.buf = (out + w * wet).astype(np.float32)
    def done(self, rms_db=-22, peak=0.85):
        return peak_limit(rms_norm(self.buf, rms_db), peak)

def envelope_digits(arr, per_sec=4):
    """시각 효과 동기화용: 0.25초마다 소리 크기를 0~9 한 자리로."""
    hop = SR // per_sec; n = len(arr) // hop
    e = np.array([np.sqrt(np.mean(arr[i * hop:(i + 1) * hop] ** 2)) for i in range(n)])
    # 부드럽게(앞뒤 평균) 후 정규화
    k = np.ones(3) / 3; e = np.convolve(e, k, mode="same")
    lo, hi = np.percentile(e, 5), np.percentile(e, 98)
    e = np.clip((e - lo) / (hi - lo + 1e-9), 0, 1)
    return "".join(str(int(round(v * 9))) for v in e)

# ---------- 1) 실제 녹음: 비, 파도, 바람 ----------
def ambient():
    print("ambient loops")
    env = {}
    rain = load(os.path.join(BLANKET, "rain.ogg"))
    rain = make_loop(rain, 72, 5, 10); rain = peak_limit(rms_norm(rain, -20), 0.9)
    save_mp3(rain, os.path.join(OUT, "rain.mp3"), 96)
    waves = load(os.path.join(BLANKET, "waves.ogg"))
    waves = make_loop(waves, 76, 6, 8); waves = peak_limit(rms_norm(waves, -20), 0.92)
    save_mp3(waves, os.path.join(OUT, "waves.mp3"), 96); env["waves"] = envelope_digits(waves)
    wind = load(os.path.join(MOODIST, "nature", "wind.mp3"))
    wind = make_loop(wind, 66, 5, 2); wind = peak_limit(rms_norm(wind, -21), 0.9)
    save_mp3(wind, os.path.join(OUT, "wind.mp3"), 96); env["wind"] = envelope_digits(wind)
    return env

# ---------- 2) 잔잔한 화음: 진짜 패드 소리로 ----------
def chord_pad(pad):
    print("chord pad")
    CH = [["C3", "G3", "B3", "E4"], ["A2", "E3", "C4", "E4"], ["F2", "F3", "A3", "E4"], ["G2", "D3", "B3", "D4"]]
    t = Track(48, 3)
    for ci, chord in enumerate(CH):
        for j, n in enumerate(chord):
            a = sustain(pad, midi_of(n), 16, attack=4.5, release=6)
            t.put(a, ci * 12 - 1.5 + j * 0.15, 0.55 if j else 0.7, pan=(-0.35, 0.3, -0.15, 0.35)[j])
    t.reverb(reverb_ir(5.5, 2.4, 2600), wet=0.35)
    save_mp3(t.done(-23, 0.8), os.path.join(OUT, "chord.mp3"), 96)

def sustain(inst, midi, length_s, attack=3.0, release=4.0):
    """짧은 샘플을 겹쳐 이어 붙여 길게 끄는 음(패드·드론용)."""
    base = inst.play(midi); n = sec(length_s); out = np.zeros((n + sec(release), 2), dtype=np.float32)
    seg = len(base); hop = int(seg * 0.5); pos = 0
    w = np.hanning(seg).astype(np.float32)[:, None]
    while pos < n:
        take = min(seg, len(out) - pos); out[pos:pos + take] += (base * w)[:take]; pos += hop
    return fade(out, attack, release)

# ---------- 3) 명상 음악 세 곡 ----------
def med_piano(piano, pad):
    print("med-piano 새벽 피아노")
    t = Track(216, 11); rng = t.rng
    ir = reverb_ir(7.5, 2.0, 3000, 0.03)
    # 패드: 느리게 바뀌는 화음 (Am9 Fmaj7 Cmaj7 Em7)
    CH = [["A2", "E3", "B3", "C4"], ["F2", "C3", "E3", "A3"], ["C3", "G3", "B3", "E4"], ["E2", "B2", "D3", "G3"]]
    for ci, chord in enumerate(CH):
        for j, n in enumerate(chord):
            t.put(sustain(pad, midi_of(n), 62, 9, 10), ci * 54 - 4 + j * 0.3, 0.28, pan=(-0.3, 0.2, -0.1, 0.3)[j])
    # 피아노: A 단조 5음계 중심, 2.5~7초마다 한 음, 가끔 5도·3도 화음
    pool = ["A3", "C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "B4", "F4"]
    bass = ["A2", "E2", "F2", "C3", "E2", "A2", "G2", "A2"]
    tt = 1.0; last = None
    while tt < 216:
        n = rng.choice(pool[:10] if rng.random() < 0.85 else pool)
        while n == last: n = rng.choice(pool)
        last = n; v = rng.uniform(0.28, 0.62)
        a = piano.play(midi_of(n)); a = lowpass_fast(a, 5200 + 6000 * v)
        t.put(a, tt, v, pan=rng.uniform(-0.35, 0.35))
        if rng.random() < 0.3:  # 화음 한 음 더(3도 또는 5도 아래)
            m2 = midi_of(n) - rng.choice([3, 4, 7]); t.put(piano.play(m2), tt + rng.uniform(0.05, 0.4), v * 0.75, pan=rng.uniform(-0.3, 0.3))
        if rng.random() < 0.22:  # 베이스
            b = bass[int(tt // 27) % len(bass)]; t.put(piano.play(midi_of(b)), tt + rng.uniform(0, 1.5), 0.42, pan=-0.1)
        tt += rng.uniform(2.6, 7.2)
    t.reverb(ir, wet=0.5, dry=0.9)
    save_mp3(t.done(-23, 0.85), os.path.join(OUT, "med-piano.mp3"))

def med_bowl(pad, harp, cello):
    print("med-bowl 싱잉볼")
    t = Track(210, 23); rng = t.rng
    bowl = load(os.path.join(MOODIST, "things", "singing-bowl.mp3"))
    bowl = make_loop(bowl, 42, 5, 0.5); bowl = rms_norm(bowl, -26)
    for k in range(0, 210, 42): t.put(bowl, k, 1.0)
    # 드론 D2 + A2, 가끔 F#3
    for n, g, p in (("D2", 0.3, -0.2), ("A2", 0.22, 0.2)):
        for k in range(0, 210, 60): t.put(sustain(pad, midi_of(n), 66, 10, 12), k - 6, g, pan=p)
    # 첼로 긴 음(D3, A3, F#3, E3) 30초마다
    for i, n in enumerate(["D3", "A3", "Fs3", "E3", "D3", "A3", "G3"]):
        a = cello.play(midi_of(n)); a = fade(a, 1.2, 1.5)
        t.put(a, 12 + i * 30 + rng.uniform(-2, 2), 0.3, pan=rng.uniform(-0.2, 0.2))
    # 하프: D 장조 5음계, 6~12초마다 한두 음
    pool = ["D4", "E4", "Fs4", "A4", "B4", "D5", "E5", "Fs5", "A5"]
    tt = 4.0
    while tt < 210:
        n = rng.choice(pool); t.put(harp.play(midi_of(n)), tt, rng.uniform(0.3, 0.5), pan=rng.uniform(-0.4, 0.4))
        if rng.random() < 0.4: t.put(harp.play(midi_of(rng.choice(pool))), tt + rng.uniform(0.3, 0.8), rng.uniform(0.25, 0.4), pan=rng.uniform(-0.4, 0.4))
        tt += rng.uniform(6, 12)
    t.reverb(reverb_ir(8.5, 1.9, 2800, 0.03), wet=0.55, dry=0.85)
    save_mp3(t.done(-23, 0.85), os.path.join(OUT, "med-bowl.mp3"))

def med_harp(harp, flute, pad):
    print("med-harp 숲속 하프")
    t = Track(204, 37); rng = t.rng
    CH = [["C3", "G3", "E4", "B4"], ["A2", "E3", "C4", "G4"], ["F2", "C3", "A3", "E4"], ["G2", "D3", "B3", "F4"]]
    for ci, chord in enumerate(CH):
        for j, n in enumerate(chord):
            t.put(sustain(pad, midi_of(n), 58, 8, 10), ci * 51 - 4 + j * 0.3, 0.22, pan=(-0.3, 0.2, -0.1, 0.3)[j])
    # 하프 아르페지오: 8~14초마다 4~6음이 올라가요 (C 장조 5음계)
    scale = ["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5", "C6"]
    tt = 2.0
    while tt < 204:
        start = rng.integers(0, 4); step = rng.choice([1, 2]); cnt = rng.integers(4, 7)
        gap = rng.uniform(0.32, 0.5); pan0 = rng.uniform(-0.4, 0.1)
        for i in range(cnt):
            idx = min(len(scale) - 1, start + i * step)
            t.put(harp.play(midi_of(scale[idx])), tt + i * gap, rng.uniform(0.3, 0.48) * (1 - i * 0.05), pan=pan0 + i * 0.12)
        if rng.random() < 0.5:  # 내려오는 짧은 꼬리
            for i in range(2):
                idx = min(len(scale) - 1, max(0, start + (cnt - 2 - i) * step)); t.put(harp.play(midi_of(scale[idx])), tt + cnt * gap + i * gap * 1.4, 0.26, pan=rng.uniform(-0.3, 0.3))
        tt += rng.uniform(8, 14)
    # 플루트: 20~35초마다 긴 음 하나(천천히 들어와요)
    fl = ["E5", "G5", "A5", "C6", "D5", "G5", "E5", "A5"]
    tt = 9.0; i = 0
    while tt < 204:
        a = flute.play(midi_of(fl[i % len(fl)])); a = fade(a, 1.6, 1.8); a = lowpass_fast(a, 4200)
        t.put(a, tt, 0.2, pan=rng.uniform(-0.2, 0.2)); i += 1; tt += rng.uniform(20, 35)
    t.reverb(reverb_ir(6.0, 2.2, 3400, 0.025), wet=0.45, dry=0.9)
    save_mp3(t.done(-23, 0.85), os.path.join(OUT, "med-harp.mp3"))

if __name__ == "__main__":
    which = sys.argv[2:] or ["ambient", "chord", "piano", "bowl", "harp"]
    env = {}
    if "ambient" in which: env = ambient()
    need = set(which) & {"chord", "piano", "bowl", "harp"}
    if need:
        print("loading instruments")
        pad = Instrument(PAD, ".mp3", cap_s=3.2, fade_out=0.3, gain=0.9)
        if "chord" in which: chord_pad(pad)
        if "piano" in which: med_piano(Instrument(os.path.join(TI, "piano"), ".wav", cap_s=14, fade_out=4), pad)
        if "bowl" in which: med_bowl(pad, Instrument(os.path.join(TI, "harp"), ".wav", cap_s=8, fade_out=2), Instrument(os.path.join(TI, "cello"), ".wav", cap_s=10, fade_out=2.5, lp=3800))
        if "harp" in which: med_harp(Instrument(os.path.join(TI, "harp"), ".wav", cap_s=8, fade_out=2), Instrument(os.path.join(TI, "flute"), ".wav", cap_s=9, fade_out=2), pad)
    if env:
        json.dump(env, open(os.path.join(OUT, "env.json"), "w"))
        print("env lengths", {k: len(v) for k, v in env.items()})
    print("done")
