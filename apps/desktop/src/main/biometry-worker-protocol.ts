export interface BiometryWorkerRequest {
  id: number
  kind: 'availability' | 'verify'
  message?: string
  windowHandle?: number[]
}

export interface BiometryWorkerResponse {
  id: number
  available?: boolean
  verified?: boolean
  error?: string
}
