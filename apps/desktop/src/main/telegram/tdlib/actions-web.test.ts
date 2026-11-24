import { describe, expect, it } from 'vitest'

import { instantView } from './actions'
import type { ActionDeps } from './actions'
import type { TdObject } from './client'

function makeDeps(respond: (method: TdObject) => TdObject): {
  deps: Pick<ActionDeps, 'invoke'>
  calls: TdObject[]
} {
  const calls: TdObject[] = []
  return {
    calls,
    deps: {
      invoke: async (method) => {
        calls.push(method)
        return respond(method)
      },
    },
  }
}

/**
 * 即时预览 is one TDLib request plus the rich-message mapper: what is pinned here
 * is that the URL travels verbatim and that a `pageBlock` tree reaches the
 * renderer as the protocol's blocks, not as TDLib JSON.
 */
describe('instantView', () => {
  it('asks getWebPageInstantView for the URL and maps its page blocks', async () => {
    const { deps, calls } = makeDeps(() => ({
      _: 'webPageInstantView',
      view_count: 42,
      version: 2,
      is_rtl: false,
      is_full: true,
      blocks: [
        { _: 'pageBlockTitle', title: { _: 'richTextPlain', text: 'WeGram v0.3.1' } },
        { _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '链接预览可用了。' } },
        {
          _: 'pageBlockPhoto',
          photo: { sizes: [{ width: 640, height: 480, photo: { id: 9 } }] },
          caption: { _: 'pageBlockCaption', text: { _: 'richTextPlain', text: '封面' } },
        },
      ],
    }))

    const page = await instantView(deps, 'https://telegra.ph/x')

    expect(calls).toEqual([{ _: 'getWebPageInstantView', url: 'https://telegra.ph/x' }])
    expect(page).toMatchObject({ url: 'https://telegra.ph/x', isFull: true, viewCount: 42 })
    expect(page.blocks.map((block) => block.type)).toEqual(['text', 'text', 'media'])
    expect(page.blocks[0]).toMatchObject({ type: 'text', role: 'title' })
    expect(page.blocks[2]).toMatchObject({ type: 'media', kind: 'photo' })
  })

  it('keeps a partial page partial instead of pretending it is whole', async () => {
    const { deps } = makeDeps(() => ({ _: 'webPageInstantView', is_full: false, blocks: [] }))

    const page = await instantView(deps, 'https://example.com/a')

    expect(page.isFull).toBe(false)
    expect(page.blocks).toEqual([])
    expect(page.viewCount).toBeUndefined()
  })
})
