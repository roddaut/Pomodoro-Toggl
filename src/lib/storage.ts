export const FOCUS_AMBIENT_IDS = [
  'off',
  'ocean',
  'wind',
  'rain',
  'forest',
] as const
export type FocusAmbientId = (typeof FOCUS_AMBIENT_IDS)[number]

const FOCUS_AMBIENT_KEY = 'pomodoro-toggl:focus_ambient'

const TOKEN_KEY = 'pomodoro-toggl:api_token'
const DESK_REMINDER_ENABLED_KEY = 'pomodoro-toggl:desk_reminder_enabled'
const DESK_REMINDER_MINUTES_KEY = 'pomodoro-toggl:desk_reminder_minutes'

export type DeskReminderSettings = {
  enabled: boolean
  thresholdMinutes: number
}

const DEFAULT_DESK_REMINDER: DeskReminderSettings = {
  enabled: true,
  thresholdMinutes: 10,
}

export function loadDeskReminderSettings(): DeskReminderSettings {
  try {
    const en = localStorage.getItem(DESK_REMINDER_ENABLED_KEY)
    const min = localStorage.getItem(DESK_REMINDER_MINUTES_KEY)
    const enabled = en === null ? DEFAULT_DESK_REMINDER.enabled : en === '1'
    let thresholdMinutes = DEFAULT_DESK_REMINDER.thresholdMinutes
    if (min !== null) {
      const n = Number.parseInt(min, 10)
      if (!Number.isNaN(n)) {
        thresholdMinutes = Math.min(240, Math.max(1, n))
      }
    }
    return { enabled, thresholdMinutes }
  } catch {
    return { ...DEFAULT_DESK_REMINDER }
  }
}

export function saveDeskReminderSettings(s: DeskReminderSettings) {
  const thresholdMinutes = Math.min(240, Math.max(1, Math.round(s.thresholdMinutes)))
  try {
    localStorage.setItem(DESK_REMINDER_ENABLED_KEY, s.enabled ? '1' : '0')
    localStorage.setItem(DESK_REMINDER_MINUTES_KEY, String(thresholdMinutes))
  } catch {
    // ignore
  }
}

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function loadFocusAmbientId(): FocusAmbientId {
  try {
    const v = localStorage.getItem(FOCUS_AMBIENT_KEY)
    if (v && (FOCUS_AMBIENT_IDS as readonly string[]).includes(v)) {
      return v as FocusAmbientId
    }
  } catch {
    /* ignore */
  }
  return 'off'
}

export function saveFocusAmbientId(id: FocusAmbientId) {
  try {
    localStorage.setItem(FOCUS_AMBIENT_KEY, id)
  } catch {
    /* ignore */
  }
}
