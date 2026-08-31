/**
 * The one rendering mode flag every panel in the product shares.
 *
 * `compact` is a real monitor at real viewing distance — a handful of rows, no
 * query chrome, nothing that assumes a pointer. `full` is the response console.
 * The redesign's §5 requires both to be the *same* component reading the *same*
 * selectors, so this type lives on its own rather than inside whichever panel
 * happened to declare it first.
 */
export type PanelMode = 'compact' | 'full';
