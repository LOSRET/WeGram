import { describe, expect, it } from 'vitest'

import { miniAppThemeParams, miniAppTdlibTheme } from './mini-app-theme'

describe('mini app theme', () => {
  it('maps the light palette to Telegram.WebApp colour keys', () => {
    expect(miniAppThemeParams('light')).toEqual({
      bg_color: '#ffffff',
      secondary_bg_color: '#f5f5f5',
      header_bg_color: '#ffffff',
      bottom_bar_bg_color: '#f5f5f5',
      section_bg_color: '#f5f5f5',
      section_separator_color: '#f0f0f0',
      text_color: '#191919',
      accent_text_color: '#2481cc',
      section_header_text_color: '#191919',
      subtitle_text_color: '#999999',
      destructive_text_color: '#fa5152',
      hint_color: '#999999',
      link_color: '#2481cc',
      button_color: '#07c160',
      button_text_color: '#ffffff',
    })
  })

  it('maps the dark palette to every TDLib themeParameters field', () => {
    expect(miniAppTdlibTheme('dark')).toEqual({
      background_color: 0x1e1e1f,
      secondary_background_color: 0x2b2b2c,
      header_background_color: 0x1e1e1f,
      bottom_bar_background_color: 0x2b2b2c,
      section_background_color: 0x2b2b2c,
      section_separator_color: 0x272728,
      text_color: 0xe7e7e7,
      accent_text_color: 0x7cc4ff,
      section_header_text_color: 0xe7e7e7,
      subtitle_text_color: 0x9a9a9a,
      destructive_text_color: 0xff6b6b,
      hint_color: 0x9a9a9a,
      link_color: 0x7cc4ff,
      button_color: 0x2ea6ff,
      button_text_color: 0xffffff,
    })
  })
})
