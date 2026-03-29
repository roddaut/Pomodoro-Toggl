type NativePhaseMessage = {
  type: 'phase'
  phase: 'idle' | 'work' | 'short_break' | 'long_break'
  connected: boolean
}

function postMessage(msg: NativePhaseMessage) {
  const w = window as Window & {
    webkit?: { messageHandlers?: { pomodoro?: { postMessage: (m: unknown) => void } } }
  }
  try {
    w.webkit?.messageHandlers?.pomodoro?.postMessage(msg)
  } catch {
    // Not in macOS WebView
  }
}

/** Notifies the macOS shell about timer / connection state (no-op in browser). */
export function postNativePhase(
  phase: NativePhaseMessage['phase'],
  connected: boolean,
) {
  postMessage({ type: 'phase', phase, connected })
}
