import { describe, expect, it } from 'vitest'

import {
  applyBottomBarColor,
  applyBottomButtonPatch,
  applyVisibilityPatch,
  defaultMiniAppControls,
  withActionBarHeight,
} from './mini-app-controls'

describe('mini app native controls', () => {
  it('starts hidden and applies setup events as partial updates', () => {
    const initial = defaultMiniAppControls()
    expect(initial.main.isVisible).toBe(false)
    expect(initial.secondary.isVisible).toBe(false)
    expect(initial.actionBarHeight).toBe(0)

    const shown = applyBottomButtonPatch(initial.main, {
      text: '  Save  ',
      is_visible: true,
      color: '#07C160',
    })
    const disabled = applyBottomButtonPatch(shown, { is_active: false })

    expect(disabled).toMatchObject({
      text: 'Save',
      color: '#07c160',
      isVisible: true,
      isActive: false,
      isProgressVisible: false,
    })
  })

  it('hides empty text and refuses malformed colours and positions', () => {
    const initial = defaultMiniAppControls().main
    const empty = applyBottomButtonPatch(initial, { text: '   ', is_visible: true })
    expect(empty.isVisible).toBe(false)

    const invalid = applyBottomButtonPatch(initial, {
      color: 'red; background: url(https://example.test)',
      position: 'diagonal',
    })
    expect(invalid.color).toBeNull()
    expect(invalid.position).toBe('left')
  })

  it('reserves one row for side-by-side buttons and two for stacked buttons', () => {
    const controls = defaultMiniAppControls()
    const main = { ...controls.main, isVisible: true }
    const secondary = { ...controls.secondary, isVisible: true }

    expect(withActionBarHeight({ ...controls, main, secondary }).actionBarHeight).toBe(56)
    expect(
      withActionBarHeight({
        ...controls,
        main,
        secondary: { ...secondary, position: 'top' },
      }).actionBarHeight,
    ).toBe(112)
    expect(
      withActionBarHeight({
        ...controls,
        main,
        secondary: { ...secondary, position: 'bottom' },
      }).actionBarHeight,
    ).toBe(112)
  })

  it('accepts only solid six-digit bottom-bar colours', () => {
    expect(applyBottomBarColor({ color: '#A1B2C3' }, null)).toBe('#a1b2c3')
    expect(applyBottomBarColor({ color: 'transparent' }, '#112233')).toBe('#112233')
  })

  it('keeps back/settings visibility when a patch omits it', () => {
    expect(applyVisibilityPatch(false, {})).toBe(false)
    expect(applyVisibilityPatch(false, { is_visible: true })).toBe(true)
    expect(applyVisibilityPatch(true, { is_visible: false })).toBe(false)
  })
})
