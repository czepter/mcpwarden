// MSW 3 in Nuxt (Spike, Aufgabe 4): `msw init <dir> --no-save` erzeugt mockServiceWorker.js (gilt auch fuer v3);
// setupWorker aus 'msw/browser', start({ onUnhandledFrame: 'bypass' }). msw/vite wurde nicht benoetigt.
// Der Worker liegt in .mocks-public (gitignoriert) und wird nur bei Mock-Builds als Public Asset ausgeliefert.
export default defineNuxtPlugin(async () => {
  // __API_MOCK__ ist Kompilier-Konstante: im Produktions-Build faellt der Zweig samt Import weg.
  if (__API_MOCK__) {
    const { startMock } = await import('../../mocks/browser')
    await startMock(__API_MOCK__)
    return
  }
  // Echt-Build: einen frueher registrierten Mock-Worker (gleicher Origin) entfernen.
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      const url = (reg.active ?? reg.waiting ?? reg.installing)?.scriptURL ?? ''
      if (url.endsWith('/mockServiceWorker.js')) await reg.unregister()
    }
  }
})
