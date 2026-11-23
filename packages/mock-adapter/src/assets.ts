import { statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { AppError } from '@wegram/protocol'
import type { MessageMedia, Sticker } from '@wegram/protocol'

import type { MockFile } from './constants'
import {
  SAMPLE_VIDEO_WEBM,
  PREMIUM_EFFECT_TGS,
  STICKER_FACE_WEBP,
  STICKER_HEART_WEBP,
  STICKER_WAVE_TGS,
  createGradientPng,
  createToneWav,
} from './mock-assets'

/**
 * The mock's real media: PNG/WebP/TGS/WebM files written once under `userData`
 * and served through the same `wx-media://` protocol the TDLib adapter uses, so
 * downloads, sticker rendering and the URL plumbing are exercised without an
 * account.
 */
export class MockAssets {
  constructor(private readonly registerMedia: (path: string) => string) {}

  readonly files = new Map<number, MockFile>()
  readonly stickers: Sticker[] = []
  /** Custom emoji: the id a text entity carries → the sticker it draws. */
  readonly customEmojis = new Map<string, Sticker>()
  /** Generated avatar for the rail, so the mock exercises the real image path. */
  selfAvatarUrl: string | null = null

  async materialize(mediaDir: string): Promise<void> {
    await mkdir(mediaDir, { recursive: true })

    const designPath = join(mediaDir, 'design-v3.png')
    await writeFile(designPath, createGradientPng(1200, 800, [34, 66, 120], [236, 168, 96]))
    const sunsetPath = join(mediaDir, 'sunset.png')
    await writeFile(sunsetPath, createGradientPng(900, 1200, [250, 170, 70], [90, 30, 110]))
    const specPath = join(mediaDir, '需求说明.md')
    await writeFile(
      specPath,
      '# 需求说明\n\n- 媒体收发：图片 / 文件，带进度\n- 贴纸：WebP / TGS / WebM\n- 搜索：全局 + 会话内\n',
      'utf8',
    )
    const facePath = join(mediaDir, 'sticker-face.webp')
    await writeFile(facePath, Buffer.from(STICKER_FACE_WEBP, 'base64'))
    const heartPath = join(mediaDir, 'sticker-heart.webp')
    await writeFile(heartPath, Buffer.from(STICKER_HEART_WEBP, 'base64'))
    const wavePath = join(mediaDir, 'sticker-wave.tgs')
    await writeFile(wavePath, Buffer.from(STICKER_WAVE_TGS, 'base64'))
    // The TGS's static frame: TDLib always ships one, and a grid cell rests on it
    // until the pointer plays the animation.
    const waveThumbPath = join(mediaDir, 'sticker-wave-thumb.png')
    await writeFile(waveThumbPath, createGradientPng(128, 128, [126, 214, 165], [40, 120, 80]))
    const premiumPath = join(mediaDir, 'premium-sticker-effect.tgs')
    await writeFile(premiumPath, Buffer.from(PREMIUM_EFFECT_TGS, 'base64'))
    const clipPath = join(mediaDir, 'sample-video.webm')
    await writeFile(clipPath, Buffer.from(SAMPLE_VIDEO_WEBM, 'base64'))
    const clickPath = join(mediaDir, 'emoji-click.wav')
    await writeFile(clickPath, createToneWav())

    const avatarPath = join(mediaDir, 'self-avatar.png')
    await writeFile(avatarPath, createGradientPng(256, 256, [7, 193, 96], [24, 96, 180]))
    this.selfAvatarUrl = this.registerMedia(avatarPath)

    this.addFile(7001, facePath, '笑脸贴纸', 'image/webp', 128, 128)
    this.addFile(7002, heartPath, '爱心贴纸', 'image/webp', 128, 128)
    this.addFile(7003, wavePath, '旋转贴纸', 'application/gzip', 128, 128)
    this.addFile(7006, waveThumbPath, '旋转贴纸预览', 'image/png', 128, 128)
    // The premium sticker's effect: a second file, like the real one.
    this.addFile(7005, premiumPath, '会员贴纸特效', 'application/gzip', 512, 512)
    this.addFile(7101, designPath, 'design-v3.png', 'image/png', 1200, 800)
    this.addFile(7102, sunsetPath, 'sunset.png', 'image/png', 900, 1200)
    this.addFile(7201, specPath, '需求说明.md', 'text/markdown')
    this.addFile(7301, clipPath, 'sample-video.webm', 'video/webm', 270, 480)
    // The animated emoji's click sound (design doc §8.5): a real file, so the click
    // path is exercised without an account.
    this.addFile(7004, clickPath, 'emoji-click.wav', 'audio/wav')

    this.stickers.push(
      { fileId: 7001, format: 'webp', emoji: '😀', width: 128, height: 128, thumbFileId: 7001 },
      { fileId: 7002, format: 'webp', emoji: '❤️', width: 128, height: 128, thumbFileId: 7002 },
      {
        fileId: 7003,
        format: 'tgs',
        emoji: '✨',
        width: 128,
        height: 128,
        thumbFileId: 7006,
        thumbFormat: 'webp',
      },
      // A WebM sticker so the demo pack exercises the third format (and the
      // grid's visible-only video playback).
      { fileId: 7301, format: 'webm', emoji: '🎬', width: 270, height: 480 },
    )
    // One custom emoji for the fixture transcript. The entity's id is the same
    // number as the sticker file it draws (7003, the ✨ TGS); the fixture data in
    // @wegram/mock-fixtures names it, and this is the art it resolves to.
    const customEmoji = this.stickers.find((sticker) => sticker.fileId === 7003)
    if (customEmoji) this.customEmojis.set('7003', customEmoji)
  }

  addFile(
    fileId: number,
    path: string,
    name: string,
    mimeType: string,
    width?: number,
    height?: number,
  ): void {
    this.files.set(fileId, {
      fileId,
      path,
      url: this.registerMedia(path),
      name,
      size: statSync(path).size,
      mimeType,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    })
  }

  mediaOf(
    fileId: number,
    extra: Partial<MessageMedia> = {},
    options: { downloadable?: boolean } = {},
  ): MessageMedia {
    const file = this.files.get(fileId)
    if (!file) throw new AppError('internal', `Unknown mock file ${fileId}`)
    return {
      fileId,
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      fileName: file.name,
      // A downloadable fixture starts with no URL: the renderer has to ask
      // `media:download`, which is what exercises the progress path.
      ...(options.downloadable ? {} : { localUrl: file.url }),
      ...(file.width ? { width: file.width } : {}),
      ...(file.height ? { height: file.height } : {}),
      ...extra,
    }
  }
}
