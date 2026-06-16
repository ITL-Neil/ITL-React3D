"""
Merge multiple OBJ files into a single OBJ file with proper MTL material file.
Called by the Node.js backend converter for drone photogrammetry multi-tile models.

Usage:
    python merge_objs.py <work_directory>

The script will:
1. Find all .obj files in the given directory (sorted by name)
2. Find all texture image files (.png, .jpg, etc.) in the same directory
3. Auto-detect the correct texture-to-model mapping by sampling UV coordinates
   and comparing them against texture pixel colors
4. Generate a merged.mtl that references all textures
5. Merge all OBJ files into merged.obj with correct index offsets
6. Assign materials to each sub-model based on the best texture match

If the auto-detected mapping doesn't look right, edit the TEXTURE_MAP dictionary
below to manually override specific assignments.
"""

import os
import sys
import glob
import re


# ============================================================================
# CONFIGURATION: Map each OBJ file to its texture file.
# If a mapping is not provided, the script will auto-detect the best match.
# Edit this dictionary to fix incorrect texture assignments.
#
# Format: "model_X.obj": "texture_name.png"
# The texture path is relative to the MTL/OBJ file location.
# ============================================================================
TEXTURE_MAP = {
    # Example (uncomment and edit as needed):
    # "model_0.obj": "green-covered.png",
    # "model_1.obj": "green-covered1.png",
}


def find_textures():
    """Find all texture image files in the directory."""
    extensions = ("*.png", "*.jpg", "*.jpeg", "*.bmp", "*.tif", "*.tiff")
    textures = []
    for ext in extensions:
        textures.extend(glob.glob(ext))
    return sorted(textures)


def get_sample_uv_face(obj_file, n_samples=200):
    """Extract sample face vertex -> UV coordinate mappings from an OBJ file.
    Returns list of (vx, vy, vz, u, v) tuples sampled from face definitions."""
    vertices = {}   # index -> (x, y, z)
    texcoords = {}  # index -> (u, v)

    with open(obj_file, "r", encoding="utf-8", errors="replace") as f:
        vi = 0
        vti = 0
        for line in f:
            if line.startswith("v "):
                vi += 1
                parts = line.split()
                vertices[vi] = (float(parts[1]), float(parts[2]), float(parts[3]))
            elif line.startswith("vt "):
                vti += 1
                parts = line.split()
                texcoords[vti] = (float(parts[1]), float(parts[2]))

    samples = []
    count = 0
    with open(obj_file, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("f "):
                parts = line.strip().split()[1:]
                for part in parts:
                    indices = part.split("/")
                    v_idx = int(indices[0])
                    vt_idx = int(indices[1]) if len(indices) > 1 and indices[1] else None

                    if v_idx in vertices and vt_idx and vt_idx in texcoords:
                        v = vertices[v_idx]
                        t = texcoords[vt_idx]
                        samples.append((v[0], v[1], v[2], t[0], t[1]))
                        count += 1
                        if count >= n_samples:
                            return samples

    return samples


def auto_detect_textures(obj_files, textures):
    """Auto-detect texture assignment by comparing rendered colors at UV positions."""
    assignment = {}

    if not textures:
        return assignment

    try:
        from PIL import Image
    except ImportError:
        print("WARNING: Pillow not installed. Falling back to simple round-robin assignment.")
        print("Install with: pip install Pillow")
        return _fallback_assignment(obj_files, textures)

    tex_images = {}
    for tex_file in textures:
        try:
            img = Image.open(tex_file)
            img.load()
            tex_images[tex_file] = img
            print(f"  Loaded texture: {tex_file} ({img.size[0]}x{img.size[1]})")
        except Exception as e:
            print(f"  WARNING: Could not load texture {tex_file}: {e}")

    if not tex_images:
        return _fallback_assignment(obj_files, textures)

    usable_textures = list(tex_images.keys())

    for obj_file in obj_files:
        print(f"  Analyzing {obj_file} ...")
        samples = get_sample_uv_face(obj_file, n_samples=300)

        if not samples:
            assignment[obj_file] = usable_textures[0]
            continue

        best_tex = None
        best_score = -1

        for tex_file, img in tex_images.items():
            w, h = img.size
            score = 0
            valid_samples = 0

            for vx, vy, vz, u, v in samples:
                px = int(u * (w - 1))
                py = int((1.0 - v) * (h - 1))
                px = max(0, min(w - 1, px))
                py = max(0, min(h - 1, py))

                try:
                    pixel = img.getpixel((px, py))
                    if len(pixel) >= 3:
                        r, g, b = pixel[0], pixel[1], pixel[2]
                        is_valid = True
                        if r == 0 and g == 0 and b == 0:
                            is_valid = False
                        if r == 255 and g == 255 and b == 255:
                            is_valid = False
                        if r == 255 and g == 0 and b == 255:
                            is_valid = False
                        if r == 0 and g == 255 and b == 0:
                            is_valid = False

                        if is_valid:
                            variance = abs(r - g) + abs(g - b) + abs(r - b)
                            score += min(variance, 50)
                            valid_samples += 1

                except Exception:
                    pass

            if len(samples) > 0:
                final_score = (valid_samples / len(samples)) * 100 + score / max(valid_samples, 1)
            else:
                final_score = 0

            print(f"    {tex_file}: score={final_score:.1f} (valid={valid_samples}/{len(samples)})")

            if final_score > best_score:
                best_score = final_score
                best_tex = tex_file

        if best_tex:
            assignment[obj_file] = best_tex
            print(f"    -> Best match: {best_tex}")

    _diversify_assignments(assignment, obj_files, tex_images, usable_textures)

    return assignment


def _diversify_assignments(assignment, obj_files, tex_images, usable_textures):
    """If more OBJ files than unique textures, try to diversify assignments
    based on spatial position of models."""
    used_textures = set(assignment.values())

    if len(used_textures) >= len(usable_textures) or len(usable_textures) <= 1:
        return

    centroids = {}
    for obj_file in obj_files:
        cx, cy, cz = 0.0, 0.0, 0.0
        count = 0
        with open(obj_file, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("v "):
                    parts = line.split()
                    cx += float(parts[1])
                    cy += float(parts[2])
                    cz += float(parts[3])
                    count += 1
        if count > 0:
            centroids[obj_file] = (cx / count, cy / count, cz / count)

    if len(centroids) != len(obj_files):
        return

    sorted_models = sorted(obj_files, key=lambda f: centroids.get(f, (0, 0, 0))[0])

    main_textures = [t for t in usable_textures
                     if not ("ao" in t.lower() or "ground" in t.lower()) or len(usable_textures) <= 1]

    if main_textures:
        for i, model in enumerate(sorted_models):
            assignment[model] = main_textures[i % len(main_textures)]


def _fallback_assignment(obj_files, textures):
    """Simple round-robin fallback when Pillow is not available."""
    assignment = {}
    main_textures = []
    for t in textures:
        size = os.path.getsize(t)
        if size > 1000000:
            main_textures.append(t)
    if not main_textures:
        main_textures = textures

    for i, obj in enumerate(obj_files):
        assignment[obj] = main_textures[i % len(main_textures)]
    return assignment


def generate_mtl(mtl_path, obj_files, texture_assignment):
    """Generate a merged MTL file with materials for each sub-model."""
    materials = {}
    for obj_file in obj_files:
        tex = texture_assignment.get(obj_file)
        if tex:
            mat_name = os.path.splitext(os.path.basename(tex))[0]
            if mat_name not in materials:
                materials[mat_name] = tex

    with open(mtl_path, "w", encoding="utf-8") as f:
        f.write("# Merged MTL file\n")
        f.write("# Generated by merge_objs.py\n\n")

        for mat_name, tex_file in materials.items():
            f.write(f"newmtl {mat_name}\n")
            f.write("Ka 1.000000 1.000000 1.000000\n")
            f.write("Kd 1.000000 1.000000 1.000000\n")
            f.write("Ks 0.000000 0.000000 0.000000\n")
            f.write("Ns 1.000000\n")
            f.write("d 1.000000\n")
            f.write("illum 2\n")
            f.write(f"map_Kd {tex_file}\n")
            f.write("\n")

    return materials


def merge_obj_files(work_dir):
    """Main entry point: merge all OBJ files in work_dir into merged.obj + merged.mtl."""
    original_cwd = os.getcwd()
    os.chdir(work_dir)

    try:
        obj_files = sorted(glob.glob("*.obj"))
        obj_files = [f for f in obj_files if f not in ("merged.obj",)]

        if not obj_files:
            print("No OBJ files found in the directory.", file=sys.stderr)
            return None

        textures = find_textures()
        print(f"Found {len(obj_files)} OBJ file(s) and {len(textures)} texture(s):")
        for f in obj_files:
            print(f"  OBJ:   {f}")
        for f in textures:
            size_mb = os.path.getsize(f) / (1024 * 1024)
            print(f"  TEX:   {f} ({size_mb:.1f} MB)")

        texture_assignment = {}
        for obj_file in obj_files:
            if obj_file in TEXTURE_MAP:
                texture_assignment[obj_file] = TEXTURE_MAP[obj_file]

        unassigned = [f for f in obj_files if f not in texture_assignment]
        if unassigned and textures:
            print("\nAuto-detecting texture assignments ...")
            auto = auto_detect_textures(unassigned, textures)
            texture_assignment.update(auto)

        print("\nFinal texture assignment:")
        for obj_file in obj_files:
            tex = texture_assignment.get(obj_file, "NONE")
            print(f"  {obj_file} -> {tex}")

        mtl_path = "merged.mtl"
        if textures:
            materials = generate_mtl(mtl_path, obj_files, texture_assignment)
            print(f"\nGenerated MTL file: {mtl_path}")
            for mat_name, tex_file in materials.items():
                print(f"  Material '{mat_name}' -> {tex_file}")
        else:
            materials = {}
            print("\nNo textures found -- skipping MTL generation.")

        output_path = "merged.obj"

        v_offset = 0
        vt_offset = 0
        vn_offset = 0

        face_pattern = re.compile(r"(\d+)(/(\d+))?(/(\d+))?")

        with open(output_path, "w", encoding="utf-8") as out:
            out.write("# Merged OBJ file\n")
            out.write(f"# Generated by merge_objs.py from {len(obj_files)} files\n")
            if materials:
                out.write("mtllib merged.mtl\n")
            out.write("\n")

            for obj_file in obj_files:
                print(f"\nProcessing {obj_file} ...")

                tex = texture_assignment.get(obj_file)
                mat_name = None
                if tex:
                    mat_name = os.path.splitext(os.path.basename(tex))[0]

                local_v = 0
                local_vt = 0
                local_vn = 0

                with open(obj_file, "r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        if line.startswith("mtllib"):
                            continue

                        if line.startswith("o "):
                            obj_name = os.path.splitext(os.path.basename(obj_file))[0]
                            out.write(f"o {obj_name}\n")
                            if mat_name:
                                out.write(f"usemtl {mat_name}\n")
                            continue

                        if line.startswith("v "):
                            out.write(line)
                            local_v += 1
                            continue

                        if line.startswith("vt "):
                            out.write(line)
                            local_vt += 1
                            continue

                        if line.startswith("vn "):
                            out.write(line)
                            local_vn += 1
                            continue

                        if line.startswith("f "):
                            parts = line.strip().split()
                            new_parts = ["f"]
                            for part in parts[1:]:
                                m = face_pattern.fullmatch(part)
                                if m:
                                    vi = int(m.group(1)) + v_offset
                                    ti = m.group(3)
                                    ni = m.group(5)
                                    if ti is not None and ni is not None:
                                        new_parts.append(
                                            f"{vi}/{int(ti) + vt_offset}/{int(ni) + vn_offset}"
                                        )
                                    elif ti is not None:
                                        new_parts.append(f"{vi}/{int(ti) + vt_offset}")
                                    elif ni is not None:
                                        new_parts.append(f"{vi}//{int(ni) + vn_offset}")
                                    else:
                                        new_parts.append(str(vi))
                                else:
                                    new_parts.append(part)
                            out.write(" ".join(new_parts) + "\n")
                            continue

                        out.write(line)

                v_offset += local_v
                vt_offset += local_vt
                vn_offset += local_vn

                print(f"  -> {local_v} vertices, {local_vt} texcoords, {local_vn} normals")

            out.write(f"\n# Total: {v_offset} vertices, {vt_offset} texcoords, {vn_offset} normals\n")

        merged_obj_path = os.path.join(work_dir, "merged.obj")
        print(f"\nDone! Merged file saved to: {merged_obj_path}")
        print(f"Total: {v_offset} vertices, {vt_offset} texcoords, {vn_offset} normals")

        return merged_obj_path

    finally:
        os.chdir(original_cwd)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python merge_objs.py <work_directory>", file=sys.stderr)
        sys.exit(1)

    work_dir = sys.argv[1]
    if not os.path.isdir(work_dir):
        print(f"Error: directory not found: {work_dir}", file=sys.stderr)
        sys.exit(1)

    result = merge_obj_files(work_dir)
    if result is None:
        print("Error: merge failed (no OBJ files found)", file=sys.stderr)
        sys.exit(1)
