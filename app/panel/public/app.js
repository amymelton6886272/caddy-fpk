const state = { csrf: "", config: "", sites: [], managed: true, revision: "", view: "overview" };
const titles = { overview: "总览", sites: "站点管理", config: "Caddyfile", certificates: "证书", logs: "日志", backups: "配置历史" };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function notify(message, error = false) { const element = $("#notice"); element.textContent = message; element.className = `notice${error ? " error" : ""}`; clearTimeout(notify.timer); notify.timer = setTimeout(() => element.classList.add("hidden"), 7000); }
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.method && options.method !== "GET" ? { "X-CSRF-Token": state.csrf } : {}), ...options.headers } });
  const data = await response.json();
  if (response.status === 401 && path !== "/api/login") { showLogin(); throw new Error("登录已过期，请重新登录。"); }
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}
function busy(button, pending) { button.disabled = pending; if (pending) button.dataset.label = button.textContent, button.textContent = "处理中…"; else if (button.dataset.label) button.textContent = button.dataset.label; }
function showLogin() { $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); $("#login-password").value = ""; $("#login-password").focus(); }
function showApp() { $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); }
function setView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("hidden", element.id !== view));
  $$(".nav-item[data-view]").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $("#view-title").textContent = titles[view];
  $("#view-kicker").textContent = view === "overview" ? "CADDY SERVER" : "SERVER MANAGEMENT";
  if (view === "certificates") loadCertificates();
  if (view === "logs") loadLogs();
  if (view === "backups") loadBackups();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function siteLabel(site) { return site.type === "proxy" ? "反向代理" : "静态网站"; }
function renderSites() {
  $("#manual-warning").classList.toggle("hidden", state.managed);
  $("#save-sites").disabled = !state.managed;
  $("#add-site").disabled = !state.managed;
  $("#stat-sites").textContent = state.managed ? state.sites.length : "—";
  $("#stat-mode").textContent = state.managed ? "站点管理" : "手动配置";
  $("#site-count").textContent = state.managed ? `共 ${state.sites.length} 个站点` : "高级模式";
  const list = $("#site-list");
  if (!state.sites.length) list.innerHTML = `<div class="empty">${state.managed ? "还没有站点。点击「添加站点」开始配置。" : "手动 Caddyfile 中的站点不会在此解析，以免破坏自定义配置。"}</div>`;
  else list.innerHTML = state.sites.map((site, index) => `<article class="site-card"><div><h3>${escapeHtml(site.name)}<span class="tag">${siteLabel(site)}</span></h3><p><strong>${escapeHtml(site.address)}</strong> → ${escapeHtml(site.type === "proxy" ? site.upstream : site.root)}</p></div><div class="actions"><button class="button ghost edit-site" data-index="${index}" ${state.managed ? "" : "disabled"}>编辑</button><button class="button ghost delete-site" data-index="${index}" ${state.managed ? "" : "disabled"}>删除</button></div></article>`).join("");
  $("#overview-sites").innerHTML = state.managed && state.sites.length ? state.sites.slice(0, 4).map((site) => `<div class="compact-site"><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.address)}</small><small>${siteLabel(site)}</small></div>`).join("") : `<p class="muted">${state.managed ? "尚未添加站点。" : "当前使用高级配置模式。"}</p>`;
  $$(".edit-site").forEach((button) => button.addEventListener("click", () => openSite(Number(button.dataset.index))));
  $$(".delete-site").forEach((button) => button.addEventListener("click", () => { if (confirm("确定从列表中删除此站点吗？点击「保存并应用」后生效。")) { state.sites.splice(Number(button.dataset.index), 1); renderSites(); } }));
}
function openSite(index = -1) {
  const site = index >= 0 ? state.sites[index] : { id: "", name: "", type: "proxy", address: "", upstream: "", root: "/srv" };
  $("#site-id").value = index;
  $("#site-name").value = site.name;
  $("#site-type").value = site.type;
  $("#site-address").value = site.address;
  $("#site-upstream").value = site.upstream;
  $("#site-root").value = site.root;
  $("#site-auth-user").value = site.authUser || "";
  $("#site-auth-password").value = "";
  $("#site-password-help").textContent = site.authHash ? "留空沿用原密码；输入新密码则更换。" : "以 bcrypt 哈希保存，不保存明文。";
  $("#site-allowed-ips").value = (site.allowedIps || []).join("\n");
  $("#security-settings").open = Boolean(site.authUser || site.allowedIps?.length);
  updateSecuritySummary();
  $("#site-dialog-title").textContent = index >= 0 ? "编辑站点" : "添加站点";
  updateSiteType();
  $("#site-dialog").showModal();
}
function updateSiteType() { const proxy = $("#site-type").value === "proxy"; $("#upstream-field").classList.toggle("hidden", !proxy); $("#root-field").classList.toggle("hidden", proxy); $("#site-upstream").required = proxy; $("#site-root").required = !proxy; }
function updateSecuritySummary() { const enabled = $("#site-auth-user").value.trim() || $("#site-allowed-ips").value.trim(); $("#security-summary").textContent = enabled ? "已配置" : "未启用"; $("#security-summary").classList.toggle("enabled", Boolean(enabled)); }
async function loadBootstrap() {
  const data = await request("/api/bootstrap");
  state.config = data.config;
  state.revision = data.revision;
  state.sites = data.sites;
  state.managed = data.managed;
  $("#config-editor").value = state.config;
  $("#stat-status").textContent = data.status.running ? "运行中" : "连接失败";
  $("#service-pill").textContent = data.status.running ? "● Caddy 运行中" : "● Caddy 未连接";
  $("#service-pill").className = `pill ${data.status.running ? "online" : "offline"}`;
  const hostname = location.hostname;
  const websitePort = data.config.match(/^\s*http_port\s+(\d+)\s*$/m)?.[1] || 8080;
  $("#website-link").href = `http://${hostname}:${websitePort}/`;
  renderSites();
}
async function apply(payload, button) {
  busy(button, true);
  try { const result = await request("/api/apply", { method: "POST", body: JSON.stringify({ ...payload, revision: state.revision }) }); notify(result.message); await loadBootstrap(); }
  catch (error) { notify(error.message, true); }
  finally { busy(button, false); }
}
async function loadCertificates() {
  try { const { certificates } = await request("/api/certificates"); $("#certificate-list").innerHTML = certificates.length ? `<table><thead><tr><th>域名</th><th>签发者</th><th>到期时间</th><th>状态</th></tr></thead><tbody>${certificates.map((cert) => { const days = cert.notAfter ? Math.ceil((new Date(cert.notAfter) - Date.now()) / 86400000) : null; return `<tr><td>${escapeHtml(cert.name)}</td><td>${escapeHtml(cert.issuer)}</td><td>${cert.notAfter ? new Date(cert.notAfter).toLocaleString("zh-CN") : "—"}</td><td>${days === null ? "—" : days >= 0 ? `有效 · ${days} 天` : "已过期"}</td></tr>`; }).join("")}</tbody></table>` : `<div class="empty">暂无证书。配置有效公网域名后，Caddy 会自动申请。</div>`; }
  catch (error) { $("#certificate-list").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}
async function loadLogs() { try { $("#log-view").textContent = (await request("/api/logs")).log; $("#log-view").scrollTop = $("#log-view").scrollHeight; } catch (error) { $("#log-view").textContent = error.message; } }
async function loadBackups() {
  try {
    const { backups } = await request("/api/backups");
    $("#stat-backups").textContent = backups.length;
    $("#backup-list").innerHTML = backups.length ? `<table><thead><tr><th>备份文件</th><th>时间</th><th>大小</th><th></th></tr></thead><tbody>${backups.map((backup) => `<tr><td>${escapeHtml(backup.name)}</td><td>${new Date(backup.createdAt).toLocaleString("zh-CN")}</td><td>${backup.size} B</td><td><a class="text-button" href="/api/backup?name=${encodeURIComponent(backup.name)}&download=1">下载</a> <button class="text-button restore-backup" data-name="${escapeHtml(backup.name)}">恢复到编辑器</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty">暂无配置历史。第一次成功应用更改时会自动创建备份。</div>`;
    $$(".restore-backup").forEach((button) => button.addEventListener("click", async () => {
      const data = await request(`/api/backup?name=${encodeURIComponent(button.dataset.name)}`);
      $("#config-editor").value = data.config;
      setView("config");
      notify("备份已载入编辑器，检查无误后点击「保存并应用」。");
    }));
  }
  catch (error) { $("#backup-list").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; }
}

$("#login-form").addEventListener("submit", async (event) => { event.preventDefault(); $("#login-error").textContent = ""; try { const data = await request("/api/login", { method: "POST", body: JSON.stringify({ password: $("#login-password").value }) }); state.csrf = data.csrf; await loadBootstrap(); showApp(); } catch (error) { $("#login-error").textContent = error.message; } });
$("#nav").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) setView(button.dataset.view); });
$$('[data-go]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
$("#add-site").addEventListener("click", () => openSite());
$("#site-type").addEventListener("change", updateSiteType);
$("#site-auth-user").addEventListener("input", updateSecuritySummary);
$("#site-allowed-ips").addEventListener("input", updateSecuritySummary);
$("#site-form").addEventListener("submit", (event) => { event.preventDefault(); const index = Number($("#site-id").value); const previous = index >= 0 ? state.sites[index] : {}; const site = { id: index >= 0 ? previous.id : `site-${crypto.randomUUID().slice(0, 8)}`, name: $("#site-name").value.trim(), type: $("#site-type").value, address: $("#site-address").value.trim(), upstream: $("#site-upstream").value.trim(), root: $("#site-root").value.trim() || "/srv", authUser: $("#site-auth-user").value.trim(), authPassword: $("#site-auth-password").value, authHash: previous.authHash || "", allowedIps: $("#site-allowed-ips").value.split(/[\s,]+/).filter(Boolean) }; if (site.authUser && !site.authPassword && !site.authHash) return notify("首次启用访问密码时，请填写至少 8 位密码。", true); if (state.sites.some((item, i) => i !== index && item.address === site.address)) return notify("站点地址不能重复。", true); if (index >= 0) state.sites[index] = site; else state.sites.push(site); renderSites(); $("#site-dialog").close(); });
$$(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#save-sites").addEventListener("click", (event) => apply({ mode: "sites", sites: state.sites }, event.currentTarget));
$("#save-config").addEventListener("click", (event) => apply({ mode: "advanced", config: $("#config-editor").value }, event.currentTarget));
$("#validate-config").addEventListener("click", async (event) => { busy(event.currentTarget, true); try { const data = await request("/api/validate", { method: "POST", body: JSON.stringify({ config: $("#config-editor").value }) }); $("#validation-output").textContent = data.json; $("#validation-output").classList.remove("hidden"); notify("Caddyfile 校验通过，JSON 适配结果已显示。"); } catch (error) { notify(error.message, true); } finally { busy(event.currentTarget, false); } });
$$('[data-refresh]').forEach((button) => button.addEventListener("click", () => ({ certificates: loadCertificates, logs: loadLogs, backups: loadBackups }[button.dataset.refresh]())));
$("#logout-button").addEventListener("click", async () => { await request("/api/logout", { method: "POST" }); showLogin(); });
$("#password-button").addEventListener("click", () => { $("#password-form").reset(); $("#password-dialog").showModal(); });
$("#password-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await request("/api/password", { method: "POST", body: JSON.stringify({ currentPassword: $("#current-password").value, newPassword: $("#new-password").value }) }); $("#password-dialog").close(); notify("管理员密码已修改。"); } catch (error) { notify(error.message, true); } });
loadBootstrap().then(showApp).catch(showLogin);
