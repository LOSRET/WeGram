import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ARCHIVE_PAGE_ANIM_MS } from '../src/renderer/src/lib/archivePage'
import { INFO_PANEL_ANIM_MS } from '../src/renderer/src/lib/chatInfo'
import { COMMENT_PANEL_ANIM_MS } from '../src/renderer/src/lib/comments'
import { CHAT_ROW_H } from '../src/renderer/src/lib/listMetrics'
import { TOPICS_PAGE_ANIM_MS } from '../src/renderer/src/lib/topics'

/**
 * Two numbers live twice: once in TypeScript (the virtualiser and the unmount
 * timer need them before any CSS is read) and once in the stylesheet (the
 * browser needs them). Neither copy can import the other, so the agreement is
 * asserted here instead of promised in a comment.
 *
 * This sits in scripts/ rather than beside the code because it has to read the
 * stylesheets, and the renderer is not allowed to touch `node:fs`. Vitest stubs
 * `?raw` CSS imports to an empty string, which is why the files are read here.
 */

const STYLES = join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'styles')
const DIGITS = '0123456789. '

function read(name: string): string {
  return readFileSync(join(STYLES, name), 'utf8')
}

function pxAfter(css: string, name: string): number {
  const start = css.indexOf(name)
  if (start < 0) throw new Error(`${name} is missing from the stylesheet`)
  const colon = css.indexOf(':', start)
  const unit = css.indexOf('px', colon)
  return Number(css.slice(colon + 1, unit).trim())
}

function transformMs(css: string): number {
  const start = css.indexOf('.wx-comments-panel')
  if (start < 0) throw new Error('the comment panel rule is missing from comments.css')
  const block = css.slice(start, css.indexOf('}', start))
  const declarationStart = block.indexOf('transition:')
  if (declarationStart < 0) throw new Error('the panel transition is missing from comments.css')
  const declaration = block.slice(declarationStart, block.indexOf(';', declarationStart))
  const valueStart = declaration.indexOf('transform') + 'transform'.length
  let index = valueStart
  while (DIGITS.includes(declaration[index] ?? '') && index < declaration.length) index += 1
  const value = Number(declaration.slice(valueStart, index).trim())
  // '0.25s' means seconds; '250ms' already is milliseconds.
  return declaration.slice(index, index + 2).startsWith('m') ? value : Math.round(value * 1000)
}

/** Duration of one property in a rule's `transition:` declaration. */
function propertyMs(css: string, selector: string, property: string): number {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`${selector} is missing from the stylesheet`)
  const block = css.slice(start, css.indexOf('}', start))
  const declarationStart = block.indexOf('transition:')
  if (declarationStart < 0) throw new Error(`the transition is missing from ${selector}`)
  const declaration = block.slice(declarationStart, block.indexOf(';', declarationStart))
  const valueStart = declaration.indexOf(property) + property.length
  let index = valueStart
  while (DIGITS.includes(declaration[index] ?? '') && index < declaration.length) index += 1
  const value = Number(declaration.slice(valueStart, index).trim())
  return declaration.slice(index, index + 2).startsWith('m') ? value : Math.round(value * 1000)
}

describe('style contract', () => {
  it('keeps the virtualised row height equal to --wx-list-item-h', () => {
    expect(pxAfter(read('tokens.css'), '--wx-list-item-h')).toBe(CHAT_ROW_H)
  })

  it('keeps the panel slide equal to COMMENT_PANEL_ANIM_MS', () => {
    expect(transformMs(read('comments.css'))).toBe(COMMENT_PANEL_ANIM_MS)
  })

  it('keeps the 聊天信息 slide equal to INFO_PANEL_ANIM_MS', () => {
    expect(propertyMs(read('chat-info.css'), '.wx-info {', 'transform')).toBe(INFO_PANEL_ANIM_MS)
  })

  it('keeps the 已归档会话 slide equal to ARCHIVE_PAGE_ANIM_MS', () => {
    expect(propertyMs(read('chat-list.css'), '.wx-archive-page {', 'transform')).toBe(
      ARCHIVE_PAGE_ANIM_MS,
    )
  })

  it('keeps the 话题 slide equal to TOPICS_PAGE_ANIM_MS', () => {
    expect(propertyMs(read('topics.css'), '.wx-topics-page {', 'transform')).toBe(
      TOPICS_PAGE_ANIM_MS,
    )
  })
})
