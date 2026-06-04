# Reusable Upload and GLB Compression Components

This folder contains reusable frontend and backend pieces extracted from the current GLB compression project.

## Contents

```bash
component/
├── frontend/
│   ├── DragUpload.tsx
│   ├── DragUpload.css
│   ├── index.ts
│   └── README.md
├── backend/
│   ├── GlbCompressionService.cs
│   └── README.md
└── README.md
```

## What It Provides

- A reusable React drag-and-drop upload component.
- A reusable C# GLB compression service.

The frontend component validates file extensions and returns accepted `File[]` objects. The backend method accepts an existing `.glb` file path, calls `gltf-transform`, and writes a compressed `.glb` file whose name includes the original file name and a UUID.

## Integration Overview

1. Copy `component/frontend` into a React project.
2. Import `DragUpload` and pass an `onFilesSelected` callback.
3. In the callback, send the selected file to your backend as `multipart/form-data`.
4. Copy `component/backend/GlbCompressionService.cs` into a .NET backend project.
5. Save the uploaded GLB file to a temporary directory.
6. Call `GlbCompressionService.CompressGlbAsync(inputPath, outputDirectory)`.
7. Return the generated compressed GLB file to the frontend.

## Frontend Sketch

```tsx
<DragUpload
  allowedExtensions={['glb']}
  multiple={false}
  onFilesSelected={async ([file]) => {
    const formData = new FormData();
    formData.append('file', file);

    await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
  }}
/>
```

## Backend Sketch

```csharp
var result = await GlbCompressionService.CompressGlbAsync(
    inputPath: inputPath,
    outputDirectory: outputDirectory);
```

## Interface Notes

Recommended upload endpoint:

```bash
POST /api/upload
Content-Type: multipart/form-data
Field name: file
```

Recommended success response:

```bash
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="original_UUID.glb"
```

See the nested README files for detailed integration instructions.
