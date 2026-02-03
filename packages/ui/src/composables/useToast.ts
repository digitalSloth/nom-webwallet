import { toast } from 'vue-sonner'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastOptions {
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function useToast() {
  const show = (message: string, type: ToastType = 'success', options?: ToastOptions) => {
    switch (type) {
      case 'success':
        toast.success(message, options)
        break
      case 'error':
        toast.error(message, options)
        break
      case 'info':
        toast.info(message, options)
        break
      case 'warning':
        toast.warning(message, options)
        break
      default:
        toast(message, options)
    }
  }

  return {
    show,
    toast, // Export the raw toast function for advanced usage
  }
}
