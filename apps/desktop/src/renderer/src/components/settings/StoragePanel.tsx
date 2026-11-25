import type { CacheLimit, StorageMediaKind, StorageState } from '@wegram/protocol'
import { useEffect, useState } from 'react'

import { errorMessage, invoke } from '@renderer/lib/ipc'
import { cacheShare, formatStorageSize, sumBucketSizes } from '@renderer/lib/storage'

import { SettingsGroup } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { SettingsSelect } from './SettingsSelect'

const LIMIT_OPTIONS: readonly { value: CacheLimit; label: string }[] = [
  { value: 'unlimited', label: '不限制' },
  { value: '512mb', label: '512 MB' },
  { value: '1gb', label: '1 GB' },
  { value: '2gb', label: '2 GB' },
  { value: '5gb', label: '5 GB' },
]

/** The official client's row names, in the protocol's fixed order. */
const KIND_LABELS: Record<StorageMediaKind, string> = {
  photo: '图片',
  video: '视频',
  sticker: '贴纸和表情符号',
  animation: 'GIF',
  other: '其他媒体',
}

/** The cache-size writer the rows, the summary and the button all share. */
const size = formatStorageSize

/**
 * 数据与存储 (design doc §9.11.3): TDLib's cache, the ceiling 缓存上限 puts on it,
 * and 清理缓存 with the official dialog's per-type ticks.
 *
 * Two owners, like 消息通知: the usage belongs to TDLib and is read every time the
 * group opens, while 缓存上限 is this machine's own preference in `ui.db`. Every
 * write answers the state after it ran — including a fresh per-type read — so the
 * panel never paints a size it has not been handed, and no control is drawn before
 * the first read lands.
 */
export function StoragePanel() {
  const [state, setState] = useState<StorageState | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<StorageMediaKind>>(new Set())
  const [busy, setBusy] = useState<'limit' | 'clear' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void invoke('storage:get')
      .then((next) => {
        if (cancelled) return
        setState(next)
        // Everything clearable starts ticked, like the client's dialog.
        setSelected(new Set(next.usage.buckets.map((bucket) => bucket.kind)))
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeLimit = async (limit: CacheLimit): Promise<void> => {
    setBusy('limit')
    setNotice(null)
    setError(null)
    try {
      const next = await invoke('storage:setLimit', { limit })
      setState(next)
      // A trim may empty a kind: keep the ticks that still have something to clear.
      setSelected((current) => {
        const available = new Set(next.usage.buckets.map((bucket) => bucket.kind))
        return new Set([...current].filter((kind) => available.has(kind)))
      })
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (kind: StorageMediaKind): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const clear = async (): Promise<void> => {
    if (!state) return
    const kinds = state.usage.buckets
      .filter((bucket) => selected.has(bucket.kind))
      .map((bucket) => bucket.kind)
    if (kinds.length === 0) return
    setBusy('clear')
    setNotice(null)
    setError(null)
    try {
      const result = await invoke('storage:clear', { kinds })
      setState(result.state)
      // Whatever is left starts ticked again, so a second click can clear the rest.
      setSelected(new Set(result.state.usage.buckets.map((bucket) => bucket.kind)))
      setNotice(result.freedBytes > 0 ? `已清理 ${size(result.freedBytes)}` : '没有可清理的缓存')
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(null)
    }
  }

  if (!state) {
    return (
      <>
        <p className="wx-set-muted">正在读取存储空间…</p>
        {error ? <div className="wx-set-error">{error}</div> : null}
      </>
    )
  }

  const { mediaSize, mediaCount, databaseSize, buckets } = state.usage
  const chosenSize = sumBucketSizes(buckets.filter((bucket) => selected.has(bucket.kind)))

  return (
    <>
      <SettingsGroup title="存储空间">
        <SettingsRow
          label="已用空间"
          description={`媒体 ${size(mediaSize)} · ${mediaCount} 个文件 · 数据库 ${size(databaseSize)}`}
        >
          <span className="wx-set-value">{size(mediaSize + databaseSize)}</span>
        </SettingsRow>
        <SettingsRow label="缓存上限" description="超过后清理最久未使用的媒体缓存">
          {/* A control is never painted with a value the panel has not read, and
              while the trim runs the old ceiling would be a lie. */}
          {busy === 'limit' ? (
            <span className="wx-set-muted">处理中…</span>
          ) : (
            <SettingsSelect
              label="缓存上限"
              value={state.limit}
              options={LIMIT_OPTIONS}
              disabled={busy !== null}
              onChange={(next) => void changeLimit(next)}
            />
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="清理缓存">
        {buckets.length === 0 ? (
          <p className="wx-set-muted">没有可清理的媒体缓存</p>
        ) : (
          <>
            {buckets.map((bucket) => {
              const checked = selected.has(bucket.kind)
              const share = cacheShare(bucket.size, mediaSize)
              return (
                <button
                  key={bucket.kind}
                  type="button"
                  className="wx-set-media"
                  aria-pressed={checked}
                  disabled={busy !== null}
                  onClick={() => toggle(bucket.kind)}
                >
                  <span
                    className={`wx-set-check${checked ? '' : ' wx-set-check--empty'}`}
                    aria-hidden="true"
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span className="wx-set-media__label">{KIND_LABELS[bucket.kind]}</span>
                  {share > 0 ? <span className="wx-set-media__percent">{share}%</span> : null}
                  <span className="wx-set-media__size">{size(bucket.size)}</span>
                </button>
              )
            })}
            <button
              type="button"
              className="wx-set-clear"
              disabled={busy !== null || chosenSize <= 0}
              onClick={() => void clear()}
            >
              {busy === 'clear'
                ? '清理中…'
                : chosenSize > 0
                  ? `清理缓存 ${size(chosenSize)}`
                  : '清理缓存'}
            </button>
            <p className="wx-set-note">缩略图、头像和壁纸不会被清理；媒体需要时会重新下载。</p>
          </>
        )}
      </SettingsGroup>

      {notice ? <p className="wx-set-muted">{notice}</p> : null}
      {error ? <div className="wx-set-error">{error}</div> : null}
    </>
  )
}
