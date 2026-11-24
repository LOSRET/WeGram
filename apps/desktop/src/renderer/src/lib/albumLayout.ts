import type { Message } from '@wegram/protocol'

/**
 * Telegram album (media group) geometry — a port of tdesktop's
 * `Ui::LayoutMediaGroup` (`Telegram/SourceFiles/ui/grouped_layout.cpp`), the one
 * place every official client agrees on (design doc §8.6).
 *
 * An album is not a grid. One to four items are placed by a template chosen from
 * the items' aspect ratios: two similar wide pictures stack, two wide or two
 * square ones sit side by side, a narrow first item takes the left column. Five
 * to ten items — or any item wider than 2:1 — go through the official client's
 * search over row splits: every candidate makes each row exactly `maxWidth` wide
 * and the winner is the one whose total height comes closest to
 * `maxWidth * 4 / 3`, with a penalty for a row shorter than `minWidth` and for a
 * split whose rows shrink (more items above than below).
 *
 * The box is Telegram Desktop's own: 430 px maximum, a 100 px minimum and a
 * 4 px seam (`ALBUM_MAX_WIDTH` / `ALBUM_MIN_WIDTH` / `ALBUM_SPACING`). A pane
 * narrower than that does not re-run the layout — `resizeAlbum` scales the
 * composed geometry by `newWidth / 430`, spacing included, exactly like the
 * official client's `GroupedMedia::countCurrentSize`, so an album keeps its
 * composition at any window width.
 */

export interface AlbumSize {
  width: number
  height: number
}

/** Which album borders a cell touches — tdesktop's `RectParts`. */
export interface AlbumSides {
  left: boolean
  top: boolean
  right: boolean
  bottom: boolean
}

/** One placed item: the box it occupies and the borders it touches. */
export interface AlbumCell {
  x: number
  y: number
  width: number
  height: number
  sides: AlbumSides
}

export interface AlbumLayout {
  width: number
  height: number
  /** One entry per item, in album order. */
  cells: AlbumCell[]
}

export interface AlbumLayoutOptions {
  maxWidth?: number
  minWidth?: number
  spacing?: number
}

/** tdesktop's `maxMediaSize: 430px` — an album is as wide as the official client's. */
export const ALBUM_MAX_WIDTH = 430

/** tdesktop's `minPhotoSize: 100px`; a row shorter than this is penalised. */
export const ALBUM_MIN_WIDTH = 100

/** tdesktop's `historyGroupSkip: 4px` — the seam between two cells. */
export const ALBUM_SPACING = 4

/** Ratios used when TDLib sent a media item without its dimensions. */
const PHOTO_RATIO = 4 / 3
const VIDEO_RATIO = 16 / 9

// tdesktop's `ComplexLayouter::CropRatios` bounds, unchanged.
const MAX_CROP_RATIO = 2.75
const MIN_CROP_RATIO = 0.6667

type Proportion = 'w' | 'q' | 'n'

interface LayoutContext {
  readonly ratios: number[]
  readonly proportions: Proportion[]
  readonly maxWidth: number
  readonly maxHeight: number
  readonly minWidth: number
  readonly spacing: number
  readonly averageRatio: number
  readonly maxSizeRatio: number
}

interface Attempt {
  readonly counts: number[]
  readonly heights: number[]
}

const round = (value: number): number => Math.round(value)

const sides = (left: boolean, top: boolean, right: boolean, bottom: boolean): AlbumSides => ({
  left,
  top,
  right,
  bottom,
})

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

function classify(ratio: number): Proportion {
  if (ratio > 1.2) return 'w'
  if (ratio < 0.8) return 'n'
  return 'q'
}

/**
 * `Layouter::layout`: the template branch. A picture wider than 2:1 is the
 * official client's signal that the plain templates cannot hold it, so even a
 * two-item album falls through to the split search then.
 */
function layoutBranch(ctx: LayoutContext): AlbumCell[] {
  const count = ctx.ratios.length
  if (count === 0) return []
  if (count === 1) return layoutOne(ctx)
  if (count >= 5 || ctx.ratios.some((ratio) => ratio > 2)) return layoutComplex(ctx)
  if (count === 2) return layoutTwo(ctx)
  if (count === 3) return layoutThree(ctx)
  return layoutFour(ctx)
}

function layoutOne(ctx: LayoutContext): AlbumCell[] {
  const [ratio = 1] = ctx.ratios
  const width = ctx.maxWidth
  const height = round(width / ratio)
  return [{ x: 0, y: 0, width, height, sides: sides(true, true, true, true) }]
}

function layoutTwo(ctx: LayoutContext): AlbumCell[] {
  const [first = 1, second = 1] = ctx.ratios
  const [firstKind = 'q', secondKind = 'q'] = ctx.proportions
  const { maxWidth, maxHeight, spacing } = ctx

  const bothWide = firstKind === 'w' && secondKind === 'w'
  if (bothWide && ctx.averageRatio > 1.4 * ctx.maxSizeRatio && Math.abs(second - first) < 0.2) {
    // Two similar panoramas read better stacked than squeezed into two columns.
    const width = maxWidth
    const height = round(
      Math.min(width / first, Math.min(width / second, (maxHeight - spacing) / 2)),
    )
    return [
      { x: 0, y: 0, width, height, sides: sides(true, true, true, false) },
      { x: 0, y: height + spacing, width, height, sides: sides(true, false, true, true) },
    ]
  }

  if (bothWide || (firstKind === 'q' && secondKind === 'q')) {
    const width = Math.floor((maxWidth - spacing) / 2)
    const height = round(Math.min(width / first, Math.min(width / second, maxHeight)))
    return [
      { x: 0, y: 0, width, height, sides: sides(true, true, false, true) },
      { x: width + spacing, y: 0, width, height, sides: sides(false, true, true, true) },
    ]
  }

  // A wide and a tall picture: divide by the ratio so neither is starved, but
  // keep the left one at least 1.5 × the minimum.
  const minimalWidth = round(ctx.minWidth * 1.5)
  const secondWidth = Math.min(
    round(
      Math.max(0.4 * (maxWidth - spacing), (maxWidth - spacing) / first / (1 / first + 1 / second)),
    ),
    maxWidth - spacing - minimalWidth,
  )
  const firstWidth = maxWidth - secondWidth - spacing
  const height = Math.min(maxHeight, round(Math.min(firstWidth / first, secondWidth / second)))
  return [
    { x: 0, y: 0, width: firstWidth, height, sides: sides(true, true, false, true) },
    {
      x: firstWidth + spacing,
      y: 0,
      width: secondWidth,
      height,
      sides: sides(false, true, true, true),
    },
  ]
}

function layoutThree(ctx: LayoutContext): AlbumCell[] {
  const [firstKind = 'q'] = ctx.proportions
  return firstKind === 'n' ? layoutThreeLeftAndOther(ctx) : layoutThreeTopAndOther(ctx)
}

function layoutThreeLeftAndOther(ctx: LayoutContext): AlbumCell[] {
  const [first = 1, second = 1, third = 1] = ctx.ratios
  const { maxWidth, maxHeight, minWidth, spacing } = ctx

  const firstHeight = maxHeight
  const thirdHeight = round(
    Math.min((maxHeight - spacing) / 2, (second * (maxWidth - spacing)) / (third + second)),
  )
  const secondHeight = firstHeight - thirdHeight - spacing
  const rightWidth = Math.max(
    minWidth,
    round(Math.min((maxWidth - spacing) / 2, Math.min(thirdHeight * third, secondHeight * second))),
  )
  const leftWidth = Math.min(round(firstHeight * first), maxWidth - spacing - rightWidth)

  return [
    { x: 0, y: 0, width: leftWidth, height: firstHeight, sides: sides(true, true, false, true) },
    {
      x: leftWidth + spacing,
      y: 0,
      width: rightWidth,
      height: secondHeight,
      sides: sides(false, true, true, false),
    },
    {
      x: leftWidth + spacing,
      y: secondHeight + spacing,
      width: rightWidth,
      height: thirdHeight,
      sides: sides(false, false, true, true),
    },
  ]
}

function layoutThreeTopAndOther(ctx: LayoutContext): AlbumCell[] {
  const [first = 1, second = 1, third = 1] = ctx.ratios
  const { maxWidth, maxHeight, spacing } = ctx

  const firstWidth = maxWidth
  const firstHeight = round(Math.min(firstWidth / first, (maxHeight - spacing) * 0.66))
  const secondWidth = Math.floor((maxWidth - spacing) / 2)
  const secondHeight = Math.min(
    maxHeight - firstHeight - spacing,
    round(Math.min(secondWidth / second, secondWidth / third)),
  )
  const thirdWidth = firstWidth - secondWidth - spacing

  return [
    { x: 0, y: 0, width: firstWidth, height: firstHeight, sides: sides(true, true, true, false) },
    {
      x: 0,
      y: firstHeight + spacing,
      width: secondWidth,
      height: secondHeight,
      sides: sides(true, false, false, true),
    },
    {
      x: secondWidth + spacing,
      y: firstHeight + spacing,
      width: thirdWidth,
      height: secondHeight,
      sides: sides(false, false, true, true),
    },
  ]
}

function layoutFour(ctx: LayoutContext): AlbumCell[] {
  const [firstKind = 'q'] = ctx.proportions
  return firstKind === 'w' ? layoutFourTopAndOther(ctx) : layoutFourLeftAndOther(ctx)
}

function layoutFourTopAndOther(ctx: LayoutContext): AlbumCell[] {
  const [first = 1, second = 1, third = 1, fourth = 1] = ctx.ratios
  const { maxWidth, maxHeight, minWidth, spacing } = ctx

  const width = maxWidth
  const firstHeight = round(Math.min(width / first, (maxHeight - spacing) * 0.66))
  const rowHeight = round((maxWidth - 2 * spacing) / (second + third + fourth))
  const firstColumnWidth = Math.max(
    minWidth,
    round(Math.min((maxWidth - 2 * spacing) * 0.4, rowHeight * second)),
  )
  const thirdColumnWidth = round(
    Math.max(Math.max(minWidth, (maxWidth - 2 * spacing) * 0.33), rowHeight * fourth),
  )
  const secondColumnWidth = width - firstColumnWidth - thirdColumnWidth - 2 * spacing
  const bottomHeight = Math.min(maxHeight - firstHeight - spacing, rowHeight)

  return [
    { x: 0, y: 0, width, height: firstHeight, sides: sides(true, true, true, false) },
    {
      x: 0,
      y: firstHeight + spacing,
      width: firstColumnWidth,
      height: bottomHeight,
      sides: sides(true, false, false, true),
    },
    {
      x: firstColumnWidth + spacing,
      y: firstHeight + spacing,
      width: secondColumnWidth,
      height: bottomHeight,
      sides: sides(false, false, false, true),
    },
    {
      x: firstColumnWidth + secondColumnWidth + 2 * spacing,
      y: firstHeight + spacing,
      width: thirdColumnWidth,
      height: bottomHeight,
      sides: sides(false, false, true, true),
    },
  ]
}

function layoutFourLeftAndOther(ctx: LayoutContext): AlbumCell[] {
  const [first = 1, second = 1, third = 1, fourth = 1] = ctx.ratios
  const { maxWidth, maxHeight, minWidth, spacing } = ctx

  const height = maxHeight
  const firstColumnWidth = round(Math.min(height / first, (maxWidth - spacing) * 0.6))
  const rowHeight = round((maxHeight - 2 * spacing) / (1 / second + 1 / third + 1 / fourth))
  const firstRowHeight = round(rowHeight / second)
  const secondRowHeight = round(rowHeight / third)
  const lastRowHeight = height - firstRowHeight - secondRowHeight - 2 * spacing
  const rightWidth = Math.max(minWidth, Math.min(maxWidth - firstColumnWidth - spacing, rowHeight))

  return [
    { x: 0, y: 0, width: firstColumnWidth, height, sides: sides(true, true, false, true) },
    {
      x: firstColumnWidth + spacing,
      y: 0,
      width: rightWidth,
      height: firstRowHeight,
      sides: sides(false, true, true, false),
    },
    {
      x: firstColumnWidth + spacing,
      y: firstRowHeight + spacing,
      width: rightWidth,
      height: secondRowHeight,
      sides: sides(false, false, true, false),
    },
    {
      x: firstColumnWidth + spacing,
      y: firstRowHeight + secondRowHeight + 2 * spacing,
      width: rightWidth,
      height: lastRowHeight,
      sides: sides(false, false, true, true),
    },
  ]
}

function cropRatios(ratios: readonly number[], averageRatio: number): number[] {
  const low = averageRatio > 1.1 ? 1 : MIN_CROP_RATIO
  const high = averageRatio > 1.1 ? MAX_CROP_RATIO : 1
  return ratios.map((ratio) => clamp(ratio, low, high))
}

/**
 * `ComplexLayouter::layout`: enumerate every way to split the items into two,
 * three or four rows (each row at most three items, the second allowed four when
 * the album is mostly portrait), make each row exactly `maxWidth` wide by
 * scaling its ratios, then pick the split whose total height is closest to
 * `maxWidth * 4 / 3`.
 */
function layoutComplex(ctx: LayoutContext): AlbumCell[] {
  const { maxWidth, minWidth, spacing } = ctx
  const maxHeight = Math.floor((maxWidth * 4) / 3)
  const ratios = cropRatios(ctx.ratios, ctx.averageRatio)
  const count = ratios.length

  const lineHeightOf = (offset: number, lineCount: number): number => {
    let sum = 0
    for (let index = offset; index < offset + lineCount; index += 1) sum += ratios[index] ?? 0
    return (maxWidth - (lineCount - 1) * spacing) / sum
  }

  const attempts: Attempt[] = []
  const pushAttempt = (counts: number[]): void => {
    const heights: number[] = []
    let offset = 0
    for (const lineCount of counts) {
      heights.push(lineHeightOf(offset, lineCount))
      offset += lineCount
    }
    attempts.push({ counts, heights })
  }

  for (let first = 1; first < count; first += 1) {
    if (first > 3 || count - first > 3) continue
    pushAttempt([first, count - first])
  }
  for (let first = 1; first < count - 1; first += 1) {
    for (let second = 1; second < count - first; second += 1) {
      const third = count - first - second
      if (first > 3 || second > (ctx.averageRatio < 0.85 ? 4 : 3) || third > 3) continue
      pushAttempt([first, second, third])
    }
  }
  for (let first = 1; first < count - 2; first += 1) {
    for (let second = 1; second < count - first - 1; second += 1) {
      for (let third = 1; third < count - first - second; third += 1) {
        const fourth = count - first - second - third
        if (first > 3 || second > 3 || third > 3 || fourth > 3) continue
        pushAttempt([first, second, third, fourth])
      }
    }
  }

  let best: Attempt | undefined
  let bestDiff = 0
  for (const attempt of attempts) {
    const lineCount = attempt.counts.length
    let totalHeight = spacing * (lineCount - 1)
    let minLineHeight = Number.POSITIVE_INFINITY
    for (const height of attempt.heights) {
      totalHeight += height
      minLineHeight = Math.min(minLineHeight, height)
    }
    // A row shorter than the minimum reads as a sliver, and a split whose rows
    // shrink — more items above than below — makes the cells grow towards the
    // bottom, which tdesktop punishes the same way. Both weight the candidate, they
    // do not forbid it: the search still has to return something.
    const tooShort = minLineHeight < minWidth ? 1.5 : 1
    let shrinking = 1
    for (let line = 1; line < lineCount; line += 1) {
      if ((attempt.counts[line - 1] ?? 0) > (attempt.counts[line] ?? 0)) {
        shrinking = 1.5
        break
      }
    }
    const diff = Math.abs(totalHeight - maxHeight) * tooShort * shrinking
    if (!best || diff < bestDiff) {
      best = attempt
      bestDiff = diff
    }
  }
  if (!best) return []

  const cells: AlbumCell[] = []
  let index = 0
  let y = 0
  const rowCount = best.counts.length
  for (let row = 0; row < rowCount; row += 1) {
    const columnCount = best.counts[row] ?? 0
    const lineHeight = best.heights[row] ?? 0
    const height = round(lineHeight)
    let x = 0
    for (let column = 0; column < columnCount; column += 1) {
      // The last cell takes the remainder, so rounding never leaves a seam at the
      // album's right edge.
      const width =
        column === columnCount - 1 ? maxWidth - x : round((ratios[index] ?? 1) * lineHeight)
      cells.push({
        x,
        y,
        width,
        height,
        sides: sides(column === 0, row === 0, column === columnCount - 1, row === rowCount - 1),
      })
      x += width + spacing
      index += 1
    }
    y += height + spacing
  }
  return cells
}

/** The union box of the placed cells: some templates stop short of `maxWidth`. */
function pack(cells: AlbumCell[]): AlbumLayout {
  let width = 0
  let height = 0
  for (const cell of cells) {
    width = Math.max(width, cell.x + cell.width)
    height = Math.max(height, cell.y + cell.height)
  }
  return { width, height, cells }
}

function ratioOf(size: AlbumSize): number {
  return Math.max(size.width, 1) / Math.max(size.height, 1)
}

/** The geometry of one album, in album order. */
export function layoutAlbum(
  sizes: readonly AlbumSize[],
  options: AlbumLayoutOptions = {},
): AlbumLayout {
  const maxWidth = options.maxWidth ?? ALBUM_MAX_WIDTH
  const minWidth = options.minWidth ?? ALBUM_MIN_WIDTH
  const spacing = options.spacing ?? ALBUM_SPACING
  const ratios = sizes.map(ratioOf)
  if (!ratios.length) return { width: 0, height: 0, cells: [] }

  const ctx: LayoutContext = {
    ratios,
    proportions: ratios.map(classify),
    maxWidth,
    // tdesktop keeps the templates square and only lets the split search grow to
    // 4:3, which is what stops a stack of portraits from becoming a column.
    maxHeight: maxWidth,
    minWidth,
    spacing,
    // tdesktop accumulates from 1.0 on purpose; the average leans towards square.
    averageRatio: ratios.reduce((sum, ratio) => sum + ratio, 1) / ratios.length,
    maxSizeRatio: 1,
  }
  return pack(layoutBranch(ctx))
}

/** The size one message contributes to its album, with tdesktop's fallbacks. */
export function albumItemSize(message: Pick<Message, 'kind' | 'media'>): AlbumSize {
  const media = message.media
  const width = media?.width
  const height = media?.height
  if (width && height && width > 0 && height > 0) return { width, height }
  const ratio = message.kind === 'video' ? VIDEO_RATIO : PHOTO_RATIO
  return { width: Math.round(ratio * 100), height: 100 }
}

/** The geometry of the album those messages form (the row's items, in order). */
export function albumLayoutOf(messages: readonly Pick<Message, 'kind' | 'media'>[]): AlbumLayout {
  return layoutAlbum(messages.map(albumItemSize))
}

/**
 * `GroupedMedia::countCurrentSize`: a narrower pane does not re-run the layout —
 * the composed geometry is scaled by `width / layout.width` and the seam with it,
 * so the composition keeps its proportions on any window width.
 */
export function resizeAlbum(
  layout: AlbumLayout,
  width: number,
  spacing = ALBUM_SPACING,
): AlbumLayout {
  // The measured row width is fractional; the cells below are whole pixels, so the
  // album box is rounded to the same grid.
  const target = Math.round(width)
  if (target <= 0 || !layout.cells.length) return { width: 0, height: 0, cells: [] }
  if (target >= layout.width) return layout

  const factor = target / layout.width
  const scale = (value: number): number => Math.round(value * factor)
  const scaledSpacing = scale(spacing)

  let height = 0
  const cells = layout.cells.map((cell) => {
    // A cell that does not touch the album's border has a seam after it, so the
    // scaled edge has to grow before the seam is subtracted again.
    const gapRight = cell.sides.right ? 0 : spacing
    const gapBottom = cell.sides.bottom ? 0 : spacing
    const left = scale(cell.x)
    const top = scale(cell.y)
    const right = scale(cell.x + cell.width + gapRight)
    const bottom = scale(cell.y + cell.height + gapBottom)
    const resized: AlbumCell = {
      x: left,
      y: top,
      width: right - left - (cell.sides.right ? 0 : scaledSpacing),
      height: bottom - top - (cell.sides.bottom ? 0 : scaledSpacing),
      sides: cell.sides,
    }
    height = Math.max(height, resized.y + resized.height)
    return resized
  })

  return { width: target, height, cells }
}
