// Gemini Auto Image - 사이드 패널
const $ = (id) => document.getElementById(id);
const MAX_REFS = 8;
const MAX_LIBRARY = 300;
const SITE_RE = /^https:\/\/(labs\.google|gemini\.google\.com)\//;

const state = {
  ratio: '1:1',
  refs: [], // { name, dataUrl }
  running: false,
  stop: false
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 저장 ----------
async function saveDraft() {
  await chrome.storage.local.set({
    draft: { prompts: $('prompts').value, ratio: state.ratio, refs: state.refs }
  });
}

function readSettings() {
  return {
    delay: Math.max(0, Number($('set-delay').value) || 0),
    timeout: Math.max(30, Number($('set-timeout').value) || 300),
    repeat: Math.min(20, Math.max(1, Number($('set-repeat').value) || 1)),
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
    $('prompts').value = draft.prompts || '';
    state.ratio = draft.ratio || '1:1';
    state.refs = draft.refs || [];
  }
  if (settings) {
    $('set-delay').value = settings.delay;
    $('set-timeout').value = settings.timeout;
    $('set-repeat').value = settings.repeat;
    $('set-ratio-text').checked = settings.ratioText;
    $('set-autodl').checked = settings.autoDownload;
    $('set-folder').value = settings.folder;
  }
  renderRatios();
  renderRefs();
  updateCount();
  renderLibrary();
  checkSite();
}

// ---------- 프롬프트 ----------
function getPrompts() {
  return $('prompts').value.split('\n').map((s) => s.trim()).filter(Boolean);
}

function updateCount() {
  const n = getPrompts().length;
  $('prompt-count').textContent = `${n} prompt${n === 1 ? '' : 's'}`;
}

$('prompts').addEventListener('input', () => { updateCount(); saveDraft(); });
$('clear-prompts').addEventListener('click', () => { $('prompts').value = ''; updateCount(); saveDraft(); });
$('txt-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const cur = $('prompts').value.trim();
  $('prompts').value = (cur ? cur + '\n' : '') + text.trim();
  e.target.value = '';
  updateCount();
  saveDraft();
});

// ---------- 비율 ----------
function renderRatios() {
  document.querySelectorAll('.ratio').forEach((b) => b.classList.toggle('active', b.dataset.ratio === state.ratio));
}
$('ratios').addEventListener('click', (e) => {
  const b = e.target.closest('.ratio');
  if (!b) return;
  state.ratio = b.dataset.ratio;
  renderRatios();
  saveDraft();
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
['set-delay', 'set-timeout', 'set-repeat', 'set-ratio-text', 'set-autodl', 'set-folder'].forEach((id) => {
  $(id).addEventListener('change', saveSettings);
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
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url || !SITE_RE.test(tab.url)) return null;
  return tab;
}

function siteName(url) {
  if (!url) return '';
  if (url.includes('labs.google')) return 'Google Flow';
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
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete') checkSite(); });

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

// ---------- 실행 ----------
function buildPrompt(text, settings) {
  if (!settings.ratioText) return text;
  return `${text} (aspect ratio ${state.ratio})`;
}

function setRunning(on) {
  state.running = on;
  $('start-btn').disabled = on;
  $('stop-btn').disabled = !on;
  $('prompts').disabled = on;
}

$('start-btn').addEventListener('click', async () => {
  const prompts = getPrompts();
  if (!prompts.length) return setStatus('프롬프트를 한 줄 이상 입력하세요.', 'err');
  const tab = await checkSite();
  if (!tab) return setStatus('Google Flow나 Gemini 탭을 연 상태에서 시작하세요.', 'err');

  const settings = readSettings();
  const jobs = [];
  prompts.forEach((p) => { for (let r = 0; r < settings.repeat; r++) jobs.push(p); });

  state.stop = false;
  setRunning(true);
  let done = 0, fail = 0, saved = 0;
  setProgress(0, jobs.length);

  for (let i = 0; i < jobs.length; i++) {
    if (state.stop) break;
    setStatus(`${i + 1} / ${jobs.length} 생성 중 · ${jobs[i].slice(0, 40)}`);
    let res;
    try {
      res = await sendToTab(tab.id, {
        gai: true,
        type: 'run',
        prompt: buildPrompt(jobs[i], settings),
        refs: state.refs,
        timeoutSec: settings.timeout
      });
    } catch (e) {
      res = { ok: false, error: '페이지와 연결하지 못했습니다. 탭을 새로고침해 주세요.' };
    }
    if (state.stop) break;

    if (res && res.ok) {
      const items = res.items.map((it) => ({ ...it, prompt: jobs[i], time: Date.now() }));
      await addToLibrary(items);
      if (settings.autoDownload) {
        for (const it of items) await download(it, ++saved, settings.folder);
      }
      done++;
    } else {
      fail++;
      setStatus(`${i + 1}번 실패 · ${(res && res.error) || '알 수 없는 오류'}`, 'err');
      // 생성 버튼이 막혔다면 한도에 걸린 것이므로 멈춘다
      if (res && /비활성화/.test(res.error || '')) break;
      await sleep(1500);
    }
    setProgress(i + 1, jobs.length);
    if (i < jobs.length - 1 && settings.delay && !state.stop) await sleep(settings.delay * 1000);
  }

  setRunning(false);
  if (state.stop) setStatus(`중지됨 · 성공 ${done}건, 실패 ${fail}건`);
  else setStatus(`완료 · 성공 ${done}건, 실패 ${fail}건`, fail ? 'err' : 'ok');
});

$('stop-btn').addEventListener('click', async () => {
  state.stop = true;
  const tab = await getTargetTab();
  if (tab) { try { await chrome.tabs.sendMessage(tab.id, { gai: true, type: 'stop' }); } catch (e) {} }
  setStatus('중지하는 중...');
});

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
    url: 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent('https://labs.google/fx/tools/flow')
  });
});

initVault();

load();
