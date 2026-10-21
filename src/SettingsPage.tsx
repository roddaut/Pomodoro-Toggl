import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getLoginItemStatus,
  isNativeShell,
  setDeskReminderSettings,
  setLoginItemEnabled,
} from './lib/nativeBridge'
import {
  loadDeskReminderSettings,
  saveDeskReminderSettings,
  saveFocusAmbientId,
  type FocusAmbientId,
} from './lib/storage'

const FOCUS_AMBIENT_OPTIONS: { id: FocusAmbientId; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'ocean', label: 'Ocean waves' },
  { id: 'wind', label: 'Wind' },
  { id: 'rain', label: 'Rain' },
  { id: 'forest', label: 'Forest (soft)' },
]

type Props = {
  onBack: () => void
  focusAmbientId: FocusAmbientId
  onFocusAmbientChange: (id: FocusAmbientId) => void
}

export default function SettingsPage({
  onBack,
  focusAmbientId,
  onFocusAmbientChange,
}: Props) {
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [loginItemNeedsApproval, setLoginItemNeedsApproval] = useState(false)
  const [loginItemSupported, setLoginItemSupported] = useState(true)
  const [loginItemError, setLoginItemError] = useState<string | null>(null)
  const [loginItemBusy, setLoginItemBusy] = useState(false)

  const initialDeskReminder = useMemo(() => loadDeskReminderSettings(), [])
  const [deskReminderEnabled, setDeskReminderEnabled] = useState(
    initialDeskReminder.enabled,
  )
  const [deskReminderMinutes, setDeskReminderMinutes] = useState(
    initialDeskReminder.thresholdMinutes,
  )
  const [deskReminderMinutesDraft, setDeskReminderMinutesDraft] = useState(() =>
    String(initialDeskReminder.thresholdMinutes),
  )
  const [deskReminderError, setDeskReminderError] = useState<string | null>(null)
  const [deskReminderBusy, setDeskReminderBusy] = useState(false)
  const deskReminderMinutesDirtyRef = useRef(false)
  const deskReminderMinutesCommitTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)

  const applyDeskReminder = useCallback(
    async (enabled: boolean, thresholdMinutes: number) => {
      const clamped = Math.min(240, Math.max(1, Math.round(thresholdMinutes)))
      saveDeskReminderSettings({ enabled, thresholdMinutes: clamped })
      setDeskReminderEnabled(enabled)
      setDeskReminderMinutes(clamped)
      setDeskReminderMinutesDraft(String(clamped))
      deskReminderMinutesDirtyRef.current = false
      if (!isNativeShell()) return
      setDeskReminderBusy(true)
      setDeskReminderError(null)
      try {
        const d = await setDeskReminderSettings(enabled, clamped)
        if (d.error) setDeskReminderError(d.error)
        setDeskReminderEnabled(d.enabled)
        setDeskReminderMinutes(d.thresholdMinutes)
        if (!deskReminderMinutesDirtyRef.current) {
          setDeskReminderMinutesDraft(String(d.thresholdMinutes))
        }
      } catch (e) {
        setDeskReminderError(
          e instanceof Error ? e.message : 'Could not update desk reminder',
        )
      } finally {
        setDeskReminderBusy(false)
      }
    },
    [],
  )

  useEffect(() => {
    return () => {
      if (deskReminderMinutesCommitTimerRef.current) {
        clearTimeout(deskReminderMinutesCommitTimerRef.current)
        deskReminderMinutesCommitTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isNativeShell()) return
    const ac = new AbortController()
    void (async () => {
      try {
        const d = await getLoginItemStatus(ac.signal)
        setOpenAtLogin(d.enabled)
        setLoginItemNeedsApproval(Boolean(d.requiresApproval))
        setLoginItemSupported(d.supported !== false)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    if (!isNativeShell()) return
    const ac = new AbortController()
    const s = loadDeskReminderSettings()
    void (async () => {
      try {
        const d = await setDeskReminderSettings(
          s.enabled,
          s.thresholdMinutes,
          ac.signal,
        )
        if (d.error) setDeskReminderError(d.error)
        setDeskReminderEnabled(d.enabled)
        setDeskReminderMinutes(d.thresholdMinutes)
        if (!deskReminderMinutesDirtyRef.current) {
          setDeskReminderMinutesDraft(String(d.thresholdMinutes))
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    })()
    return () => ac.abort()
  }, [])

  return (
    <>
      <header className="top">
        <div className="settings-top">
          <button type="button" className="ghost" onClick={onBack}>
            ← Back
          </button>
          <h1>Settings</h1>
          <p className="lede">Sound and Mac app options.</p>
        </div>
      </header>

      <section className="card settings-sound" aria-labelledby="sound-heading">
        <h3 id="sound-heading">Focus ambience</h3>
        <p className="mac-login-hint">
          Gentle background while the focus timer runs. Off by default.
        </p>
        <label className="settings-sound-label" htmlFor="focus-ambient-select">
          Sound during focus
        </label>
        <select
          id="focus-ambient-select"
          className="settings-sound-select"
          value={focusAmbientId}
          onChange={(e) => {
            const id = e.target.value as FocusAmbientId
            saveFocusAmbientId(id)
            onFocusAmbientChange(id)
          }}
        >
          {FOCUS_AMBIENT_OPTIONS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </section>

      {isNativeShell() && (
      <section className="card mac-login" aria-labelledby="mac-login-heading">
        <h3 id="mac-login-heading">Mac app</h3>
        <div className="mac-login-row">
          <input
            id="pomodoro-open-at-login"
            type="checkbox"
            className="mac-login-checkbox"
            checked={openAtLogin}
            disabled={loginItemBusy || !loginItemSupported}
            onChange={async (e) => {
              const next = e.target.checked
              setLoginItemBusy(true)
              setLoginItemError(null)
              try {
                const d = await setLoginItemEnabled(next)
                if (d.error) setLoginItemError(d.error)
                setOpenAtLogin(d.enabled)
                setLoginItemNeedsApproval(Boolean(d.requiresApproval))
                setLoginItemSupported(d.supported !== false)
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
        {!loginItemSupported && (
          <p className="mac-login-hint">
            Open at login requires running <strong>PomodoroToggl.app</strong> (for
            example <code className="mac-login-code">npm run macos:run</code> or{' '}
            <code className="mac-login-code">npm run macos:open</code>). It does
            not work when you launch the Swift build binary directly.
          </p>
        )}
        {loginItemSupported && loginItemNeedsApproval && (
          <p className="mac-login-hint">
            Approve &ldquo;Pomodoro × Toggl&rdquo; in System Settings → General →
            Login Items &amp; Extensions (or Open at Login).
          </p>
        )}
        {loginItemError && (
          <p className="error mac-login-error">{loginItemError}</p>
        )}

        <div className="mac-login-divider" aria-hidden="true" />

        <div className="mac-login-row">
          <input
            id="pomodoro-desk-reminder-enabled"
            type="checkbox"
            className="mac-login-checkbox"
            checked={deskReminderEnabled}
            disabled={deskReminderBusy}
            onChange={(e) => {
              if (deskReminderMinutesCommitTimerRef.current) {
                clearTimeout(deskReminderMinutesCommitTimerRef.current)
                deskReminderMinutesCommitTimerRef.current = null
              }
              const raw = parseInt(deskReminderMinutesDraft, 10)
              const mins = Number.isNaN(raw) ? deskReminderMinutes : raw
              void applyDeskReminder(e.target.checked, mins)
            }}
          />
          <label
            className="mac-login-row-label"
            htmlFor="pomodoro-desk-reminder-enabled"
          >
            Remind me to start focus if the timer isn&apos;t running
          </label>
        </div>
        <div className="mac-login-desk-row">
          <label className="mac-login-desk-label" htmlFor="pomodoro-desk-reminder-min">
            After
          </label>
          <input
            id="pomodoro-desk-reminder-min"
            type="number"
            min={1}
            max={240}
            className="mac-login-desk-input"
            value={deskReminderMinutesDraft}
            onChange={(e) => {
              const v = e.target.value
              deskReminderMinutesDirtyRef.current = true
              setDeskReminderMinutesDraft(v)
              if (deskReminderMinutesCommitTimerRef.current) {
                clearTimeout(deskReminderMinutesCommitTimerRef.current)
                deskReminderMinutesCommitTimerRef.current = null
              }
              const n = parseInt(v, 10)
              if (Number.isNaN(n)) return
              deskReminderMinutesCommitTimerRef.current = setTimeout(() => {
                deskReminderMinutesCommitTimerRef.current = null
                void applyDeskReminder(deskReminderEnabled, n)
              }, 350)
            }}
            onBlur={(e) => {
              const el = e.currentTarget
              const valueAtBlur = el.value
              if (deskReminderMinutesCommitTimerRef.current) {
                clearTimeout(deskReminderMinutesCommitTimerRef.current)
                deskReminderMinutesCommitTimerRef.current = null
              }
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  if (document.activeElement === el) return
                  const n = parseInt(valueAtBlur, 10)
                  if (Number.isNaN(n)) {
                    deskReminderMinutesDirtyRef.current = false
                    setDeskReminderMinutesDraft(String(deskReminderMinutes))
                    return
                  }
                  void applyDeskReminder(deskReminderEnabled, n)
                })
              })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <span className="mac-login-desk-suffix">
            min. at desk (keyboard &amp; mouse)
          </span>
        </div>
        <p className="mac-login-hint">
          Only while you&apos;re connected to Toggl and the timer is idle. Uses
          recent input to notice when you&apos;re at the computer; long idle periods
          reset the count.
        </p>
        {deskReminderError && (
          <p className="error mac-login-error">{deskReminderError}</p>
        )}
      </section>
      )}
    </>
  )
}
