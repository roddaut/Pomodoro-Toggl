import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  createTimeEntry,
  fetchMe,
  type TogglMe,
} from './lib/toggl'
import {
  getLoginItemStatus,
  isNativeShell,
  postNativePhase,
  setLoginItemEnabled,
} from './lib/nativeBridge'
import { clearToken, loadToken, saveToken } from './lib/storage'
import {
  startBreakOceanSound,
  stopBreakOceanSound,
} from './lib/breakOceanSound'
import {
  playWorkCompleteSound,
  prepareWorkAudio,
} from './lib/workCompleteSound'
import { playTickSound } from './lib/tickSound'

type Phase =
  | 'idle'
  | 'work'
  | 'before_break'
  | 'short_break'
  | 'long_break'

const DEFAULT_WORK = 25 * 60
const DEFAULT_SHORT = 5 * 60
const DEFAULT_LONG = 15 * 60

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatOvertime(totalSeconds: number): string {
  return `+${formatClock(totalSeconds)}`
}

/** Full ISO 8601 (ms kept). Toggl validates `duration` against `stop − start`; rounding away ms made both timestamps the same second for short spans. */
function toIso(d: Date): string {
  return d.toISOString()
}

function splitMinSec(totalSeconds: number) {
  const t = Math.max(0, Math.floor(totalSeconds))
  return { min: Math.floor(t / 60), sec: t % 60 }
}

function totalFromMinSec(min: number, sec: number) {
  const m = Math.max(0, Math.floor(min))
  const s = Math.min(59, Math.max(0, Math.floor(sec)))
  return m * 60 + s
}

function DurationMinSecInputs({
  label,
  totalSeconds,
  minTotalSeconds,
  disabled,
  onCommit,
}: {
  label: string
  totalSeconds: number
  minTotalSeconds: number
  disabled: boolean
  onCommit: (nextTotal: number) => void
}) {
  const { min, sec } = splitMinSec(totalSeconds)
  const apply = (nextMin: number, nextSec: number) => {
    const t = totalFromMinSec(nextMin, nextSec)
    onCommit(Math.max(minTotalSeconds, t))
  }

  return (
    <div className="duration-block">
      <span className="duration-name">{label}</span>
      <div className="duration-inputs">
        <label className="duration-part">
          <input
            className="duration-input-min"
            type="number"
            min={0}
            max={999}
            disabled={disabled}
            value={min}
            onChange={(e) => {
              const raw = Number(e.target.value)
              const m = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
              apply(m, sec)
            }}
          />
          <span className="duration-unit">min</span>
        </label>
        <label className="duration-part">
          <input
            className="duration-input-sec"
            type="number"
            min={0}
            max={59}
            disabled={disabled}
            value={sec}
            onChange={(e) => {
              const raw = Number(e.target.value)
              const s = Number.isFinite(raw)
                ? Math.min(59, Math.max(0, Math.floor(raw)))
                : 0
              apply(min, s)
            }}
          />
          <span className="duration-unit">sec</span>
        </label>
      </div>
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => loadToken())
  const [tokenDraft, setTokenDraft] = useState('')
  const [me, setMe] = useState<TogglMe | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [workspaceId, setWorkspaceId] = useState<number | ''>('')
  const [projectId, setProjectId] = useState<number | ''>('')
  const [description, setDescription] = useState('')

  const [phase, setPhase] = useState<Phase>('idle')
  const [remaining, setRemaining] = useState(DEFAULT_WORK)
  const [workSec, setWorkSec] = useState(DEFAULT_WORK)
  const [shortSec, setShortSec] = useState(DEFAULT_SHORT)
  const [longSec, setLongSec] = useState(DEFAULT_LONG)
  const [pomosUntilLong, setPomosUntilLong] = useState(0)

  const workStartRef = useRef<number | null>(null)
  const zeroHandledRef = useRef(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [overtimeSec, setOvertimeSec] = useState(0)
  const [pendingBreak, setPendingBreak] = useState<'short_break' | 'long_break'>(
    'short_break',
  )

  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [loginItemNeedsApproval, setLoginItemNeedsApproval] = useState(false)
  const [loginItemError, setLoginItemError] = useState<string | null>(null)
  const [loginItemBusy, setLoginItemBusy] = useState(false)

  const workspaces = me?.workspaces ?? []
  const projectsForWs = useMemo(() => {
    if (workspaceId === '') return []
    return (me?.projects ?? []).filter(
      (p) => p.workspace_id === workspaceId && p.active !== false,
    )
  }, [me?.projects, workspaceId])

  const connect = useCallback(async () => {
    const t = tokenDraft.trim() || token
    if (!t) {
      setLoadError('Paste your API token first.')
      return
    }
    setBusy(true)
    setLoadError(null)
    try {
      const profile = await fetchMe(t)
      setMe(profile)
      setToken(t)
      saveToken(t)
      const wid =
        profile.default_workspace_id ??
        profile.workspaces?.[0]?.id ??
        ''
      setWorkspaceId(wid === '' ? '' : wid)
      const firstProject = profile.projects?.find(
        (p) => p.workspace_id === wid && p.active !== false,
      )
      setProjectId(firstProject?.id ?? '')
    } catch (e) {
      setMe(null)
      setLoadError(e instanceof Error ? e.message : 'Could not reach Toggl.')
    } finally {
      setBusy(false)
    }
  }, [token, tokenDraft])

  useEffect(() => {
    if (!token) return
    setBusy(true)
    setLoadError(null)
    fetchMe(token)
      .then((profile) => {
        setMe(profile)
        const wid =
          profile.default_workspace_id ??
          profile.workspaces?.[0]?.id ??
          ''
        setWorkspaceId((prev) =>
          prev !== '' ? prev : wid === '' ? '' : wid,
        )
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : 'Session expired.')
        setMe(null)
      })
      .finally(() => setBusy(false))
  }, [token])

  useEffect(() => {
    if (workspaceId === '') {
      setProjectId('')
      return
    }
    const stillValid = projectsForWs.some((p) => p.id === projectId)
    if (!stillValid) {
      const first = projectsForWs[0]
      setProjectId(first?.id ?? '')
    }
  }, [workspaceId, projectsForWs, projectId])

  useEffect(() => {
    postNativePhase(phase, Boolean(token))
  }, [phase, token])

  useEffect(() => {
    if (!isNativeShell()) return
    const ac = new AbortController()
    void (async () => {
      try {
        const d = await getLoginItemStatus(ac.signal)
        setOpenAtLogin(d.enabled)
        setLoginItemNeedsApproval(Boolean(d.requiresApproval))
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        // Bridge not ready or native error — leave defaults; avoid noisy timeout in UI
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const shouldOcean =
      (phase === 'short_break' || phase === 'long_break') && remaining > 0
    if (shouldOcean) startBreakOceanSound()
    else stopBreakOceanSound()
    return () => stopBreakOceanSound()
  }, [phase, remaining])

  const logSession = useCallback(
    async (startedAt: number, endedAt: number) => {
      if (!token || workspaceId === '') {
        setSyncNote('Skipped: connect Toggl and pick a workspace.')
        return
      }
      const start = new Date(startedAt)
      const stop = new Date(endedAt)
      const duration = Math.max(
        1,
        Math.round((stop.getTime() - start.getTime()) / 1000),
      )
      const desc =
        description.trim() ||
        `Pomodoro (${Math.round(duration / 60)} min)`
      try {
        await createTimeEntry(token, workspaceId, {
          description: desc,
          start: toIso(start),
          stop: toIso(stop),
          duration,
          workspace_id: workspaceId,
          project_id: projectId === '' ? undefined : projectId,
        })
        setSyncNote(`Logged ${formatClock(duration)} to Toggl.`)
      } catch (e) {
        setSyncNote(
          e instanceof Error ? e.message : 'Could not create time entry.',
        )
      }
    },
    [token, workspaceId, projectId, description],
  )

  useEffect(() => {
    if (phase === 'before_break') {
      const id = window.setInterval(() => {
        setOvertimeSec((o) => o + 1)
        playTickSound()
      }, 1000)
      return () => window.clearInterval(id)
    }
    if (phase === 'work') {
      const id = window.setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) return 0
          return r - 1
        })
      }, 1000)
      return () => window.clearInterval(id)
    }
    if (phase === 'short_break' || phase === 'long_break') {
      const id = window.setInterval(() => {
        setRemaining((r) => {
          if (r <= 1) return 0
          return r - 1
        })
      }, 1000)
      return () => window.clearInterval(id)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'short_break' && phase !== 'long_break') return
    if (remaining > 0) return
    const id = window.setInterval(() => {
      setOvertimeSec((o) => o + 1)
      playTickSound()
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase, remaining])

  useEffect(() => {
    if (remaining !== 0) {
      zeroHandledRef.current = false
      return
    }
    if (phase === 'idle') return
    if (zeroHandledRef.current) return
    zeroHandledRef.current = true

    if (phase === 'work') {
      playWorkCompleteSound()
      const end = Date.now()
      const start = workStartRef.current ?? end - workSec * 1000
      void logSession(start, end)
      const next =
        (pomosUntilLong + 1) % 4 === 0 ? 'long_break' : 'short_break'
      setPendingBreak(next)
      setPomosUntilLong((n) => n + 1)
      setOvertimeSec(0)
      setPhase('before_break')
      workStartRef.current = null
      return
    }
    if (phase === 'short_break' || phase === 'long_break') {
      setOvertimeSec(0)
      return
    }
  }, [
    remaining,
    phase,
    workSec,
    shortSec,
    longSec,
    logSession,
    pomosUntilLong,
  ])

  function startFocus() {
    prepareWorkAudio()
    setSyncNote(null)
    workStartRef.current = Date.now()
    setPhase('work')
    setRemaining(workSec)
  }

  function startBreak() {
    if (phase !== 'before_break') return
    setOvertimeSec(0)
    setPhase(pendingBreak)
    setRemaining(pendingBreak === 'long_break' ? longSec : shortSec)
  }

  function stopSession() {
    if (phase !== 'work') return
    const end = Date.now()
    const start = workStartRef.current
    workStartRef.current = null
    if (start != null) {
      const elapsed = end - start
      if (elapsed >= 60_000) void logSession(start, end)
      else setSyncNote('Session under 1 minute — not sent to Toggl.')
    }
    setPhase('idle')
    setRemaining(workSec)
  }

  function skipBreak() {
    if (
      phase !== 'short_break' &&
      phase !== 'long_break' &&
      phase !== 'before_break'
    )
      return
    setPhase('idle')
    setRemaining(workSec)
    setOvertimeSec(0)
  }

  function disconnect() {
    clearToken()
    setToken(null)
    setMe(null)
    setWorkspaceId('')
    setProjectId('')
    setTokenDraft('')
    setPhase('idle')
    setRemaining(workSec)
    setOvertimeSec(0)
    setSyncNote(null)
  }

  const phaseLabel =
    phase === 'work'
      ? 'Focus'
      : phase === 'before_break'
        ? pendingBreak === 'long_break'
          ? 'Break soon (long)'
          : 'Break soon (short)'
        : phase === 'short_break'
          ? 'Short break'
          : phase === 'long_break'
            ? 'Long break'
            : 'Ready'

  const dialProgress =
    phase === 'idle' || phase === 'before_break'
      ? 0
      : phase === 'work'
        ? workSec > 0
          ? 1 - remaining / workSec
          : 0
        : phase === 'short_break'
          ? shortSec > 0
            ? remaining > 0
              ? 1 - remaining / shortSec
              : 1
            : 0
          : longSec > 0
            ? remaining > 0
              ? 1 - remaining / longSec
              : 1
            : 0

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Pomodoro × Toggl</h1>
          <p className="lede">
            Focus sessions become Toggl time entries on your workspace.
          </p>
        </div>
        {token && (
          <button type="button" className="ghost" onClick={disconnect}>
            Sign out
          </button>
        )}
      </header>

      {!token ? (
        <section className="card">
          <h2>Connect Toggl Track</h2>
          <p className="hint">
            Create an API token in{' '}
            <a
              href="https://track.toggl.com/profile"
              target="_blank"
              rel="noreferrer"
            >
              Profile → API token
            </a>
            . It is stored only in this browser.
          </p>
          <label className="field">
            <span>API token</span>
            <input
              type="password"
              autoComplete="off"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="Paste token"
            />
          </label>
          {loadError && <p className="error">{loadError}</p>}
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={connect}
          >
            {busy ? 'Connecting…' : 'Save & load workspaces'}
          </button>
        </section>
      ) : (
        <>
          <section className="card grid">
            <label className="field">
              <span>Workspace</span>
              <select
                value={workspaceId === '' ? '' : String(workspaceId)}
                onChange={(e) =>
                  setWorkspaceId(
                    e.target.value ? Number(e.target.value) : '',
                  )
                }
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Project (optional)</span>
              <select
                value={projectId === '' ? '' : String(projectId)}
                onChange={(e) =>
                  setProjectId(e.target.value ? Number(e.target.value) : '')
                }
              >
                <option value="">No project</option>
                {projectsForWs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field full">
              <span>What are you working on?</span>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Deep work — design review"
              />
            </label>
          </section>

          <section className="timer">
            <div
              className="ring"
              style={
                {
                  '--p': String(Math.min(1, Math.max(0, dialProgress))),
                } as React.CSSProperties
              }
              aria-hidden
            />
            <div className="timer-inner">
              <p className="phase">{phaseLabel}</p>
              <p className="clock" aria-live="polite">
                {phase === 'before_break' ||
                ((phase === 'short_break' || phase === 'long_break') &&
                  remaining === 0)
                  ? formatOvertime(overtimeSec)
                  : formatClock(remaining)}
              </p>
              <p className="meta">
                {phase === 'idle'
                  ? `${Math.round(workSec / 60)} min focus · After this focus: ${(pomosUntilLong + 1) % 4 === 0 ? 'long' : 'short'} break`
                  : phase === 'work'
                    ? 'Stay on task until the bell.'
                    : phase === 'before_break'
                      ? 'Extra time is counting. Start the break when you are ready.'
                      : phase === 'short_break' || phase === 'long_break'
                        ? remaining === 0
                          ? 'Break time is over. Extra time is counting — end when you are ready.'
                          : 'Breathe. Next round is waiting.'
                        : ''}
              </p>
            </div>
          </section>

          <div className="actions">
            {phase === 'idle' && (
              <button type="button" className="primary" onClick={startFocus}>
                Start focus
              </button>
            )}
            {phase === 'work' && (
              <button type="button" className="danger" onClick={stopSession}>
                Stop &amp; reset
              </button>
            )}
            {phase === 'before_break' && (
              <>
                <button type="button" className="primary" onClick={startBreak}>
                  Start break
                </button>
                <button type="button" className="secondary" onClick={skipBreak}>
                  Skip break
                </button>
              </>
            )}
            {(phase === 'short_break' || phase === 'long_break') && (
              <button type="button" className="secondary" onClick={skipBreak}>
                {remaining === 0 ? 'End break' : 'Skip break'}
              </button>
            )}
          </div>

          {syncNote && <p className="sync">{syncNote}</p>}

          <section className="card durations">
            <h3>Durations (minutes &amp; seconds)</h3>
            <p className="durations-hint">
              Minutes can be 0 (sub-minute timers use seconds). Each duration is
              at least 1 second total. Seconds are 0–59.
            </p>
            <div className="row">
              <DurationMinSecInputs
                label="Focus"
                totalSeconds={workSec}
                minTotalSeconds={1}
                disabled={phase !== 'idle'}
                onCommit={(t) => {
                  setWorkSec(t)
                  if (phase === 'idle') setRemaining(t)
                }}
              />
              <DurationMinSecInputs
                label="Short break"
                totalSeconds={shortSec}
                minTotalSeconds={1}
                disabled={phase !== 'idle'}
                onCommit={setShortSec}
              />
              <DurationMinSecInputs
                label="Long break"
                totalSeconds={longSec}
                minTotalSeconds={1}
                disabled={phase !== 'idle'}
                onCommit={setLongSec}
              />
            </div>
          </section>
        </>
      )}

      {isNativeShell() && (
        <section className="card mac-login" aria-labelledby="mac-login-heading">
          <h3 id="mac-login-heading">Mac app</h3>
          <div className="mac-login-row">
            <input
              id="pomodoro-open-at-login"
              type="checkbox"
              className="mac-login-checkbox"
              checked={openAtLogin}
              disabled={loginItemBusy}
              onChange={async (e) => {
                const next = e.target.checked
                setLoginItemBusy(true)
                setLoginItemError(null)
                try {
                  const d = await setLoginItemEnabled(next)
                  if (d.error) setLoginItemError(d.error)
                  setOpenAtLogin(d.enabled)
                  setLoginItemNeedsApproval(Boolean(d.requiresApproval))
                } catch (err) {
                  setLoginItemError(
                    err instanceof Error ? err.message : 'Could not update',
                  )
                } finally {
                  setLoginItemBusy(false)
                }
              }}
            />
            <label className="mac-login-row-label" htmlFor="pomodoro-open-at-login">
              Open at login
            </label>
          </div>
          {loginItemNeedsApproval && (
            <p className="mac-login-hint">
              Approve &ldquo;Pomodoro × Toggl&rdquo; in System Settings → General
              → Login Items &amp; Extensions (or Open at Login).
            </p>
          )}
          {loginItemError && (
            <p className="error mac-login-error">{loginItemError}</p>
          )}
        </section>
      )}

      <footer className="foot">
        <p>
          Uses{' '}
          <a
            href="https://developers.track.toggl.com/docs/api/"
            target="_blank"
            rel="noreferrer"
          >
            Toggl Track API v9
          </a>
          . Run locally with <code>npm run dev</code> so the dev proxy can reach
          Toggl.
        </p>
      </footer>
    </div>
  )
}
