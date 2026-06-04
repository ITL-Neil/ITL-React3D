# Component Integration Demo

This directory is reserved for a future integration demo of the reusable code in `component/`.

The demo project will contain:

- a frontend demo that imports `component/frontend/DragUpload`
- a backend demo that calls `component/backend/GlbCompressionService.cs`

Planned structure:

```bash
component_demo/
├── frontend/
│   └── README.md
├── backend/
│   └── README.md
└── README.md
```

## Planned Demo Flow

1. Start the demo backend.
2. Start the demo frontend.
3. Open the frontend page.
4. Select or drag a `.glb` file with the reusable upload component.
5. The frontend sends the selected file to the backend.
6. The backend receives the file and calls `GlbCompressionService`.
7. The backend returns the compressed GLB file.
8. The frontend downloads the compressed file.

## Planned Backend Startup

When demo backend code is added, it will be started with commands similar to:

```bash
cd component_demo/backend
dotnet run
```

## Planned Frontend Startup

When demo frontend code is added, it will be started with commands similar to:

```bash
cd component_demo/frontend
npm install
npm run dev
```

## Current Status

This directory is initialized only. Demo frontend and backend source code will be added later.
