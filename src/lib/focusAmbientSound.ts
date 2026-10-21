/**
 * Gentle looped ambience during focus. Uses the shared AudioContext from
 * workCompleteSound — call prepareWorkAudio() from Start focus first.
 */

import type { FocusAmbientId } from './storage'
import { ensureAudioRunning, getSharedAudioContext } from './workCompleteSound'

let stopActive: (() => void) | null = null
/** Invalidates async `ensureAudioRunning` callbacks after `stopFocusAmbient` or a new start. */
let generation = 0

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

function makeWhiteNoiseBuffer(c: AudioContext, durationSec: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * durationSec)
  const buffer = c.createBuffer(1, len, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1
  }
  let peak = 0
  for (let i = 0; i < len; i++) {
    peak = Math.max(peak, Math.abs(data[i]))
  }
  if (peak > 0) {
    const scale = 0.35 / peak
    for (let i = 0; i < len; i++) data[i] *= scale
  }
  return buffer
}

function startOcean(c: AudioContext): () => void {
  const buffer = makeBrownNoiseBuffer(c, 8)
  const source = c.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 520
  filter.Q.value = 0.7

  const master = c.createGain()
  master.gain.value = 0.078

  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.1
  const lfoGain = c.createGain()
  lfoGain.gain.value = 0.032

  source.connect(filter)
  filter.connect(master)
  master.connect(c.destination)

  lfo.connect(lfoGain)
  lfoGain.connect(master.gain)

  const now = c.currentTime
  source.start(now)
  lfo.start(now)

  return () => {
    const t = getSharedAudioContext()?.currentTime ?? 0
    try {
      source.stop(t)
    } catch {
      /* already stopped */
    }
    try {
      lfo.stop(t)
    } catch {
      /* already stopped */
    }
    source.disconnect()
    filter.disconnect()
    master.disconnect()
    lfo.disconnect()
    lfoGain.disconnect()
  }
}

function startWind(c: AudioContext): () => void {
  const buffer = makeBrownNoiseBuffer(c, 8)
  const source = c.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 380
  filter.Q.value = 0.45

  const master = c.createGain()
  master.gain.value = 0.072

  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.045
  const lfoGain = c.createGain()
  lfoGain.gain.value = 140

  source.connect(filter)
  filter.connect(master)
  master.connect(c.destination)

  lfo.connect(lfoGain)
  lfoGain.connect(filter.frequency)

  const now = c.currentTime
  source.start(now)
  lfo.start(now)

  return () => {
    const t = getSharedAudioContext()?.currentTime ?? 0
    try {
      source.stop(t)
    } catch {
      /* already stopped */
    }
    try {
      lfo.stop(t)
    } catch {
      /* already stopped */
    }
    source.disconnect()
    filter.disconnect()
    master.disconnect()
    lfo.disconnect()
    lfoGain.disconnect()
  }
}

function startRain(c: AudioContext): () => void {
  const buffer = makeWhiteNoiseBuffer(c, 6)
  const source = c.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1800
  hp.Q.value = 0.7

  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 7200
  lp.Q.value = 0.5

  const master = c.createGain()
  master.gain.value = 0.038

  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.22
  const lfoGain = c.createGain()
  lfoGain.gain.value = 0.014

  source.connect(hp)
  hp.connect(lp)
  lp.connect(master)
  master.connect(c.destination)

  lfo.connect(lfoGain)
  lfoGain.connect(master.gain)

  const now = c.currentTime
  source.start(now)
  lfo.start(now)

  return () => {
    const t = getSharedAudioContext()?.currentTime ?? 0
    try {
      source.stop(t)
    } catch {
      /* already stopped */
    }
    try {
      lfo.stop(t)
    } catch {
      /* already stopped */
    }
    source.disconnect()
    hp.disconnect()
    lp.disconnect()
    master.disconnect()
    lfo.disconnect()
    lfoGain.disconnect()
  }
}

function startForest(c: AudioContext): () => void {
  const buffer = makeBrownNoiseBuffer(c, 8)
  const source = c.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 420
  filter.Q.value = 0.65

  const master = c.createGain()
  master.gain.value = 0.062

  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 0.028
  const lfoGain = c.createGain()
  lfoGain.gain.value = 0.018

  source.connect(filter)
  filter.connect(master)
  master.connect(c.destination)

  lfo.connect(lfoGain)
  lfoGain.connect(master.gain)

  const now = c.currentTime
  source.start(now)
  lfo.start(now)

  return () => {
    const t = getSharedAudioContext()?.currentTime ?? 0
    try {
      source.stop(t)
    } catch {
      /* already stopped */
    }
    try {
      lfo.stop(t)
    } catch {
      /* already stopped */
    }
    source.disconnect()
    filter.disconnect()
    master.disconnect()
    lfo.disconnect()
    lfoGain.disconnect()
  }
}

export function stopFocusAmbient(): void {
  generation++
  if (!stopActive) return
  try {
    stopActive()
  } catch {
    /* ignore */
  }
  stopActive = null
}

export function startFocusAmbient(kind: FocusAmbientId): void {
  stopFocusAmbient()
  if (kind === 'off') return

  const token = generation
  void ensureAudioRunning().then((c) => {
    if (!c || token !== generation) return
    try {
      switch (kind) {
        case 'ocean':
          stopActive = startOcean(c)
          break
        case 'wind':
          stopActive = startWind(c)
          break
        case 'rain':
          stopActive = startRain(c)
          break
        case 'forest':
          stopActive = startForest(c)
          break
        default:
          break
      }
    } catch {
      stopActive = null
    }
  })
}
