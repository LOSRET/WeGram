import type { ReactNode } from 'react'

export interface SettingsSection {
  key: string
  label: string
}

const iconProps = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/**
 * Hand-drawn 16 px glyphs for the nav. Proportion matches the rail's own icons
 * (16 px box, 1.4 px stroke) rather than borrowing a tabler set.
 */
const ICONS: Record<string, ReactNode> = {
  account: (
    <svg {...iconProps}>
      <circle cx="8" cy="5.4" r="2.7" />
      <path d="M2.9 13.8c.5-2.8 2.6-4.3 5.1-4.3s4.6 1.5 5.1 4.3" />
    </svg>
  ),
  general: (
    <svg {...iconProps}>
      <path d="M2 4.6h12M2 11.4h12" />
      <circle cx="6" cy="4.6" r="1.5" />
      <circle cx="10.5" cy="11.4" r="1.5" />
    </svg>
  ),
  network: (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M2.1 8h11.8" />
      <path d="M8 2.1c1.7 1.7 2.5 3.8 2.5 5.9s-.8 4.2-2.5 5.9c-1.7-1.7-2.5-3.8-2.5-5.9S6.3 3.8 8 2.1z" />
    </svg>
  ),
  about: (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M8 7.2v4.1" />
      <path d="M8 5.1h.01" />
    </svg>
  ),
}

interface SettingsNavProps {
  sections: readonly SettingsSection[]
  active: string
  onSelect: (key: string) => void
}

/**
 * The 160 px left column: one 40 px row per group, the selected one filled with
 * the row-active green and drawn in white (design doc §9.11.2).
 */
export function SettingsNav({ sections, active, onSelect }: SettingsNavProps) {
  return (
    <nav className="wx-set-nav" aria-label="设置分组">
      {sections.map((section) => (
        <button
          key={section.key}
          type="button"
          className={`wx-set-nav__item${section.key === active ? ' is-active' : ''}`}
          aria-current={section.key === active ? 'page' : undefined}
          onClick={() => onSelect(section.key)}
        >
          <span className="wx-set-nav__icon">{ICONS[section.key] ?? ICONS['general']}</span>
          <span className="wx-set-nav__label">{section.label}</span>
        </button>
      ))}
    </nav>
  )
}
