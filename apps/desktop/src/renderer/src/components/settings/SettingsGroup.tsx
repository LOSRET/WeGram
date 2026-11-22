import type { ReactNode } from 'react'

/**
 * A titled block of rows. The title sits above a hairline, exactly like the
 * client's 账号 / 存储 / 功能 headings (design doc §9.11.2).
 */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wx-set-group">
      <h2 className="wx-set-group__title">{title}</h2>
      <div className="wx-set-group__rows">{children}</div>
    </section>
  )
}
