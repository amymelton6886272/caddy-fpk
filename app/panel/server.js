import { readFile } from "node:fs/promises";
import { createPanel } from "./lib/server.js";
import { dataPaths } from "./lib/store.js";

const root = process.env.CADDY_DATA_ROOT || "/mnt/caddy";
const paths = dataPaths(root);
const passwordHash = (await readFile(paths.password, "utf8")).trim();
const sessionSecret = (await readFile(paths.secret, "utf8")).trim();
const port = Number(process.env.PANEL_PORT || 8080);

createPanel({ root, passwordHash, sessionSecret }).listen(port, "0.0.0.0", () => {
  console.log(`Caddy FPK panel listening on ${port}`);
});
