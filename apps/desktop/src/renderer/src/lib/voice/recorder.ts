import { muxOggOpus, type OpusPacket } from './oggOpus'

/**
 * Recording a 语音消息 in the renderer.
 *
 * Chromium cannot record OGG (`MediaRecorder` offers WebM/Opus or MP4/AAC), so the
 * clip is built the other way round: `AudioEncoder` (WebCodecs) turns the
 * microphone's PCM into raw Opus packets, and `./oggOpus.ts` writes the OGG
 * container. No dependency is added and nothing leaves the renderer until the
 * finished bytes are handed to `messages:sendVoice`.
 *
 * The capture graph is deliberately plain: an `AudioContext` fixed at 48 kHz (what
 * Opus wants) feeding a `ScriptProcessor`. The processor is deprecated, but it is
 * the one capture node that needs no module URL — an AudioWorklet would add a
 * second entry point to the bundle for one callback — and 48 kHz mono speech is
 * far below the rate where its main-thread cost matters.
 */

/** The client's cap for one voice note; the gesture stops itself here. */
export const VOICE_MAX_SECONDS = 60
const SAMPLE_RATE = 48_000
/** Telegram's own voice bitrate; ~4 KB per second, so a minute is ~240 KB. */
const BITRATE = 32_000
/** Opus frames are 20 ms at 48 kHz. */
const FRAME_SAMPLES = 960

export interface RecordedVoice {
  /** base64 of an OGG/Opus file. */
  audio: string
  /** Whole seconds, never 0 (a voice note's duration is at least a second). */
  duration: number
}

export interface VoiceRecording {
  /** Current input level 0..1, for the overlay's bars. */
  level(): number
  /** Ends the capture and answers the encoded clip. */
  stop(): Promise<RecordedVoice>
  /** Ends the capture and throws the audio away. */
  cancel(): void
}

/** Whether this renderer can record at all; the button is disabled otherwise. */
export function voiceRecordingSupported(): boolean {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

/** The microphone's refusals, in words the reader can act on. */
function microphoneError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new Error('没有麦克风权限，请在系统设置里允许 WeGram 使用麦克风')
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return new Error('没有找到可用的麦克风')
    }
    if (error.name === 'NotReadableError') {
      return new Error('麦克风正被其他程序占用')
    }
  }
  return error instanceof Error ? error : new Error(String(error))
}

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

export async function startVoiceRecording(): Promise<VoiceRecording> {
  const config: AudioEncoderConfig = {
    codec: 'opus',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: BITRATE,
  }
  if (
    typeof AudioEncoder === 'undefined' ||
    !(await AudioEncoder.isConfigSupported(config)).supported
  ) {
    throw new Error('这台设备不支持 Opus 录音')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch (error) {
    throw microphoneError(error)
  }

  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  // A suspended context (autoplay rules) would record silence; the gesture that
  // started the recording is what lets this resume.
  if (context.state === 'suspended') await context.resume()

  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.6
  source.connect(analyser)

  const processor = context.createScriptProcessor(4096, 1, 1)
  // A muted sink: the processor only runs while it reaches the destination, and
  // the microphone must not be played back into the speakers.
  const silent = context.createGain()
  silent.gain.value = 0
  source.connect(processor)
  processor.connect(silent)
  silent.connect(context.destination)

  const packets: OpusPacket[] = []
  let failure: Error | null = null
  let levelValue = 0
  let recordedSamples = 0
  let pending = new Float32Array(0)
  let state: 'recording' | 'stopped' = 'recording'

  const encoder = new AudioEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      // Chromium emits 20 ms frames; the duration field is the honest source when
      // it is there, and a frame is 960 samples by definition.
      const duration = chunk.duration ?? 0
      const samples =
        duration > 0 ? Math.round((duration * SAMPLE_RATE) / 1_000_000) : FRAME_SAMPLES
      packets.push({ data, samples })
    },
    error: (error) => {
      failure = error instanceof Error ? error : new Error(String(error))
    },
  })
  encoder.configure(config)

  /** Encodes one 20 ms frame; a short final one is zero-padded. */
  const encodeFrame = (samples: Float32Array): void => {
    const frame = new Float32Array(FRAME_SAMPLES)
    frame.set(samples.subarray(0, FRAME_SAMPLES))
    encoder.encode(
      new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: FRAME_SAMPLES,
        numberOfChannels: 1,
        timestamp: Math.round((recordedSamples * 1_000_000) / SAMPLE_RATE),
        data: frame,
      }),
    )
    recordedSamples += FRAME_SAMPLES
  }

  processor.onaudioprocess = (event) => {
    if (state !== 'recording') return
    const input = event.inputBuffer.getChannelData(0)
    let sum = 0
    for (const sample of input) sum += sample * sample
    levelValue = Math.min(1, Math.sqrt(sum / input.length) * 4)
    const merged = new Float32Array(pending.length + input.length)
    merged.set(pending)
    merged.set(input, pending.length)
    pending = merged
    while (pending.length >= FRAME_SAMPLES) {
      encodeFrame(pending)
      pending = pending.slice(FRAME_SAMPLES)
    }
  }

  const teardown = (): void => {
    state = 'stopped'
    processor.onaudioprocess = null
    processor.disconnect()
    analyser.disconnect()
    silent.disconnect()
    for (const track of stream.getTracks()) track.stop()
  }

  return {
    level: () => levelValue,
    async stop(): Promise<RecordedVoice> {
      if (state !== 'recording') throw new Error('录音已经结束')
      teardown()
      // The tail is shorter than a frame; pad it so the last word is not lost.
      if (pending.length > 0) encodeFrame(pending)
      await encoder.flush()
      encoder.close()
      await context.close()
      if (failure) throw failure
      if (packets.length === 0) throw new Error('没有录到声音')
      const audio = base64Of(muxOggOpus({ packets }))
      return { audio, duration: Math.max(1, Math.round(recordedSamples / SAMPLE_RATE)) }
    },
    cancel(): void {
      if (state !== 'recording') return
      teardown()
      encoder.close()
      void context.close()
    },
  }
}
