# Caddy for fnOS

将 [Caddy](https://github.com/caddyserver/caddy) 官方 `2.11.9-alpine` Docker 镜像包装为飞牛 fnOS 的 Docker 型 FPK 应用，并提供独立开发的配套管理后台。此项目及后台均不是 Caddy 官方发布的 fnOS 应用或官方管理界面。

## 安装与使用

1. 在飞牛应用中心选择手动安装，上传 `dist/caddy-2.11.9-3-all.fpk`。
2. 设置 HTTP/HTTPS 网站端口（默认 `8080/8443`）、后台端口（默认 `18081`）及至少 10 位的管理员密码。三个端口不能相同。
3. 首次安装会拉取 Node/Caddy 基础镜像并在 NAS 本地构建双容器镜像，因此需要联网，构建时间取决于 NAS 性能。安装完成后不需要重新构建。
4. 点击桌面图标或访问 `http://飞牛IP:18081`，使用安装时设置的密码登录。网站默认地址仍为 `http://飞牛IP:8080`。
5. 后台支持反向代理/静态站点管理、站点密码和 IP 白名单、完整 Caddyfile 编辑、证书查看、最近日志和配置历史。应用配置会先经过 `caddy adapt` 校验，再调用 Caddy 管理 API 热加载，无需重启容器。
6. 网站文件位于应用共享目录 `caddy-fpk/www`。静态站点表单中的 `/srv` 即对应此目录。
7. Caddy 配置、证书、网站、后台密码和配置历史在升级及默认卸载后保留。卸载时明确选择删除才会清理数据。

管理 API 监听 `0.0.0.0:2019` 以便同一 Compose 网络中的后台调用，但不会映射到宿主机端口。不要额外映射或反向代理 `:2019`。后台本身有 scrypt 密码哈希、HttpOnly/SameSite Cookie、CSRF 防护和登录频率限制；仍建议只在可信局域网或 VPN 中访问，不要直接暴露到公网。

## 后台使用说明

- **站点管理**：填写域名/监听地址和上游 `主机:端口`，点击“保存并应用”。每个地址只能有一个站点。
- **网站访问保护**：编辑站点，可选设置访问用户名/密码和 IPv4/IPv6 CIDR 白名单。留空则不启用。修改其他设置时无需重输已有站点密码。密码以 bcrypt 哈希保存，后台不显示或导出明文。
- **高级配置**：支持完整 Caddyfile。必须保留全局 `admin 0.0.0.0:2019` 和 `origins caddy:2019`，否则后台无法管理 Caddy。
- **手动配置保护**：在文件管理器中手动修改配置后，后台切换到高级模式，不会用站点列表覆盖自定义内容。需要恢复站点向导时，参考 `app/defaults/Caddyfile` 补齐托管标记。
- **配置历史**：成功热加载后保留旧文件，最多 10 份。恢复会先载入编辑器，确认后才会应用。
- **修改密码**：登录后通过侧栏“修改密码”操作，需要提供当前密码。明文密码不会写入 Compose 或环境变量。

## 反向代理示例

将默认 `:8080` 站点替换为实际域名：

```caddyfile
example.com {
	reverse_proxy host.docker.internal:3000
}
```

Docker Desktop 支持 `host.docker.internal`。在 fnOS Linux 上，请使用飞牛主机的 LAN IP 或 Docker 网关 IP，例如 `192.168.1.10:3000`。目标应用必须监听对应接口，而不只是 `127.0.0.1`。

自动申请公网证书通常需要主机端口 `80/443`、正确的公网 DNS、路由器端口转发，以及 Caddy 能访问证书颁发机构。内网站点不会自动获得受信任的公网证书。DNS 插件不包含在官方基础镜像中，需要 DNS 验证时应使用自定义 Caddy 镜像。

## 构建

在 Windows PowerShell 中运行：

```powershell
.\build.ps1
```

脚本使用工作区内的 `fnpackup\fnpackup\fnpack.exe`，生成 `app.tgz`、更新 MD5 校验值，并输出版本化 FPK 到 `dist`。FPK 包含零第三方运行时依赖的 Node.js 后台源码及 Dockerfile，但不内嵌基础镜像。

后台测试：

```powershell
npm --prefix .\panel test
```

可选：启动 Docker Desktop 后，可在本机构建同一镜像进行验证：

```powershell
docker build -f .\app\docker\Dockerfile -t caddy-fpk-local:2.11.9-3 .\app
```

`publish-image.ps1` 提供可选的多架构预构建发布流程，使用前须先登录相应仓库并同步修改 Compose 的镜像名。默认 FPK 不依赖该仓库。

## 从旧版升级

安装新版时会为旧版全局 Caddyfile 自动补齐内部管理 API。无法识别的配置会先备份为 `config/Caddyfile.pre-panel`，再使用默认配置。后台密码不会要求重新设置。请保留以下全局配置：

```caddyfile
{
	admin 0.0.0.0:2019 {
		origins caddy:2019
	}
	http_port 8080
	https_port 8443
}
```

其余站点内容保持不变。不要映射 2019 端口。

## 验证

后台包含 Node 内置测试，覆盖密码、会话、CSRF、站点配置、路径隔离和证书元数据。项目结构、JSON 配置和 FPK 内容也可在 Windows 上检查。Windows 打包及本机容器验证不等同于 fnOS 真机安装测试。
