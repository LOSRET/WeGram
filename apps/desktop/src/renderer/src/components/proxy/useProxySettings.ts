import type { ProxyConfig, ProxyMode, ProxyState, ProxyTestResult } from '@wegram/protocol'

import { useCallback, useEffect, useState } from 'react'

import { errorMessage, invoke } from '../../lib/ipc'

export interface ProxyStatus {
  kind: 'idle' | 'busy' | 'ok' | 'fail'
  text?: string
}

export interface ProxySettings {
  /** What main decided is in force; `null` until the first answer. */
  state: ProxyState | null
  preferIpv6: boolean
  status: ProxyStatus
  setStatus: (status: ProxyStatus) => void
  setMode: (mode: ProxyMode) => Promise<void>
  save: (config: ProxyConfig) => Promise<void>
  clear: () => Promise<void>
  refresh: () => Promise<void>
  test: (config: ProxyConfig) => Promise<ProxyTestResult | null>
  toggleIpv6: (next: boolean) => Promise<void>
}

/**
 * The proxy state every surface paints (design doc §6.4).
 *
 * Which proxy is in force is decided in main (`proxy-controller.ts`); this hook only
 * asks for changes and keeps the last answer. It exists because the login window's
 * modal and 设置 → 网络与代理 must not be two implementations of the same rules —
 * and because the OS proxy can change under an open panel (`evt:proxy`).
 */
export function useProxySettings(onError?: (message: string) => void): ProxySettings {
  const [state, setState] = useState<ProxyState | null>(null)
  const [preferIpv6, setPreferIpv6] = useState(false)
  const [status, setStatus] = useState<ProxyStatus>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [proxy, network] = await Promise.all([invoke('proxy:get'), invoke('network:get')])
        if (cancelled) return
        setState(proxy)
        setPreferIpv6(network.preferIpv6)
      } catch (error) {
        onError?.(errorMessage(error))
      }
    })()

    // Main publishes what it changed on its own — the OS proxy appearing, going away
    // or starting to answer again — so an open panel never shows a stale proxy.
    const unsubscribe = window.tg.on('evt:proxy', (event) => {
      if (!cancelled) setState(event.payload)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [onError])

  const setMode = useCallback(async (mode: ProxyMode) => {
    setStatus({ kind: 'busy' })
    try {
      setState(await invoke('proxy:set', { mode }))
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }, [])

  const save = useCallback(async (config: ProxyConfig) => {
    setStatus({ kind: 'busy' })
    try {
      setState(await invoke('proxy:set', { config }))
      setStatus({ kind: 'ok', text: '已保存并应用到 TDLib' })
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }, [])

  const clear = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      setState(await invoke('proxy:set', { config: null }))
      setStatus({ kind: 'ok', text: '代理已删除，当前直连' })
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }, [])

  const refresh = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      const next = await invoke('proxy:refresh')
      setState(next)
      setStatus({ kind: 'ok', text: next.detail ?? '已重新检测' })
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }, [])

  const test = useCallback(async (config: ProxyConfig): Promise<ProxyTestResult | null> => {
    setStatus({ kind: 'busy' })
    try {
      const result = await invoke('proxy:test', { config })
      setStatus(
        result.ok
          ? { kind: 'ok', text: `连通，耗时 ${result.latencyMs ?? 0}ms` }
          : { kind: 'fail', text: result.error ?? '连接失败' },
      )
      return result
    } catch (error) {
      setStatus({ kind: 'fail', text: errorMessage(error) })
      return null
    }
  }, [])

  const toggleIpv6 = useCallback(async (next: boolean) => {
    setPreferIpv6(next)
    try {
      await invoke('network:set', { preferIpv6: next })
    } catch (error) {
      setPreferIpv6(!next)
      setStatus({ kind: 'fail', text: errorMessage(error) })
    }
  }, [])

  return { state, preferIpv6, status, setStatus, setMode, save, clear, refresh, test, toggleIpv6 }
}
