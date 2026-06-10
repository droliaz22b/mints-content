/// <reference types="vite/client" />
import PocketBase from 'pocketbase'

const url = import.meta.env.VITE_POCKETBASE_URL as string | undefined
if (!url) {
  console.warn('VITE_POCKETBASE_URL is not set. Falling back to http://127.0.0.1:8090')
}

export const pb = new PocketBase(url || 'http://127.0.0.1:8090')
pb.autoCancellation(false)
