/** Sets the browser tab title. No-op during SSR. Call from a page's `firstUpdated()` (WCAG 2.4.2). */
export function setDocumentTitle(title) {
  if (typeof document === 'undefined') return;
  document.title = title;
}
