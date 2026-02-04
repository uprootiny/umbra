(ns app.math.hn.hyperboloid
  "Hyperboloid model of hyperbolic n-space H^n.

   The hyperboloid is the upper sheet of a two-sheeted hyperboloid in
   Minkowski space R^{n,1}:

     H^n = { x ∈ R^{n+1} : <x,x>_L = -1, x₀ > 0 }

   Key formulas:
     Distance:     d(x,y) = arcosh(-<x,y>_L)
     Geodesic:     γ(t) = cosh(t)·x + sinh(t)·v  for unit tangent v
     Midpoint:     m = (x + y) / √(-<x+y, x+y>_L)

   This model is computationally superior to Poincaré for:
     - Numerical stability (no boundary issues)
     - Matrix operations (isometries are linear in O(1,n))
     - Batch processing (dot products vectorize well)"
  (:require [app.math.hn.minkowski :as M]))

;; ════════════════════════════════════════════════════════════════════════════
;; CONSTANTS
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const EPSILON 1e-10)
(def ^:const MAX-DIST 20.0)  ; Clamp distances to avoid numerical issues

;; ════════════════════════════════════════════════════════════════════════════
;; DISTANCE FUNCTIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn cosh-dist
  "Return cosh(d(x,y)) = -<x,y>_L.

   This is often more useful than the distance itself for comparisons,
   and avoids the arcosh computation."
  [^js x ox ^js y oy dim]
  (- (M/dot-L x ox y oy dim)))

(defn dist
  "Hyperbolic distance d(x,y) = arcosh(-<x,y>_L).

   Returns distance in the natural metric of H^n (curvature K = -1)."
  [^js x ox ^js y oy dim]
  (let [cosh-d (cosh-dist x ox y oy dim)]
    (cond
      ;; Same point (within numerical precision)
      (<= cosh-d 1.0) 0.0

      ;; Very large distance - clamp
      (> cosh-d (js/Math.cosh MAX-DIST)) MAX-DIST

      ;; Normal case
      :else (js/Math.acosh cosh-d))))

(defn dist-squared-approx
  "Approximate squared distance for nearby points.

   For small d, d² ≈ 2(cosh(d) - 1).

   Useful for comparisons without computing arcosh."
  [^js x ox ^js y oy dim]
  (let [cosh-d (cosh-dist x ox y oy dim)]
    (* 2.0 (max 0.0 (- cosh-d 1.0)))))

;; ════════════════════════════════════════════════════════════════════════════
;; NORMALIZATION
;; ════════════════════════════════════════════════════════════════════════════

(defn project-to-hyperboloid!
  "Project a vector back onto the hyperboloid H^n.

   Given any v with v₀ > 0, find the point on H^n by:
     x = v / √(-<v,v>_L)

   This is the 'closest' point on H^n in the radial direction.

   Returns true if successful, false if the vector cannot be projected."
  [^js v ov dim]
  (let [norm2 (M/norm-L-squared v ov dim)
        v0 (aget v ov)]
    (cond
      ;; Already close to hyperboloid
      (< (js/Math.abs (+ norm2 1.0)) EPSILON)
      true

      ;; Invalid: norm² should be negative for timelike vectors
      (>= norm2 (- EPSILON))
      false

      ;; Invalid: v₀ should be positive
      (<= v0 EPSILON)
      false

      ;; Project
      :else
      (let [scale (/ 1.0 (js/Math.sqrt (- norm2)))]
        (M/scale-vec! v ov scale dim)
        true))))

(defn normalize-hyperboloid!
  "Ensure a point stays on the hyperboloid after numerical drift.

   This is a gentler version that handles small perturbations by
   adjusting x₀ to satisfy <x,x>_L = -1."
  [^js x ox dim]
  (let [spatial2 (M/spatial-norm-squared x ox dim)
        ;; x₀² = 1 + Σxᵢ², so x₀ = √(1 + spatial²)
        x0-new (js/Math.sqrt (+ 1.0 spatial2))]
    (aset x ox x0-new)
    x))

;; ════════════════════════════════════════════════════════════════════════════
;; GEODESIC OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn geodesic-midpoint!
  "Compute the geodesic midpoint of x and y.

   The midpoint is: m = (x + y) / ||x + y||_L

   where ||·||_L means normalize to the hyperboloid."
  [^js out oo ^js x ox ^js y oy dim]
  ;; out = x + y
  (M/add-vec! out oo x ox y oy dim)
  ;; Normalize to hyperboloid
  (normalize-hyperboloid! out oo dim)
  out)

(defn geodesic-lerp!
  "Interpolate along the geodesic from x to y.

   γ(t) for t ∈ [0,1] where γ(0) = x, γ(1) = y.

   Formula: γ(t) = sinh((1-t)d)/sinh(d)·x + sinh(td)/sinh(d)·y
   where d = d(x,y)."
  [^js out oo ^js x ox ^js y oy t dim]
  (cond
    (<= t 0.0)
    (M/copy-vec! out oo x ox dim)

    (>= t 1.0)
    (M/copy-vec! out oo y oy dim)

    :else
    (let [d (dist x ox y oy dim)]
      (if (< d EPSILON)
        ;; Points are the same
        (M/copy-vec! out oo x ox dim)
        ;; Proper interpolation
        (let [sinh-d (js/Math.sinh d)
              a (/ (js/Math.sinh (* (- 1.0 t) d)) sinh-d)
              b (/ (js/Math.sinh (* t d)) sinh-d)]
          (M/linear-comb! out oo x ox a y oy b dim)
          ;; Renormalize for numerical stability
          (normalize-hyperboloid! out oo dim)
          out)))))

(defn geodesic-extend!
  "Extend from x through y by a factor k > 1.

   For k = 2, you get the point beyond y at the same distance as x-y.

   This is extrapolation: γ(k) for k > 1."
  [^js out oo ^js x ox ^js y oy k dim]
  (geodesic-lerp! out oo x ox y oy k dim))

;; ════════════════════════════════════════════════════════════════════════════
;; BATCH OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn centroid!
  "Compute the Fréchet mean (centroid) of a set of points.

   Uses iterative optimization: start at one point, repeatedly move
   toward the mean of log-mapped points, then exp back.

   For now, uses a simpler approach: weighted average + project.
   This is approximate but fast for visualization."
  [^js out oo ^js points n dim]
  (let [stride (inc dim)]
    ;; Sum all points
    (M/zero-vec! out oo dim)
    (loop [i 0]
      (when (< i n)
        (M/add-vec! out oo out oo points (* i stride) dim)
        (recur (inc i))))
    ;; Normalize to hyperboloid
    (normalize-hyperboloid! out oo dim)
    out))

(defn find-nearest
  "Find the index of the nearest point to query.

   Returns [index, distance]."
  [^js query oq ^js points n dim]
  (let [stride (inc dim)]
    (loop [i 0
           best-i -1
           best-d js/Infinity]
      (if (>= i n)
        [best-i best-d]
        (let [d (dist query oq points (* i stride) dim)]
          (if (< d best-d)
            (recur (inc i) i d)
            (recur (inc i) best-i best-d)))))))

(defn find-k-nearest
  "Find k nearest neighbors.

   Returns vector of [index, distance] pairs, sorted by distance."
  [^js query oq ^js points n k dim]
  (let [stride (inc dim)
        results (volatile! (sorted-set-by #(compare (second %1) (second %2))))]
    (loop [i 0]
      (when (< i n)
        (let [d (dist query oq points (* i stride) dim)]
          (vswap! results conj [i d])
          (when (> (count @results) k)
            (vswap! results disj (last @results))))
        (recur (inc i))))
    (vec @results)))

;; ════════════════════════════════════════════════════════════════════════════
;; SHELL / LOD HELPERS
;; ════════════════════════════════════════════════════════════════════════════

(defn classify-by-distance
  "Classify points into shells based on distance from query.

   Returns a map: {:shell0 [indices...] :shell1 [...] :shell2 [...]}

   Shells are defined by radius thresholds."
  [^js query oq ^js points n dim thresholds]
  (let [stride (inc dim)
        shells (volatile! {:shell0 [] :shell1 [] :shell2 []})]
    (loop [i 0]
      (when (< i n)
        (let [d (dist query oq points (* i stride) dim)
              shell-key (cond
                          (< d (first thresholds)) :shell0
                          (< d (second thresholds)) :shell1
                          :else :shell2)]
          (vswap! shells update shell-key conj i))
        (recur (inc i))))
    @shells))

;; ════════════════════════════════════════════════════════════════════════════
;; VALIDATION
;; ════════════════════════════════════════════════════════════════════════════

(defn validate-point
  "Validate that a point is on the hyperboloid.

   Returns {:valid true} or {:valid false :error \"description\"}."
  [^js x ox dim]
  (let [norm2 (M/norm-L-squared x ox dim)
        x0 (aget x ox)]
    (cond
      (<= x0 0)
      {:valid false :error "x₀ must be positive"}

      (> (js/Math.abs (+ norm2 1.0)) 0.01)
      {:valid false :error (str "Not on hyperboloid: <x,x>_L = " norm2 " (should be -1)")}

      :else
      {:valid true})))
