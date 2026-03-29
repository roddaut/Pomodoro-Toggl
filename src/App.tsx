import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  createTimeEntry,
  fetchMe,
  type TogglMe,
} from './lib/toggl'
import { postNativePhase } from './lib/nativeBridge'
import { clearToken, loadToken, saveToken } from './lib/storage'
import {
  startBreakOceanSound,
  stopBreakOceanSound,
} from './lib/breakOceanSound'
import {
  playWorkCompleteSound,
  prepareWorkAudio,
} from './lib/workCompleteSound'

type Phase = 'idle' | 'work' | 'short_break' | 'long_break'

const DEFAULT_WORK = 25 * 60
const DEFAULT_SHORT = 5 * 60
const DEFAULT_LONG = 15 * 60

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function toIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
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
    if (phase === 'short_break' || phase === 'long_break') {
      startBreakOceanSound()
    } else {
      stopBreakOceanSound()
    }
    return () => stopBreakOceanSound()
  }, [phase])

  const logSession = useCallback(
    async (startedAt: number, endedAt: number) => {
      if (!token || workspaceId === '') {
        setSyncNote('Skipped: connect Toggl and pick a workspace.')
        return
      }
      const duration = Math.max(1, Math.round((endedAt - startedAt) / 1000))
      const start = new Date(startedAt)
      const stop = new Date(endedAt)
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
    if (phase !== 'work' && phase !== 'short_break' && phase !== 'long_break')
      return
    const id = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) return 0
        return r - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase])

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
      setPomosUntilLong((n) => n + 1)
      setPhase(next)
      setRemaining(next === 'long_break' ? longSec : shortSec)
      workStartRef.current = null
      return
    }
    if (phase === 'short_break' || phase === 'long_break') {
      setPhase('idle')
      setRemaining(workSec)
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
    if (phase !== 'short_break' && phase !== 'long_break') return
    setPhase('idle')
    setRemaining(workSec)
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
    setSyncNote(null)
  }

  const phaseLabel =
    phase === 'work'
      ? 'Focus'
      : phase === 'short_break'
        ? 'Short break'
        : phase === 'long_break'
          ? 'Long break'
          : 'Ready'

  const dialProgress =
    phase === 'idle'
      ? 0
      : phase === 'work'
        ? workSec > 0
          ? 1 - remaining / workSec
          : 0
        : phase === 'short_break'
          ? shortSec > 0
            ? 1 - remaining / shortSec
            : 0
          : longSec > 0
            ? 1 - remaining / longSec
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
                {formatClock(remaining)}
              </p>
              <p className="meta">
                {phase === 'idle'
                  ? `${Math.round(workSec / 60)} min focus · After this focus: ${(pomosUntilLong + 1) % 4 === 0 ? 'long' : 'short'} break`
                  : phase === 'work'
                    ? 'Stay on task until the bell.'
                    : 'Breathe. Next round is waiting.'}
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
            {(phase === 'short_break' || phase === 'long_break') && (
              <button type="button" className="secondary" onClick={skipBreak}>
                Skip break
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
