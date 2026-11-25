import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The one place the site is served from; relative links must resolve under it (and under any other base, as they stay relative). */
const BASE_PATH = "/pochimail/";
const ORIGIN = "https://example.test";
/** Plain links (not resources) may leave the site for these hosts only. */
const LINK_HOSTS = new Set(["github.com", "developers.google.com", "myaccount.google.com"]);

export const LIMITED_USE =
  "Pochimail's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const attributes = (html: string, tag: string, attribute: string): string[] =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?\\s${attribute}\\s*=\\s*"([^"]*)"`, "gi"))].map(
    (match) => match[1] ?? "",
  );

const srcsetUrls = (html: string): string[] =>
  [...html.matchAll(/\ssrcset\s*=\s*"([^"]*)"/gi)].flatMap((match) =>
    (match[1] ?? "").split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? ""),
  );

const cssUrls = (css: string): string[] => [
  ...[...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1] ?? ""),
  ...[...css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)].map((m) => m[1] ?? ""),
];

const isExternal = (reference: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference);

/** The file a served path maps to: a trailing slash or a folder means its index.html. */
const fileFor = (dist: string, pathname: string): string => {
  const relative = decodeURIComponent(pathname.slice(BASE_PATH.length));
  const candidate = join(dist, relative);
  if (relative === "" || relative.endsWith("/")) return join(candidate, "index.html");
  return existsSync(candidate) && statSync(candidate).isDirectory()
    ? join(candidate, "index.html")
    : candidate;
};

const localProblem = (dist: string, page: string, reference: string): string | undefined => {
  if (reference.startsWith("#") || reference === "") return undefined;
  if (reference.startsWith("/"))
    return `${page}: "${reference}" starts with "/" and escapes ${BASE_PATH}`;
  const served = new URL(reference, `${ORIGIN}${BASE_PATH}${page}`);
  if (!served.pathname.startsWith(BASE_PATH)) return `${page}: "${reference}" leaves ${BASE_PATH}`;
  return existsSync(fileFor(dist, served.pathname))
    ? undefined
    : `${page}: "${reference}" does not exist in the built site`;
};

const resourceProblems = (dist: string, page: string, references: string[]): string[] =>
  references.flatMap((reference) => {
    if (isExternal(reference)) return [`${page}: external resource "${reference}"`];
    return localProblem(dist, page, reference) ?? [];
  });

const linkProblems = (dist: string, page: string, hrefs: string[]): string[] =>
  hrefs.flatMap((href) => {
    if (href.startsWith("mailto:")) return [];
    if (!isExternal(href)) return localProblem(dist, page, href) ?? [];
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return [`${page}: invalid link "${href}"`];
    }
    return url.protocol === "https:" && LINK_HOSTS.has(url.hostname)
      ? []
      : [`${page}: link to a host the site does not allow: "${href}"`];
  });

const policyProblems = (policy: string, contactEmail: string): string[] => {
  const text = policy.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  const problems: string[] = [];
  if (!text.includes(LIMITED_USE))
    problems.push("privacy: the Limited Use sentence is missing or changed");
  for (const scope of ["gmail.readonly", "gmail.modify", "gmail.send"])
    if (!text.includes(scope)) problems.push(`privacy: scope ${scope} is not listed`);
  if (/mail\.google\.com/.test(text))
    problems.push("privacy: lists a scope the app never requests");
  if (!policy.includes(`mailto:${contactEmail}`))
    problems.push("privacy: the contact address is missing");
  if (!/Last updated:\s*<time datetime="\d{4}-\d{2}-\d{2}"/.test(policy))
    problems.push("privacy: no last-updated date");
  if (!/\/commits\/[^"]*privacy/.test(policy))
    problems.push("privacy: no link to the policy history");
  return problems;
};

const pageProblems = (dist: string, page: string): string[] => {
  const html = readFileSync(join(dist, page), "utf8");
  // Resolve relative to the page's own folder: `privacy/index.html` is served at `privacy/`.
  const from = page.endsWith("index.html") ? page.slice(0, -"index.html".length) : page;
  return [
    ...(/\{\{\w+\}\}/.test(html) ? [`${page}: unfilled placeholder`] : []),
    ...resourceProblems(dist, from, [
      ...attributes(html, "script", "src"),
      ...attributes(html, "link", "href"),
      ...attributes(html, "img", "src"),
      ...attributes(html, "source", "src"),
      ...attributes(html, "iframe", "src"),
      ...srcsetUrls(html),
    ]),
    ...linkProblems(dist, from, attributes(html, "a", "href")),
  ];
};

/** The sources must not hold a copy of the app's theme: no fonts or images, no color literals, no inline styles. */
const sourceProblems = (src: string): string[] =>
  walk(src).flatMap((file) => {
    const name = file.slice(src.length + 1);
    if (/\.(woff2?|ttf|otf|png|jpe?g|svg)$/i.test(name))
      return [`src/${name}: a copied asset belongs in packages/ui`];
    const text = readFileSync(file, "utf8");
    if (name.endsWith(".css") && /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(text))
      return [`src/${name}: a color literal; use the app's tokens`];
    if (name.endsWith(".html") && /\sstyle\s*=/i.test(text))
      return [`src/${name}: an inline style; use the stylesheet and the app's tokens`];
    return [];
  });

/** Everything wrong with a built site; an empty list means it can be deployed. */
export const checkSite = (root: string, dist: string = join(root, "site", "dist")): string[] => {
  const siteDir = join(root, "site");
  const config = JSON.parse(readFileSync(join(siteDir, "site.config.json"), "utf8")) as {
    contactEmail: string;
  };
  const files = walk(dist).map((file) =>
    file
      .slice(dist.length + 1)
      .split("\\")
      .join("/"),
  );
  const policyFile = join(dist, "privacy", "index.html");
  return [
    ...files.filter((file) => file.endsWith(".html")).flatMap((page) => pageProblems(dist, page)),
    ...files
      .filter((file) => file.endsWith(".css"))
      .flatMap((file) =>
        resourceProblems(dist, file, cssUrls(readFileSync(join(dist, file), "utf8"))),
      ),
    ...(existsSync(policyFile)
      ? policyProblems(readFileSync(policyFile, "utf8"), config.contactEmail)
      : ["privacy/index.html is missing"]),
    ...(existsSync(join(dist, "index.html")) ? [] : ["index.html is missing"]),
    ...sourceProblems(join(siteDir, "src")),
  ];
};

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "..");
  const problems = checkSite(root);
  for (const problem of problems) console.error(`FAIL ${problem}`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write("site: ok\n");
}
