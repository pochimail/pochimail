/**
 * Two libraries (Sonner for toasts, react-style-singleton for the scroll lock of a Dialog or Sheet) add their CSS at
 * runtime as `<style>` elements. The production CSP is `style-src 'self'` (csp.ts), which blocks those, so the styles
 * never applied. A constructable stylesheet is not inline style, so the CSP leaves it alone: these rewrites make both
 * libraries adopt their CSS that way, and `style-src` stays strict. A library change that moves the code we rewrite
 * fails the build instead of silently shipping unstyled toasts.
 */
const SONNER = /\/sonner\/dist\/index\.mjs$/;
const STYLE_SINGLETON = /\/react-style-singleton\/dist\/es2015\/singleton\.js$/;

const SONNER_INSERT = /function __insertCSS\(code\) \{[\s\S]*?\n\}/;

const ADOPT = `function adoptCss(code) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(code);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return sheet;
}`;

const SINGLETON = `${ADOPT}
export var stylesheetSingleton = function () {
  var counter = 0;
  var sheet = null;
  return {
    add: function (style) {
      if (counter == 0) sheet = adoptCss(style);
      counter++;
    },
    remove: function () {
      counter--;
      if (!counter && sheet) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (s) { return s !== sheet; });
        sheet = null;
      }
    },
  };
};
`;

const rewrite = (id: string, code: string): string | null => {
  if (SONNER.test(id)) {
    if (!SONNER_INSERT.test(code)) throw new Error(`csp-safe-styles: no __insertCSS in ${id}`);
    return code.replace(
      SONNER_INSERT,
      `${ADOPT}\nfunction __insertCSS(code) {\n  if (code && typeof document != 'undefined') adoptCss(code);\n}`,
    );
  }
  if (STYLE_SINGLETON.test(id)) {
    if (
      !code.includes("export var stylesheetSingleton") ||
      !code.includes("createElement('style')")
    )
      throw new Error(`csp-safe-styles: stylesheetSingleton moved in ${id}`);
    return SINGLETON;
  }
  return null;
};

/** The module's code with its runtime `<style>` injection replaced, or `null` when the module is not one of the two. */
export const adoptRuntimeStyles = (id: string, code: string): string | null =>
  rewrite(id.replaceAll("\\", "/").split("?")[0] ?? id, code);
