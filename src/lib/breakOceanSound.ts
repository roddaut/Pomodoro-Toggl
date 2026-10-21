/**
 * Looped brown-noise surf ambience during breaks. Uses the same AudioContext as
 * the work chime — call `prepareWorkAudio()` from a user gesture before the break
 * (e.g. Start focus) so playback is allowed when the break starts automatically.
 */

import { ensureAudioRunning, getSharedAudioContext } from './workCompleteSound'

type OceanNodes = {
  source: AudioBufferSourceNode
  filter: BiquadFilterNode
  master: GainNode
  lfo: OscillatorNode
  lfoGain: GainNode
}

let ocean: OceanNodes | null = null

function makeBrownNoiseBuffer(c: AudioContext, durationSec: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * durationSec)
  const buffer = c.createBuffer(1, len, c.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) * 0.98
    data[i] = last
  }
  let peak = 0
  for (let i = 0; i < len; i++) {
    peak = Math.max(peak, Math.abs(data[i]))
  }
  if (peak > 0) {
    const scale = 0.45 / peak
    for (let i = 0; i < len; i++) data[i] *= scale
  }
  return buffer
}

/** Start looping ocean / surf ambience. Safe to call when already playing (no-op). */
export function startBreakOceanSound(): void {
  void ensureAudioRunning().then((c) => {
    if (!c || ocean) return
    try {
      const buffer = makeBrownNoiseBuffer(c, 8)
      const source = c.createBufferSource()
      source.buffer = buffer
      source.loop = true

      const filter = c.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 520
      filter.Q.value = 0.7

      const master = c.createGain()
      master.gain.value = 0.11

      const lfo = c.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = 0.11
      const lfoGain = c.createGain()
      lfoGain.gain.value = 0.045

      source.connect(filter)
      filter.connect(master)
      master.connect(c.destination)

      lfo.connect(lfoGain)
      lfoGain.connect(master.gain)

      const now = c.currentTime
      source.start(now)
      lfo.start(now)

      ocean = { source, filter, master, lfo, lfoGain }
    } catch {
      /* ignore */
    }
  })
}

/** Stop ambience and release nodes. */
export function stopBreakOceanSound(): void {
  if (!ocean) return
  try {
    const c = getSharedAudioContext()
    const { source, lfo } = ocean
    const now = c?.currentTime ?? 0
    try {
      source.stop(now)
    } catch {
      /* already stopped */
    }
    try {
      lfo.stop(now)
    } catch {
      /* already stopped */
    }
    source.disconnect()
    ocean.filter.disconnect()
    ocean.master.disconnect()
    lfo.disconnect()
    ocean.lfoGain.disconnect()
  } catch {
    /* ignore */
  }
  ocean = null
}
