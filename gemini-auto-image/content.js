// Gemini Auto Image - 콘텐츠 스크립트
// Google Flow(flow.google.com)와 Gemini(gemini.google.com) 페이지에서
// 생성 설정(이미지/동영상, 비율, 모델, 개수) 선택, 프롬프트 입력, 참조 이미지 첨부,
// 생성 버튼 클릭, 결과 수집을 담당한다.
(() => {
  if (window.__geminiAutoImageLoaded) return;
  window.__geminiAutoImageLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let stopRequested = false;

  const SUBMIT_WORDS = /(generate|create|send|submit|run|생성|만들기|보내기|전송|제출)/i;
  const NOT_SUBMIT = /(close|닫기|delete|삭제|cancel|취소|attach|첨부|upload|업로드|add|추가|setting|설정|agent|에이전트|search|검색|filter|필터|menu|메뉴|more|더보기|help|도움말|^\+$|x[1-4]\b|nano|banana|veo|imagen)/i;
  const SUBMIT_ICONS = /\b(arrow_forward|arrow_upward|send|north|arrow_right_alt)\b/;
  const MODEL_WORDS = /(nano|banana|veo|imagen|gemini)/i;
  const NO_SIGNAL_MS = 30000; // 생성 버튼을 누른 뒤 이 시간 동안 아무 변화가 없으면 실패로 본다

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) !== 0;
  }

  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelOf = (el) =>
    [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-tooltip'), textOf(el)]
      .filter(Boolean)
      .join(' ')
      .slice(0, 120);
  const isDisabled = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true';

  function realClick(el) {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function pressEscape() {
    const t = document.activeElement || document.body;
    const ev = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true };
    t.dispatchEvent(new KeyboardEvent('keydown', ev));
    t.dispatchEvent(new KeyboardEvent('keyup', ev));
  }

  // ---------- 입력창 ----------
  function findPromptInput() {
    const candidates = [
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('[contenteditable="true"]'),
      ...document.querySelectorAll('[role="textbox"]')
    ].filter((el) => isVisible(el) && !el.closest('[aria-hidden="true"]'));
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return candidates[0];
  }

  const isPlainInput = (el) => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
  const inputText = (el) => (isPlainInput(el) ? el.value : el.innerText || '');
  const squash = (s) => (s || '').replace(/\s+/g, '');

  function selectAllIn(el) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function setPrompt(input, text) {
    input.focus();
    if (isPlainInput(input)) {
      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(input, text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
      return squash(input.value) === squash(text);
    }

    // 리치 에디터(contenteditable): 내부 상태가 바뀌도록 편집 명령과 붙여넣기 이벤트만 쓴다.
    const want = squash(text).length;
    const filled = () => squash(inputText(input)).length >= want * 0.9;

    selectAllIn(input);
    document.execCommand('delete');
    await sleep(80);

    // 1) 붙여넣기 이벤트: 줄바꿈을 문단으로 유지한다
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(250);
    if (filled()) return true;

    // 2) 편집 명령으로 입력
    selectAllIn(input);
    document.execCommand('insertText', false, text);
    await sleep(250);
    if (filled()) return true;

    // 3) beforeinput 이벤트 (일부 에디터용)
    selectAllIn(input);
    input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
    await sleep(250);
    return filled();
  }

  // 입력창을 감싸는 작성 영역 (입력창, 설정 칩, 생성 버튼이 함께 있는 상자)
  function findComposer(input) {
    let el = input;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      const r = el.getBoundingClientRect();
      const btns = [...el.querySelectorAll('button, [role="button"]')].filter(isVisible);
      if (btns.length >= 2 && r.width < window.innerWidth * 0.95) return el;
    }
    return input.parentElement || document.body;
  }

  // ---------- 생성 버튼 ----------
  function findSubmitButton(input) {
    const composer = findComposer(input);
    const cr = composer.getBoundingClientRect();
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(isVisible);
    let best = null;
    let bestScore = 0;
    for (const b of buttons) {
      const label = labelOf(b);
      const r = b.getBoundingClientRect();
      let score = 0;
      if (SUBMIT_ICONS.test(b.innerText || '') || SUBMIT_ICONS.test(b.getAttribute('aria-label') || '')) score += 6;
      if (SUBMIT_WORDS.test(label)) score += 5;
      if (composer.contains(b)) score += 4;
      const inBand = r.top >= cr.top - 10 && r.bottom <= cr.bottom + 60 && r.left >= cr.left - 10 && r.right <= cr.right + 60;
      if (inBand) {
        score += 2;
        // 작성 영역 오른쪽 아래에 있을수록 생성 버튼일 가능성이 높다
        score += Math.max(0, 3 - Math.hypot(cr.right - r.right, cr.bottom - r.bottom) / 40);
      }
      if (NOT_SUBMIT.test(label) && !SUBMIT_ICONS.test(b.innerText || '')) score -= 10;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return bestScore >= 4 ? best : null;
  }

  // ---------- 생성 설정 (Flow 의 설정 칩) ----------
  function clickableAll() {
    return [
      ...document.querySelectorAll(
        'button, [role="button"], [role="tab"], [role="option"], [role="radio"], [role="menuitem"], [role="menuitemradio"], [role="combobox"], [role="listbox"] li, label'
      )
    ].filter(isVisible);
  }

  function findExact(words, root) {
    const list = clickableAll().filter((el) => !root || root.contains(el));
    for (const w of words) {
      const hit = list.find((el) => textOf(el).toLowerCase() === w.toLowerCase());
      if (hit) return hit;
    }
    for (const w of words) {
      const re = new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
      const hit = list.find((el) => textOf(el).length <= 30 && re.test(textOf(el)));
      if (hit) return hit;
    }
    return null;
  }

  function findSettingsChip(input) {
    const composer = findComposer(input);
    const list = [...composer.querySelectorAll('button, [role="button"]')].filter(isVisible);
    return (
      list.find((b) => /x\s?[1-4]\b/i.test(textOf(b)) && MODEL_WORDS.test(textOf(b))) ||
      list.find((b) => /x\s?[1-4]\b/i.test(textOf(b))) ||
      list.find((b) => MODEL_WORDS.test(textOf(b))) ||
      null
    );
  }

  const ratioVisible = () => !!findExact(['16:9']) && !!findExact(['9:16']);

  let lastConfigKey = '';

  async function configure(input, cfg) {
    const key = JSON.stringify(cfg);
    if (key === lastConfigKey) return { applied: true, skipped: true, warnings: [] };
    const warnings = [];

    const chip = findSettingsChip(input);
    if (!chip) {
      return { applied: false, warnings: ['Flow 설정 버튼(모델 · x1)을 찾지 못해 현재 설정 그대로 생성합니다.'] };
    }
    if (!ratioVisible()) {
      realClick(chip);
      for (let i = 0; i < 10 && !ratioVisible(); i++) await sleep(150);
    }
    if (!ratioVisible()) {
      pressEscape();
      return { applied: false, warnings: ['Flow 설정 창이 열리지 않아 현재 설정 그대로 생성합니다.'] };
    }

    // 1) 이미지 / 동영상
    const kindEl = cfg.kind === 'video' ? findExact(['동영상', 'Video', 'Videos']) : findExact(['이미지', 'Image', 'Images']);
    if (kindEl) {
      realClick(kindEl);
      await sleep(350);
    } else warnings.push(cfg.kind === 'video' ? '동영상 탭을 찾지 못했습니다.' : '이미지 탭을 찾지 못했습니다.');

    // 2) 비율
    const ratioEl = findExact([cfg.ratio]);
    if (ratioEl) {
      realClick(ratioEl);
      await sleep(200);
    } else warnings.push(`${cfg.ratio} 비율 버튼을 찾지 못했습니다.`);

    // 3) 모델
    if (cfg.model) {
      const popupRoot = ratioEl ? ratioEl.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]') : null;
      const already = clickableAll().find((el) => el !== chip && (!popupRoot || popupRoot.contains(el)) && MODEL_WORDS.test(textOf(el)) && textOf(el).toLowerCase().includes(cfg.model.toLowerCase()) && textOf(el).length < 60);
      if (!already) {
        const dropdown = clickableAll().find((el) => el !== chip && !chip.contains(el) && (!popupRoot || popupRoot.contains(el)) && MODEL_WORDS.test(textOf(el)) && textOf(el).length < 60);
        if (dropdown) {
          realClick(dropdown);
          await sleep(400);
          const want = cfg.model.toLowerCase();
          const options = clickableAll().filter((el) => el !== dropdown && textOf(el).toLowerCase().includes(want) && textOf(el).length < 80);
          options.sort((a, b) => textOf(a).length - textOf(b).length);
          if (options[0]) {
            realClick(options[0]);
            await sleep(300);
          } else {
            warnings.push(`"${cfg.model}" 모델을 목록에서 찾지 못했습니다.`);
            pressEscape();
            await sleep(200);
          }
        } else warnings.push('모델 선택 목록을 찾지 못했습니다.');
      }
    }

    // 4) 생성 개수
    if (cfg.count) {
      const countEl = findExact([`x${cfg.count}`, `×${cfg.count}`]);
      if (countEl) {
        realClick(countEl);
        await sleep(150);
      }
    }

    // 설정 창 닫기
    if (ratioVisible()) {
      pressEscape();
      await sleep(250);
    }
    if (ratioVisible()) {
      realClick(chip);
      await sleep(250);
    }
    input.focus();

    if (!warnings.length) lastConfigKey = key;
    return { applied: warnings.length === 0, warnings };
  }

  // ---------- 참조 이미지 ----------
  async function dataUrlToFile(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || 'image/png' });
  }

  async function attachReferences(refs, input) {
    if (!refs || !refs.length) return { attached: 0 };
    const files = [];
    for (let i = 0; i < refs.length; i++) files.push(await dataUrlToFile(refs[i].dataUrl, refs[i].name || `reference-${i + 1}.png`));
    const fileInput = [...document.querySelectorAll('input[type="file"]')].find((el) => !el.accept || /image/.test(el.accept));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    if (fileInput) {
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input) {
      input.focus();
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } else return { attached: 0 };
    await sleep(1500);
    return { attached: files.length };
  }

  // ---------- 결과 ----------
  function mediaSrc(el) {
    if (el.tagName === 'VIDEO') return el.currentSrc || el.src || (el.querySelector('source') && el.querySelector('source').src) || '';
    return el.currentSrc || el.src || '';
  }

  function collectMedia() {
    const list = [];
    document.querySelectorAll('img, video').forEach((el) => {
      const src = mediaSrc(el);
      if (!src || src.startsWith('data:image/svg')) return;
      const r = el.getBoundingClientRect();
      const w = el.tagName === 'VIDEO' ? Math.max(el.videoWidth, r.width) : Math.max(el.naturalWidth, r.width);
      const h = el.tagName === 'VIDEO' ? Math.max(el.videoHeight, r.height) : Math.max(el.naturalHeight, r.height);
      if (w < 200 || h < 120) return; // 아이콘, 프로필 사진 제외
      list.push({ src, type: el.tagName === 'VIDEO' ? 'video' : 'image' });
    });
    return list;
  }

  function busyCount() {
    let n = 0;
    document.querySelectorAll('[role="progressbar"], [aria-busy="true"], mat-progress-spinner, progress').forEach((el) => { if (isVisible(el)) n++; });
    // Flow 는 생성 중인 칸에 "37%" 같은 진행률을 띄운다
    document.querySelectorAll('div, span, p').forEach((el) => {
      if (el.children.length === 0 && /^\s*\d{1,3}\s*%\s*$/.test(el.textContent || '') && isVisible(el)) n++;
    });
    return n;
  }

  async function toTransferable(item) {
    if (!item.src.startsWith('blob:')) return item;
    try {
      const blob = await (await fetch(item.src)).blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      return { ...item, src: dataUrl };
    } catch (e) {
      return item;
    }
  }

  async function waitForResults(ctx, opts) {
    const timeoutMs = (opts.timeoutSec || 300) * 1000;
    const settleMs = opts.kind === 'video' ? 5000 : 3000;
    const expected = opts.count || 1;
    const start = Date.now();
    let sawSignal = false;
    let lastCount = 0;
    let lastChange = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (stopRequested) return { stopped: true, items: [] };
      await sleep(1000);
      const fresh = collectMedia().filter((m) => !ctx.before.has(m.src));
      const busy = busyCount();
      const cleared = squash(inputText(ctx.input)).length < ctx.promptLen * 0.5;
      if (fresh.length || busy > ctx.busyBefore || cleared) sawSignal = true;

      if (fresh.length !== lastCount) {
        lastCount = fresh.length;
        lastChange = Date.now();
      }
      const settled = Date.now() - lastChange >= settleMs;
      if (fresh.length >= expected && settled && busy <= ctx.busyBefore) return { items: fresh };
      if (fresh.length > 0 && Date.now() - lastChange >= settleMs * 4) return { items: fresh };
      if (!sawSignal && Date.now() - start > NO_SIGNAL_MS) return { items: [], noSignal: true };
    }
    return { items: collectMedia().filter((m) => !ctx.before.has(m.src)), timedOut: true };
  }

  async function runPrompt(msg) {
    stopRequested = false;
    const input = findPromptInput();
    if (!input) return { ok: false, error: '프롬프트 입력창을 찾지 못했습니다. Flow 프로젝트 화면을 열어 주세요.' };

    const warnings = [];
    if (/flow\.google\.com|labs\.google/.test(location.host)) {
      const cfg = await configure(input, { kind: msg.kind, ratio: msg.ratio, model: msg.model, count: msg.count });
      warnings.push(...cfg.warnings);
    }

    const ctx = { input, before: new Set(collectMedia().map((m) => m.src)), busyBefore: busyCount(), promptLen: squash(msg.prompt).length };

    if (msg.refs && msg.refs.length) await attachReferences(msg.refs, input);

    const typed = await setPrompt(input, msg.prompt);
    if (!typed) return { ok: false, error: '프롬프트를 입력창에 넣지 못했습니다.', warnings };
    await sleep(400);

    const btn = findSubmitButton(input);
    if (!btn) return { ok: false, error: '생성 버튼을 찾지 못했습니다.', warnings, retryable: true };
    for (let i = 0; i < 25 && isDisabled(btn); i++) await sleep(200);
    if (isDisabled(btn)) return { ok: false, error: '생성 버튼이 비활성화되어 있습니다. 크레딧이나 사용 한도를 확인해 주세요.', warnings, limit: true };
    realClick(btn);

    const result = await waitForResults(ctx, msg);
    if (result.stopped) return { ok: false, stopped: true, error: '중지됨' };
    if (result.noSignal) return { ok: false, error: '생성 버튼을 눌렀지만 Flow에서 반응이 없습니다.', warnings, retryable: true };

    const items = [];
    for (const it of result.items) items.push(await toTransferable(it));
    if (!items.length) return { ok: false, error: '제한 시간 안에 결과가 나오지 않았습니다.', warnings, retryable: true };
    return { ok: true, items, warnings, timedOut: !!result.timedOut };
  }

  // ---------- 문제 해결용 화면 정보 (프롬프트 내용과 개인 정보는 담지 않는다) ----------
  function describe(el) {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      aria: (el.getAttribute('aria-label') || '').slice(0, 60) || undefined,
      text: el.matches('textarea, [contenteditable="true"], [role="textbox"]') ? undefined : textOf(el).slice(0, 40) || undefined,
      disabled: isDisabled(el) || undefined,
      cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 60) || undefined,
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
    };
  }

  function diagnose() {
    const input = findPromptInput();
    const out = { host: location.host, path: location.pathname.split('/').slice(0, 2).join('/'), w: innerWidth, h: innerHeight };
    out.input = input ? { ...describe(input), editable: input.getAttribute('contenteditable'), placeholder: (input.getAttribute('placeholder') || input.getAttribute('aria-placeholder') || '').slice(0, 60) } : null;
    if (input) {
      const composer = findComposer(input);
      out.composer = describe(composer);
      out.composerButtons = [...composer.querySelectorAll('button, [role="button"]')].filter(isVisible).map(describe);
      const sb = findSubmitButton(input);
      out.submitGuess = sb ? describe(sb) : null;
      const chip = findSettingsChip(input);
      out.chipGuess = chip ? describe(chip) : null;
    }
    out.popupOpen = ratioVisible();
    out.popupItems = out.popupOpen ? clickableAll().filter((el) => textOf(el).length < 40).slice(0, 60).map(describe) : [];
    out.fileInputs = document.querySelectorAll('input[type="file"]').length;
    out.media = collectMedia().length;
    out.busy = busyCount();
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.gai) return;
    if (msg.type === 'ping') {
      sendResponse({ ok: true, host: location.host, hasInput: !!findPromptInput() });
      return;
    }
    if (msg.type === 'stop') {
      stopRequested = true;
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'diag') {
      try { sendResponse({ ok: true, info: diagnose() }); } catch (e) { sendResponse({ ok: false, error: String(e) }); }
      return;
    }
    if (msg.type === 'run') {
      runPrompt(msg)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e), retryable: true }));
      return true;
    }
  });
})();
