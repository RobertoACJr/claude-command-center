/// <reference types="vite/client" />
import type { CommandCenterApi } from '../../shared/types'

declare global {
  interface Window {
    api: CommandCenterApi
  }
}

export {}
