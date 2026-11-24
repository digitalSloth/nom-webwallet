// Bottom-sheet classes for the web dialogs. Every token carries the
// phone: or desktop: variant, so neither layout picks up the other's
// styles.

/**
 * nom-ui DialogContent: a centred 480 px modal on desktop, a bottom
 * sheet on phones.
 */
export const SHEET_DIALOG =
  'desktop:max-w-[480px] phone:top-auto phone:bottom-0 phone:left-0 phone:right-0 ' +
  'phone:w-full phone:max-w-none phone:translate-x-0 phone:translate-y-0 ' +
  'phone:max-h-[92dvh] phone:rounded-t-xl phone:rounded-b-none phone:border-x-0 ' +
  'phone:border-b-0 phone:pb-[calc(1.5rem+env(safe-area-inset-bottom))] ' +
  'phone:pl-[max(1.5rem,env(safe-area-inset-left))] ' +
  'phone:pr-[max(1.5rem,env(safe-area-inset-right))] ' +
  'phone:data-[state=open]:slide-in-from-bottom phone:data-[state=closed]:slide-out-to-bottom'

/** A footer pair in a sheet shares the row; a lone button spans it. */
export const SHEET_FOOTER = 'phone:flex-row phone:flex-wrap phone:*:flex-1'

/** Backdrop of the PoW and interrupted-send overlays. */
export const SHEET_BACKDROP = 'phone:items-end phone:p-0'

/** Card of the PoW and interrupted-send overlays. */
export const SHEET_CARD =
  'phone:max-w-none phone:max-h-[92dvh] phone:overflow-y-auto phone:rounded-t-xl ' +
  'phone:rounded-b-none phone:border-x-0 phone:border-b-0 phone:pt-6 ' +
  'phone:pb-[calc(1.5rem+env(safe-area-inset-bottom))] ' +
  'phone:pl-[max(1.5rem,env(safe-area-inset-left))] ' +
  'phone:pr-[max(1.5rem,env(safe-area-inset-right))]'
