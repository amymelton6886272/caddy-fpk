import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export async function hashSitePassword(password, binary = "caddy") {
  const { stdout } = await execute(binary, ["hash-password", "--plaintext", password], { windowsHide: true, encoding: "utf8", timeout: 30_000 });
  const hash = stdout.trim();
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) throw new Error("Caddy 未能生成有效的密码哈希。");
  return hash;
}
