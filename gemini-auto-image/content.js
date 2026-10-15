// Gemini Auto Image - 콘텐츠 스크립트
// Google Flow(labs.google)와 Gemini(gemini.google.com) 페이지에서
// 프롬프트 입력, 참조 이미지 첨부, 생성 버튼 클릭, 결과 수집을 담당한다.
(() => {
  if (window.__geminiAutoImageLoaded) return;
  window.__geminiAutoImageLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let stopRequested = false;

  const SUBMIT_WORDS = /(generate|create|send|submit|run|생성|만들기|보내기|전송|제출)/i;
  const BUSY_WORDS = /(generating|loading|in progress|생성 중|생성하는 중|처리 중|대기)/i;

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  }

  // ---------- 입력창 찾기 ----------
  function findPromptInput() {
    const candidates = [
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('rich-textarea [contenteditable="true"]'),
      ...document.querySelectorAll('.ql-editor[contenteditable="true"]'),
      ...document.querySelectorAll('[contenteditable="true"][role="textbox"]'),
      ...document.querySelectorAll('[contenteditable="true"]')
    ].filter(isVisible);
    if (!candidates.length) return null;
    // 화면에서 가장 큰 입력창을 프롬프트 입력창으로 본다
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return candidates[0];
  }

  function setPrompt(input, text) {
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable (Gemini 등)
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete');
      document.execCommand('insertText', false, text);
      if ((input.innerText || '').trim() !== text.trim()) {
        input.textContent = text;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      }
    }
  }

  // ---------- 생성 버튼 찾기 ----------
  function buttonLabel(btn) {
    return [btn.getAttribute('aria-label'), btn.getAttribute('title'), btn.getAttribute('mattooltip'), btn.innerText]
      .filter(Boolean)
      .join(' ');
  }

  function findSubmitButton(input) {
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(isVisible);
    const matches = buttons.filter((b) => {
      const label = buttonLabel(b);
      return SUBMIT_WORDS.test(label) || /arrow_forward|arrow_upward|send/.test(b.innerText || '');
    });
    if (!matches.length) return null;
    if (!input) return matches[0];
    // 입력창과 가장 가까운 버튼을 고른다
    const ir = input.getBoundingClientRect();
    const cx = ir.left + ir.width / 2;
    const cy = ir.top + ir.height / 2;
    matches.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const da = Math.hypot(ra.left - cx, ra.top - cy);
      const db = Math.hypot(rb.left - cx, rb.top - cy);
      return da - db;
    });
    return matches[0];
  }

  function isDisabled(btn) {
    return btn.disabled || btn.getAttribute('aria-disabled') === 'true';
  }

  // ---------- 참조 이미지 첨부 ----------
  async function dataUrlToFile(dataUrl, name) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || 'image/png' });
  }

  async function attachReferences(refs, input) {
    if (!refs || !refs.length) return { attached: 0 };
    const files = [];
    for (let i = 0; i < refs.length; i++) {
      files.push(await dataUrlToFile(refs[i].dataUrl, refs[i].name || `reference-${i + 1}.png`));
    }
    // 1) 파일 input 이 있으면 그곳에 넣는다
    const fileInput = [...document.querySelectorAll('input[type="file"]')].find(
      (el) => !el.accept || /image/.test(el.accept)
    );
    if (fileInput) {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1500);
      return { attached: files.length, method: 'file-input' };
    }
    // 2) 없으면 입력창에 붙여넣기 이벤트로 넣는다
    if (input) {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      input.focus();
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(1500);
      return { attached: files.length, method: 'paste' };
    }
    return { attached: 0 };
  }

  // ---------- 결과 미디어 수집 ----------
  function mediaSrc(el) {
    if (el.tagName === 'VIDEO') {
      return el.currentSrc || el.src || (el.querySelector('source') && el.querySelector('source').src) || '';
    }
    return el.currentSrc || el.src || '';
  }

  function collectMedia() {
    const list = [];
    document.querySelectorAll('img, video').forEach((el) => {
      const src = mediaSrc(el);
      if (!src || src.startsWith('data:image/svg')) return;
      const r = el.getBoundingClientRect();
      const w = el.tagName === 'VIDEO' ? el.videoWidth || r.width : el.naturalWidth || r.width;
      const h = el.tagName === 'VIDEO' ? el.videoHeight || r.height : el.naturalHeight || r.height;
      if (w < 200 || h < 200) return; // 아이콘, 프로필 사진 제외
      list.push({ src, type: el.tagName === 'VIDEO' ? 'video' : 'image' });
    });
    return list;
  }

  function isBusy() {
    const nodes = document.querySelectorAll('[role="progressbar"], [aria-busy="true"], mat-progress-spinner, .loading');
    for (const n of nodes) if (isVisible(n)) return true;
    const labels = document.querySelectorAll('[aria-live], [aria-label]');
    for (const n of labels) {
      const t = (n.getAttribute('aria-label') || n.textContent || '').slice(0, 80);
      if (BUSY_WORDS.test(t) && isVisible(n)) return true;
    }
    return false;
  }

  async function toTransferable(item) {
    // blob: 주소는 페이지 밖에서 열 수 없으므로 data URL 로 바꾼다
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

  async function waitForResults(before, opts) {
    const timeoutMs = (opts.timeoutSec || 300) * 1000;
    const settleMs = (opts.settleSec || 6) * 1000;
    const start = Date.now();
    let lastCount = 0;
    let lastChange = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stopRequested) return { stopped: true, items: [] };
      await sleep(2000);
      const fresh = collectMedia().filter((m) => !before.has(m.src));
      if (fresh.length !== lastCount) {
        lastCount = fresh.length;
        lastChange = Date.now();
      }
      const expected = opts.expected || 1;
      const settled = Date.now() - lastChange >= settleMs;
      if (fresh.length >= expected && settled && !isBusy()) {
        return { items: fresh };
      }
      if (fresh.length > 0 && settled && Date.now() - lastChange >= settleMs * 3) {
        return { items: fresh };
      }
    }
    const fresh = collectMedia().filter((m) => !before.has(m.src));
    return { items: fresh, timedOut: true };
  }

  async function runPrompt(msg) {
    stopRequested = false;
    const input = findPromptInput();
    if (!input) {
      return { ok: false, error: '프롬프트 입력창을 찾지 못했습니다. Flow 프로젝트 화면이나 Gemini 대화 화면을 열어 주세요.' };
    }

    const before = new Set(collectMedia().map((m) => m.src));

    if (msg.refs && msg.refs.length) {
      await attachReferences(msg.refs, input);
    }

    setPrompt(input, msg.prompt);
    await sleep(600);

    const btn = findSubmitButton(input);
    if (btn) {
      // 버튼이 활성화될 때까지 잠시 기다린다
      for (let i = 0; i < 20 && isDisabled(btn); i++) await sleep(300);
      if (isDisabled(btn)) {
        return { ok: false, error: '생성 버튼이 비활성화되어 있습니다. 사용 한도나 입력 상태를 확인해 주세요.' };
      }
      btn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    const result = await waitForResults(before, msg);
    if (result.stopped) return { ok: false, stopped: true, error: '중지됨' };

    const items = [];
    for (const it of result.items) items.push(await toTransferable(it));
    if (!items.length) {
      return { ok: false, error: result.timedOut ? '제한 시간 안에 결과가 나오지 않았습니다.' : '새 결과를 찾지 못했습니다.' };
    }
    return { ok: true, items, timedOut: !!result.timedOut };
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
    if (msg.type === 'run') {
      runPrompt(msg)
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true; // 비동기 응답
    }
  });
})();
