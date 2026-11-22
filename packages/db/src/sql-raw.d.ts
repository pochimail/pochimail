/** Vite inlines `?raw` imports, so migration SQL travels inside the built worker (no runtime file lookup). */
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
