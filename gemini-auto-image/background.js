// Gemini Auto Image - 백그라운드
// 1) 툴바 아이콘을 누르면 사이드 패널을 연다.
// 2) "정확한 클릭" (선택 기능): 사용자가 Settings 에서 직접 켜고 Chrome 권한 창에서 허락한 경우에만,
//    Flow / Gemini 탭에 실제 마우스 클릭과 키 입력을 보낸다. 작업이 끝나면 바로 떨어진다.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const ALLOWED = /^https:\/\/(flow\.google\.com|labs\.google|gemini\.google\.com)\//;
const attached = new Set();
let idleTimer = null;

const hasPermission = () => chrome.permissions.contains({ permissions: ['debugger'] }).catch(() => false);

if (chrome.debugger && chrome.debugger.onDetach) {
  chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId));
}

async function ensureAttached(tab) {
  if (!tab || !ALLOWED.test(tab.url || '')) return false; // Flow / Gemini 탭에만 붙는다
  if (!(await hasPermission()) || !chrome.debugger) return false;
  if (attached.has(tab.id)) return true;
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    attached.add(tab.id);
    return true;
  } catch (e) {
    if (/already attached/i.test(String(e && e.message))) {
      attached.add(tab.id);
      return true;
    }
    return false;
  }
}

async function detachAll() {
  for (const tabId of [...attached]) {
    try { await chrome.debugger.detach({ tabId }); } catch (e) {}
    attached.delete(tabId);
  }
}

function touchIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(detachAll, 60 * 1000); // 1분 동안 쓰지 않으면 떨어진다
}

const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);

async function realClick(tab, x, y) {
  if (!(await ensureAttached(tab))) return false;
  touchIdle();
  await send(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send(tab.id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  return true;
}

async function realEscape(tab) {
  if (!(await ensureAttached(tab))) return false;
  touchIdle();
  const k = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
  await send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await send(tab.id, 'Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.gaiBg) return;
  let job;
  if (msg.gaiBg === 'click' && sender.tab) job = realClick(sender.tab, msg.x, msg.y);
  else if (msg.gaiBg === 'escape' && sender.tab) job = realEscape(sender.tab);
  else if (msg.gaiBg === 'detach') job = detachAll().then(() => true);
  else return;
  job.then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
  return true;
});
