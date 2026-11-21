import { describe, expect, it } from 'vitest'

import { mapContent, previewContent } from './content'
import { mapRichMessage } from './rich'
import { richText } from './rich-text'

/**
 * Rich messages are Telegram's page-of-blocks content type. These tests pin
 * the two things the renderer trusts: entity offsets in the flattened text, and
 * the block union the page maps to (with unknown blocks dropped, not guessed).
 */
describe('richText', () => {
  it('keeps plain text', () => {
    expect(richText({ _: 'richTextPlain', text: 'hello' })).toEqual({ text: 'hello' })
  })

  it('walks a concatenation', () => {
    const mapped = richText({
      _: 'richTexts',
      texts: [
        { _: 'richTextPlain', text: 'a' },
        { _: 'richTextPlain', text: 'b' },
      ],
    })
    expect(mapped.text).toBe('ab')
  })

  it('turns a wrapper into an entity whose offset is in the flattened text', () => {
    const mapped = richText({
      _: 'richTexts',
      texts: [
        { _: 'richTextPlain', text: 'ab' },
        { _: 'richTextBold', text: { _: 'richTextPlain', text: 'cd' } },
      ],
    })
    expect(mapped.text).toBe('abcd')
    expect(mapped.entities).toEqual([{ type: 'bold', offset: 2, length: 2 }])
  })

  it('carries the url of a link', () => {
    const mapped = richText({
      _: 'richTextUrl',
      text: { _: 'richTextPlain', text: 'site' },
      url: 'https://example.test',
      is_cached: false,
    })
    expect(mapped.entities).toEqual([
      { type: 'textUrl', offset: 0, length: 4, url: 'https://example.test' },
    ])
  })

  it('uses the alternative text of a custom emoji', () => {
    const mapped = richText({
      _: 'richTextCustomEmoji',
      custom_emoji_id: '5',
      alternative_text: 'X',
    })
    expect(mapped.text).toBe('X')
    expect(mapped.entities).toEqual([
      { type: 'customEmoji', offset: 0, length: 1, customEmojiId: '5' },
    ])
  })

  it('keeps the words of a node it has no entity for', () => {
    expect(
      richText({ _: 'richTextEmailAddress', text: { _: 'richTextPlain', text: 'a@b' } }),
    ).toEqual({ text: 'a@b' })
  })
})

describe('mapRichMessage', () => {
  it('maps headings and paragraphs, and flattens them in reading order', () => {
    const { blocks, text } = mapRichMessage({
      blocks: [
        { _: 'pageBlockSectionHeading', text: { _: 'richTextPlain', text: '标题' }, size: 2 },
        { _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '正文' } },
      ],
    })
    expect(blocks).toEqual([
      { type: 'text', role: 'section', size: 2, text: { text: '标题' } },
      { type: 'text', role: 'paragraph', text: { text: '正文' } },
    ])
    expect(text).toBe('标题\n正文')
  })

  it('maps a list with its labels and nested blocks', () => {
    const { blocks } = mapRichMessage({
      blocks: [
        {
          _: 'pageBlockList',
          items: [
            {
              _: 'pageBlockListItem',
              label: '一',
              value: 1,
              type: '1',
              has_checkbox: false,
              is_checked: false,
              blocks: [{ _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '第一' } }],
            },
          ],
        },
      ],
    })
    expect(blocks).toEqual([
      {
        type: 'list',
        items: [
          {
            label: '一',
            value: 1,
            blocks: [{ type: 'text', role: 'paragraph', text: { text: '第一' } }],
          },
        ],
      },
    ])
  })

  it('maps a table, keeping spans and alignment', () => {
    const { blocks } = mapRichMessage({
      blocks: [
        {
          _: 'pageBlockTable',
          is_bordered: true,
          is_striped: false,
          is_compact: true,
          cells: [
            [
              {
                _: 'pageBlockTableCell',
                text: { _: 'richTextPlain', text: '型号' },
                is_header: true,
                colspan: 1,
                rowspan: 1,
                align: { _: 'pageBlockHorizontalAlignmentLeft' },
              },
              {
                _: 'pageBlockTableCell',
                text: { _: 'richTextPlain', text: '价' },
                is_header: true,
                colspan: 2,
                rowspan: 1,
                align: { _: 'pageBlockHorizontalAlignmentRight' },
              },
            ],
          ],
        },
      ],
    })
    expect(blocks).toEqual([
      {
        type: 'table',
        bordered: true,
        striped: false,
        compact: true,
        rows: [
          [
            { text: { text: '型号' }, header: true, colspan: 1, rowspan: 1, align: 'left' },
            { text: { text: '价' }, header: true, colspan: 2, rowspan: 1, align: 'right' },
          ],
        ],
      },
    ])
  })

  it('maps a photo to the largest size plus a >=160px thumb', () => {
    const { blocks } = mapRichMessage({
      blocks: [
        {
          _: 'pageBlockPhoto',
          photo: {
            sizes: [
              { width: 100, height: 100, photo: { id: 11 } },
              { width: 200, height: 150, photo: { id: 13 } },
              { width: 400, height: 300, photo: { id: 12 } },
            ],
          },
          caption: { text: { _: 'richTextPlain', text: '图注' } },
        },
      ],
    })
    expect(blocks).toEqual([
      {
        type: 'media',
        kind: 'photo',
        media: {
          fileId: 12,
          thumbFileId: 13,
          width: 400,
          height: 300,
          // Smallest first: the bubble asks for the variant that covers its box.
          sizes: [
            { fileId: 11, width: 100, height: 100 },
            { fileId: 13, width: 200, height: 150 },
            { fileId: 12, width: 400, height: 300 },
          ],
        },
        caption: { text: '图注' },
      },
    ])
  })

  it('nests quotes and collapsible blocks', () => {
    const { blocks, text } = mapRichMessage({
      blocks: [
        {
          _: 'pageBlockBlockQuote',
          blocks: [{ _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '引用' } }],
        },
        {
          _: 'pageBlockDetails',
          header: { _: 'richTextPlain', text: '更多' },
          is_open: false,
          blocks: [{ _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '隐藏' } }],
        },
      ],
    })
    expect(blocks).toEqual([
      { type: 'quote', blocks: [{ type: 'text', role: 'paragraph', text: { text: '引用' } }] },
      {
        type: 'details',
        header: { text: '更多' },
        open: false,
        blocks: [{ type: 'text', role: 'paragraph', text: { text: '隐藏' } }],
      },
    ])
    expect(text).toBe('引用\n更多\n隐藏')
  })

  it('drops a block it cannot draw without losing its siblings', () => {
    const { blocks } = mapRichMessage({
      blocks: [
        { _: 'pageBlockAnchor', name: 'a' },
        { _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '还在' } },
      ],
    })
    expect(blocks).toHaveLength(1)
  })
})

describe('mapContent (rich message)', () => {
  it('maps it to kind rich and keeps the flattened words as text', () => {
    const mapped = mapContent({
      _: 'messageRichMessage',
      message: {
        _: 'richMessage',
        is_full: true,
        is_rtl: false,
        blocks: [
          { _: 'pageBlockSectionHeading', text: { _: 'richTextPlain', text: '标题' }, size: 1 },
          {
            _: 'pageBlockParagraph',
            text: {
              _: 'richTexts',
              texts: [
                { _: 'richTextPlain', text: '看这 ' },
                {
                  _: 'richTextMention',
                  text: { _: 'richTextPlain', text: '@bot' },
                  username: 'bot',
                },
              ],
            },
          },
        ],
      },
    })
    expect(mapped.kind).toBe('rich')
    expect(mapped.text).toContain('@bot')
    expect(mapped.rich).toHaveLength(2)
  })

  it('previews a rich message on one line in the chat list', () => {
    const preview = previewContent({
      _: 'messageRichMessage',
      message: {
        blocks: [
          { _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '第一句' } },
          { _: 'pageBlockParagraph', text: { _: 'richTextPlain', text: '第二句' } },
        ],
      },
    })
    expect(preview).toBe('第一句 第二句')
  })

  it('maps a page button row to the shared button model', () => {
    const mapped = mapContent({
      _: 'messageRichMessage',
      message: {
        blocks: [
          {
            _: 'pageBlockButtonRow',
            buttons: [
              {
                _: 'inlineButton',
                text: { _: 'richTextPlain', text: '点我' },
                type: { _: 'inlineKeyboardButtonTypeUrl', url: 'https://x.test' },
              },
            ],
          },
        ],
      },
    })
    expect(mapped.rich).toEqual([
      { type: 'buttons', rows: [[{ text: '点我', url: 'https://x.test' }]] },
    ])
  })
})
