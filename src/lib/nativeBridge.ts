type NativePhaseMessage = {
  type: 'phase'
  phase: 'idle' | 'work' | 'before_break' | 'short_break' | 'long_break'
  connected: boolean
}

export type LoginItemDetail = {
  enabled: boolean
  requiresApproval?: boolean
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
    let timeoutId: ReturnType<typeof setTimeout>

    const cleanup = () => {
      window.removeEventListener('pomodoro-login-item', handler)
      window.clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    const handler = (e: Event) => {
      cleanup()
      const ce = e as CustomEvent<LoginItemDetail>
      resolve(ce.detail ?? { enabled: false })
    }

    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', onAbort)

    timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('Login item request timed out'))
    }, 15000)

    window.addEventListener('pomodoro-login-item', handler)
  })
}

/** Current login-item state from the macOS shell. */
export async function getLoginItemStatus(
  signal?: AbortSignal,
): Promise<LoginItemDetail> {
  if (!isNativeShell()) {
    return { enabled: false }
  }
  const p = waitForLoginItemEvent(signal)
  postMessage({ type: 'loginItem', action: 'get' })
  return p
}

/** Register or unregister Open at login. */
export async function setLoginItemEnabled(
  enabled: boolean,
  signal?: AbortSignal,
): Promise<LoginItemDetail> {
  if (!isNativeShell()) {
    return { enabled: false }
  }
  const p = waitForLoginItemEvent(signal)
  postMessage({ type: 'loginItem', action: 'set', enabled })
  return p
}
