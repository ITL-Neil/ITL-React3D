# 前端演示 — component_demo/frontend

> 基于 React 18 + Vite + TypeScript 的前端演示页面，集成 `DragUpload` 组件，拖拽上传 GLB 文件后自动发送至后端压缩并下载结果。

## 启动方式

```bash
# 安装依赖（首次运行）
npm install

# 启动开发服务器（http://localhost:5173）
npm run dev
```

## 配置

编辑 `.env` 文件修改后端地址（默认 `http://localhost:5100/api/compress`）。

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/DragUpload.tsx` | 复制自 `component/frontend/DragUpload.tsx` |
| `src/DragUpload.css` | 组件样式 |
| `src/App.tsx` | 演示页面，调用 DragUpload + 上传至后端 |
| `src/App.css` | 页面样式 |
| `src/main.tsx` | 应用入口 |

详细启动说明请参考 `../../component_demo/README.md`。
