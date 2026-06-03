# GLB 压缩前端应用

这是 3D 模型压缩工具的前端项目，基于 React + Vite 实现。页面支持选择或拖拽上传文件，调用后端 `/api/upload` 接口进行压缩，处理成功后自动下载 `compressed.glb`。

## 功能说明

- 选择本地文件后自动上传
- 支持拖拽文件上传
- 上传和压缩过程中显示处理中状态
- 压缩成功后自动触发下载
- 压缩失败时显示后端返回的错误信息

## 环境要求

需要先安装：

- Node.js
- npm

检查版本：

```bash
node --version
npm --version
```

Windows PowerShell 如果执行 `npm` 遇到脚本策略问题，可以使用：

```bash
npm.cmd --version
```

## 安装依赖

进入前端目录：

```bash
cd frontend
```

安装依赖：

```bash
npm install
```

Windows PowerShell 可使用：

```bash
npm.cmd install
```

## 本地开发运行

启动前端开发服务：

```bash
npm run dev
```

Windows PowerShell 可使用：

```bash
npm.cmd run dev
```

默认访问地址：

```bash
http://localhost:5173
```

也可以指定 host：

```bash
npm run dev -- --host 127.0.0.1
```

Windows PowerShell：

```bash
npm.cmd run dev -- --host 127.0.0.1
```

## 后端接口地址配置

前端默认请求后端接口：

```bash
http://localhost:5000/api/upload
```

如果后端部署在其他地址，可以通过环境变量 `VITE_API_URL` 修改。

Linux/macOS 示例：

```bash
VITE_API_URL=http://127.0.0.1:5000/api/upload npm run dev
```

Windows PowerShell 示例：

```bash
$env:VITE_API_URL="http://127.0.0.1:5000/api/upload"
npm.cmd run dev
```

也可以在 `frontend/` 目录下创建 `.env.local`：

```bash
VITE_API_URL=http://127.0.0.1:5000/api/upload
```

然后启动：

```bash
npm run dev
```

## 构建生产版本

执行构建：

```bash
npm run build
```

Windows PowerShell：

```bash
npm.cmd run build
```

构建产物会生成到：

```bash
dist/
```

## 本地预览生产构建

先构建：

```bash
npm run build
```

再预览：

```bash
npm run preview
```

Windows PowerShell：

```bash
npm.cmd run build
npm.cmd run preview
```

## 使用流程

1. 启动后端服务，默认地址为 `http://localhost:5000`
2. 启动前端服务，默认地址为 `http://localhost:5173`
3. 打开前端页面
4. 点击上传区域，或拖拽文件到上传区域
5. 等待后端压缩完成
6. 浏览器自动下载 `compressed.glb`

## 与后端联调

确认后端可访问：

```bash
curl http://localhost:5000/
```

正常返回：

```json
{
  "status": "GLB compressor backend is running"
}
```

如果前端和后端不在同一台机器，请把 `VITE_API_URL` 设置为后端服务器地址，例如：

```bash
VITE_API_URL=http://192.168.1.100:5000/api/upload npm run dev
```

## 常见问题

### Failed to fetch

通常表示浏览器无法连接到后端。请检查：

- 后端是否已启动
- 后端地址是否正确
- `VITE_API_URL` 是否配置正确
- 后端端口是否被防火墙拦截
- 浏览器控制台是否有 CORS 错误

### net::ERR_CONNECTION_RESET

通常表示后端连接被中断。请查看后端终端日志，确认后端是否报错或进程是否退出。

### CORS error

后端需要允许前端地址跨域访问。当前后端默认允许：

```bash
http://localhost:5173
http://127.0.0.1:5173
```

如果前端部署到其他域名，需要在后端 CORS 配置中增加对应地址。

### 上传成功但没有下载

请检查浏览器是否拦截了下载，或查看页面是否显示错误信息。后端成功时会返回文件流，前端会自动触发下载并显示下载按钮。
