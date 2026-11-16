import { useCallback, useEffect, useRef, useState } from 'react'

interface Result {
  label: string
  value: string
  pass?: boolean
}

/**
 * Dev-only acceptance panel for design doc §8.2.
 *
 * It turns the four "must not jump / must stay fluent" rules into numbers:
 * average FPS while scrolling 5000 messages, and how far the viewport moves
 * when a page of older messages is prepended. Enabled with `?perf=1`.
 */
export function PerfPanel() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [renderedRows, setRenderedRows] = useState(0)
  const frameRef = useRef(0)

  const measureRows = useCallback(() => {
    setRenderedRows(document.querySelectorAll('.wx-message-slot').length)
  }, [])

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(measureRows, 500)
    measureRows()
    return () => window.clearInterval(timer)
  }, [open, measureRows])

  if (!import.meta.env.DEV) return null

  const scroller = (): HTMLDivElement | null =>
    document.querySelector<HTMLDivElement>('[data-testid="message-scroller"]')

  const runScrollTest = async (): Promise<void> => {
    const el = scroller()
    if (!el) {
      setResults([{ label: '滚动测试', value: '找不到消息滚动容器', pass: false }])
      return
    }
    setBusy(true)
    setResults([{ label: '滚动测试', value: '进行中…' }])

    el.scrollTop = el.scrollHeight
    await nextFrame()

    const durations: number[] = []
    const start = performance.now()
    let last = start
    let direction = -1
    let frames = 0

    await new Promise<void>((resolve) => {
      const step = (time: number): void => {
        durations.push(time - last)
        last = time
        frames += 1
        el.scrollTop += direction * 14
        if (el.scrollTop <= 0) direction = 1
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) direction = -1
        if (time - start < 2000) frameRef.current = requestAnimationFrame(step)
        else resolve()
      }
      frameRef.current = requestAnimationFrame(step)
    })

    const elapsed = performance.now() - start
    const fps = (frames / elapsed) * 1000
    const sorted = [...durations].sort((a, b) => a - b)
    const worst = Math.round(sorted[sorted.length - 1] ?? 0)
    const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0)

    setResults([
      { label: '平均帧率', value: `${fps.toFixed(1)} fps`, pass: fps >= 50 },
      { label: '最差单帧', value: `${worst} ms`, pass: worst < 50 },
      { label: 'P95 单帧', value: `${p95} ms`, pass: p95 < 34 },
      { label: '采样帧数', value: String(frames) },
    ])
    measureRows()
    setBusy(false)
  }

  const runAnchorTest = async (): Promise<void> => {
    const el = scroller()
    if (!el) {
      setResults([{ label: '锚定测试', value: '找不到消息滚动容器', pass: false }])
      return
    }
    setBusy(true)
    setResults([{ label: '锚定测试', value: '进行中…' }])

    // The threshold in MessageList is scrollTop < 160. Park above it, cross it,
    // then let the list report how far its self-chosen anchor row moved.
    el.scrollTop = 500
    await nextFrame()
    await nextFrame()

    const heightBefore = el.scrollHeight
    const loadedBefore = loadedCount()
    delete el.dataset['anchorId']
    delete el.dataset['anchorDelta']
    delete el.dataset['anchorVisible']

    el.scrollTop = 100
    await sleep(2500)

    const loadedAfter = loadedCount()
    const grew = el.scrollHeight > heightBefore + 100
    const anchorId = el.dataset['anchorId'] ?? ''
    const anchorDelta = Number(el.dataset['anchorDelta'] ?? 'NaN')
    const anchorVisible = el.dataset['anchorVisible'] === '1'

    if (!grew) {
      setResults([
        { label: '翻页', value: '未触发（已到底）' },
        { label: '提示', value: '先打开有更多历史的会话', pass: false },
      ])
      setBusy(false)
      return
    }

    if (!anchorId) {
      setResults([
        { label: '翻页', value: `已加载 ${loadedBefore} → ${loadedAfter}` },
        { label: '锚点', value: '列表没有报告锚点行', pass: false },
      ])
      setBusy(false)
      return
    }

    setResults([
      { label: '翻页', value: `已加载 ${loadedBefore} → ${loadedAfter}` },
      { label: '锚点消息', value: anchorId, pass: anchorVisible },
      { label: '翻页后位移', value: `${anchorDelta} px`, pass: Math.abs(anchorDelta) <= 2 },
    ])
    measureRows()
    setBusy(false)
  }

  function loadedCount(): number {
    const text = document.querySelector('.wx-chat__header-actions .wx-hint')?.textContent ?? ''
    return Number(text.replace(/[^\d]/g, '') || 0)
  }

  return (
    <div className="wx-perf">
      <button className="wx-perf__toggle" onClick={() => setOpen((value) => !value)}>
        {open ? '收起验收' : 'W2 验收'}
      </button>
      {open ? (
        <div className="wx-perf__panel">
          <div className="wx-perf__row">
            <span>虚拟化渲染行数</span>
            <strong>{renderedRows}</strong>
          </div>
          <div className="wx-perf__actions">
            <button className="wx-button" disabled={busy} onClick={() => void runScrollTest()}>
              滚动测试
            </button>
            <button className="wx-button wx-button--ghost" disabled={busy} onClick={() => void runAnchorTest()}>
              锚定测试
            </button>
          </div>
          <div className="wx-perf__results">
            {results.map((result) => (
              <div key={result.label} className="wx-perf__row">
                <span>{result.label}</span>
                <strong className={result.pass === false ? 'wx-perf__fail' : result.pass ? 'wx-perf__pass' : ''}>
                  {result.value}
                </strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
