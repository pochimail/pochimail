/** True in the macOS desktop shell, where the window uses an inset title bar with traffic lights. */
export const isMacDesktop = (): boolean => /Macintosh/.test(navigator.userAgent);
