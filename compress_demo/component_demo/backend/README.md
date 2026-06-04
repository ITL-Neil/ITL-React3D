# Backend Demo Placeholder

This folder is reserved for a future backend demo that calls:

```bash
component/backend/GlbCompressionService.cs
```

The planned demo backend will:

- expose an upload endpoint such as `POST /api/upload`
- receive a `.glb` file from the demo frontend
- save the uploaded file to a temporary directory
- call `GlbCompressionService.CompressGlbAsync`
- return the compressed GLB file to the frontend

Planned startup command:

```bash
cd component_demo/backend
dotnet run
```

Demo source code is not implemented in this step.
