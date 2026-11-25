/** True in the macOS desktop shell, where the window uses an inset title bar with traffic lights. */
// Renderer-only hint; main decides the title bar from process.platform.
export const isMacDesktop = (): boolean => /Macintosh/.test(navigator.userAgent);
