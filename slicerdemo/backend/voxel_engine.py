"""
voxel_engine.py - 核心体素化等体积切割算法（Python/trimesh/numpy 实现）

相比 JS 版本的优势：
- trimesh 自带加速射线检测（Cython 后端）
- numpy 数组运算效率比 JS 高 10~100 倍
- 网格修复（fill_holes / fix_normals）一行代码完成
"""
import numpy as np
import trimesh
import subprocess
import os
import tempfile
import gc
from typing import List, Dict, Any, Tuple


def repair_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """
    网格修复：
    1. 统一法线朝外
    2. 填充孔洞（fill_holes）
    3. 移除退化面
    4. 确保水密（watertight）
    """
    mesh = mesh.copy()
    # 统一法线
    mesh.fix_normals()
    # 填充孔洞
    mesh.fill_holes()
    # 移除退化面
    mesh.remove_degenerate_faces()
    # 合并接近的顶点
    mesh.merge_vertices()
    return mesh


def voxelize_mesh(
    mesh: trimesh.Trimesh,
    voxel_divisions: int,
    on_progress=None,
) -> Tuple[np.ndarray, dict]:
    """
    体素化网格，使用 trimesh 内置 voxelized()（空间细分法，内存友好）。

    返回：
        occupied : np.ndarray(bool), shape (nX, nY, nZ)
        info     : dict with box, voxel_size, nX, nY, nZ, axis, axis_min, axis_max
    """
    # 包围盒
    bounds = mesh.bounds
    box_min = bounds[0]
    box_max = bounds[1]
    size = box_max - box_min

    # 确定切割轴（最长水平轴）
    if size[0] >= size[1]:
        axis = 0  # X 轴
    else:
        axis = 1  # Y 轴

    axis_len = size[axis]
    voxel_size = axis_len / voxel_divisions

    nX = max(1, int(np.ceil(size[0] / voxel_size)))
    nY = max(1, int(np.ceil(size[1] / voxel_size)))
    nZ = max(1, int(np.ceil(size[2] / voxel_size)))

    occupied = np.zeros((nX, nY, nZ), dtype=bool)

    if on_progress:
        on_progress(0.06)

    # 用 trimesh 内置体素化（subdivide 法填充网格内部，不依赖射线求交）
    voxel_grid = mesh.voxelized(pitch=voxel_size, method='subdivide')

    if on_progress:
        on_progress(0.50)

    # 从 VoxelGrid 中提取填充体素的网格坐标
    # voxel_grid.points 是填充体素中心点数组 (N, 3)
    # 或者用 encoding 的稀疏字典直接拿索引
    if hasattr(voxel_grid, 'encoding') and voxel_grid.encoding is not None:
        # 尝试稀疏编码（_data 是 {(ix,iy,iz): bool} 的 dict）
        enc_data = getattr(voxel_grid.encoding, '_data', None)
        if isinstance(enc_data, dict):
            for (ix, iy, iz), val in enc_data.items():
                if val and 0 <= ix < nX and 0 <= iy < nY and 0 <= iz < nZ:
                    occupied[ix, iy, iz] = True
        else:
            # 回退：从 points 计算索引
            _fill_from_points(voxel_grid, occupied, box_min, voxel_size, nX, nY, nZ)
    else:
        _fill_from_points(voxel_grid, occupied, box_min, voxel_size, nX, nY, nZ)

    if on_progress:
        on_progress(0.85)

    voxel_volume = voxel_size ** 3
    total_voxels = int(occupied.sum())
    info = {
        "voxel_size": voxel_size,
        "nX": nX,
        "nY": nY,
        "nZ": nZ,
        "axis": axis,
        "axis_min": box_min[axis],
        "axis_max": box_max[axis],
        "box_min": box_min.tolist(),
        "box_max": box_max.tolist(),
        "voxel_volume": voxel_volume,
        "total_voxels": total_voxels,
        "total_volume": float(total_voxels * voxel_volume),
    }
    print(f"[INFO] 体素化完成：{total_voxels:,} / {nX * nY * nZ:,} voxels filled", flush=True)
    return occupied, info


def _fill_from_points(voxel_grid, occupied, box_min, voxel_size, nX, nY, nZ):
    """从 VoxelGrid.points 回填 occupied 数组"""
    pts = np.asarray(voxel_grid.points, dtype=np.float64)
    if len(pts) == 0:
        return
    # 批量计算整数索引
    ix = np.floor((pts[:, 0] - box_min[0]) / voxel_size).astype(int)
    iy = np.floor((pts[:, 1] - box_min[1]) / voxel_size).astype(int)
    iz = np.floor((pts[:, 2] - box_min[2]) / voxel_size).astype(int)
    # 裁剪边界
    valid = (ix >= 0) & (ix < nX) & (iy >= 0) & (iy < nY) & (iz >= 0) & (iz < nZ)
    occupied[ix[valid], iy[valid], iz[valid]] = True


def compute_equal_volume_cuts(
    occupied: np.ndarray,
    info: dict,
    N: int,
    on_progress=None,
) -> Dict[str, Any]:
    """
    根据体素占据矩阵，计算等体积垂直切割面。

    参数：
        occupied   : bool ndarray (nX, nY, nZ)
        info       : voxelize_mesh 返回的 info dict
        N          : 切割刀数（产生 N+1 块）
        on_progress: 进度回调

    返回：
        {
            "cut_planes": [x0, x1, ...],   # 切割面坐标（世界坐标）
            "axis": "x" or "y",
            "slice_volumes": [v0, v1, ...],  # 每块体积
            "slice_percentages": [p0, p1, ...], # 每块占比 (%)
            "total_volume": float,
            "box_min": [x,y,z],
            "box_max": [x,y,z],
        }
    """
    axis = info["axis"]
    nX, nY, nZ = info["nX"], info["nY"], info["nZ"]
    voxel_vol = info["voxel_volume"]
    axis_min = info["axis_min"]
    axis_max = info["axis_max"]
    voxel_size = info["voxel_size"]

    # 沿切割轴统计每列的"内部体素"数量
    if axis == 0:  # X 轴
        n_cut = nX
        column_counts = occupied.sum(axis=(1, 2))  # shape (nX,)
    else:  # Y 轴
        n_cut = nY
        column_counts = occupied.sum(axis=(0, 2))  # shape (nY,)

    total_count = int(column_counts.sum())
    total_volume = total_count * voxel_vol
    target_per_slice = total_count / (N + 1)

    if on_progress:
        on_progress(0.90)

    # 寻找切割面
    cut_planes = []
    cumulative = 0
    i = 0
    while len(cut_planes) < N and i < n_cut:
        cumulative += int(column_counts[i])
        if cumulative >= target_per_slice * (len(cut_planes) + 1):
            # 线性插值定位切割面
            prev_cum = cumulative - int(column_counts[i])
            excess = cumulative - target_per_slice * (len(cut_planes) + 1)
            count_i = int(column_counts[i])
            frac = 1.0 - (excess / count_i) if count_i > 0 else 0.0
            coord = axis_min + (i + frac) * voxel_size
            cut_planes.append(float(coord))
        i += 1

    # 补足（极端情况，某列体素数为 0 导致不够切割面）
    while len(cut_planes) < N:
        prev = cut_planes[-1] if cut_planes else axis_min
        cut_planes.append(float((prev + axis_max) / 2))

    # 计算每块体积
    slice_volumes = [0.0] * (N + 1)
    slice_idx = 0
    cum_for_vol = 0
    for i in range(n_cut):
        cum_for_vol += int(column_counts[i])
        while slice_idx < N and cum_for_vol >= target_per_slice * (slice_idx + 1):
            slice_idx += 1
        if slice_idx <= N:
            slice_volumes[slice_idx] += int(column_counts[i]) * voxel_vol

    slice_percentages = [round(v / total_volume * 100, 2) for v in slice_volumes]

    if on_progress:
        on_progress(1.0)

    axis_name = "x" if axis == 0 else "y"

    return {
        "cut_planes": cut_planes,
        "axis": axis_name,
        "slice_volumes": [float(v) for v in slice_volumes],
        "slice_percentages": slice_percentages,
        "total_volume": float(total_volume),
        "box_min": info["box_min"],
        "box_max": info["box_max"],
        "voxel_size": voxel_size,
        "n_cut": n_cut,
        "axis_min": axis_min,
        "axis_max": axis_max,
    }


def process_glb(
    file_path: str,
    N: int,
    voxel_divisions: int,
    on_progress=None,
) -> Dict[str, Any]:
    """
    完整处理流程：加载 GLB → 修复 → 体素化 → 等体积切割

    参数：
        file_path        : GLB 文件路径
        N                : 切割刀数
        voxel_divisions  : 体素分辨率（沿最长轴）
        on_progress      : 进度回调，接收 0~1 的浮点数

    返回：结果 dict（同 compute_equal_volume_cuts）
    """
    if on_progress:
        on_progress(0.01)

    # 加载 GLB（先解压 Meshopt 压缩，trimesh 4.x 原生不支持）
    decompressed_path = None
    
    try:
        # 先尝试直接加载
        scene_or_mesh = trimesh.load(file_path, force='mesh')
    except (IndexError, KeyError, Exception) as e:
        # Meshopt 压缩导致 trimesh 崩溃 → 用 @gltf-transform 解压后重试
        import sys
        node_exe = os.path.join(
            os.path.dirname(sys.executable), '..', '..', '..',
            '.workbuddy', 'binaries', 'node', 'versions', '22.22.2', 'node.exe'
        )
        # 回退到系统 node
        if not os.path.exists(node_exe):
            node_exe = "node"
        
        decompressed_path = file_path + ".decompressed.glb"
        script = os.path.join(os.path.dirname(__file__), "decompress_glb.js")
        
        result = subprocess.run(
            [node_exe, script, file_path, decompressed_path],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"GLB 加载失败（含 Meshopt 解压也失败）：{e}\n"
                f"解压脚本输出：{result.stderr}"
            )
        
        scene_or_mesh = trimesh.load(decompressed_path, force='mesh')
    
    if isinstance(scene_or_mesh, trimesh.Scene):
        # 多 mesh 场景 → 合并所有几何体
        geoms = []
        for name, geom in scene_or_mesh.geometry.items():
            if isinstance(geom, trimesh.Trimesh):
                geoms.append(geom)
        if len(geoms) == 0:
            raise ValueError("GLB 中未找到可用的网格几何体")
        mesh = trimesh.util.concatenate(geoms)
    else:
        mesh = scene_or_mesh

    if on_progress:
        on_progress(0.03)

    # 修复
    mesh = repair_mesh(mesh)

    if on_progress:
        on_progress(0.04)

    # 大模型降采样：三角面 > 10万 时简化
    FACE_LIMIT = 100_000
    original_faces = len(mesh.faces)
    if original_faces > FACE_LIMIT:
        mesh = mesh.simplify_quadric_decimation(face_count=FACE_LIMIT)
        if on_progress:
            on_progress(0.05)
        print(f"[INFO] 网格简化：{original_faces:,} → {len(mesh.faces):,} faces", flush=True)

    # 体素化
    def _voxel_progress(p):
        if on_progress:
            on_progress(p)

    occupied, info = voxelize_mesh(mesh, voxel_divisions, on_progress=_voxel_progress)

    # 等体积切割
    result = compute_equal_volume_cuts(occupied, info, N, on_progress=on_progress)
    return result
