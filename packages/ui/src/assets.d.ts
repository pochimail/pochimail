declare module "*.png" {
  const url: string;
  export default url;
}

/** Vite `?inline`: the file as a data URI. */
declare module "*.png?inline" {
  const dataUri: string;
  export default dataUri;
}
