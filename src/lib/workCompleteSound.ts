/**
 * Wind-chime style completion when a work period ends.
 * Call `prepareWorkAudio()` from a user gesture (e.g. starting focus) so the
 * AudioContext stays usable when the timer fires minutes later.
 */

let ctx: AudioContext | null = null

/** Shared context for work chime and break ambience (unlocked via prepareWorkAudio). */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) ctx = new AudioContext()
  return ctx
}

/**
 * Ensures the shared AudioContext is running. Always await before scheduling
 * nodes — `resume()` is async; scheduling while still suspended can be silent.
 */
export async function ensureAudioRunning(): Promise<AudioContext | null> {
  try {
    const c = getSharedAudioContext()
    if (!c) return null
    if (c.state === 'suspended') await c.resume()
    return c.state === 'closed' ? null : c
  } catch {
    return null
  }
}

export function prepareWorkAudio(): void {
  void ensureAudioRunning()
}

/** Fire-and-forget resume; use from focus, visibility, overtime entry, or pointer. */
export function wakeSharedAudio(): void {
  void ensureAudioRunning()
}

/** C major pentatonic ascending — reads as a clear “chime” cascade. */
const CHIME_FREQS_HZ = [523.25, 587.33, 659.25, 783.99, 880.0]

function bellStrike(
  c: AudioContext,
  fundamentalHz: number,
  t0: number,
  master: GainNode,
): void {
  const partials: { ratio: number; level: number }[] = [
    { ratio: 1, level: 0.42 },
    { ratio: 2, level: 0.2 },
    { ratio: 3, level: 0.08 },
  ]
  for (const { ratio, level } of partials) {
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(fundamentalHz * ratio, t0)
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(level, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55)
    o.connect(g)
    g.connect(master)
    o.start(t0)
    o.stop(t0 + 0.58)
  }
}

export function playWorkCompleteSound(): void {
  void ensureAudioRunning().then((c) => {
    if (!c) return
    try {
      const now = c.currentTime
      const master = c.createGain()
      master.gain.setValueAtTime(0.1, now)
      master.gain.setValueAtTime(0.1, now + 0.65)
      master.gain.exponentialRampToValueAtTime(0.001, now + 1.05)
      master.connect(c.destination)

      const gap = 0.11
      CHIME_FREQS_HZ.forEach((hz, i) => {
        bellStrike(c, hz, now + i * gap, master)
      })
    } catch {
      /* ignore */
    }
  })
}
