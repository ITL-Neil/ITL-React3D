# 前端演示 — component_demo/frontend

> 基于 React 18 + Vite + TypeScript 的前端演示页面。
> 通过 Vite alias `@component` 引用 `component/frontend/` 中的 `DragUpload` 组件和 `useCompressApi` Hook，
> 拖拽上传任意 3D 文件后自动发送至后端处理并下载压缩结果。

## 启动方式

```bash
# 安装依赖（首次运行）
npm install

# 启动开发服务器（http://localhost:5173）
npm run dev
```

## 配置

编辑 `.env` 文件修改后端地址（默认 `VITE_API_URL=http://localhost:5100/api/compress`）。

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/App.tsx` | 演示页面，import `@component/DragUpload` + `@component/useCompressApi` |
| `src/App.css` | 页面样式 |
| `src/main.tsx` | 应用入口 |
| `vite.config.ts` | 配置 `@component` alias → `../../component/frontend/`，`server.fs.allow` 跨目录访问 |
| `tsconfig.json` | 配置 `paths: {"@component/*": ["../../component/frontend/*"]}`，`include` 扩展到组件目录 |

## 集成方式

本 demo 前端不包含 `DragUpload.tsx`、`DragUpload.css`、`useCompressApi.ts` 等文件副本。
所有功能通过 Vite alias 从 `component/frontend/` 引入：

```tsx
// App.tsx
import DragUpload from '@component/DragUpload';
import { useCompressApi, formatBytes } from '@component/useCompressApi';

function App() {
  const { status, isBusy, stats, compress, download } = useCompressApi();

  return (
    <DragUpload
      onFilesSelected={async (files) => {
        await compress(files[0]);
        download();
      }}
      disabled={isBusy}
      multiple={false}
    />
  );
}
```

### Vite 配置关键点

```ts
// vite.config.ts
resolve: {
  alias: {
    '@component': path.resolve(__dirname, '../../component/frontend'),
  },
},
server: {
  fs: {
    allow: ['..', '../..'],  // 允许 Vite 访问 component/ 目录
  },
},
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@component/*": ["../../component/frontend/*"]
    }
  },
  "include": ["src", "../../component/frontend"]
}
```

## 实时开发

修改 `component/frontend/` 中的源码后，Vite HMR 会自动热更新 demo 页面，无需手动同步文件。

详细启动说明请参考 `../../component_demo/README.md`。
