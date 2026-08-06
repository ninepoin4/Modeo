# Modeo 桌面封装（Electron）

将本地 Web 版 Modeo 打包为桌面应用窗口。

## 使用

```bash
cd desktop
npm install          # 安装 Electron（约 100MB）
npm start            # 启动桌面应用
```

## 自检

```bash
npm run smoke        # 启动后加载首页，输出 MODOE_SMOKE_OK 并自动退出
```

说明：桌面壳只是启动 `../server.js`（内置 Node 服务）并用窗口加载本地界面，应用本体仍是零依赖的。此目录的 `package.json` 独立于主项目，不影响主项目"零依赖"承诺。

窗口为无边框设计：顶部标题栏支持拖动，右上角为最小化/最大化/关闭（原生 IPC）。
