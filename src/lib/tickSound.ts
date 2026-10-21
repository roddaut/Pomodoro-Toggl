/**
 * Mechanical clock–style tick (escapement click + short resonant decay).
 * Call once per second during overtime. Uses ensureAudioRunning() so playback
 * works after long sessions or when the AudioContext was suspended.
 */

import { ensureAudioRunning } from './workCompleteSound'

function makeNoiseBuffer(c: AudioContext, durationSec: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * durationSec)
  const buffer = c.createBuffer(1, len, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1
  }
  return buffer
}

export function playTickSound(): void {
  void ensureAudioRunning().then((c) => {
    if (!c) return
    try {
      const t0 = c.currentTime

      // --- Transient: band-limited noise = mechanical scrape / pallet click ---
      const noiseBuf = makeNoiseBuffer(c, 0.04)
      const noiseSrc = c.createBufferSource()
      noiseSrc.buffer = noiseBuf

      const noiseBp = c.createBiquadFilter()
      noiseBp.type = 'bandpass'
      noiseBp.frequency.setValueAtTime(3200, t0)
      noiseBp.Q.value = 1.2

      const noiseGain = c.createGain()
      noiseGain.gain.setValueAtTime(0.11, t0)
      noiseGain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.022)

      noiseSrc.connect(noiseBp)
      noiseBp.connect(noiseGain)

      // --- Body: fast pitch-drop (gear / spring resonance) ---
      const tone = c.createOscillator()
      tone.type = 'triangle'
      tone.frequency.setValueAtTime(2100, t0)
      tone.frequency.exponentialRampToValueAtTime(380, t0 + 0.038)

      const toneGain = c.createGain()
      toneGain.gain.setValueAtTime(0.055, t0)
      toneGain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.055)

      tone.connect(toneGain)

      // --- Subtle weight (pendulum / case) ---
      const thud = c.createOscillator()
      thud.type = 'sine'
      thud.frequency.setValueAtTime(95, t0)

      const thudGain = c.createGain()
      thudGain.gain.setValueAtTime(0.028, t0)
      thudGain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.045)

      thud.connect(thudGain)

      const master = c.createGain()
      master.gain.value = 0.85
      master.connect(c.destination)

      noiseGain.connect(master)
      toneGain.connect(master)
      thudGain.connect(master)

      noiseSrc.start(t0)
      noiseSrc.stop(t0 + 0.04)
      tone.start(t0)
      tone.stop(t0 + 0.06)
      thud.start(t0)
      thud.stop(t0 + 0.05)
    } catch {
      /* ignore */
    }
  })
}
