import { AppError } from '@wegram/protocol'
import { app } from 'electron'

/**
 * 开机自启 (设置 → 通用, design doc §9.11.3).
 *
 * The operating system owns the entry — it lives in the login items, so there is
 * no copy in `ui.db` to drift from it; `settings:get` reads it back every time.
 *
 * Only a packaged build may write it. In development `process.execPath` is the
 * Electron binary under `node_modules`, and registering that would add a startup
 * item that opens no app (or a stale `out/` build) — worse than no switch, because
 * a broken startup entry looks exactly like a broken release. The panel asks
 * {@link canLaunchAtLogin} and disables the row instead.
 */
export function canLaunchAtLogin(): boolean {
  return app.isPackaged
}

export function getLaunchAtLogin(): boolean {
  return canLaunchAtLogin() && app.getLoginItemSettings().openAtLogin
}

export function setLaunchAtLogin(enabled: boolean): void {
  if (!canLaunchAtLogin()) {
    throw new AppError('forbidden', '开机自启只在安装版可用')
  }
  // Electron's default `path` is the app's own executable, which is the entry a
  // packaged build wants; passing anything here would point at this run's exe.
  app.setLoginItemSettings({ openAtLogin: enabled })
}
