import { describe, expect, it } from 'vitest'

import {
  parseMiniAppCloudStorageRequest,
  parseMiniAppCloudStorageResult,
} from './mini-app-cloud-storage'

describe('Mini App CloudStorage bridge', () => {
  it('validates and serializes the four reserved custom methods', () => {
    expect(
      parseMiniAppCloudStorageRequest({
        req_id: 'r1',
        method: 'saveStorageValue',
        params: { key: 'reading_mode', value: 'vertical' },
      }),
    ).toEqual({
      reqId: 'r1',
      method: 'saveStorageValue',
      parameters: '{"key":"reading_mode","value":"vertical"}',
    })
    expect(
      parseMiniAppCloudStorageRequest({
        req_id: 'r2',
        method: 'getStorageValues',
        params: { keys: ['reading_mode', 'theme-1'] },
      })?.method,
    ).toBe('getStorageValues')
    expect(
      parseMiniAppCloudStorageRequest({
        req_id: 'r3',
        method: 'deleteStorageValues',
        params: { keys: ['reading_mode'] },
      })?.method,
    ).toBe('deleteStorageValues')
    expect(
      parseMiniAppCloudStorageRequest({ req_id: 'r4', method: 'getStorageKeys', params: {} }),
    ).toEqual({ reqId: 'r4', method: 'getStorageKeys', parameters: '{}' })
  })

  it('refuses unknown methods, malformed keys and oversized values', () => {
    expect(
      parseMiniAppCloudStorageRequest({ req_id: 'r', method: 'deleteEverything', params: {} }),
    ).toBeNull()
    expect(
      parseMiniAppCloudStorageRequest({
        req_id: 'r',
        method: 'saveStorageValue',
        params: { key: 'not allowed', value: 'x' },
      }),
    ).toBeNull()
    expect(
      parseMiniAppCloudStorageRequest({
        req_id: 'r',
        method: 'saveStorageValue',
        params: { key: 'valid', value: 'x'.repeat(4097) },
      }),
    ).toBeNull()
  })

  it('checks each result shape before it reaches the guest', () => {
    expect(parseMiniAppCloudStorageResult('saveStorageValue', true)).toEqual({
      ok: true,
      value: true,
    })
    expect(parseMiniAppCloudStorageResult('getStorageValues', { theme: 'dark' })).toEqual({
      ok: true,
      value: { theme: 'dark' },
    })
    expect(parseMiniAppCloudStorageResult('getStorageKeys', ['theme'])).toEqual({
      ok: true,
      value: ['theme'],
    })
    expect(parseMiniAppCloudStorageResult('getStorageValues', { theme: 1 }).ok).toBe(false)
  })
})
