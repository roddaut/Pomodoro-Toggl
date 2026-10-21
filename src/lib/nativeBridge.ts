type NativePhaseMessage = {
  type: 'phase'
  phase: 'idle' | 'work' | 'before_break' | 'short_break' | 'long_break'
  connected: boolean
}

export type LoginItemDetail = {
  enabled: boolean
  requiresApproval?: boolean
  /** False when the host is not a `.app` bundle (e.g. bare SwiftPM binary); SMAppService needs an app bundle. */
  supported?: boolean
  error?: string
}

export type DeskReminderDetail = {
  enabled: boolean
  thresholdMinutes: number
  error?: string
}

function getNativePomodoro() {
  const w = window as Window & {
    webkit?: {
      messageHandlers?: { pomodoro?: { postMessage: (m: unknown) => void } }
    }
  }
  return w.webkit?.messageHandlers?.pomodoro
}

function postMessage(msg: Record<string, unknown>) {
  try {
    getNativePomodoro()?.postMessage(msg)
  } catch {
    // Not in macOS WebView
  }
}

/** Serialize WKWebView ↔ JS round-trips so only one listener is pending per event name at a time. */
let nativeReplyChain: Promise<void> = Promise.resolve()

function enqueueNativeReply<T>(fn: () => Promise<T>): Promise<T> {
  const run = nativeReplyChain.then(() => fn())
  nativeReplyChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** True when running inside the Pomodoro × Toggl macOS shell (WKWebView). */
export function isNativeShell(): boolean {
  return !!getNativePomodoro()
}

/** Notifies the macOS shell about timer / connection state (no-op in browser). */
export function postNativePhase(
  phase: NativePhaseMessage['phase'],
  connected: boolean,
) {
  postMessage({ type: 'phase', phase, connected })
}

function waitForLoginItemEvent(signal?: AbortSignal): Promise<LoginItemDetail> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      window.removeEventListener('pomodoro-login-item', handler)
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
    }

    function onAbort() {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    function handler(e: Event) {
      cleanup()
      const ce = e as CustomEvent<LoginItemDetail>
      resolve(ce.detail ?? { enabled: false })
    }

    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', onAbort)

    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Login item request timed out'))
    }, 15000)

    window.addEventListener('pomodoro-login-item', handler)
  })
}

function waitForDeskReminderEvent(signal?: AbortSignal): Promise<DeskReminderDetail> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      window.removeEventListener('pomodoro-desk-reminder', handler)
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
    }

    function onAbort() {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    function handler(e: Event) {
      cleanup()
      const ce = e as CustomEvent<DeskReminderDetail>
      const d = ce.detail
      resolve(
        d ?? {
          enabled: true,
          thresholdMinutes: 10,
        },
      )
    }

    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', onAbort)

    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Desk reminder request timed out'))
    }, 15000)

    window.addEventListener('pomodoro-desk-reminder', handler)
  })
}

/** Current login-item state from the macOS shell. */
export async function getLoginItemStatus(
  signal?: AbortSignal,
): Promise<LoginItemDetail> {
  if (!isNativeShell()) {
    return { enabled: false }
  }
  return enqueueNativeReply(async () => {
    const p = waitForLoginItemEvent(signal)
    postMessage({ type: 'loginItem', action: 'get' })
    return p
  })
}

/** Register or unregister Open at login. */
export async function setLoginItemEnabled(
  enabled: boolean,
  signal?: AbortSignal,
): Promise<LoginItemDetail> {
  if (!isNativeShell()) {
    return { enabled: false }
  }
  return enqueueNativeReply(async () => {
    const p = waitForLoginItemEvent(signal)
    postMessage({ type: 'loginItem', action: 'set', enabled })
    return p
  })
}

/** Current desk-reminder config from the macOS shell (in-memory; pair with storage on the web). */
export async function getDeskReminderSettings(
  signal?: AbortSignal,
): Promise<DeskReminderDetail> {
  if (!isNativeShell()) {
    return { enabled: true, thresholdMinutes: 10 }
  }
  return enqueueNativeReply(async () => {
    const p = waitForDeskReminderEvent(signal)
    postMessage({ type: 'deskReminder', action: 'get' })
    return p
  })
}

/** Apply desk-reminder enable + threshold (minutes) in the macOS shell. */
export async function setDeskReminderSettings(
  enabled: boolean,
  thresholdMinutes: number,
  signal?: AbortSignal,
): Promise<DeskReminderDetail> {
  if (!isNativeShell()) {
    return { enabled, thresholdMinutes }
  }
  const clamped = Math.min(240, Math.max(1, Math.round(thresholdMinutes)))
  return enqueueNativeReply(async () => {
    const p = waitForDeskReminderEvent(signal)
    postMessage({
      type: 'deskReminder',
      action: 'set',
      enabled,
      thresholdMinutes: clamped,
    })
    return p
  })
}
