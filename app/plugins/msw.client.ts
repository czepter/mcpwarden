// MSW 3 in Nuxt (spike, task 4): `msw init <dir> --no-save` produces mockServiceWorker.js (also applies to v3);
// setupWorker from 'msw/browser', start({ onUnhandledFrame: 'bypass' }). msw/vite was not needed.
// The worker lives in .mocks-public (gitignored) and is served as a public asset only for mock builds.
export default defineNuxtPlugin(async () => {
  // __API_MOCK__ is a compile-time constant: in the production build the branch is dropped together with the import.
  if (__API_MOCK__) {
    const { startMock } = await import('../../mocks/browser')
    await startMock(__API_MOCK__)
    return
  }
  // Real build: remove a mock worker registered earlier (same origin).
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      const url = (reg.active ?? reg.waiting ?? reg.installing)?.scriptURL ?? ''
      if (url.endsWith('/mockServiceWorker.js')) await reg.unregister()
    }
  }
})
