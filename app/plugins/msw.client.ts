// MSW 3 in Nuxt (Spike, Aufgabe 4): `msw init public --no-save` erzeugt public/mockServiceWorker.js (Befehl gilt auch fuer v3);
// setupWorker aus 'msw/browser', start({ onUnhandledFrame: 'bypass' }). Das Vite-Plugin msw/vite wurde nicht benoetigt.
// Der dynamische Import hinter der Build-Konstante wird im Produktions-Build entfernt (Test: rg mockServiceWorker .output).
export default defineNuxtPlugin(async () => {
  const spec = import.meta.env.VITE_API_MOCK as string | undefined
  if (!spec) return
  const { startMock } = await import('../../mocks/browser')
  await startMock(spec)
})
