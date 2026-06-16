/**
 * manualAlign — 底面矫正 + 封底功能
 *
 * autoAlignTopFace(wrapper): 原地修改 wrapper 的 quat/pos，让模型平放+贴地
 * addBottomCap(group):       在模型底部 XZ 投影凸包位置添加水平底面（wrappper 子节点）
 */

import * as THREE from 'three';

/** 收集 Group 所有子 mesh 的世界坐标顶点 */
export function collectWorldVertices(
  group: THREE.Group,
  maxCount: number = Infinity,
  includeCap: boolean = false,
): number[] {
  const pts: number[] = [];
  group.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // 默认跳过封底面 mesh；includeCap=true 时包含
    if (!includeCap && mesh.name === 'bottom-cap') return;
    const pos = mesh.geometry.attributes.position;
    if (!pos || pos.count === 0) return;
    const step = maxCount === Infinity ? 1 : Math.max(1, Math.floor(pos.count / maxCount));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      v.applyMatrix4(mesh.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
  });
  return pts;
}

/** 计算 Group 的包围盒（世界坐标）*/
export function computeBox(group: THREE.Group, includeCap: boolean = false): THREE.Box3 | null {
  const box = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!includeCap && mesh.name === 'bottom-cap') return;
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const nodeBox = geo.boundingBox!.clone();
    nodeBox.applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(nodeBox.min);
    box.expandByPoint(nodeBox.max);
  });
  return box.isEmpty() ? null : box;
}

/* ═════════════════════════════════════════════
   autoAlignTopFace - 底面矫正 + 贴地（原地修改）
═════════════════════════════════════════════ */
export function autoAlignTopFace(
  wrapper: THREE.Group,
  includeCap: boolean = false,
  onDone?: () => void,
): void {
  console.time('[autoAlign]');

  // ── 记录是否有封底面 + 先移除旧封底面 ──
  // 旧封底面的局部几何体对应于当前 wrapper 朝向。
  // 一旦 wrapper 归零 (identity)，旧几何体在世界空间的位置就是错的，
  // 包含这些顶点会误导 PCA。
  const hadCap = wrapper.getObjectByName('bottom-cap') !== undefined;
  if (hadCap) {
    wrapper.remove(wrapper.getObjectByName('bottom-cap')!);
  }

  // ── 归零 wrapper ──
  wrapper.quaternion.identity();
  wrapper.position.set(0, 0, 0);
  wrapper.updateMatrix();
  wrapper.updateWorldMatrix(true, true);

  // ── 收集顶点（不包含封底面 — 旧封底面已移除，若 includeCap 会在后面重建）─
  const verts = collectWorldVertices(wrapper, 8000, false);
  const n = verts.length / 3;

  if (n < 20) {
    console.warn('[autoAlign] too few vertices:', n);
    console.timeEnd('[autoAlign]');
    onDone?.();
    return;
  }

  // ── 协方差矩阵 ──
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < verts.length; i += 3) { cx += verts[i]; cy += verts[i + 1]; cz += verts[i + 2]; }
  cx /= n; cy /= n; cz /= n;

  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (let i = 0; i < verts.length; i += 3) {
    const dx = verts[i] - cx, dy = verts[i + 1] - cy, dz = verts[i + 2] - cz;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }
  cxx /= n; cxy /= n; cxz /= n; cyy /= n; cyz /= n; czz /= n;

  // 功率迭代
  const power = (sx: number, sy: number, sz: number, it = 25): [number, number, number] => {
    let vx = sx, vy = sy, vz = sz;
    const l0 = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (l0 < 1e-10) return [1, 0, 0];
    vx /= l0; vy /= l0; vz /= l0;
    for (let k = 0; k < it; k++) {
      const nx = cxx * vx + cxy * vy + cxz * vz;
      const ny = cxy * vx + cyy * vy + cyz * vz;
      const nz = cxz * vx + cyz * vy + czz * vz;
      const ln = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (ln < 1e-15) break;
      vx = nx / ln; vy = ny / ln; vz = nz / ln;
    }
    return [vx, vy, vz];
  };

  const [e1x, e1y, e1z] = power(1, 0, 0);
  const d = e1x * 0 + e1y * 1 + e1z * 0;
  const t2x = 0 - e1x * d, t2y = 1 - e1y * d, t2z = 0 - e1z * d;
  const t2l = Math.sqrt(t2x * t2x + t2y * t2y + t2z * t2z);
  const [e2x, e2y, e2z] = t2l > 0.1 ? power(t2x / t2l, t2y / t2l, t2z / t2l) : power(0, 0, 1);
  const e3x = e1y * e2z - e1z * e2y;
  const e3y = e1z * e2x - e1x * e2z;
  const e3z = e1x * e2y - e1y * e2x;

  // ── 特征值分析：判断模型是"扁平"还是"体积型" ──
  // 扁平模型（如鞋垫）：最小特征值远小于最大特征值 → 用 Y-高度最小化
  // 体积型模型（如城堡）：各方向方差相近 → 用底面平坦度 + Y 对齐加分
  const rayleigh = (ex: number, ey: number, ez: number) =>
    ex * (cxx * ex + cxy * ey + cxz * ez) +
    ey * (cxy * ex + cyy * ey + cyz * ez) +
    ez * (cxz * ex + cyz * ey + czz * ez);
  const lambda1 = Math.abs(rayleigh(e1x, e1y, e1z));
  const lambda2 = Math.abs(rayleigh(e2x, e2y, e2z));
  const lambda3 = Math.abs(rayleigh(e3x, e3y, e3z));
  const flatnessRatio = Math.min(lambda1, lambda2, lambda3) / Math.max(lambda1, lambda2, lambda3);
  const isFlat = flatnessRatio < 0.20;

  console.log(`[autoAlign] eigenvalues: λ=${lambda1.toFixed(2)},${lambda2.toFixed(2)},${lambda3.toFixed(2)} ` +
    `ratio=${flatnessRatio.toFixed(4)} → ${isFlat ? 'FLAT (min Y-height)' : 'VOLUMETRIC (max bottom flatness)'}`);

  // 9 个候选方向
  const cand: [number, number, number, string][] = [
    [e1x, e1y, e1z, 'PCA-1'], [e2x, e2y, e2z, 'PCA-2'], [e3x, e3y, e3z, 'PCA-3'],
    [1, 0, 0, '+X'], [-1, 0, 0, '-X'],
    [0, 1, 0, '+Y'], [0, -1, 0, '-Y'],
    [0, 0, 1, '+Z'], [0, 0, -1, '-Z'],
  ];

  const tv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dn = new THREE.Vector3(0, -1, 0);

  let bestScore = -Infinity, bestQ = new THREE.Quaternion(), bestL = '?';
  let bestAlign = 0; // for tiebreaking
  const bottomRatio = 0.15;
  const bottomMinCount = 10;

  const rotBuf = new Float64Array(n * 3);
  const yBuf = new Float64Array(n);

  for (const [ax, ay, az, lb] of cand) {
    const axis = new THREE.Vector3(ax, ay, az).normalize();
    const tgt = axis.dot(up) >= axis.dot(dn) ? up : dn;
    const q = new THREE.Quaternion().setFromUnitVectors(axis, tgt);

    // 旋转所有顶点
    for (let i = 0, j = 0; i < verts.length; i += 3, j++) {
      tv.set(verts[i], verts[i + 1], verts[i + 2]);
      tv.applyQuaternion(q);
      rotBuf[j * 3] = tv.x;
      rotBuf[j * 3 + 1] = tv.y;
      rotBuf[j * 3 + 2] = tv.z;
      yBuf[j] = tv.y;
    }

    const ySorted = Array.from(yBuf).sort((a, b) => a - b);
    const ySpan = ySorted[n - 1] - ySorted[0];
    const bottomK = Math.max(bottomMinCount, Math.floor(n * bottomRatio));
    const bottomThreshold = ySorted[bottomK - 1];

    // 收集底部顶点 → XZ 凸包面积
    const bottomPts: [number, number][] = [];
    for (let j = 0; j < n; j++) {
      if (rotBuf[j * 3 + 1] <= bottomThreshold + 1e-6) {
        bottomPts.push([rotBuf[j * 3], rotBuf[j * 3 + 2]]);
      }
    }

    const hull = convexHull2D(bottomPts);
    let hullArea = 0;
    if (hull.length >= 3) {
      for (let i = 1; i < hull.length - 1; i++) {
        const ax = hull[i][0] - hull[0][0];
        const ay = hull[i][1] - hull[0][1];
        const bx = hull[i + 1][0] - hull[0][0];
        const by = hull[i + 1][1] - hull[0][1];
        hullArea += Math.abs(ax * by - ay * bx);
      }
      hullArea *= 0.5;
    }

    // 底部 Y 方差
    let sumY = 0, sumY2 = 0;
    for (let k = 0; k < bottomK; k++) { sumY += ySorted[k]; sumY2 += ySorted[k] * ySorted[k]; }
    const meanY = sumY / bottomK;
    const yVar = sumY2 / bottomK - meanY * meanY;
    const flatnessScore = hullArea / Math.max(yVar, 1e-4);

    // Y 对齐度：候选轴与 +Y 的夹角余弦绝对值（1=垂直, 0=水平）
    const yAlign = Math.abs(axis.dot(up));

    // ── 根据模型形状选择评分策略 ──
    let score: number;
    if (isFlat) {
      // 扁平模型：最小化 Y 高度 → 鞋垫平放
      score = -ySpan;
      console.log(`[autoAlign] ${lb}: ySpan=${ySpan.toFixed(2)} flat=${flatnessScore.toFixed(1)} ` +
        `align=${yAlign.toFixed(2)} → score=${score.toFixed(2)}`);
    } else {
      // 体积型模型：最大化底面平坦度 + Y 对齐加分（30%）
      // 加分让竖向候选在相近平坦度时胜出 → 城堡自然直立
      score = flatnessScore * (1 + yAlign * 0.30);
      console.log(`[autoAlign] ${lb}: flat=${flatnessScore.toFixed(1)} yVar=${yVar.toFixed(4)} ` +
        `align=${yAlign.toFixed(2)} ySpan=${ySpan.toFixed(2)} → score=${score.toFixed(2)}`);
    }

    // ── 平局处理：分数相近时偏向 Y 对齐更高的候选 ──
    if (bestScore !== -Infinity) {
      const relativeGap = Math.abs(score - bestScore) / Math.max(Math.abs(bestScore), 1e-6);
      if (relativeGap < 0.03 && yAlign > bestAlign) {
        // 分数差距 <3%，且 Y 对齐更高 → 用对齐度打破平局
        score = bestScore + 1; // 微小优势
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestQ.copy(q);
      bestL = lb;
      bestAlign = yAlign;
    }
  }

  console.log(`[autoAlign] best: ${bestL} score=${bestScore.toFixed(2)} align=${bestAlign.toFixed(2)}`);

  // ── 应用旋转 ──
  wrapper.quaternion.copy(bestQ);
  wrapper.position.set(0, 0, 0);
  wrapper.updateMatrix();
  wrapper.updateWorldMatrix(true, true);

  // ── 贴地（用精确顶点最低 Y，不用 box.min.y）──
  // box.min.y 可能与实际顶点位置有差异（轴对齐包围盒 vs 旋转后的网格）
  // 用精确顶点 Y 确保模型 + 封底面完全贴合在 y=0
  const pv = collectWorldVertices(wrapper, Infinity, false);
  let exactMinY = Infinity;
  for (let i = 1; i < pv.length; i += 3) {
    if (pv[i] < exactMinY) exactMinY = pv[i];
  }
  if (Number.isFinite(exactMinY)) {
    wrapper.position.y -= exactMinY;
    console.log('[autoAlign] grounding: exactMinY=', exactMinY.toFixed(6), '→ pos.y=', wrapper.position.y.toFixed(6));
  }

  wrapper.updateMatrix();
  wrapper.updateWorldMatrix(true, true);

  // ── 对齐后重建封底面（强制 targetWorldY=0 确保在网格平面上）──
  if (hadCap || includeCap) {
    addBottomCap(wrapper, 0);
    console.log('[autoAlign] re-added bottom cap at y=0 after alignment');
  }

  // ── 安全贴地：封底面也作为模型一部分，确保没有任何顶点在 y=0 以下 ──
  {
    wrapper.updateMatrix();
    wrapper.updateWorldMatrix(true, true);
    const pvCheck = collectWorldVertices(wrapper, Infinity, true);
    let checkMinY = Infinity;
    for (let i = 1; i < pvCheck.length; i += 3) {
      if (pvCheck[i] < checkMinY) checkMinY = pvCheck[i];
    }
    if (Number.isFinite(checkMinY) && checkMinY < -0.0001) {
      wrapper.position.y -= checkMinY;
      wrapper.updateMatrix();
      wrapper.updateWorldMatrix(true, true);
      console.log('[autoAlign] safety clamp: minY was', checkMinY.toFixed(6), '→ shifted up by', (-checkMinY).toFixed(6));
    }
  }

  const pvFinal = collectWorldVertices(wrapper, Infinity, true);
  let finalMinY = Infinity, finalMaxY = -Infinity;
  for (let i = 1; i < pvFinal.length; i += 3) {
    if (pvFinal[i] < finalMinY) finalMinY = pvFinal[i];
    if (pvFinal[i] > finalMaxY) finalMaxY = pvFinal[i];
  }
  console.log('[autoAlign] done — pos.y:', wrapper.position.y.toFixed(4),
    '| exact min/max Y:', finalMinY.toFixed(4), '/', finalMaxY.toFixed(4));
  console.timeEnd('[autoAlign]');
  onDone?.();
}

/* ═════════════════════════════════════════════
   2D 凸包（Graham Scan）
═════════════════════════════════════════════ */
function convexHull2D(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points.length < 2 ? points : [points[0], points[1]];
  let piv = 0;
  for (let i = 1; i < points.length; i++)
    if (points[i][1] < points[piv][1] || (points[i][1] === points[piv][1] && points[i][0] < points[piv][0])) piv = i;

  const sorted = points.map((p, i) => ({ p, i })).sort((a, b) => {
    if (a.i === piv) return -1; if (b.i === piv) return 1;
    const aa = Math.atan2(a.p[1] - points[piv][1], a.p[0] - points[piv][0]);
    const ab = Math.atan2(b.p[1] - points[piv][1], b.p[0] - points[piv][0]);
    if (Math.abs(aa - ab) < 1e-12) {
      const dA = (a.p[0] - points[piv][0]) ** 2 + (a.p[1] - points[piv][1]) ** 2;
      const dB = (b.p[0] - points[piv][0]) ** 2 + (b.p[1] - points[piv][1]) ** 2;
      return dA - dB;
    }
    return aa - ab;
  });

  const stack: [number, number][] = [];
  for (const { p } of sorted) {
    while (stack.length >= 2) {
      const c = stack[stack.length - 1], b = stack[stack.length - 2];
      const cross = (b[0] - c[0]) * (p[1] - c[1]) - (b[1] - c[1]) * (p[0] - c[0]);
      if (cross >= 0) stack.pop(); else break;
    }
    stack.push(p);
  }
  return stack;
}

/* ═════════════════════════════════════════════
   addBottomCap — 在模型底部添加水平底面

   形状 = 模型所有顶点在 XZ 平面的投影凸包（世界坐标）
   封底面放在模型实际底部 Y 坐标（minWorldY）处，精确贴合。

   工作原理：
   世界凸包点 (xw, minWorldY, zw) → 逆变换到 wrapper 局部空间：
     localPos = matrixWorld⁻¹ * (xw, minWorldY, zw)
   渲染时：
     worldPos = matrixWorld * localPos = (xw, minWorldY, zw)  ← 紧贴模型底部
═════════════════════════════════════════════ */
export function addBottomCap(group: THREE.Group, targetWorldY?: number): THREE.Mesh | null {
  group.updateWorldMatrix(true, true);

  // 移除旧封底
  const old = group.getObjectByName('bottom-cap');
  if (old) {
    ((old as THREE.Mesh).geometry as THREE.BufferGeometry)?.dispose();
    const oldMat = (old as THREE.Mesh).material;
    if (Array.isArray(oldMat)) {
      oldMat.forEach(m => (m as THREE.Material).dispose());
    } else {
      (oldMat as THREE.Material).dispose();
    }
    group.remove(old);
  }

  // ── 收集所有顶点 → XZ 投影 + 找最低 Y（世界坐标）──
  const pts2D: [number, number][] = [];
  let minWorldY = Infinity;
  const v = new THREE.Vector3();
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || mesh.name === 'bottom-cap') return;
    const pos = mesh.geometry.attributes.position;
    if (!pos || pos.count === 0) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      v.applyMatrix4(mesh.matrixWorld);
      if (v.y < minWorldY) minWorldY = v.y;
      pts2D.push([v.x, v.z]);
    }
  });

  if (pts2D.length < 3 || !Number.isFinite(minWorldY)) return null;

  const hull = convexHull2D(pts2D);
  if (hull.length < 3) return null;

  // ── 封底面的世界 Y 坐标 ──
  // targetWorldY 在 autoAlignTopFace 贴地后传入 0，确保底面精确在网格水平面
  // 未传入时用模型实际最低顶点 Y
  const capWorldY = targetWorldY !== undefined
    ? targetWorldY
    : (Math.abs(minWorldY) < 0.001 ? 0 : minWorldY);

  // ── 凸包点放在指定世界 Y ──
  const invWorld = group.matrixWorld.clone().invert();
  const localPts: THREE.Vector3[] = [];
  for (const [xw, zw] of hull) {
    const wp = new THREE.Vector3(xw, capWorldY, zw);
    const lp = wp.applyMatrix4(invWorld);
    localPts.push(lp);
  }

  // ── BufferGeometry 三角形扇（fan triangulation）──
  const verts: number[] = [];
  const norms: number[] = [];

  const p0 = localPts[0];
  for (let i = 1; i < localPts.length - 1; i++) {
    const p1 = localPts[i], p2 = localPts[i + 1];

    verts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);

    // 统一朝上的法线
    const e1x = p1.x - p0.x, e1y = p1.y - p0.y, e1z = p1.z - p0.z;
    const e2x = p2.x - p0.x, e2y = p2.y - p0.y, e2z = p2.z - p0.z;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    norms.push(nx / nl, ny / nl, nz / nl, nx / nl, ny / nl, nz / nl, nx / nl, ny / nl, nz / nl);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));

  const mat = new THREE.MeshStandardMaterial({
    color: 0x7090c0,
    side: THREE.DoubleSide,
    roughness: 0.5,
    metalness: 0.05,
    // 不透明，与模型外观完全一致 → 视觉上一体化
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'bottom-cap';
  // 普通子节点 — 自然跟随 wrapper 变换
  group.add(mesh);

  console.log('[addBottomCap] base at worldY=', capWorldY.toFixed(4),
    '(minVtxY=', minWorldY.toFixed(4), targetWorldY !== undefined ? ' forced' : ' auto', ') |',
    hull.length, 'hull vertices');
  return mesh;
}
