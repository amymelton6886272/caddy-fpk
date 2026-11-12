const DEFAULT_SITE = {
  id: "welcome",
  name: "欢迎页",
  type: "static",
  address: ":8080",
  upstream: "",
  root: "/srv",
  authUser: "",
  authPassword: "",
  authHash: "",
  allowedIps: [],
};

const begin = "# BEGIN CADDY FPK PANEL";
const end = "# END CADDY FPK PANEL";
const absolutePath = (value) => value.startsWith("/") || (process.platform === "win32" && /^[A-Za-z]:[\\/]/.test(value));

function quote(value) {
  if (!value || /[\s"{}]/.test(value)) return JSON.stringify(value);
  return value;
}

function normalizeSite(site) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(site.id)) throw new Error("站点 ID 格式无效");
  if (!["proxy", "static"].includes(site.type)) throw new Error("站点类型无效");
  if (!site.address || /[\s{}]/.test(site.address)) throw new Error("站点地址不能包含空格或花括号");
  if (site.address.includes("{") || site.address.includes("}")) throw new Error("站点地址不能包含花括号");
  if (site.type === "proxy") {
    if (!site.upstream || /[\s{}]/.test(site.upstream)) throw new Error("上游地址格式无效");
    if (!/^[a-zA-Z0-9.+_-]+:\d{1,5}$/.test(site.upstream)) throw new Error("上游地址应为主机名或 IP:端口，例如 host.docker.internal:3000");
    const port = Number(site.upstream.split(":").at(-1));
    if (port < 1 || port > 65535) throw new Error("上游端口无效");
  } else if (!absolutePath(site.root) || /[\s{}]/.test(site.root)) {
    throw new Error("静态目录必须是有效的容器内绝对路径");
  }
  const authUser = String(site.authUser || "").trim();
  if (authUser && (!/^[a-zA-Z0-9._@-]{1,64}$/.test(authUser) || !site.authHash)) throw new Error("请设置有效的站点用户名和密码");
  const allowedIps = Array.isArray(site.allowedIps) ? site.allowedIps.map((ip) => String(ip).trim()).filter(Boolean) : [];
  if (allowedIps.length > 100) throw new Error("白名单最多支持 100 个地址");
  for (const cidr of allowedIps) {
    const match = cidr.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/);
    if (match) {
      if (match[1].split(".").some((part) => Number(part) > 255) || Number(match[2] ?? 32) > 32) throw new Error(`无效的 IPv4 白名单：${cidr}`);
    } else {
      const ipv6 = cidr.match(/^([0-9a-fA-F:]+)(?:\/(\d{1,3}))?$/);
      if (!ipv6 || !ipv6[1].includes(":") || ipv6[1].split(":").length > 8 || ipv6[1].split("::").length > 2 || Number(ipv6[2] ?? 128) > 128) throw new Error(`无效的 IP/CIDR 白名单：${cidr}`);
    }
  }
  return {
    id: site.id,
    name: String(site.name || site.id).slice(0, 100),
    type: site.type,
    address: site.address,
    upstream: site.type === "proxy" ? site.upstream : "",
    root: site.type === "static" ? site.root : "/srv",
    authUser,
    authPassword: "",
    authHash: authUser ? site.authHash : "",
    allowedIps,
  };
}

export function globalOptions(httpPort = 8080, httpsPort = 8443, admin = "0.0.0.0:2019") {
  return `{
\tadmin ${admin} {
\t\torigins ${admin.startsWith("0.0.0.0:") ? `caddy:${admin.split(":").at(-1)}` : admin}
\t}
\thttp_port ${httpPort}
\thttps_port ${httpsPort}
}

${begin}`;
}

export function initialConfig(httpPort = 8080, httpsPort = 8443) {
  return `${globalOptions(httpPort, httpsPort)}\n${end}\n`;
}

export function renderSites(sites, httpPort = 8080, httpsPort = 8443, admin = "0.0.0.0:2019") {
  const ids = new Set();
  const addresses = new Set();
  const blocks = sites.map((raw) => {
    const site = normalizeSite(raw);
    if (ids.has(site.id)) throw new Error("站点 ID 不能重复");
    if (addresses.has(site.address)) throw new Error("站点地址不能重复");
    ids.add(site.id);
    addresses.add(site.address);
    const directives = site.type === "proxy"
      ? `\treverse_proxy ${site.upstream}`
      : `\troot * ${site.root}\n\tfile_server\n\tencode gzip`;
    const security = [];
    if (site.allowedIps.length) security.push(`\t@denied not remote_ip ${site.allowedIps.join(" ")}\n\trespond @denied "Forbidden" 403`);
    if (site.authUser) security.push(`\tbasic_auth {\n\t\t${site.authUser} ${site.authHash}\n\t}`);
    return `\n${quote(site.address)} {\n${security.length ? `${security.join("\n")}\n` : ""}${directives}\n}`;
  });
  return `${globalOptions(httpPort, httpsPort, admin)}\n${end}\n${blocks.join("\n")}\n`;
}

export function defaultSites() {
  return [DEFAULT_SITE];
}

export function isManaged(config) {
  return /^\{\r?\n/.test(config) && new RegExp(`${begin}\\r?\\n${end}`).test(config);
}

export function migrateLegacy(config) {
  if (isManaged(config)) return config;
  const match = config.match(/^\{\r?\n([\s\S]*?)^\}\r?\n?/m);
  if (!match || !/^\s*admin\s+0\.0\.0\.0:2019\s*\{/m.test(match[1])) return null;
  const sites = [];
  const block = /(^|\r?\n)([^\s{#][^\s{]*)\s*\{\r?\n([\s\S]*?)^\}/gm;
  for (const [, , address, body] of config.slice(match[0].length).matchAll(block)) {
    const proxy = body.match(/^\s*reverse_proxy\s+([^\s]+)\s*$/m)?.[1];
    const root = body.match(/^\s*root\s+\*\s+([^\s]+)\s*$/m)?.[1];
    if (!proxy && !root) return null;
    if (/^\s*(handle|route|redir|respond|basic_auth|@)/m.test(body)) return null;
    sites.push({ id: `site-${sites.length + 1}`, name: address, type: proxy ? "proxy" : "static", address, upstream: proxy || "", root: root || "/srv", authUser: "", authPassword: "", authHash: "", allowedIps: [] });
  }
  if (!sites.length) return null;
  return { config: renderSites(sites), sites };
}

