// jsdom has no ResizeObserver, and Radix form controls (checkbox, switch, radio) construct one as soon as they mount.
// Which screen mounts before a test ends depends on timing, so every test gets the same inert one.
class InertResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= InertResizeObserver;
