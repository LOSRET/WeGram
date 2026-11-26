import '@renderer/styles/index.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@renderer/App'
import { MediaViewer } from '@renderer/components/viewer/MediaViewer'
import { installPreviewBridge } from '@renderer/lib/preview-bridge'
import { queryClient } from '@renderer/lib/query'
import { LoginWindow } from '@renderer/screens/LoginWindow'
import { InstantViewWindow } from '@renderer/screens/InstantViewWindow'
import { MiniAppMenu } from '@renderer/screens/MiniAppMenu'
import { MiniAppWindow } from '@renderer/screens/MiniAppWindow'
import { QrWindow } from '@renderer/screens/QrWindow'
import { ReportWindow } from '@renderer/screens/ReportWindow'
import { SettingsWindow } from '@renderer/screens/SettingsWindow'

// Browser preview (pnpm web): no preload script exists, so install a mock bridge.
installPreviewBridge()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// The side windows share this bundle through the hash: `#viewer` is the 图片和视频
// window (only `viewer:init`), `#login` is the standalone login window (only the
// auth flow), and `#qr` is 群二维码 (only `qr:info`). None may boot the chat shell,
// and the shell itself must not render a login form inside the main window.
const route = window.location.hash

// The Mini App's ⋯ card is one transparent `WebContentsView` over the guest page
// (design doc §9.4.1): only the card may paint, so the page has no backdrop.
if (route.startsWith('#miniappmenu')) document.documentElement.dataset['backdrop'] = 'clear'

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {route.startsWith('#viewer') ? (
        <MediaViewer />
      ) : route.startsWith('#login') ? (
        <LoginWindow />
      ) : route.startsWith('#qr') ? (
        <QrWindow />
      ) : route.startsWith('#report') ? (
        <ReportWindow />
      ) : route.startsWith('#instantview') ? (
        <InstantViewWindow />
      ) : route.startsWith('#settings') ? (
        <SettingsWindow />
      ) : route.startsWith('#miniappmenu') ? (
        <MiniAppMenu />
      ) : route.startsWith('#miniapp') ? (
        <MiniAppWindow />
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
)
