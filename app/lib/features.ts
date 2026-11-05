// Phase switches of the UI (spec: dark mode and admin scope in the consent only after or from phase 2).
// Deliberately constants, not a server response: a server that already offers `mcpwarden:admin` does not unlock the UI.
export const FEATURES = {
  /** Consent: show the switch for `mcpwarden:admin` and send it along. */
  consentAdminScope: false,
  /**
   * Pages for which the phase 1 backend has no routes (statistics, auth links, stdio approval). On only in the mock build;
   * the value comes from the compile-time constant of the mock build and is false in the production build.
   */
  phase2: Boolean(__API_MOCK__),
  /** Settings: appearance choice "System"/"Hell"/"Dunkel". */
  colorSchemeChoice: false,
} as const
