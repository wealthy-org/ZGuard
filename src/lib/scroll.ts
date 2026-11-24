import type Lenis from 'lenis';

let lenis: Lenis | null = null;

export function registerLenis(instance: Lenis | null) {
  lenis = instance;
}

/** Smoothly scroll back to the top, through Lenis when it is running. */
export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { duration: 1.6 });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Jump to the top instantly and cancel any scroll inertia still in flight. */
export function jumpToTop() {
  lenis?.scrollTo(0, { immediate: true, force: true });
  window.scrollTo(0, 0);
}

/** Smoothly scroll to an element, routed through Lenis when available. */
export function scrollToEl(el: HTMLElement, offset = 96) {
  if (lenis) lenis.scrollTo(el, { offset: -offset, duration: 1.2 });
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
