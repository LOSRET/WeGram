import { ProxyForm } from '../proxy/ProxyForm'
import { SettingsGroup } from './SettingsGroup'

interface NetworkPanelProps {
  onError: (message: string) => void
}

/**
 * 网络与代理: the client's own proxy form, inline in the settings window
 * (design doc §6.4 / §9.11.3). It is the same component the login window shows as
 * a modal, so there is one implementation of "write TDLib's proxy".
 */
export function NetworkPanel({ onError }: NetworkPanelProps) {
  return (
    <SettingsGroup title="代理">
      <ProxyForm onError={onError} />
    </SettingsGroup>
  )
}
