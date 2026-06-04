# DragUpload

`DragUpload` is a reusable React + TypeScript drag-and-drop file upload component extracted from the current frontend upload page. It is business-agnostic: it only validates selected files and returns accepted `File[]` objects to the caller.

## Files

```bash
component/frontend/DragUpload.tsx
component/frontend/DragUpload.css
component/frontend/index.ts
```

## Import

Copy the `component/frontend` files into your React project, then import:

```tsx
import DragUpload from './component/frontend/DragUpload';
import './component/frontend/DragUpload.css';
```

Or import from the index file:

```tsx
import DragUpload, { defaultAllowedExtensions } from './component/frontend';
import './component/frontend/DragUpload.css';
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `allowedExtensions` | `string[]` | Full supported extension list below | Allowed file extensions. Values are normalized to lowercase and may include or omit the leading dot. |
| `onFilesSelected` | `(files: File[]) => void` | Required | Callback fired with accepted files after selection or drop. |
| `multiple` | `boolean` | `true` | Whether multiple files can be selected. |
| `disabled` | `boolean` | `false` | Disables clicking, dropping, and file selection. |
| `title` | `string` | `Select or drop files` | Main text shown inside the drop zone. |
| `description` | `string` | Built-in description | Helper text shown before any file is selected. |
| `className` | `string` | `''` | Extra class name for custom styling. |

## Example

```tsx
import { useState } from 'react';
import DragUpload from './component/frontend/DragUpload';
import './component/frontend/DragUpload.css';

function UploadPanel() {
  const [files, setFiles] = useState<File[]>([]);

  return (
    <DragUpload
      allowedExtensions={['glb']}
      multiple={false}
      title="Upload GLB file"
      description="Drop a .glb file here, or click to select one."
      onFilesSelected={(acceptedFiles) => {
        setFiles(acceptedFiles);
      }}
    />
  );
}
```

Send accepted files to a backend:

```tsx
async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('http://localhost:5000/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  return response.blob();
}
```

## Supported File Extensions

Validation is based on the extension list below. All values are lowercase. If a format has multiple common extensions, this component uses the extensions explicitly listed here.

```bash
glb, gltf, ply, stl, obj, off, dae, fbx, dxf, ifc, xyz, pcd, las, laz, stp, step, 3dxml, iges, igs, shp, geojson, xaml, pts, asc, brep, fcstd, bim, usdz, pdb, vtk, svg, wrl, 3dm, 3ds, amf, 3mf, dwg, json, rfa, rvt, cvs, gpkg, ac, zgl, x, ter, smd, sib, q3o, q3s, ogex, nff, ms3d, mdl, md5mesh, md2, lws, hmp, irrmesh, x3d, vrml, b3dm, xyzrgb, x3dv, vtu, urdf, ugrid, su2, babylon, ac3d, bvh, ase, wkt, facet
```
