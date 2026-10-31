#!/usr/bin/env python3
# 노래(또는 반주 스템)에서 박자를 찾아 8마디 루프를 잘라내요: 템포 추정 → 박 위치(위상) 맞추기 → 에너지가 고르고 큰 구간 고르기 → 끊김 없는 루프
import sys, os, json, subprocess, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_argv = sys.argv; sys.argv = [sys.argv[0], os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')]  # render.py가 argv[1]을 출력 폴더로 쓰기 때문에
from render import SR, load, save_mp3, sec, peak_limit, rms_norm, fade

def onset_env(a, hop=512):
    m = a.mean(axis=1); n = len(m) // hop
    frames = m[:n * hop].reshape(n, hop)
    # 대역별 스펙트럼 플럭스(고음 타격감 포함)
    win = np.hanning(hop * 2)
    spec = []
    for i in range(n - 1):
        seg = m[i * hop:i * hop + hop * 2] * win
        spec.append(np.log1p(np.abs(np.fft.rfft(seg))))
    spec = np.array(spec); flux = np.maximum(0, np.diff(spec, axis=0)).sum(axis=1)
    flux = flux - np.convolve(flux, np.ones(16) / 16, mode="same")
    return np.maximum(0, flux), hop

def bar_similarity(env, fps, bpm):
    """같은 템포라도 2:3 혼동(스윙·셔플)이 생겨서, 마디끼리 가장 닮아 보이는 템포를 고르는 점수예요."""
    beat = 60 / bpm * fps; bar = beat * 4; nb = int(len(env) / bar) - 1; best = -1
    for ph in np.linspace(0, bar, 12, endpoint=False):
        sims = []
        for k in range(nb - 1):
            x = env[int(ph + k * bar):int(ph + k * bar + bar)]; y = env[int(ph + (k + 1) * bar):int(ph + (k + 1) * bar + bar)]
            n = min(len(x), len(y))
            if n < 10: continue
            x = x[:n] - x[:n].mean(); y = y[:n] - y[:n].mean(); d = np.sqrt((x ** 2).sum() * (y ** 2).sum())
            sims.append((x * y).sum() / d if d else 0)
        if sims: best = max(best, float(np.median(sims)))
    return best

def tempo_and_phase(a, lo=60, hi=200, hint=None):
    env, hop = onset_env(a); fps = SR / hop
    ac = np.correlate(env, env, "full")[len(env) - 1:]
    lags = np.arange(len(ac)); bpm_of = 60 * fps / np.maximum(lags, 1)
    m = (bpm_of >= lo) & (bpm_of <= hi)
    cand = lags[m][np.argsort(ac[m])[-8:]][::-1]
    scored = {}
    for L in cand:
        t = bpm_of[L]
        while t >= 130: t /= 2  # 마디 길이 비교는 60~130 범위로 통일
        key = round(t, 1)
        if key in scored: continue
        sim = bar_similarity(env, fps, t)
        has_double = any(abs(bpm_of[L2] - 2 * t) < 2 for L2 in cand)  # 두 배 템포도 후보에 있으면 더 믿을 만해요
        scored[key] = sim + (0.08 if has_double else 0) + (0.1 if hint and abs(t - hint) < 3 else 0)
    bpm = max(scored, key=scored.get)
    beat = 60 / bpm; Lb = beat * fps
    # 위상: 박 격자가 온셋을 가장 많이 밟는 시작점
    nb = int(len(env) / Lb); bestph, bs = 0, -1
    for ph in np.linspace(0, Lb, 48, endpoint=False):
        idx = (ph + np.arange(nb) * Lb).astype(int); idx = idx[idx < len(env)]
        s_ = env[idx].sum()
        if s_ > bs: bs, bestph = s_, ph
    # 다운비트: 4박 중 저음(킥) 에너지가 가장 큰 오프셋
    low = np.abs(a.mean(axis=1))
    times = bestph / fps + np.arange(nb) * beat
    lowenv = np.array([low[int(t * SR):int(t * SR) + int(0.06 * SR)].mean() if int(t * SR) + int(0.06 * SR) < len(low) else 0 for t in times])
    db = max(range(4), key=lambda o: lowenv[o::4].sum() if len(lowenv[o::4]) else 0)
    return bpm, bestph / fps + db * beat, beat

def pick_loop(a, bpm, t_first, bars=8, skip_s=0.0, prefer=None):
    """다운비트 격자 위에서 bars 마디 길이 구간 중, 소리가 크고 고르며(보컬 적은) 구간을 골라요."""
    bar = 60 / bpm * 4; L = bar * bars
    n_bars = int((len(a) / SR - t_first) / bar)
    best, bscore = None, -1e9
    for b in range(0, n_bars - bars):
        st = t_first + b * bar
        if st < skip_s: continue
        seg = a[sec(st):sec(st + L)]
        if len(seg) < sec(L): break
        rms = np.sqrt((seg ** 2).mean()); per_bar = np.array([np.sqrt((seg[sec(i * bar):sec((i + 1) * bar)] ** 2).mean()) for i in range(bars)])
        evenness = per_bar.min() / (per_bar.max() + 1e-9)
        score = 20 * np.log10(rms + 1e-9) + 6 * evenness
        if prefer is not None: score += prefer(st, st + L)
        if score > bscore: best, bscore = st, score
    return best, L

def make_loop(a, st, L, xf=0.08):
    seg = a[sec(st):sec(st + L + xf)].copy()
    out = seg[:sec(L)].copy(); X = sec(xf)
    w = np.sin(np.linspace(0, math.pi / 2, X))[:, None]
    out[:X] = out[:X] * w + seg[sec(L):sec(L) + X] * np.flip(w)
    return out

if __name__ == "__main__" and not os.environ.get("KARAOKE"):
    sys.argv = _argv
    src, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
    bars = int(sys.argv[4]) if len(sys.argv) > 4 else 8
    a = load(src)
    bpm, t0, beat = tempo_and_phase(a)
    st, L = pick_loop(a, bpm, t0, bars)
    loop = make_loop(a, st, L)
    loop = peak_limit(rms_norm(loop, -16), 0.9)
    os.makedirs(out, exist_ok=True)
    save_mp3(loop, os.path.join(out, f"{name}.mp3"), 128)
    meta = {"bpm": round(bpm, 2), "bars": bars, "len": round(L, 4), "start": round(st, 3)}
    print(json.dumps(meta)); json.dump(meta, open(os.path.join(out, f"{name}.json"), "w"))

# ---------- 직접 만든 '노래방' 반주 추출(외부 프로그램 없이) ----------
def bandpass_fft(x, lo, hi):
    n = len(x); F = np.fft.rfft(x, axis=0); f = np.fft.rfftfreq(n, 1 / SR)
    g = 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-6)) ** 4) / np.sqrt(1 + (f / hi) ** 4)
    return np.fft.irfft(F * g[:, None], n=n, axis=0).astype(np.float32)

def karaoke(a, strength=0.9):
    """목소리는 보통 한가운데(좌우 똑같이)에 있어요. 가운데 소리 중 목소리 대역(180~5000Hz)만 빼고,
    가운데에 같이 있는 킥·베이스(저음)와 공기감(고음)은 그대로 둬요. 좌우로 퍼진 악기는 전부 남아요."""
    mid = a.mean(axis=1, keepdims=True); mid_voice = bandpass_fft(mid, 180, 5000)
    return (a - strength * mid_voice).astype(np.float32)

def vocal_ratio(seg):
    """구간에 목소리가 얼마나 있는지: 가운데 소리의 목소리 대역 에너지 / 전체"""
    mid = seg.mean(axis=1); side = (seg[:, 0] - seg[:, 1]) / 2
    F = np.abs(np.fft.rfft(mid)) ** 2; f = np.fft.rfftfreq(len(mid), 1 / SR); v = F[(f > 300) & (f < 3000)].sum()
    Fs = np.abs(np.fft.rfft(side)) ** 2; tot = F.sum() + Fs.sum() + 1e-9
    return float(v / tot)

if __name__ == "__main__" and os.environ.get("KARAOKE"):
    sys.argv = _argv
    src, out, name = sys.argv[1], sys.argv[2], sys.argv[3]; bars = int(sys.argv[4]) if len(sys.argv) > 4 else 8
    a = load(src)
    bpm, t0, beat = tempo_and_phase(a)
    # 목소리가 적은 구간을 선호하면서(간주·전주) 크고 고른 8마디를 골라요
    vr_cache = {}
    def prefer(st, en):
        seg = a[sec(st):sec(en)]; r = vocal_ratio(seg); vr_cache[round(st, 2)] = r
        return -28 * r
    st, L = pick_loop(a, bpm, t0, bars, prefer=prefer)
    loop = make_loop(karaoke(a), st, L)
    loop = peak_limit(rms_norm(loop, -16), 0.9)
    os.makedirs(out, exist_ok=True); save_mp3(loop, os.path.join(out, f"{name}.mp3"), 128)
    meta = {"bpm": round(bpm, 2), "bars": bars, "len": round(L, 4), "start": round(st, 3), "vocal_ratio": round(vr_cache.get(round(st, 2), -1), 3)}
    print(json.dumps(meta)); json.dump(meta, open(os.path.join(out, f"{name}.json"), "w"))
