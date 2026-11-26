export type MiniAppTheme = 'light' | 'dark'

interface MiniAppPalette {
  background: string
  secondaryBackground: string
  separator: string
  text: string
  hint: string
  link: string
  destructive: string
  button: string
  buttonText: string
}

/** The colours both the SDK events and TDLib's signed launch parameters use. */
const PALETTES: Record<MiniAppTheme, MiniAppPalette> = {
  light: {
    background: '#ffffff',
    secondaryBackground: '#f5f5f5',
    separator: '#f0f0f0',
    text: '#191919',
    hint: '#999999',
    link: '#2481cc',
    destructive: '#fa5152',
    button: '#07c160',
    buttonText: '#ffffff',
  },
  dark: {
    background: '#1e1e1f',
    secondaryBackground: '#2b2b2c',
    separator: '#272728',
    text: '#e7e7e7',
    hint: '#9a9a9a',
    link: '#7cc4ff',
    destructive: '#ff6b6b',
    button: '#2ea6ff',
    buttonText: '#ffffff',
  },
}

/** Telegram.WebApp theme keys, sent when the page asks or the app theme changes. */
export function miniAppThemeParams(theme: MiniAppTheme): Record<string, string> {
  const palette = PALETTES[theme]
  return {
    bg_color: palette.background,
    secondary_bg_color: palette.secondaryBackground,
    header_bg_color: palette.background,
    bottom_bar_bg_color: palette.secondaryBackground,
    section_bg_color: palette.secondaryBackground,
    section_separator_color: palette.separator,
    text_color: palette.text,
    accent_text_color: palette.link,
    section_header_text_color: palette.text,
    subtitle_text_color: palette.hint,
    destructive_text_color: palette.destructive,
    hint_color: palette.hint,
    link_color: palette.link,
    button_color: palette.button,
    button_text_color: palette.buttonText,
  }
}

/** TDLib's `themeParameters` body; the adapter adds the `_` discriminator. */
export function miniAppTdlibTheme(theme: MiniAppTheme) {
  const palette = PALETTES[theme]
  return {
    background_color: rgb(palette.background),
    secondary_background_color: rgb(palette.secondaryBackground),
    header_background_color: rgb(palette.background),
    bottom_bar_background_color: rgb(palette.secondaryBackground),
    section_background_color: rgb(palette.secondaryBackground),
    section_separator_color: rgb(palette.separator),
    text_color: rgb(palette.text),
    accent_text_color: rgb(palette.link),
    section_header_text_color: rgb(palette.text),
    subtitle_text_color: rgb(palette.hint),
    destructive_text_color: rgb(palette.destructive),
    hint_color: rgb(palette.hint),
    link_color: rgb(palette.link),
    button_color: rgb(palette.button),
    button_text_color: rgb(palette.buttonText),
  }
}

function rgb(hex: string): number {
  return Number.parseInt(hex.slice(1), 16)
}
