// Phasen-Schalter der UI (Spec: Dunkelmodus und Admin-Scope im Consent erst nach bzw. ab Phase 2).
// Bewusst Konstanten, keine Server-Antwort: Ein Server, der `mcpwarden:admin` schon anbietet, schaltet die UI nicht frei.
export const FEATURES = {
  /** Consent: Schalter fuer `mcpwarden:admin` anzeigen und mitsenden. */
  consentAdminScope: false,
  /** Einstellungen: Darstellungswahl "System"/"Hell"/"Dunkel". */
  colorSchemeChoice: false,
} as const
