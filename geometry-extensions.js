/**
 * GEOMETRY EXTENSIONS MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * P1: Voronoi diagrams, Klein model, hyperbolic embeddings
 * P3: Parallel transport, H^3 visualization foundations
 *
 * Dependencies: hyperbolic-engine.js (C, cadd, cmul, hypDist, mobius, etc.)
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// P1: KLEIN MODEL
// ════════════════════════════════════════════════════════════════════════════
// Geodesics are straight lines in Klein model - useful for intersection

/**
 * Convert Poincaré disk point to Klein disk
 * Klein: k = 2p / (1 + |p|²)
 */
function poincareToKlein(z) {
  const r2 = z.re * z.re + z.im * z.im;
  const denom = 1 + r2;
  return {
    x: (2 * z.re) / denom,
    y: (2 * z.im) / denom
  };
}

/**
 * Convert Klein disk point to Poincaré disk
 * Poincaré: p = k / (1 + √(1 - |k|²))
 */
function kleinToPoincare(k) {
  const r2 = k.x * k.x + k.y * k.y;
  if (r2 >= 1) {
    // Clamp to boundary
    const scale = 0.999 / Math.sqrt(r2);
    k = { x: k.x * scale, y: k.y * scale };
  }
  const denom = 1 + Math.sqrt(Math.max(0, 1 - r2));
  return C(k.x / denom, k.y / denom);
}

/**
 * Hyperbolic distance in Klein model
 * Uses cross-ratio with ideal points
 */
function kleinDist(k1, k2) {
  // Convert to Poincaré and use standard formula
  const p1 = kleinToPoincare(k1);
  const p2 = kleinToPoincare(k2);
  return hypDist(p1, p2);
}

/**
 * Geodesic in Klein model is a straight line segment
 * Returns endpoints (possibly on boundary)
 */
function kleinGeodesic(k1, k2, extend = false) {
  if (!extend) {
    return { start: k1, end: k2 };
  }

  // Extend to unit circle boundary
  const dx = k2.x - k1.x;
  const dy = k2.y - k1.y;

  // Line: k1 + t*(k2-k1), find t where |k|² = 1
  // |k1 + t*d|² = 1
  // |k1|² + 2t(k1·d) + t²|d|² = 1
  const a = dx * dx + dy * dy;
  const b = 2 * (k1.x * dx + k1.y * dy);
  const c = k1.x * k1.x + k1.y * k1.y - 1;

  const disc = b * b - 4 * a * c;
  if (disc < 0) return { start: k1, end: k2 };

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  return {
    start: { x: k1.x + t1 * dx, y: k1.y + t1 * dy },
    end: { x: k1.x + t2 * dx, y: k1.y + t2 * dy }
  };
}

/**
 * Intersection of two Klein geodesics (straight lines)
 * Returns null if parallel or no intersection
 */
function kleinGeodesicIntersect(g1, g2) {
  const d1x = g1.end.x - g1.start.x;
  const d1y = g1.end.y - g1.start.y;
  const d2x = g2.end.x - g2.start.x;
  const d2y = g2.end.y - g2.start.y;

  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-10) return null; // Parallel

  const dx = g2.start.x - g1.start.x;
  const dy = g2.start.y - g1.start.y;

  const t = (dx * d2y - dy * d2x) / det;
  const s = (dx * d1y - dy * d1x) / det;

  // Check if intersection is within both segments
  if (t < 0 || t > 1 || s < 0 || s > 1) return null;

  return {
    x: g1.start.x + t * d1x,
    y: g1.start.y + t * d1y
  };
}

// ════════════════════════════════════════════════════════════════════════════
// P1: HYPERBOLIC VORONOI DIAGRAMS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compute perpendicular bisector between two points in Poincaré disk
 * Returns a geodesic arc (circle arc in Poincaré, line in Klein)
 */
function hyperbolicBisector(z1, z2, numPoints = 64) {
  // In Klein model, bisector is a straight line
  const k1 = poincareToKlein(z1);
  const k2 = poincareToKlein(z2);

  // Midpoint in Klein
  const midK = { x: (k1.x + k2.x) / 2, y: (k1.y + k2.y) / 2 };

  // Direction perpendicular to k1-k2
  const dx = k2.x - k1.x;
  const dy = k2.y - k1.y;
  const perpX = -dy;
  const perpY = dx;

  // Extend bisector to disk boundary
  const len = Math.sqrt(perpX * perpX + perpY * perpY);
  if (len < 1e-10) return [];

  const nx = perpX / len;
  const ny = perpY / len;

  // Find intersection with unit circle
  // |mid + t*n|² = 1
  const a = 1; // |n|² = 1
  const b = 2 * (midK.x * nx + midK.y * ny);
  const c = midK.x * midK.x + midK.y * midK.y - 1;

  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / 2;
  const t2 = (-b + sqrtDisc) / 2;

  const p1K = { x: midK.x + t1 * nx, y: midK.y + t1 * ny };
  const p2K = { x: midK.x + t2 * nx, y: midK.y + t2 * ny };

  // Convert back to Poincaré and sample the arc
  const p1 = kleinToPoincare(p1K);
  const p2 = kleinToPoincare(p2K);

  return sampleGeodesic(p1, p2, numPoints);
}

/**
 * Compute Voronoi cell for a center point given its neighbors
 * Returns array of vertices in Poincaré disk coordinates
 */
function hyperbolicVoronoiCell(center, neighbors, maxRadius = 0.95) {
  if (neighbors.length === 0) {
    // No neighbors - return full disk approximation
    return hypCircle(center, 2, 64);
  }

  // Work in Klein model for easier intersection
  const centerK = poincareToKlein(center);

  // Compute all bisector lines
  const bisectors = neighbors.map(neighbor => {
    const neighborK = poincareToKlein(neighbor);
    const midK = {
      x: (centerK.x + neighborK.x) / 2,
      y: (centerK.y + neighborK.y) / 2
    };

    const dx = neighborK.x - centerK.x;
    const dy = neighborK.y - centerK.y;

    return {
      point: midK,
      normal: { x: dx, y: dy }, // Points away from center
      neighborK
    };
  });

  // Start with a large polygon (clipped disk)
  let vertices = [];
  const numSides = 32;
  for (let i = 0; i < numSides; i++) {
    const angle = (i / numSides) * Math.PI * 2;
    vertices.push({
      x: maxRadius * Math.cos(angle),
      y: maxRadius * Math.sin(angle)
    });
  }

  // Clip polygon by each bisector half-plane
  for (const bisector of bisectors) {
    vertices = clipPolygonByHalfPlane(vertices, bisector.point, bisector.normal);
    if (vertices.length < 3) break;
  }

  // Convert back to Poincaré
  return vertices.map(v => kleinToPoincare(v));
}

/**
 * Clip a polygon by a half-plane (Sutherland-Hodgman)
 * Keeps points on the side opposite to normal
 */
function clipPolygonByHalfPlane(vertices, point, normal) {
  if (vertices.length < 3) return [];

  const result = [];
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    // Distance from half-plane (negative = inside)
    const dCurr = (curr.x - point.x) * normal.x + (curr.y - point.y) * normal.y;
    const dNext = (next.x - point.x) * normal.x + (next.y - point.y) * normal.y;

    const currInside = dCurr <= 0;
    const nextInside = dNext <= 0;

    if (currInside) {
      result.push(curr);
    }

    if (currInside !== nextInside) {
      // Edge crosses the plane - find intersection
      const t = dCurr / (dCurr - dNext);
      result.push({
        x: curr.x + t * (next.x - curr.x),
        y: curr.y + t * (next.y - curr.y)
      });
    }
  }

  return result;
}

/**
 * Compute full Voronoi diagram for a set of points
 * Returns map: point index -> cell vertices
 */
function hyperbolicVoronoiDiagram(points, k = 8) {
  const cells = new Map();

  for (let i = 0; i < points.length; i++) {
    // Find k nearest neighbors
    const dists = points.map((p, j) => ({
      idx: j,
      dist: j === i ? Infinity : hypDist(points[i], p)
    }));
    dists.sort((a, b) => a.dist - b.dist);

    const neighbors = dists.slice(0, k).map(d => points[d.idx]);
    cells.set(i, hyperbolicVoronoiCell(points[i], neighbors));
  }

  return cells;
}

// ════════════════════════════════════════════════════════════════════════════
// P1: HYPERBOLIC EMBEDDINGS (Hierarchy Optimization)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Embed a tree hierarchy in hyperbolic space
 * Uses exponential spacing to preserve hierarchy
 */
function embedHierarchy(root, options = {}) {
  const {
    rootRadius = 0,        // Root at center
    branchAngle = 0.8,     // Radians per depth level
    radiusGrowth = 0.4,    // How fast radius increases
    spreadFactor = 0.9     // How much to spread siblings
  } = options;

  const positions = new Map();

  function embed(nodeId, node, parentZ, depth, angleStart, angleEnd) {
    // Compute position
    let z;
    if (depth === 0) {
      z = C(0, 0);
    } else {
      // Position along arc between angleStart and angleEnd
      const angle = (angleStart + angleEnd) / 2;
      const r = 1 - Math.exp(-radiusGrowth * depth);
      z = C(r * Math.cos(angle), r * Math.sin(angle));

      // Transform relative to parent
      if (parentZ) {
        z = mobius(cscale(parentZ, -1), z);
      }
    }

    positions.set(nodeId, z);

    // Embed children
    const children = node.children || [];
    if (children.length > 0) {
      const childAngleSpan = (angleEnd - angleStart) * spreadFactor;
      const childAngleStart = (angleStart + angleEnd) / 2 - childAngleSpan / 2;

      children.forEach((childId, i) => {
        const childNode = typeof childId === 'object' ? childId : { id: childId, children: [] };
        const t0 = i / children.length;
        const t1 = (i + 1) / children.length;
        embed(
          childNode.id || childId,
          childNode,
          z,
          depth + 1,
          childAngleStart + t0 * childAngleSpan,
          childAngleStart + t1 * childAngleSpan
        );
      });
    }
  }

  embed(root.id, root, null, 0, 0, Math.PI * 2);
  return positions;
}

/**
 * Optimize embedding using gradient descent
 * Minimizes distortion between graph distances and hyperbolic distances
 */
function optimizeEmbedding(points, targetDistances, iterations = 100, lr = 0.01) {
  // points: array of Complex
  // targetDistances: Map or matrix of target hyperbolic distances

  const n = points.length;
  const positions = points.map(p => ({ re: p.re, im: p.im }));

  for (let iter = 0; iter < iterations; iter++) {
    // Compute gradients
    const grads = positions.map(() => ({ re: 0, im: 0 }));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pi = C(positions[i].re, positions[i].im);
        const pj = C(positions[j].re, positions[j].im);

        const currentDist = hypDist(pi, pj);
        const targetDist = targetDistances.get(`${i}-${j}`) ||
                          targetDistances.get(`${j}-${i}`) ||
                          targetDistances[i]?.[j] ||
                          1;

        const error = currentDist - targetDist;

        // Gradient of hyperbolic distance
        // ∂d/∂z ≈ direction toward/away from other point
        const diff = csub(pj, pi);
        const dist = Math.max(0.001, cabs(diff));
        const grad = cscale(cnorm(diff), error / dist);

        grads[i].re -= grad.re * lr;
        grads[i].im -= grad.im * lr;
        grads[j].re += grad.re * lr;
        grads[j].im += grad.im * lr;
      }
    }

    // Apply gradients with projection to disk
    for (let i = 0; i < n; i++) {
      positions[i].re += grads[i].re;
      positions[i].im += grads[i].im;

      // Project back into disk
      const r = Math.sqrt(positions[i].re ** 2 + positions[i].im ** 2);
      if (r > 0.95) {
        const scale = 0.95 / r;
        positions[i].re *= scale;
        positions[i].im *= scale;
      }
    }
  }

  return positions.map(p => C(p.re, p.im));
}

// ════════════════════════════════════════════════════════════════════════════
// P3: PARALLEL TRANSPORT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parallel transport a tangent vector along a geodesic
 *
 * In H², parallel transport preserves the angle with the geodesic.
 * Uses the fact that hyperbolic translations are isometries.
 *
 * @param vector - Tangent vector at start point (as Complex)
 * @param start - Starting point
 * @param end - Ending point
 * @returns Transported vector at end point
 */
function parallelTransport(vector, start, end) {
  // Move to origin-centered frame via Möbius
  // Transport is trivial at origin (just rotation)
  // Then move back

  // 1. Map start to origin
  const toOrigin = cscale(start, -1);
  const endAtOrigin = mobius(toOrigin, end);

  // 2. The direction from origin to endAtOrigin
  const geodesicDir = carg(endAtOrigin);

  // 3. Vector angle relative to geodesic at start
  const vectorAngle = carg(vector);
  const relativeAngle = vectorAngle - carg(csub(end, start));

  // 4. At the destination, the geodesic has rotated
  // The tangent to the geodesic at end (mapped to origin frame)
  const geodesicTangentAtEnd = cpolar(1, geodesicDir + Math.PI);

  // 5. Rotate back to get transported vector direction
  const transportedAngle = carg(geodesicTangentAtEnd) + Math.PI + relativeAngle;
  const transportedMag = cabs(vector);

  // 6. The vector in the original frame
  return cpolar(transportedMag, transportedAngle + carg(end));
}

/**
 * Transport a vector along a path (sequence of points)
 */
function parallelTransportPath(vector, path) {
  if (path.length < 2) return vector;

  let v = vector;
  for (let i = 0; i < path.length - 1; i++) {
    v = parallelTransport(v, path[i], path[i + 1]);
  }
  return v;
}

/**
 * Compute holonomy around a closed loop
 * Returns the rotation angle accumulated
 */
function holonomy(loop) {
  if (loop.length < 3) return 0;

  // Transport a reference vector around the loop
  const startVector = C(1, 0);
  const transported = parallelTransportPath(startVector, [...loop, loop[0]]);

  // The holonomy is the angle difference
  return carg(transported) - carg(startVector);
}

/**
 * Visualize parallel transport with a vector field
 * Returns array of {point, vector} for rendering
 */
function transportField(startVector, startPoint, endPoint, numSteps = 20) {
  const field = [];
  const path = sampleGeodesic(startPoint, endPoint, numSteps);

  let v = startVector;
  for (let i = 0; i < path.length; i++) {
    field.push({ point: path[i], vector: v });
    if (i < path.length - 1) {
      v = parallelTransport(v, path[i], path[i + 1]);
    }
  }

  return field;
}

// ════════════════════════════════════════════════════════════════════════════
// P3: DISCRETE SUBGROUPS AND TILINGS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Generate generators for a {p,q} tiling
 * Regular p-gon with q meeting at each vertex
 * Valid when (p-2)(q-2) > 4 (hyperbolic condition)
 */
function tilingGenerators(p, q) {
  // Reflection angles
  const alpha = Math.PI / p;
  const beta = Math.PI / q;

  // Check hyperbolicity
  if ((p - 2) * (q - 2) <= 4) {
    console.warn(`{${p},${q}} is not hyperbolic`);
    return [];
  }

  // Distance from center to edge midpoint
  const r = Math.acosh(Math.cos(alpha) / Math.sin(beta));

  // Distance from center to vertex
  const R = Math.acosh(1 / (Math.tan(alpha) * Math.tan(beta)));

  // Generators: rotations and reflections
  // Rotation by 2π/p around origin
  const rotation = (z) => cmul(z, cpolar(1, 2 * Math.PI / p));

  // Reflection across geodesic through edge midpoint
  const edgeMidpoint = cpolar(Math.tanh(r / 2), 0);
  const reflection = (z) => {
    // Reflect across geodesic perpendicular to real axis at edgeMidpoint
    const shifted = mobius(cscale(edgeMidpoint, -1), z);
    const reflected = cconj(shifted);
    return mobius(edgeMidpoint, reflected);
  };

  return { rotation, reflection, p, q, edgeRadius: r, vertexRadius: R };
}

/**
 * Generate orbit of a point under tiling group
 * Returns array of transformed points
 */
function tilingOrbit(generators, startPoint, maxDepth = 4) {
  const { rotation, reflection, p } = generators;
  const points = new Set();
  const queue = [{ point: startPoint, depth: 0 }];
  const seen = new Set();

  const key = (z) => `${z.re.toFixed(6)},${z.im.toFixed(6)}`;

  while (queue.length > 0) {
    const { point, depth } = queue.shift();
    const k = key(point);

    if (seen.has(k) || depth > maxDepth) continue;
    seen.add(k);

    // Skip if outside disk
    if (cabs(point) > 0.999) continue;

    points.add(point);

    // Apply generators
    for (let i = 0; i < p; i++) {
      let rotated = point;
      for (let j = 0; j < i; j++) rotated = rotation(rotated);
      queue.push({ point: rotated, depth: depth + 1 });

      const reflected = reflection(rotated);
      queue.push({ point: reflected, depth: depth + 1 });
    }
  }

  return [...points];
}

/**
 * Generate a hyperbolic tiling as edges
 * Returns array of {start, end} geodesic segments
 */
function generateTiling(p, q, depth = 3) {
  const gens = tilingGenerators(p, q);
  if (!gens.rotation) return [];

  // Start with the fundamental polygon edges
  const edges = [];
  const alpha = Math.PI / p;
  const r = Math.tanh(gens.edgeRadius / 2);

  // Vertices of fundamental polygon
  const vertices = [];
  for (let i = 0; i < p; i++) {
    const angle = (2 * i + 1) * alpha;
    vertices.push(cpolar(r * 1.2, angle)); // Approximate vertex position
  }

  // Generate edge midpoints and transform
  const edgeMidpoints = [];
  for (let i = 0; i < p; i++) {
    edgeMidpoints.push(cpolar(r, 2 * i * alpha));
  }

  // Orbit of edges under group
  const processedEdges = new Set();

  function addEdge(v1, v2) {
    const key = [
      `${v1.re.toFixed(4)},${v1.im.toFixed(4)}`,
      `${v2.re.toFixed(4)},${v2.im.toFixed(4)}`
    ].sort().join('|');

    if (!processedEdges.has(key)) {
      processedEdges.add(key);
      edges.push({ start: v1, end: v2 });
    }
  }

  // Generate orbit of fundamental domain
  const orbit = tilingOrbit(gens, C(0, 0), depth);

  for (const center of orbit) {
    for (let i = 0; i < p; i++) {
      const angle1 = 2 * i * alpha;
      const angle2 = 2 * (i + 1) * alpha;
      const v1 = mobius(cscale(center, -1), cpolar(r, angle1));
      const v2 = mobius(cscale(center, -1), cpolar(r, angle2));
      addEdge(center, v1);
    }
  }

  return edges;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS (attach to global for use in hyperbolic-engine.js)
// ════════════════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  window.GeometryExtensions = {
    // Klein model
    poincareToKlein,
    kleinToPoincare,
    kleinDist,
    kleinGeodesic,
    kleinGeodesicIntersect,

    // Voronoi
    hyperbolicBisector,
    hyperbolicVoronoiCell,
    hyperbolicVoronoiDiagram,

    // Embeddings
    embedHierarchy,
    optimizeEmbedding,

    // Parallel transport
    parallelTransport,
    parallelTransportPath,
    holonomy,
    transportField,

    // Tilings
    tilingGenerators,
    tilingOrbit,
    generateTiling
  };

  console.log('GeometryExtensions loaded: Voronoi, Klein, Transport, Tilings');
}
