// Phasen-Schalter der UI (Spec: Dunkelmodus und Admin-Scope im Consent erst nach bzw. ab Phase 2).
// Bewusst Konstanten, keine Server-Antwort: Ein Server, der `mcpwarden:admin` schon anbietet, schaltet die UI nicht frei.
export const FEATURES = {
  /** Consent: Schalter fuer `mcpwarden:admin` anzeigen und mitsenden. */
  consentAdminScope: false,
  /**
   * Seiten, zu denen es im Phase-1-Backend keine Routen gibt (Statistik, Auth-Links, stdio-Freigabe). Nur im Mock-Build an;
   * Der Wert kommt aus der Kompilier-Konstante des Mock-Builds und ist im Produktions-Build false.
   */
  phase2: Boolean(__API_MOCK__),
  /** Einstellungen: Darstellungswahl "System"/"Hell"/"Dunkel". */
  colorSchemeChoice: false,
} as const
