/* Minimal Win32 window watcher (user32/kernel32 via koffi).
 * Used to follow the ClawsGO window: show the board only while it is the active app. */
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const EnumProc = koffi.proto('bool EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');

const EnumWindows = user32.func('bool __stdcall EnumWindows(void* cb, intptr_t lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hwnd)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32 *pid)');
const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(intptr_t hwnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint16 *buf, int max)');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(intptr_t hwnd)');
const SetActiveWindow = user32.func('intptr_t __stdcall SetActiveWindow(intptr_t hwnd)');
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');

const OpenProcess = kernel32.func('intptr_t __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(intptr_t proc, uint32 flags, _Out_ uint16 *buf, _Inout_ uint32 *size)',
);
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr_t h)');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const exeCache = new Map();

function pidOfWindow(hwnd) {
  if (!hwnd) return 0;
  const pid = [0];
  try {
    GetWindowThreadProcessId(hwnd, pid);
  } catch {
    return 0;
  }
  return pid[0] || 0;
}

function exeName(pid) {
  if (exeCache.has(pid)) return exeCache.get(pid);
  let name = '';
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (h) {
    try {
      const buf = Buffer.alloc(1024 * 2);
      const size = [1024];
      if (QueryFullProcessImageNameW(h, 0, buf, size)) {
        const full = Buffer.from(buf.subarray(0, size[0] * 2)).toString('utf16le');
        name = full.split('\\').pop() || '';
      }
    } finally {
      CloseHandle(h);
    }
  }
  exeCache.set(pid, name);
  return name;
}

function windowTitle(hwnd) {
  const len = GetWindowTextLengthW(hwnd);
  if (!len) return '';
  const buf = Buffer.alloc((len + 1) * 2);
  const n = GetWindowTextW(hwnd, buf, len + 1);
  if (!n) return '';
  return Buffer.from(buf.subarray(0, n * 2)).toString('utf16le');
}

function windowRect(hwnd) {
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!GetWindowRect(hwnd, rect)) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

/** Enumerate visible top-level windows, optionally filtered by exe basename. */
function listWindows(filterExe) {
  const out = [];
  const cb = koffi.register(
    (hwnd) => {
      try {
        if (!IsWindowVisible(hwnd)) return true;
        const pid = pidOfWindow(hwnd);
        if (!pid) return true;
        if (filterExe && exeName(pid) !== filterExe) return true;
        const title = windowTitle(hwnd);
        if (!title) return true;
        out.push({
          hwnd: BigInt(hwnd),
          pid,
          title,
          minimized: !!IsIconic(hwnd),
          rect: windowRect(hwnd),
        });
      } catch {
        /* ignore single window errors */
      }
      return true;
    },
    koffi.pointer(EnumProc),
  );
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return out;
}

function foregroundPid() {
  const fg = GetForegroundWindow();
  return pidOfWindow(fg);
}

/** Bring a window to the foreground (best effort, with AttachThreadInput). */
function setForeground(hwnd) {
  if (!hwnd) return false;
  try {
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    const fg = GetForegroundWindow();
    const fgThread = fg ? GetWindowThreadProcessId(fg, [0]) : 0;
    const myThread = GetCurrentThreadId();
    const attached = fgThread && fgThread !== myThread && AttachThreadInput(myThread, fgThread, true);
    SetForegroundWindow(hwnd);
    BringWindowToTop(hwnd);
    SetActiveWindow(hwnd);
    if (attached) AttachThreadInput(myThread, fgThread, false);
    return true;
  } catch {
    return false;
  }
}

/** Find the main window (largest visible, non-minimized) of a process image. */
function findMainWindow(exe) {
  const wins = listWindows(exe).filter((w) => !w.minimized && w.rect && w.rect.width > 200);
  if (!wins.length) return null;
  wins.sort(
    (a, b) =>
      b.rect.width * b.rect.height - a.rect.width * a.rect.height ||
      (/clawsgo/i.test(b.title) ? 1 : 0) - (/clawsgo/i.test(a.title) ? 1 : 0),
  );
  return wins[0];
}

/** Find the main ClawsGO window (the largest visible one). */
function findClawsGO() {
  return findMainWindow('ClawsGO.exe');
}

module.exports = { listWindows, foregroundPid, findClawsGO, findMainWindow, pidOfWindow, exeName, setForeground };
