# 3D 模型文件压缩工具

简易前后端分离 Web 应用，用于上传 GLB 文件并调用 `gltf-transform` 执行 Draco 压缩和纹理 WebP 转换。

## 效果展示
![alt text](<READMEFILE/Format conversion and compression effect result.jpg>)

## 目录结构

- `backend/`：C# ASP.NET Core 后端
- `frontend/`：React + Vite 前端

## 环境依赖

后端需要本机可直接执行 `gltf-transform`：

```powershell
npm install -g @gltf-transform/cli
```

如果命令不在 PATH 中，可在 `backend/appsettings.json` 的 `GltfTransform:Command` 配置完整路径。Windows 下建议使用 `gltf-transform.cmd` 或对应 `.cmd` 完整路径，避免 PowerShell 执行策略拦截 `.ps1`。

临时文件默认写入系统临时目录下的 `glb-compressor` 文件夹。若要改回项目目录，可设置：

```json
"Storage": {
  "TempDirectory": "Temp"
}
```

## 启动后端

```powershell
cd backend
dotnet run
```

默认地址：`http://localhost:5000`

## 启动前端

```powershell
cd frontend
npm install
npm run dev
```

默认地址：`http://localhost:5173`

如需修改后端接口地址，可设置前端环境变量：

```powershell
$env:VITE_API_URL = "http://localhost:5000/api/upload"
npm run dev
```

## 前后端运行命令
```bash
npm.cmd run dev -- --host 127.0.0.1
dotnet run
```

## 接口

`POST /api/upload`

- 请求：`multipart/form-data`，字段名 `file`
- 成功：返回 `compressed.glb` 文件流
- 失败：返回 `{ "error": "具体错误信息" }`
