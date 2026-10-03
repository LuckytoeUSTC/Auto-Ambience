# Auto-Ambience release guidance

- Keep daily text files and `手动配置.json` at the project root.
- Keep runtime code flat in `系统/运行组件`; keep both user entrypoints, `使用说明.md` and `交给Codex.md`, at the project root.
- Detect display geometry and Windows work area automatically; do not ask the user to look up resolution or scaling.
- Read image paths only from `手动配置.json` or an explicit user-provided path.
- Preserve the local-file workflow. Do not add calendar, cloud services, audio, or automatic task inference without a new request.
- Keep the fixed local URL `http://127.0.0.1:18765/`; report a port conflict instead of silently changing it.
