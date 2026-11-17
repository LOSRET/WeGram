import '@renderer/styles/index.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@renderer/App'
import { MediaViewer } from '@renderer/components/viewer/MediaViewer'
import { installPreviewBridge } from '@renderer/lib/preview-bridge'
import { queryClient } from '@renderer/lib/query'

// Browser preview (pnpm web): no preload script exists, so install a mock bridge.
installPreviewBridge()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

// The 图片和视频 window is its own window: main loads this same bundle with
// `#viewer`, and it must not boot the chat shell (no adapter events, no store
// hydration — only `viewer:init`).
const isViewer = window.location.hash.startsWith('#viewer')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isViewer ? <MediaViewer /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
)
