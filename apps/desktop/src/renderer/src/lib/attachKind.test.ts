import { describe, expect, it } from 'vitest'

import { sendKindForPath } from './attachKind'

describe('sendKindForPath', () => {
  it('sends a clip picked through 图片与视频 as a video message', () => {
    expect(sendKindForPath('C:\\clips\\holiday.mp4', 'media')).toBe('video')
    expect(sendKindForPath('/tmp/IMG_0042.MOV', 'media')).toBe('video')
    expect(sendKindForPath('screen.webm', 'media')).toBe('video')
  })

  it('sends a picture as a photo', () => {
    expect(sendKindForPath('C:\\pics\\design.PNG', 'media')).toBe('photo')
    expect(sendKindForPath('/tmp/no-extension', 'media')).toBe('photo')
  })

  it('keeps a file picked through 发送文件 a document, even when it could play', () => {
    expect(sendKindForPath('C:\\clips\\holiday.mp4', 'file')).toBe('file')
  })
})
