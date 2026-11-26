import type { MiniAppButton, MiniAppControls } from '@wegram/protocol'

/** One native bottom-button row; two stacked rows are exactly twice this. */
export const MINI_APP_ACTION_ROW_H = 56

export function defaultMiniAppControls(): MiniAppControls {
  return withActionBarHeight({
    main: {
      text: 'Continue',
      color: null,
      textColor: null,
      isVisible: false,
      isActive: true,
      isProgressVisible: false,
      hasShineEffect: false,
      position: 'left',
    },
    secondary: {
      text: 'Cancel',
      color: null,
      textColor: null,
      isVisible: false,
      isActive: true,
      isProgressVisible: false,
      hasShineEffect: false,
      position: 'left',
    },
    backVisible: false,
    settingsVisible: false,
    bottomBarColor: null,
    actionBarHeight: 0,
  })
}

/** `web_app_setup_main_button` / `web_app_setup_secondary_button` patch. */
export function applyBottomButtonPatch(
  current: MiniAppButton,
  raw: Record<string, unknown>,
): MiniAppButton {
  let text = current.text
  if (typeof raw['text'] === 'string') text = raw['text'].trim().slice(0, 64)

  let isVisible = current.isVisible
  if (typeof raw['is_visible'] === 'boolean') isVisible = raw['is_visible']
  // Telegram Desktop hides a bottom button whose text is empty. We do not
  // render icon-only custom-emoji buttons yet, so an empty label cannot stay up.
  if (text.length === 0) isVisible = false

  return {
    text,
    color: buttonColor(raw['color'], current.color),
    textColor: buttonColor(raw['text_color'], current.textColor),
    isVisible,
    isActive: typeof raw['is_active'] === 'boolean' ? raw['is_active'] : current.isActive,
    isProgressVisible:
      typeof raw['is_progress_visible'] === 'boolean'
        ? raw['is_progress_visible']
        : current.isProgressVisible,
    hasShineEffect:
      typeof raw['has_shine_effect'] === 'boolean'
        ? raw['has_shine_effect']
        : current.hasShineEffect,
    position: buttonPosition(raw['position'], current.position),
  }
}

/** `web_app_setup_back_button` / `web_app_setup_settings_button` patch. */
export function applyVisibilityPatch(current: boolean, raw: Record<string, unknown>): boolean {
  return typeof raw['is_visible'] === 'boolean' ? raw['is_visible'] : current
}

export function applyBottomBarColor(
  raw: Record<string, unknown>,
  current: string | null,
): string | null {
  return buttonColor(raw['color'], current)
}

/** Main owns the exact pixel height the host renderer must reserve below the guest. */
export function withActionBarHeight(controls: MiniAppControls): MiniAppControls {
  const main = controls.main.isVisible
  const secondary = controls.secondary.isVisible
  let actionBarHeight = 0
  if (main || secondary) actionBarHeight = MINI_APP_ACTION_ROW_H
  if (
    main &&
    secondary &&
    controls.secondary.position !== 'left' &&
    controls.secondary.position !== 'right'
  ) {
    actionBarHeight = MINI_APP_ACTION_ROW_H * 2
  }
  return { ...controls, actionBarHeight }
}

function buttonColor(value: unknown, current: string | null): string | null {
  if (typeof value !== 'string') return current
  const color = value.trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : current
}

function buttonPosition(
  value: unknown,
  current: MiniAppButton['position'],
): MiniAppButton['position'] {
  return value === 'left' || value === 'right' || value === 'top' || value === 'bottom'
    ? value
    : current
}
