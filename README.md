# Auto-Ambience

把本地文字和图片放到 Windows 桌面上，让照片、时间表和少量文字帮助你恢复生活与工作上下文。

Auto-Ambience 使用 Node.js 本机服务与 Lively Wallpaper 显示动态桌面。日常内容保存在 Markdown、TXT 和 JSON 文件中，可直接编辑；无需 npm 安装、项目编译或云端账户。

## 功能

- 展示照片、时间表、想做的事、工作规划和按日期排序的 DDL。
- 点击“现在做”区域，打开简洁的原生输入框并保存内容。
- 在桌面切换 Markdown 状态标签。
- 添加、移动和删除可自由摆放的棋子视觉标签。
- 使用固定背景，或从指定文件夹每日选取一张背景。
- 可选自动省电：低电量时切换为静态壁纸，接通电源后恢复动态壁纸。

内容变化后，桌面约 3 秒刷新。内容读取与交互通过本机地址 `http://127.0.0.1:18765/` 完成。

## 下载与启动

1. [下载 ZIP](https://github.com/LuckytoeUSTC/Auto-Ambience/archive/refs/heads/main.zip)，解压到固定位置；也可点击仓库页面的 **Code → Download ZIP**，或使用 Git 克隆仓库。
2. 安装 [Node.js LTS](https://nodejs.org/en/download) 和 [Lively Wallpaper](https://github.com/rocksdanister/lively)。
3. 阅读根目录的 [使用说明.md](使用说明.md)，更换示例图片并编辑 `手动配置.json`。
4. 双击 `系统/打开桌面.vbs`，在 Lively 中添加 `http://127.0.0.1:18765/` 并设为壁纸。

系统要求：Windows 10/11，Node.js LTS，Lively Wallpaper。Node.js 与 Lively 不包含在发布版中。PowerShell、VBS 和 C# 辅助代码用于 Windows 原生交互，所需辅助代码由脚本在运行时加载。

如果希望由 Codex 协助配置，阅读 [交给Codex.md](交给Codex.md)。自动省电与开机启动均可选择启用。

## 文件结构

- 根目录 Markdown / TXT：日常文字内容。
- `手动配置.json`：照片、时间表、背景来源和省电阈值。
- `照片/`、`时间表/`、`背景壁纸/`：可替换的示例图片。
- `系统/`：启动、关闭、省电与开机启动入口。
- `系统/运行组件/`：网页、Node.js、PowerShell、VBS 和 C# 源码。
- `build-release.ps1`：将当前公开目录打包为发布版 ZIP，无需编译。

仓库附带通用示例内容。发布自己的版本前，请检查个人文字、图片、绝对路径和运行状态文件。
## 许可证

本项目采用 [MIT License](LICENSE)。
