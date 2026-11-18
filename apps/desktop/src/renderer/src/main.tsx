import '@renderer/styles/index.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@renderer/App'
import { MediaViewer } from '@renderer/components/viewer/MediaViewer'
import { installPreviewBridge } from '@renderer/lib/preview-bridge'
import { queryClient } from '@renderer/lib/query'
import { LoginWindow } from '@renderer/screens/LoginWindow'

// Browser preview (pnpm web): no preload script exists, so install a mock bridge.
installPreviewBridge()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// Two of the app's three windows share this bundle through the hash:
// `#viewer` is the 图片和视频 window (only `viewer:init`), and `#login` is the
// standalone login window (only the auth flow). Neither may boot the chat
// shell, and the shell itself must not render a login form inside the main
// window any more.
const route = window.location.hash

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {route.startsWith('#viewer') ? (
        <MediaViewer />
      ) : route.startsWith('#login') ? (
        <LoginWindow />
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
)
