import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  createTimeEntry,
  fetchMe,
  type TogglMe,
} from './lib/toggl'
import {
  isNativeShell,
  postNativePhase,
  setDeskReminderSettings,
} from './lib/nativeBridge'
import {
  clearToken,
  loadDeskReminderSettings,
  loadFocusAmbientId,
  loadToken,
  saveToken,
  type FocusAmbientId,
} from './lib/storage'
import SettingsPage from './SettingsPage'
import ProjectCombobox from './ProjectCombobox'
import {
  startBreakOceanSound,
  stopBreakOceanSound,
} from './lib/breakOceanSound'
import {
  startFocusAmbient,
  stopFocusAmbient,
} from './lib/focusAmbientSound'
import {
  ensureAudioRunning,
  playWorkCompleteSound,
  prepareWorkAudio,
  wakeSharedAudio,
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

/** First overtime tick after work chime (ms); subsequent ticks every 1s. */
const FIRST_TICK_AFTER_CHIME_MS = 500
/** Keep Web Audio unlocked during long focus sessions (ms). */
const AUDIO_KEEPALIVE_MS = 60_000
/** Throttle pointer-driven `wakeSharedAudio` (ms). */
const POINTER_WAKE_THROTTLE_MS = 800

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatOvertime(totalSeconds: number): string {
  return `+${formatClock(totalSeconds)}`
}

/** Seconds left until `endMs` using wall time — avoids UI drift when `setInterval` is throttled in the background. */
function secondsRemainingUntil(endMs: number): number {
  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000))
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
  const breakEndAtRef = useRef<number | null>(null)
  const zeroHandledRef = useRef(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [overtimeSec, setOvertimeSec] = useState(0)
  const [pendingBreak, setPendingBreak] = useState<'short_break' | 'long_break'>(
    'short_break',
  )

  const [view, setView] = useState<'main' | 'settings'>('main')
  const [focusAmbientId, setFocusAmbientId] = useState<FocusAmbientId>(
    () => loadFocusAmbientId(),
  )

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wakeSharedAudio()
    }
    const onFocus = () => {
      wakeSharedAudio()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    let last = 0
    const onPointerDown = () => {
      const t = Date.now()
      if (t - last < POINTER_WAKE_THROTTLE_MS) return
      last = t
      wakeSharedAudio()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  useEffect(() => {
    if (phase !== 'work') return
    const id = window.setInterval(() => {
      void ensureAudioRunning()
    }, AUDIO_KEEPALIVE_MS)
    return () => window.clearInterval(id)
  }, [phase])

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
    if (projectId === '') {
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
    const s = loadDeskReminderSettings()
    void (async () => {
      try {
        await setDeskReminderSettings(s.enabled, s.thresholdMinutes, ac.signal)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
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

  useEffect(() => {
    if (phase !== 'work') {
      stopFocusAmbient()
      return
    }
    void ensureAudioRunning().then(() => {
      startFocusAmbient(focusAmbientId)
    })
    return () => stopFocusAmbient()
  }, [phase, focusAmbientId])

  /** Submit elapsed work to Toggl (duration at least 1s). Used when finishing early, starting a break, or skipping from “break soon”. */
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

  const completeFocusAndGoToBeforeBreak = useCallback(
    (end: number, options?: { deferToggl?: boolean }) => {
      void (async () => {
        await ensureAudioRunning()
        playWorkCompleteSound()
      })()
      const deferToggl = options?.deferToggl ?? false
      if (!deferToggl) {
        const start = workStartRef.current ?? end - workSec * 1000
        void logSession(start, end)
        workStartRef.current = null
      }
      const next =
        (pomosUntilLong + 1) % 4 === 0 ? 'long_break' : 'short_break'
      setPendingBreak(next)
      setPomosUntilLong((n) => n + 1)
      setOvertimeSec(0)
      setPhase('before_break')
    },
    [logSession, pomosUntilLong, workSec],
  )

  useEffect(() => {
    if (phase === 'before_break') {
      void ensureAudioRunning()
      let intervalId: ReturnType<typeof setInterval> | undefined
      const timeoutId = window.setTimeout(() => {
        setOvertimeSec((o) => o + 1)
        playTickSound()
        intervalId = window.setInterval(() => {
          setOvertimeSec((o) => o + 1)
          playTickSound()
        }, 1000)
      }, FIRST_TICK_AFTER_CHIME_MS)
      return () => {
        window.clearTimeout(timeoutId)
        if (intervalId !== undefined) window.clearInterval(intervalId)
      }
    }
    if (phase === 'work') {
      const tick = () => {
        const start = workStartRef.current
        if (start === null) return
        setRemaining(secondsRemainingUntil(start + workSec * 1000))
      }
      tick()
      const id = window.setInterval(tick, 1000)
      return () => window.clearInterval(id)
    }
    if (phase === 'short_break' || phase === 'long_break') {
      const tick = () => {
        const endAt = breakEndAtRef.current
        if (endAt === null) return
        setRemaining(secondsRemainingUntil(endAt))
      }
      tick()
      const id = window.setInterval(tick, 1000)
      return () => window.clearInterval(id)
    }
  }, [phase, workSec])

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== 'visible') return
      if (phase === 'work') {
        const start = workStartRef.current
        if (start === null) return
        setRemaining(secondsRemainingUntil(start + workSec * 1000))
      } else if (phase === 'short_break' || phase === 'long_break') {
        const endAt = breakEndAtRef.current
        if (endAt === null) return
        setRemaining(secondsRemainingUntil(endAt))
      }
    }
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [phase, workSec])

  useEffect(() => {
    if (phase !== 'short_break' && phase !== 'long_break') return
    if (remaining > 0) return
    void ensureAudioRunning()
    let intervalId: ReturnType<typeof setInterval> | undefined
    const timeoutId = window.setTimeout(() => {
      setOvertimeSec((o) => o + 1)
      playTickSound()
      intervalId = window.setInterval(() => {
        setOvertimeSec((o) => o + 1)
        playTickSound()
      }, 1000)
    }, FIRST_TICK_AFTER_CHIME_MS)
    return () => {
      window.clearTimeout(timeoutId)
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
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
      completeFocusAndGoToBeforeBreak(Date.now(), { deferToggl: true })
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
    pomosUntilLong,
    completeFocusAndGoToBeforeBreak,
  ])

  function startFocus() {
    prepareWorkAudio()
    setSyncNote(null)
    breakEndAtRef.current = null
    workStartRef.current = Date.now()
    setPhase('work')
    setRemaining(workSec)
  }

  function startBreak() {
    if (phase !== 'before_break') return
    const focusStart = workStartRef.current
    if (focusStart !== null) {
      void logSession(focusStart, Date.now())
      workStartRef.current = null
    }
    setOvertimeSec(0)
    const next = pendingBreak
    const duration = next === 'long_break' ? longSec : shortSec
    breakEndAtRef.current = Date.now() + duration * 1000
    setPhase(next)
    setRemaining(duration)
  }

  function finishWorkEarly() {
    if (phase !== 'work') return
    completeFocusAndGoToBeforeBreak(Date.now())
  }

  /** Abandon focus without logging to Toggl. */
  function discardWorkSession() {
    if (phase !== 'work') return
    workStartRef.current = null
    setSyncNote(null)
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
    if (phase === 'before_break') {
      const focusStart = workStartRef.current
      if (focusStart !== null) {
        void logSession(focusStart, Date.now())
        workStartRef.current = null
      }
    }
    breakEndAtRef.current = null
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
    breakEndAtRef.current = null
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

  if (view === 'settings') {
    return (
      <div className="app">
        <SettingsPage
          focusAmbientId={focusAmbientId}
          onFocusAmbientChange={setFocusAmbientId}
          onBack={() => setView('main')}
        />
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

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Pomodoro × Toggl</h1>
          <p className="lede">
            Focus sessions become Toggl time entries on your workspace.
          </p>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => setView('settings')}
          >
            Settings
          </button>
          {token && (
            <button type="button" className="ghost" onClick={disconnect}>
              Sign out
            </button>
          )}
        </div>
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
              <ProjectCombobox
                key={workspaceId === '' ? '' : String(workspaceId)}
                projects={projectsForWs}
                projectId={projectId}
                setProjectId={setProjectId}
              />
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
                    ? 'Finish early logs this session to Toggl and moves to your break. Discard cancels with no entry.'
                    : phase === 'before_break'
                      ? 'Extra time is counting toward this focus block. Toggl logs when you start the break or skip it.'
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
              <>
                <button
                  type="button"
                  className="primary"
                  onClick={finishWorkEarly}
                >
                  Finish early
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={discardWorkSession}
                >
                  Discard
                </button>
              </>
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
