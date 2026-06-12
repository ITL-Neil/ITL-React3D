"""
main.py - FastAPI 后端主入口

接口设计：
  POST /api/slice
    Body (multipart/form-data):
      file: GLB/GLTF 文件
      N: 切割刀数（int）
      resolution: 体素分辨率（int，默认 60）
    Response (JSON):
      {
        "cut_planes": [x0, x1, ...],
        "axis": "x" | "y",
        "slice_volumes": [v0, v1, ...],
        "slice_percentages": [p0, p1, ...],
        "total_volume": float,
        "box_min": [x,y,z],
        "box_max": [x,y,z],
        "voxel_size": float,
      }

  GET /api/health
    Response: {"status": "ok"}
"""
import tempfile
import os
import time
import traceback
from typing import Any, Dict, List

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from voxel_engine import process_glb

# ── 创建 App ──
app = FastAPI(
    title="Coal Slicer API",
    description="煤山 3D 模型等体积切割后端",
    version="1.0.0",
)

# ── CORS（允许前端 localhost:5173 调用） ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 工具：格式化体积 ──
def format_volume(v: float) -> str:
    if v < 1e-6:
        return f"{v * 1e9:.2f} mm³"
    if v < 1e-3:
        return f"{v * 1e6:.2f} cm³"
    if v < 1:
        return f"{v * 1e3:.2f} L"
    return f"{v:.4f} m³"


# ── 健康检查 ──
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "coal-slicer-api"}


# ── 主接口：上传 + 切割 ──
@app.post("/api/slice")
async def slice_mesh(
    file: UploadFile = File(..., description="GLB 或 GLTF 文件"),
    N: int = Form(..., description="切割刀数（产生 N+1 块）"),
    resolution: int = Form(60, description="体素分辨率（沿最长轴）"),
):
    """
    接收 GLB 文件，进行等体积垂直切割，返回切割面参数。
    """
    # 参数校验
    if N < 1 or N > 100:
        raise HTTPException(status_code=400, detail="N 必须在 1~100 之间")
    if resolution < 10 or resolution > 300:
        raise HTTPException(status_code=400, detail="resolution 必须在 10~300 之间")

    suffix = os.path.splitext(file.filename)[1].lower()
    if suffix not in (".glb", ".gltf"):
        raise HTTPException(status_code=400, detail="仅支持 .glb 或 .gltf 文件")

    # 将上传文件写入临时文件
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        # 记录开始时间
        t0 = time.time()

        # 进度跟踪（可选，暂存到局部变量）
        progress_state = {"p": 0.0}

        def _on_progress(p: float):
            progress_state["p"] = p

        # 核心处理
        result = process_glb(
            file_path=tmp_path,
            N=N,
            voxel_divisions=resolution,
            on_progress=_on_progress,
        )

        elapsed = round(time.time() - t0, 2)

        # 为每个块附加格式化体积字符串
        slice_volumes_fmt = [format_volume(v) for v in result["slice_volumes"]]

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "elapsed_seconds": elapsed,
                "axis": result["axis"],
                "cut_planes": result["cut_planes"],
                "slice_volumes": result["slice_volumes"],
                "slice_volumes_fmt": slice_volumes_fmt,
                "slice_percentages": result["slice_percentages"],
                "total_volume": result["total_volume"],
                "total_volume_fmt": format_volume(result["total_volume"]),
                "box_min": result["box_min"],
                "box_max": result["box_max"],
                "voxel_size": result["voxel_size"],
                "n_cuts": len(result["cut_planes"]),
                "n_slices": len(result["slice_volumes"]),
            }
        )

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[ERROR] /api/slice failed:\n{tb}", flush=True)
        raise HTTPException(status_code=500, detail=f"处理失败：{str(e)}")

    finally:
        # 清理所有临时文件
        for p in [tmp_path, tmp_path + ".decompressed.glb"] if tmp_path else []:
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except:
                    pass


# ── 启动入口 ──
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info",
    )
