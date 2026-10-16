// Gemini Auto Image - 사이드 패널
const $ = (id) => document.getElementById(id);
const MAX_REFS = 8;
const MAX_LIBRARY = 300;
const SITE_RE = /^https:\/\/(flow\.google\.com|labs\.google|gemini\.google\.com)\//;

const SLOT_COUNT = 8;
const DEFAULT_SUFFIX = '[글자 규칙] 이미지 안에 들어가는 모든 글자는 반드시 한국어(한글)로만 쓴다. 영어, 알파벳, 로마자, 한자는 한 글자도 넣지 않는다. 위에 적힌 한글 문구를 토씨 하나 바꾸지 말고 그대로 표기하며, 번역하지 않는다.';
const newSlot = () => ({ text: '', kind: 'image', ratio: '16:9' });
const state = {
  mode: 'boxes', // 'bulk' = ① 한꺼번에 넣기, 'boxes' = ② 상자 8개
  bulk: { text: '', kind: 'image', ratio: '16:9', split: 'auto', done: [] },
  bulkStatus: {},
  slots: Array.from({ length: SLOT_COUNT }, newSlot),
  slotStatus: Array(SLOT_COUNT).fill(''),
  refs: [], // { name, dataUrl }
  running: false,
  stop: false
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 저장 ----------
async function saveDraft() {
  await chrome.storage.local.set({
    draft: { mode: state.mode, bulk: state.bulk, slots: state.slots, refs: state.refs }
  });
}

const num = (id, def, min, max) => {
  const v = Number($(id).value);
  return Math.min(max, Math.max(min, Number.isFinite(v) && $(id).value !== '' ? v : def));
};

function readSettings() {
  return {
    v: 3,
    delay: num('set-delay', 1, 0, 600),
    timeoutImage: num('set-timeout-image', 120, 30, 1800),
    timeoutVideo: num('set-timeout-video', 360, 60, 3600),
    retry: num('set-retry', 1, 0, 5),
    wait: $('set-wait').checked,
    suffixOn: $('set-suffix-on').checked,
    suffix: $('set-suffix').value.trim(),
    repeat: num('set-repeat', 1, 1, 20),
    modelImage: $('model-image').value.trim(),
    modelVideo: $('model-video').value.trim(),
    count: Number($('gen-count').value) || 1,
    ratioText: $('set-ratio-text').checked,
    autoDownload: $('set-autodl').checked,
    folder: ($('set-folder').value || 'GeminiAutoImage').replace(/[\\/:*?"<>|]/g, '_')
  };
}

async function saveSettings() {
  await chrome.storage.local.set({ settings: readSettings() });
}

async function load() {
  const { draft, settings } = await chrome.storage.local.get(['draft', 'settings']);
  if (draft) {
    if (Array.isArray(draft.slots)) {
      // 예전 버전은 상자 내용을 글자로만 저장했다
      draft.slots.slice(0, SLOT_COUNT).forEach((v, i) => {
        state.slots[i] = typeof v === 'string' ? { ...newSlot(), text: v } : { ...newSlot(), ...v };
      });
    } else if (draft.prompts) {
      state.slots[0].text = draft.prompts;
    }
    state.refs = draft.refs || [];
    if (draft.bulk) state.bulk = { ...state.bulk, ...draft.bulk, done: draft.bulk.done || [] };
    if (draft.mode === 'bulk' || draft.mode === 'boxes') state.mode = draft.mode;
    else if (draft.bulk && draft.bulk.text) state.mode = 'bulk';
  }
  if (settings && settings.v >= 2) {
    // 1.7.0 부터 빠른 기본값을 쓴다. 예전(v2) 시간 설정은 새 기본값으로 바꾼다.
    if (settings.v >= 3) {
      $('set-delay').value = settings.delay;
      $('set-timeout-image').value = settings.timeoutImage;
      $('set-timeout-video').value = settings.timeoutVideo;
      $('set-retry').value = settings.retry;
      $('set-wait').checked = !!settings.wait;
    }
    if ('suffixOn' in settings) {
      $('set-suffix-on').checked = !!settings.suffixOn;
      $('set-suffix').value = settings.suffix || '';
    }
    $('set-repeat').value = settings.repeat;
    $('model-image').value = settings.modelImage || '';
    $('model-video').value = settings.modelVideo || '';
    $('gen-count').value = String(settings.count || 1);
    $('set-ratio-text').checked = !!settings.ratioText;
    $('set-autodl').checked = settings.autoDownload !== false;
    $('set-folder').value = settings.folder || 'GeminiAutoImage';
  } else if (settings) {
    $('set-repeat').value = settings.repeat || 1;
    $('set-autodl').checked = settings.autoDownload !== false;
    $('set-folder').value = settings.folder || 'GeminiAutoImage';
  }
  if (!$('set-suffix').value.trim()) $('set-suffix').value = DEFAULT_SUFFIX;
  renderBulk();
  renderSlots();
  renderRefs();
  renderMode();
  updateCount();
  renderLibrary();
  checkSite();
}

// ---------- ① / ② 어느 쪽을 쓸지 ----------
function renderMode() {
  document.querySelectorAll('#mode-pick button').forEach((b) => {
    const on = b.dataset.v === state.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('bulk-card').hidden = state.mode !== 'bulk';
  $('boxes-card').hidden = state.mode !== 'boxes';
  if (typeof updateStartLabel === 'function') updateStartLabel();
}
$('mode-pick').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.mode = b.dataset.v;
  renderMode();
  saveDraft();
});

// ---------- 한꺼번에 넣기 ----------
// 번호(1, 2, 3 …)가 줄 맨 앞에 차례대로 나오면 번호로 나누고, 아니면 빈 줄로 나눈다.
const NUM_RE = /^\s*(?:#\s*|no\.?\s*|prompt\s*)?(\d{1,4})\s*(?:[.)\]:：]|번|-(?=\s))?(?:\s+(.*))?$/i;

function splitByNumber(text) {
  const lines = text.split('\n');
  const items = [];
  let expect = null;
  let cur = null;
  for (const line of lines) {
    const m = line.match(NUM_RE);
    const n = m ? Number(m[1]) : NaN;
    // 첫 번호는 0이나 1로 시작해야 하고, 그 뒤로는 1씩 커져야 번호로 본다 (본문 속 숫자와 헷갈리지 않게)
    const isMarker = m && (expect === null ? n === 1 || n === 0 : n === expect);
    if (isMarker) {
      if (cur) items.push(cur);
      cur = [m[2] || ''];
      expect = n + 1;
    } else if (cur) {
      cur.push(line);
    } else if (line.trim()) {
      return null; // 번호 앞에 다른 글이 있으면 번호 목록이 아니다
    }
  }
  if (cur) items.push(cur);
  if (items.length < 2) return null;
  return items.map((it) => it.join('\n').trim()).filter(Boolean);
}

function parseBulk(text, mode) {
  const t = (text || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return { items: [], how: '' };
  if (mode === 'line') return { items: t.split('\n').map((l) => l.trim()).filter(Boolean), how: '한 줄씩' };
  if (mode === 'number' || mode === 'auto') {
    const byNum = splitByNumber(t);
    if (byNum) return { items: byNum, how: '번호로' };
    if (mode === 'number') return { items: [t], how: '번호를 찾지 못해 하나로' };
  }
  const byBlank = t.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);
  return { items: byBlank, how: byBlank.length > 1 ? '빈 줄로' : '하나로' };
}

function bulkItems() {
  return parseBulk(state.bulk.text, state.bulk.split).items;
}

function renderBulk() {
  const b = state.bulk;
  if ($('bulk-text').value !== b.text) $('bulk-text').value = b.text;
  $('bulk-split').value = b.split;
  document.querySelectorAll('#bulk-kind button').forEach((x) => x.classList.toggle('on', x.dataset.v === b.kind));
  document.querySelectorAll('#bulk-ratio button').forEach((x) => x.classList.toggle('on', x.dataset.v === b.ratio));
  const { items, how } = parseBulk(b.text, b.split);
  const done = new Set(b.done);
  const doneCount = items.filter((_, i) => done.has(i)).length;
  $('bulk-summary').textContent = items.length
    ? `${items.length}개로 나눔 (${how})${doneCount ? ` · 완료 ${doneCount} · 남음 ${items.length - doneCount}` : ''}`
    : '비어 있음';
  $('bulk-reset').hidden = !doneCount;
  $('bulk-details').hidden = items.length < 1;
  const ol = $('bulk-list');
  ol.innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    const st = state.bulkStatus[i] || (done.has(i) ? 'ok' : '');
    li.className = st;
    li.textContent = (st === 'ok' ? '✓ ' : st === 'fail' ? '✕ ' : st === 'run' ? '▶ ' : '') + it.replace(/\s+/g, ' ').slice(0, 80);
    li.title = it.slice(0, 400);
    ol.append(li);
  });
  if (!state.running && typeof updateStartLabel === 'function') updateStartLabel();
}

function setBulkText(text) {
  setTimeout(updateStartLabel, 0);
  if (text !== state.bulk.text) {
    state.bulk.text = text;
    state.bulk.done = []; // 내용이 바뀌면 진행 기록을 지운다
    state.bulkStatus = {};
  }
  renderBulk();
  saveDraft();
}

$('bulk-text').addEventListener('input', () => setBulkText($('bulk-text').value));
$('bulk-split').addEventListener('change', () => {
  state.bulk.split = $('bulk-split').value;
  state.bulk.done = [];
  state.bulkStatus = {};
  renderBulk();
  saveDraft();
});
['bulk-kind', 'bulk-ratio'].forEach((id) => {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || state.running) return;
    state.bulk[$(id).dataset.key] = b.dataset.v;
    renderBulk();
    saveDraft();
  });
});
$('bulk-clear').addEventListener('click', () => { if (!state.running) setBulkText(''); });
$('bulk-reset').addEventListener('click', () => {
  if (state.running) return;
  state.bulk.done = [];
  state.bulkStatus = {};
  renderBulk();
  saveDraft();
});
{
  const zone = $('bulk-drop');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    if (state.running) return;
    const file = [...(e.dataTransfer.files || [])].find((f) => /^text\/|\.txt$|\.md$/i.test(f.type || f.name));
    const text = file ? await file.text() : e.dataTransfer.getData('text/plain') || '';
    if (text.trim()) setBulkText(text.trim());
  });
}

// ---------- 프롬프트 상자 ----------
function getPrompts() {
  return state.slots
    .map((sl, i) => ({ text: sl.text.trim(), kind: sl.kind, ratio: sl.ratio, slot: i }))
    .filter((p) => p.text);
}

function updateCount() {
  $('prompt-count').textContent = `${getPrompts().length} / ${SLOT_COUNT} 상자 사용`;
}

function setSlotStatus(i, status, title) {
  state.slotStatus[i] = status;
  const tag = document.querySelector(`.slot[data-i="${i}"] .slot-tag`);
  if (!tag) return;
  const map = { run: '보내는 중', ok: '완료', fail: '실패', retry: '재시도', wait: '대기', sent: '생성 중' };
  tag.hidden = !status;
  tag.className = 'slot-tag ' + ({ retry: 'run', wait: 'run', sent: 'run' }[status] || status);
  tag.textContent = map[status] || '';
  tag.title = title || '';
}

function refreshSlot(i) {
  const el = document.querySelector(`.slot[data-i="${i}"]`);
  if (!el) return;
  const len = state.slots[i].text.trim().length;
  el.classList.toggle('filled', len > 0);
  el.querySelector('.slot-len').textContent = len ? `${len.toLocaleString()}자` : '';
  el.querySelector('.slot-clear').hidden = !len;
  el.querySelectorAll('.seg button').forEach((b) => {
    b.classList.toggle('on', state.slots[i][b.parentElement.dataset.key] === b.dataset.v);
  });
}

function setSlotText(i, text) {
  state.slots[i].text = text;
  setTimeout(updateStartLabel, 0);
  const ta = document.querySelector(`.slot[data-i="${i}"] textarea`);
  if (ta && ta.value !== text) ta.value = text;
  setSlotStatus(i, '');
  refreshSlot(i);
  updateCount();
  saveDraft();
}

function segment(i, key, options, extraClass) {
  const seg = document.createElement('div');
  seg.className = 'seg ' + (extraClass || '');
  seg.dataset.key = key;
  options.forEach(([v, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.textContent = label;
    b.addEventListener('click', () => {
      if (state.running) return;
      state.slots[i][key] = v;
      refreshSlot(i);
      saveDraft();
    });
    seg.append(b);
  });
  return seg;
}

function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.i = i;

    const head = document.createElement('div');
    head.className = 'slot-head';
    const num = document.createElement('span');
    num.className = 'slot-num';
    num.textContent = i + 1;
    const kind = segment(i, 'kind', [['image', '이미지'], ['video', '동영상']], 'kind');
    const ratio = segment(i, 'ratio', [['16:9', '16:9'], ['9:16', '9:16']]);
    const len = document.createElement('span');
    len.className = 'slot-len';
    const tag = document.createElement('span');
    tag.className = 'slot-tag';
    tag.hidden = true;
    const clear = document.createElement('button');
    clear.className = 'slot-clear';
    clear.textContent = '✕';
    clear.title = '이 상자 비우기';
    clear.setAttribute('aria-label', `${i + 1}번 상자 비우기`);
    clear.addEventListener('click', () => { if (!state.running) setSlotText(i, ''); });
    const run = document.createElement('button');
    run.className = 'slot-run';
    run.type = 'button';
    run.textContent = '▶ 실행';
    run.title = '이 상자만 바로 실행';
    run.addEventListener('click', () => runSlot(i));
    head.append(num, kind, ratio, len, tag, run, clear);

    const ta = document.createElement('textarea');
    ta.id = `slot-${i + 1}`;
    ta.placeholder = '여기에 끌어다 놓기';
    ta.value = state.slots[i].text;
    ta.addEventListener('input', () => setSlotText(i, ta.value));

    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('over'); });
    slot.addEventListener('dragleave', (e) => { if (!slot.contains(e.relatedTarget)) slot.classList.remove('over'); });
    slot.addEventListener('drop', async (e) => {
      e.preventDefault();
      slot.classList.remove('over');
      if (state.running) return;
      const file = [...(e.dataTransfer.files || [])].find((f) => /^text\/|\.txt$|\.md$/i.test(f.type || f.name));
      let text = '';
      if (file) text = await file.text();
      else text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text') || '';
      if (text.trim()) setSlotText(i, text.trim());
    });

    slot.append(head, ta);
    box.append(slot);
    refreshSlot(i);
    setSlotStatus(i, state.slotStatus[i]);
  }
}

$('clear-prompts').addEventListener('click', () => {
  if (state.running) return;
  for (let i = 0; i < SLOT_COUNT; i++) setSlotText(i, '');
});

// ---------- 참조 이미지 ----------
function renderRefs() {
  const box = $('refs');
  box.innerHTML = '';
  state.refs.forEach((ref, i) => {
    const d = document.createElement('div');
    d.className = 'ref';
    const img = document.createElement('img');
    img.src = ref.dataUrl;
    img.alt = ref.name;
    const x = document.createElement('button');
    x.className = 'x';
    x.textContent = '✕';
    x.setAttribute('aria-label', '참조 이미지 삭제');
    x.addEventListener('click', () => { state.refs.splice(i, 1); renderRefs(); saveDraft(); });
    d.append(img, x);
    box.append(d);
  });
  if (state.refs.length < MAX_REFS) {
    const add = document.createElement('button');
    add.className = 'ref add';
    add.textContent = '+';
    add.setAttribute('aria-label', '참조 이미지 추가');
    add.addEventListener('click', () => $('ref-input').click());
    box.append(add);
  }
  const empty = Math.max(0, 4 - box.children.length);
  for (let i = 0; i < empty; i++) {
    const d = document.createElement('div');
    d.className = 'ref';
    box.append(d);
  }
  $('ref-count').textContent = `(${state.refs.length}/${MAX_REFS})`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

$('ref-input').addEventListener('change', async (e) => {
  for (const f of [...e.target.files]) {
    if (state.refs.length >= MAX_REFS) break;
    state.refs.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
  }
  e.target.value = '';
  renderRefs();
  saveDraft();
});

// ---------- 탭 ----------
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== 'view-' + t.dataset.view; });
    $('run-bar').hidden = t.dataset.view !== 'control';
    if (t.dataset.view === 'library') renderLibrary();
  });
});

// ---------- 설정 ----------
['set-delay', 'set-timeout-image', 'set-timeout-video', 'set-retry', 'set-wait', 'set-suffix-on', 'set-suffix', 'set-repeat', 'set-ratio-text', 'set-autodl', 'set-folder', 'model-image', 'model-video', 'gen-count'].forEach((id) => {
  $(id).addEventListener('change', saveSettings);
});

// ---------- 문제 해결: Flow 화면 정보 복사 ----------
$('diag-btn').addEventListener('click', async () => {
  const msg = $('diag-msg');
  msg.className = 'status';
  const tab = await checkSite();
  if (!tab) { msg.className = 'status err'; msg.textContent = 'Flow 프로젝트 탭을 먼저 여세요.'; return; }
  try {
    const res = await sendToTab(tab.id, { gai: true, type: 'diag' });
    const text = 'GAI-DIAG ' + chrome.runtime.getManifest().version + '\n' + JSON.stringify(res && res.info);
    await navigator.clipboard.writeText(text);
    msg.className = 'status ok';
    msg.textContent = '복사했습니다. Claude 대화창에 붙여넣어 주세요.';
  } catch (e) {
    msg.className = 'status err';
    msg.textContent = '정보를 가져오지 못했습니다. Flow 탭을 새로고침한 뒤 다시 누르세요.';
  }
});

// ---------- 상태 표시 ----------
function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}
function setProgress(done, total) {
  $('bar').style.width = total ? (done / total) * 100 + '%' : '0';
}

// ---------- 사이트 연결 ----------
async function getTargetTab() {
  // 1) 패널이 붙어 있는 창의 현재 탭
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && active.url && SITE_RE.test(active.url)) return active;
  // 2) 같은 창에 열린 Flow / Gemini 탭 중 가장 최근에 본 탭
  const pick = (tabs) => tabs
    .filter((t) => t.url && SITE_RE.test(t.url))
    .sort((x, y) => (y.lastAccessed || 0) - (x.lastAccessed || 0))[0] || null;
  const inWindow = pick(await chrome.tabs.query({ currentWindow: true }));
  if (inWindow) return inWindow;
  // 3) 다른 Chrome 창까지 찾아본다
  return pick(await chrome.tabs.query({}));
}

function siteName(url) {
  if (!url) return '';
  if (url.includes('flow.google.com') || url.includes('labs.google')) return 'Google Flow';
  if (url.includes('gemini.google.com')) return 'Gemini';
  return '';
}

async function checkSite() {
  const tab = await getTargetTab();
  const badge = $('site-badge');
  if (tab) {
    badge.textContent = siteName(tab.url) + ' 연결됨';
    badge.classList.add('on');
  } else {
    badge.textContent = 'Flow / Gemini 탭을 여세요';
    badge.classList.remove('on');
  }
  return tab;
}
chrome.tabs.onActivated.addListener(checkSite);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) checkSite(); });
chrome.tabs.onRemoved.addListener(() => checkSite());
chrome.windows.onFocusChanged.addListener(() => checkSite());

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    // 확장 설치 전에 열린 탭이면 스크립트를 주입하고 다시 보낸다
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(300);
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

// ---------- 라이브러리 ----------
async function getLibrary() {
  const { library } = await chrome.storage.local.get('library');
  return library || [];
}

async function addToLibrary(items) {
  const lib = await getLibrary();
  lib.unshift(...items);
  lib.length = Math.min(lib.length, MAX_LIBRARY);
  await chrome.storage.local.set({ library: lib });
}

async function renderLibrary() {
  const lib = await getLibrary();
  const box = $('lib');
  box.innerHTML = '';
  lib.forEach((it) => {
    const d = document.createElement('div');
    d.className = 'lib-item';
    const media = document.createElement(it.type === 'video' ? 'video' : 'img');
    media.src = it.src;
    if (it.type === 'video') { media.controls = true; media.muted = true; }
    else media.alt = it.prompt;
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = it.prompt;
    cap.title = it.prompt;
    d.append(media, cap);
    box.append(d);
  });
  $('lib-count').textContent = lib.length;
  $('lib-empty').hidden = lib.length > 0;
}

function extOf(item) {
  const m = item.src.match(/^data:(image|video)\/([a-z0-9+]+)/i);
  if (m) return m[2].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  return item.type === 'video' ? 'mp4' : 'png';
}

function safeName(text) {
  return text.replace(/[\\/:*?"<>|\n\r]/g, ' ').trim().slice(0, 40) || 'image';
}

async function download(item, index, folder) {
  try {
    await chrome.downloads.download({
      url: item.src,
      filename: `${folder}/${String(index).padStart(3, '0')}_${safeName(item.prompt)}.${extOf(item)}`,
      conflictAction: 'uniquify'
    });
  } catch (e) {
    console.warn('download failed', e);
  }
}

$('lib-download').addEventListener('click', async () => {
  const lib = await getLibrary();
  const folder = readSettings().folder;
  for (let i = 0; i < lib.length; i++) await download(lib[i], lib.length - i, folder);
});
$('lib-clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ library: [] });
  renderLibrary();
});

// ---------- 실행 (대기열) ----------
// ▶ 실행이나 시작을 누르면 대기열에 넣는다. 실행 중에도 언제든 더 넣을 수 있다.
// 기본은 "연속 실행": 프롬프트를 보내자마자 다음으로 넘어가고, 결과는 끝난 순서대로 모아 저장한다.
function buildPrompt(job, settings) {
  let text = job.text;
  if (settings.suffixOn && settings.suffix && !text.includes(settings.suffix)) text += '\n' + settings.suffix;
  if (settings.ratioText) text += ` (비율 ${job.ratio})`;
  return text;
}

function markJob(job, status, title) {
  if (!job.bulk) return setSlotStatus(job.slot, status, title);
  state.bulkStatus[job.idx] = { retry: 'run', wait: '', sent: 'run' }[status] ?? status;
  // 목록은 Flow 에 보내는 순간 끝난 것으로 기록한다 (다시 시작할 때 크레딧을 두 번 쓰지 않게)
  if ((status === 'ok' || status === 'sent') && !state.bulk.done.includes(job.idx)) {
    state.bulk.done.push(job.idx);
    saveDraft();
  }
  renderBulk();
}

let accurateOn = false;
const queue = [];
const run = { saved: 0, done: 0, fail: 0, lastError: '', inflight: [] };

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.gaiStatus || !state.running) return;
  if (msg.needClick) {
    const el = $('status');
    el.textContent = 'Flow 화면에서 노란 테두리가 생긴 → 버튼을 한 번 눌러 주세요.' +
      (accurateOn ? '' : ' 매번 누르지 않으려면 Settings 탭에서 "정확한 클릭"을 켜세요.');
    el.className = 'status ask';
  }
});

function setRunning(on) {
  state.running = on;
  $('stop-btn').disabled = !on;
  ['model-image', 'model-video', 'gen-count'].forEach((id) => { $(id).disabled = on; });
  updateStartLabel();
}

function updateStartLabel() {
  if (state.mode === 'bulk') {
    const list = bulkItems();
    const done = new Set(state.bulk.done);
    const left = list.filter((_, i) => !done.has(i)).length;
    $('start-btn').textContent = list.length ? `① 목록 시작 (${left}개 남음)` : '① 목록 시작';
  } else {
    const boxes = getPrompts().length;
    $('start-btn').textContent = boxes ? `② 상자 전체 시작 (${boxes}개)` : '② 상자 전체 시작';
  }
}

const sameJob = (a, b) => (a.bulk ? b.bulk && a.idx === b.idx : !b.bulk && a.slot === b.slot);

function enqueue(jobs) {
  const settings = readSettings();
  let added = 0;
  for (const j of jobs) {
    if (queue.some((q) => sameJob(q, j)) || (run.current && sameJob(run.current, j))) continue;
    for (let r = 0; r < settings.repeat; r++) queue.push({ ...j });
    markJob(j, 'wait');
    added++;
  }
  if (!state.running) runQueue();
  else if (added) setStatus(`대기열에 ${added}개 추가 · 남은 ${queue.length}개`);
}

async function handleItems(items, job, settings) {
  const stamped = items.map((it) => ({ ...it, prompt: job.text, time: Date.now() }));
  await addToLibrary(stamped);
  if (settings.autoDownload) for (const it of stamped) await download(it, ++run.saved, settings.folder);
}

// 연속 실행에서 모인 결과를 먼저 보낸 프롬프트부터 차례로 짝지어 저장한다
async function collect(tab, settings) {
  let res;
  try { res = await chrome.tabs.sendMessage(tab.id, { gai: true, type: 'collect' }); } catch (e) { return { got: 0, busy: 0 }; }
  const items = (res && res.items) || [];
  for (const it of items) {
    const owner = run.inflight.find((f) => f.got < f.need) || run.inflight[run.inflight.length - 1];
    if (!owner) break;
    owner.got++;
    await handleItems([it], owner.job, settings);
    if (owner.got >= owner.need) { markJob(owner.job, 'ok'); run.done++; }
  }
  run.inflight = run.inflight.filter((f) => f.got < f.need);
  return { got: items.length, busy: (res && res.busy) || 0 };
}

async function runQueue() {
  const tab = await checkSite();
  if (!tab) {
    queue.splice(0).forEach((j) => markJob(j, ''));
    return setStatus('이 Chrome 창에서 Google Flow 프로젝트나 Gemini 대화를 연 뒤 시작하세요.', 'err');
  }
  const settings = readSettings();
  Object.assign(run, { saved: run.saved, done: 0, fail: 0, lastError: '', inflight: [], current: null });
  try { await sendToTab(tab.id, { gai: true, type: 'resetConfig' }); } catch (e) {}
  state.stop = false;
  setRunning(true);
  let sent = 0;

  for (;;) {
    while (queue.length && !state.stop) {
      const job = queue.shift();
      run.current = job;
      const name = job.bulk ? `목록 ${job.idx + 1}/${bulkItems().length}` : `${job.slot + 1}번 상자`;
      const label = `${name} · ${job.kind === 'video' ? '동영상' : '이미지'} ${job.ratio}`;
      let res = null;
      let stopAll = false;
      for (let attempt = 0; attempt <= settings.retry; attempt++) {
        if (state.stop) break;
        markJob(job, attempt ? 'retry' : 'run');
        setStatus(`${label} 보내는 중${attempt ? ` · 다시 시도 ${attempt}` : ''} · 대기 ${queue.length}개`);
        try {
          res = await sendToTab(tab.id, {
            gai: true,
            type: 'run',
            wait: settings.wait,
            prompt: buildPrompt(job, settings),
            kind: job.kind,
            ratio: job.ratio,
            model: job.kind === 'video' ? settings.modelVideo : settings.modelImage,
            count: settings.count,
            refs: state.refs,
            timeoutSec: job.kind === 'video' ? settings.timeoutVideo : settings.timeoutImage
          });
        } catch (e) {
          res = { ok: false, error: '페이지와 연결하지 못했습니다. Flow 탭을 새로고침해 주세요.', retryable: true };
        }
        if (state.stop || (res && res.ok)) break;
        if (res && res.limit) { stopAll = true; break; }
        if (res && res.retryable === false) break;
        await sleep(1500);
      }
      run.current = null;
      if (state.stop) { markJob(job, ''); break; }

      const warn = res && res.warnings && res.warnings.length ? res.warnings.join(' ') : '';
      if (res && res.ok && res.submitted) {
        sent++;
        markJob(job, 'sent', warn);
      if (warn) { run.lastError = `${name} 설정 확인 필요: ${warn}`; setStatus(`${name} · 설정 확인 필요: ${warn}`, 'err'); }
        run.inflight.push({ job, need: settings.count, got: 0, since: Date.now() });
        await collect(tab, settings); // 그 사이 끝난 결과가 있으면 바로 저장
      } else if (res && res.ok) {
        sent++;
        await handleItems(res.items, job, settings);
        run.done++;
        markJob(job, 'ok', warn);
      } else {
        run.fail++;
        const why = (res && res.error) || '알 수 없는 오류';
        run.lastError = `${name}: ${why}`;
        markJob(job, 'fail', why);
        setStatus(`${name} 실패 · ${why}${warn ? ' · ' + warn : ''}`, 'err');
        if (stopAll) {
          queue.splice(0).forEach((j) => markJob(j, ''));
          break;
        }
      }
      if (queue.length && settings.delay && !state.stop) await sleep(settings.delay * 1000);
    }

    // 연속 실행: 보낸 것들의 결과가 다 나올 때까지 모은다. 그 사이 ▶ 로 새로 들어온 것은 먼저 보낸다.
    if (!state.stop && run.inflight.length) {
      const limitMs = Math.max(...run.inflight.map((f) => (f.job.kind === 'video' ? settings.timeoutVideo : settings.timeoutImage))) * 1000;
      let lastNew = Date.now();
      const start = Date.now();
      while (!state.stop && run.inflight.length && !queue.length && Date.now() - start < limitMs) {
        setStatus(`모두 보냈습니다 · 결과 ${run.inflight.length}개를 기다리는 중`);
        await sleep(3000);
        const c = await collect(tab, settings);
        if (c.got) lastNew = Date.now();
        if (!c.busy && Date.now() - lastNew > 20000) break;
      }
      if (queue.length && !state.stop) continue;
      run.inflight.forEach((f) => { markJob(f.job, 'fail', '결과를 모으지 못했습니다. Flow 화면에서 직접 확인해 주세요.'); run.fail++; });
      run.inflight = [];
    }
    if (queue.length && !state.stop) continue;
    break;
  }
  finish();

  function finish() {
    setRunning(false);
    try { chrome.runtime.sendMessage({ gaiBg: 'detach' }); } catch (e) {}
    state.slotStatus.forEach((st, k) => { if (['run', 'retry', 'wait'].includes(st)) setSlotStatus(k, ''); });
    Object.keys(state.bulkStatus).forEach((k) => { if (state.bulkStatus[k] === 'run') delete state.bulkStatus[k]; });
    renderBulk();
    const tail = run.lastError ? ` · ${run.lastError}` : '';
    if (state.stop) setStatus(`중지됨 · 보냄 ${sent}건, 저장 ${run.done}건, 실패 ${run.fail}건${tail}`, run.fail ? 'err' : '');
    else setStatus(`완료 · 보냄 ${sent}건, 저장 ${run.done}건, 실패 ${run.fail}건${tail}`, run.fail ? 'err' : 'ok');
  }
}

// 처음 실행할 때 정확한 클릭 권한을 한 번 물어본다 (버튼을 누른 그 순간에만 물어볼 수 있다)
let askedAccurate = false;
function askAccurateOnce() {
  if (accurateOn || askedAccurate) return Promise.resolve();
  askedAccurate = true;
  return chrome.permissions.request({ permissions: ['debugger'] }).catch(() => false).then(refreshAccurate);
}

// 시작 버튼: 한꺼번에 넣기 목록을 실행한다. 목록이 비어 있으면 상자 전체를 실행한다.
$('start-btn').addEventListener('click', () => {
  const asking = askAccurateOnce();
  const bulkList = bulkItems();
  let jobs;
  if (state.mode === 'bulk') {
    if (!bulkList.length) return setStatus('① 한꺼번에 넣기에 프롬프트를 붙여넣어 주세요.', 'err');
    const doneSet = new Set(state.bulk.done);
    jobs = bulkList
      .map((text, idx) => ({ text, kind: state.bulk.kind, ratio: state.bulk.ratio, bulk: true, idx }))
      .filter((j) => !doneSet.has(j.idx));
    if (!jobs.length) return setStatus('한꺼번에 넣기 목록을 모두 끝냈습니다. 다시 하려면 "처음부터 다시"를 누르세요.', 'err');
  } else {
    jobs = getPrompts();
    if (!jobs.length) return setStatus('② 상자에 프롬프트를 넣어 주세요.', 'err');
  }
  asking.then(() => enqueue(jobs));
});

// 상자 ▶ 버튼: 그 상자를 바로 대기열에 넣는다 (실행 중이어도 된다)
function runSlot(i) {
  const sl = state.slots[i];
  if (!sl.text.trim()) return setStatus(`${i + 1}번 상자가 비어 있습니다.`, 'err');
  const asking = askAccurateOnce();
  asking.then(() => enqueue([{ text: sl.text.trim(), kind: sl.kind, ratio: sl.ratio, slot: i }]));
}

$('stop-btn').addEventListener('click', async () => {
  state.stop = true;
  queue.splice(0).forEach((j) => markJob(j, ''));
  const tab = await getTargetTab();
  if (tab) { try { await chrome.tabs.sendMessage(tab.id, { gai: true, type: 'stop' }); } catch (e) {} }
  setStatus('중지하는 중...');
});

// ---------- 정확한 클릭 (선택 기능) ----------
async function refreshAccurate() {
  try { accurateOn = await chrome.permissions.contains({ permissions: ['debugger'] }); } catch (e) { accurateOn = false; }
  $('accurate-state').textContent = accurateOn ? '켜짐' : '꺼짐';
  $('accurate-state').className = 'pill ' + (accurateOn ? 'on' : '');
  $('accurate-btn').textContent = accurateOn ? '끄기' : '켜기';
}
$('accurate-btn').addEventListener('click', async () => {
  try {
    if (accurateOn) await chrome.permissions.remove({ permissions: ['debugger'] });
    else await chrome.permissions.request({ permissions: ['debugger'] });
  } catch (e) {}
  refreshAccurate();
});
refreshAccurate();

// ---------- 계정 메모 (암호화 보관) ----------
// 계정 정보는 사용자가 정한 잠금 비밀번호로 AES-GCM 암호화해 chrome.storage.local 에 저장한다.
// 키는 PBKDF2 로 만들고 메모리에만 두며, 패널을 닫거나 5분 동안 쓰지 않으면 지운다.
// 자동 로그인이나 외부 전송은 하지 않는다.
const PBKDF2_ITER = 310000;
const LOCK_AFTER_MS = 5 * 60 * 1000;
const vault = { key: null, accounts: [], salt: null, timer: null };

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(data) };
}

async function decryptJson(key, blob) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function saveVault() {
  const blob = await encryptJson(vault.key, vault.accounts);
  await chrome.storage.local.set({ vault: { v: 1, salt: b64(vault.salt), iter: PBKDF2_ITER, ...blob } });
}

function showAccState(state) {
  $('acc-setup').hidden = state !== 'setup';
  $('acc-locked').hidden = state !== 'locked';
  $('acc-open').hidden = state !== 'open';
}

function lockVault() {
  vault.key = null;
  vault.accounts = [];
  clearTimeout(vault.timer);
  $('acc-list').innerHTML = '';
  $('unlock-pin').value = '';
  $('unlock-msg').textContent = '';
  chrome.storage.local.get('vault').then(({ vault: v }) => showAccState(v ? 'locked' : 'setup'));
}

function touchVault() {
  if (!vault.key) return;
  clearTimeout(vault.timer);
  vault.timer = setTimeout(lockVault, LOCK_AFTER_MS);
}

async function initVault() {
  const { vault: stored, accounts: legacy } = await chrome.storage.local.get(['vault', 'accounts']);
  if (stored) {
    showAccState('locked');
    return;
  }
  showAccState('setup');
  if (legacy && legacy.length) {
    $('setup-msg').className = 'status';
    $('setup-msg').textContent = `예전에 저장한 계정 ${legacy.length}개가 암호화 없이 남아 있습니다. 잠금 비밀번호를 설정하면 암호화되어 옮겨집니다.`;
  }
}

$('setup-btn').addEventListener('click', async () => {
  const pin = $('setup-pin').value;
  const msg = $('setup-msg');
  msg.className = 'status err';
  if (pin.length < 6) { msg.textContent = '잠금 비밀번호는 6자 이상이어야 합니다.'; return; }
  if (pin !== $('setup-pin2').value) { msg.textContent = '두 입력이 서로 다릅니다.'; return; }
  const { accounts: legacy } = await chrome.storage.local.get('accounts');
  vault.salt = crypto.getRandomValues(new Uint8Array(16));
  vault.key = await deriveKey(pin, vault.salt);
  vault.accounts = legacy || [];
  await saveVault();
  await chrome.storage.local.remove('accounts');
  $('setup-pin').value = '';
  $('setup-pin2').value = '';
  msg.textContent = '';
  showAccState('open');
  renderAccounts();
  touchVault();
});

async function unlock() {
  const pin = $('unlock-pin').value;
  const msg = $('unlock-msg');
  const { vault: stored } = await chrome.storage.local.get('vault');
  if (!stored) return lockVault();
  try {
    const salt = unb64(stored.salt);
    const key = await deriveKey(pin, salt);
    vault.accounts = await decryptJson(key, stored);
    vault.key = key;
    vault.salt = salt;
    $('unlock-pin').value = '';
    msg.textContent = '';
    showAccState('open');
    renderAccounts();
    touchVault();
  } catch (e) {
    msg.textContent = '잠금 비밀번호가 맞지 않습니다.';
    $('unlock-pin').select();
  }
}
$('unlock-btn').addEventListener('click', unlock);
$('unlock-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

$('reset-vault').addEventListener('click', async () => {
  const b = $('reset-vault');
  if (b.dataset.confirm !== '1') {
    b.dataset.confirm = '1';
    b.textContent = '정말 모두 지우려면 한 번 더 누르세요';
    setTimeout(() => { b.dataset.confirm = ''; b.textContent = '잊어버렸어요 · 저장된 계정 모두 지우고 새로 설정'; }, 3000);
    return;
  }
  await chrome.storage.local.remove(['vault', 'accounts']);
  b.dataset.confirm = '';
  b.textContent = '잊어버렸어요 · 저장된 계정 모두 지우고 새로 설정';
  lockVault();
});

$('lock-btn').addEventListener('click', lockVault);
document.addEventListener('visibilitychange', () => { if (document.hidden) lockVault(); });
window.addEventListener('pagehide', lockVault);
['click', 'keydown', 'input'].forEach((ev) => document.addEventListener(ev, touchVault, true));

$('change-btn').addEventListener('click', async () => {
  const pin = $('change-pin').value;
  const msg = $('change-msg');
  if (!vault.key) return lockVault();
  if (pin.length < 6) { msg.className = 'status err'; msg.textContent = '6자 이상이어야 합니다.'; return; }
  vault.salt = crypto.getRandomValues(new Uint8Array(16));
  vault.key = await deriveKey(pin, vault.salt);
  await saveVault();
  $('change-pin').value = '';
  msg.className = 'status ok';
  msg.textContent = '잠금 비밀번호를 바꿨습니다.';
  setTimeout(() => { msg.textContent = ''; }, 2500);
});

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = '복사됨';
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('done'); }, 1200);
}

function miniBtn(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'mini ' + (cls || '');
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function renderAccounts() {
  const list = vault.accounts;
  const box = $('acc-list');
  box.innerHTML = '';
  list.forEach((acc, i) => {
    const card = document.createElement('div');
    card.className = 'acc';

    const head = document.createElement('div');
    head.className = 'acc-head';
    const name = document.createElement('span');
    name.className = 'acc-name';
    name.textContent = acc.name || `계정 ${i + 1}`;
    const del = miniBtn('삭제', 'del', async () => {
      if (del.dataset.confirm !== '1') {
        del.dataset.confirm = '1';
        del.textContent = '한 번 더 누르면 삭제';
        setTimeout(() => { del.dataset.confirm = ''; del.textContent = '삭제'; }, 2500);
        return;
      }
      vault.accounts.splice(i, 1);
      await saveVault();
      renderAccounts();
    });
    head.append(name, del);

    const idLine = document.createElement('div');
    idLine.className = 'acc-line';
    const idVal = document.createElement('span');
    idVal.className = 'acc-val';
    idVal.textContent = acc.email;
    idVal.title = acc.email;
    idLine.append(idVal, document.createElement('span'), miniBtn('아이디 복사', 'copy', (e) => copyText(acc.email, e.currentTarget)));
    card.append(head, idLine);

    if (acc.pass) {
      const pwLine = document.createElement('div');
      pwLine.className = 'acc-line';
      const pwVal = document.createElement('span');
      pwVal.className = 'acc-val';
      pwVal.textContent = '••••••••';
      const show = miniBtn('보기', '', () => {
        const hidden = pwVal.textContent === '••••••••';
        pwVal.textContent = hidden ? acc.pass : '••••••••';
        show.textContent = hidden ? '숨기기' : '보기';
      });
      pwLine.append(pwVal, show, miniBtn('비번 복사', 'copy', (e) => copyText(acc.pass, e.currentTarget)));
      card.append(pwLine);
    }
    box.append(card);
  });
  $('acc-empty').hidden = list.length > 0;
}

$('acc-add').addEventListener('click', async () => {
  if (!vault.key) return lockVault();
  const email = $('acc-email').value.trim();
  if (!email) { $('acc-email').focus(); return; }
  vault.accounts.push({ name: $('acc-name').value.trim(), email, pass: $('acc-pass').value });
  await saveVault();
  $('acc-name').value = '';
  $('acc-email').value = '';
  $('acc-pass').value = '';
  renderAccounts();
});

$('acc-open-chooser').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent('https://flow.google.com/')
  });
});

initVault();

load();
