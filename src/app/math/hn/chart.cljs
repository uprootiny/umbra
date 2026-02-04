(ns app.math.hn.chart
  "Projection charts for visualizing H^n.

   A chart is a mapping from the manifold to a lower-dimensional space
   suitable for rendering. We provide several chart types:

   1. TANGENT ATLAS CHART
      Projects points to the tangent space at a basepoint, then to a 2D
      plane within that tangent space. This is the primary chart for
      interactive visualization.

   2. POINCARÉ BALL CHART
      Projects to the Poincaré ball model, then extracts 2D slice.
      Good for seeing global structure.

   3. KLEIN CHART
      Projects to Klein model (straight geodesics) then to 2D.
      Useful for certain geometric constructions.

   Each chart can have different bases (orientations) and can serve as
   a different 'minimap' view of the same underlying manifold."
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.isometries :as iso]))

(def ^:const EPSILON 1e-10)

;; ════════════════════════════════════════════════════════════════════════════
;; TANGENT ATLAS CHART
;; ════════════════════════════════════════════════════════════════════════════

(defn tangent-chart
  "Create a tangent atlas chart.

   Args:
     dim: hyperbolic dimension n
     basis-i, basis-j: indices of spatial dimensions to use for 2D plane
                       (default: 1, 2)

   Returns a chart object with:
     :type :tangent
     :dim n
     :basepoint (atom, the focus point)
     :basis [i j] (which spatial axes to project to)
     :tmp (scratch buffer)"
  ([dim] (tangent-chart dim 1 2))
  ([dim basis-i basis-j]
   {:type :tangent
    :dim dim
    :basepoint (atom (M/origin-vec dim))
    :basis [basis-i basis-j]
    :tmp (M/make-vec dim)}))

(defn set-basepoint!
  "Set the basepoint (focus) of a tangent chart."
  [chart ^js p op]
  (M/copy-vec! @(:basepoint chart) 0 p op (:dim chart))
  chart)

(defn set-basis!
  "Set the 2D basis axes of a tangent chart."
  [chart i j]
  (assoc chart :basis [i j]))

(defn project-tangent
  "Project a point to 2D using the tangent atlas chart.

   1. Compute v = log_b(x) where b is the basepoint
   2. Extract components [v_i, v_j] for the chosen basis

   Returns [x, y] screen coordinates.

   Note: The tangent space T_b H^n is isomorphic to R^n. The spatial
   components of the log map (indices 1..n) give coordinates in this space."
  [chart ^js x ox]
  (let [dim (:dim chart)
        basepoint @(:basepoint chart)
        tmp (:tmp chart)
        [bi bj] (:basis chart)]

    ;; Compute log map
    (maps/log! tmp 0 basepoint 0 x ox dim)

    ;; Extract 2D coordinates from spatial components
    ;; (the tangent vector has 0 for timelike component by construction)
    [(aget tmp bi) (aget tmp bj)]))

(defn project-tangent-batch
  "Project multiple points to 2D.

   Args:
     chart: the chart
     points: Float32Array of points (N × (dim+1))
     n: number of points

   Returns: Float32Array of 2D coords (N × 2)"
  [chart ^js points n]
  (let [dim (:dim chart)
        stride (inc dim)
        basepoint @(:basepoint chart)
        [bi bj] (:basis chart)
        tmp (M/make-vec dim)
        out (js/Float32Array. (* n 2))]

    (loop [i 0]
      (when (< i n)
        (maps/log! tmp 0 basepoint 0 points (* i stride) dim)
        (aset out (* i 2) (aget tmp bi))
        (aset out (+ (* i 2) 1) (aget tmp bj))
        (recur (inc i))))
    out))

(defn unproject-tangent!
  "Inverse projection: 2D coordinates back to H^n.

   Given [x, y] in screen space, returns a point on the manifold."
  [^js out oo chart x y]
  (let [dim (:dim chart)
        basepoint @(:basepoint chart)
        [bi bj] (:basis chart)
        tmp (:tmp chart)]

    ;; Build tangent vector: only components bi and bj are non-zero
    (M/zero-vec! tmp 0 dim)
    (aset tmp bi x)
    (aset tmp bj y)

    ;; Exponential map to get point
    (maps/exp! out oo basepoint 0 tmp 0 dim)))

;; ════════════════════════════════════════════════════════════════════════════
;; POINCARÉ BALL CHART
;; ════════════════════════════════════════════════════════════════════════════

(defn hyperboloid-to-ball!
  "Convert from hyperboloid to Poincaré ball model.

   For x ∈ H^n with x = (x₀, x₁, ..., x_n), the ball point is:
     p_i = x_i / (x₀ + 1)  for i = 1..n

   The result lives in the open unit ball in R^n."
  [^js out oo ^js x ox dim]
  (let [x0 (aget x ox)
        denom (+ x0 1.0)]
    (loop [i 1]
      (when (<= i dim)
        (aset out (+ oo (dec i)) (/ (aget x (+ ox i)) denom))
        (recur (inc i))))
    out))

(defn ball-to-hyperboloid!
  "Convert from Poincaré ball to hyperboloid model.

   For p ∈ B^n with |p|² < 1:
     x₀ = (1 + |p|²) / (1 - |p|²)
     x_i = 2p_i / (1 - |p|²)"
  [^js out oo ^js p op dim]
  (let [;; |p|²
        r2 (loop [i 0, acc 0.0]
             (if (>= i dim)
               acc
               (let [pi (aget p (+ op i))]
                 (recur (inc i) (+ acc (* pi pi))))))
        denom (- 1.0 r2)]

    (when (> denom EPSILON)
      (aset out oo (/ (+ 1.0 r2) denom))
      (loop [i 0]
        (when (< i dim)
          (aset out (+ oo (inc i)) (/ (* 2.0 (aget p (+ op i))) denom))
          (recur (inc i)))))
    out))

(defn poincare-chart
  "Create a Poincaré ball chart.

   Projects to the n-dimensional Poincaré ball, then extracts a 2D slice."
  ([dim] (poincare-chart dim 0 1))  ; Use first two spatial dims
  ([dim slice-i slice-j]
   {:type :poincare
    :dim dim
    :slice [slice-i slice-j]
    :tmp (js/Float32Array. dim)}))

(defn project-poincare
  "Project a point to 2D using Poincaré ball chart.

   Returns [x, y] where x,y ∈ (-1, 1)."
  [chart ^js x ox]
  (let [dim (:dim chart)
        [si sj] (:slice chart)
        tmp (:tmp chart)]

    (hyperboloid-to-ball! tmp 0 x ox dim)
    [(aget tmp si) (aget tmp sj)]))

;; ════════════════════════════════════════════════════════════════════════════
;; KLEIN CHART
;; ════════════════════════════════════════════════════════════════════════════

(defn hyperboloid-to-klein!
  "Convert from hyperboloid to Klein model.

   For x ∈ H^n:
     k_i = x_i / x₀  for i = 1..n

   The Klein model has straight geodesics but distorted angles."
  [^js out oo ^js x ox dim]
  (let [x0 (aget x ox)]
    (when (> x0 EPSILON)
      (loop [i 1]
        (when (<= i dim)
          (aset out (+ oo (dec i)) (/ (aget x (+ ox i)) x0))
          (recur (inc i)))))
    out))

(defn klein-chart
  "Create a Klein model chart."
  ([dim] (klein-chart dim 0 1))
  ([dim slice-i slice-j]
   {:type :klein
    :dim dim
    :slice [slice-i slice-j]
    :tmp (js/Float32Array. dim)}))

(defn project-klein
  "Project a point to 2D using Klein chart."
  [chart ^js x ox]
  (let [dim (:dim chart)
        [si sj] (:slice chart)
        tmp (:tmp chart)]

    (hyperboloid-to-klein! tmp 0 x ox dim)
    [(aget tmp si) (aget tmp sj)]))

;; ════════════════════════════════════════════════════════════════════════════
;; UNIFIED PROJECTION INTERFACE
;; ════════════════════════════════════════════════════════════════════════════

(defn project
  "Project a point using any chart type.

   Returns [x, y] in the chart's coordinate system."
  [chart ^js x ox]
  (case (:type chart)
    :tangent (project-tangent chart x ox)
    :poincare (project-poincare chart x ox)
    :klein (project-klein chart x ox)
    (throw (js/Error. (str "Unknown chart type: " (:type chart))))))

(defn project-batch
  "Project multiple points.

   Returns Float32Array of [x, y, x, y, ...] pairs."
  [chart ^js points n]
  (let [dim (:dim chart)
        stride (inc dim)
        out (js/Float32Array. (* n 2))]

    (loop [i 0]
      (when (< i n)
        (let [[px py] (project chart points (* i stride))]
          (aset out (* i 2) px)
          (aset out (+ (* i 2) 1) py))
        (recur (inc i))))
    out))

;; ════════════════════════════════════════════════════════════════════════════
;; SCREEN TRANSFORM
;; ════════════════════════════════════════════════════════════════════════════

(defn chart-to-screen
  "Convert chart coordinates to screen pixels.

   Args:
     [cx, cy]: chart coordinates
     width, height: screen dimensions
     scale: zoom factor
     offset-x, offset-y: pan offset

   Returns [sx, sy] screen coordinates."
  [[cx cy] width height scale offset-x offset-y]
  (let [center-x (/ width 2)
        center-y (/ height 2)]
    [(+ center-x offset-x (* cx scale))
     (+ center-y offset-y (* cy scale -1))]))  ; Flip Y for screen coords

(defn screen-to-chart
  "Convert screen pixels to chart coordinates."
  [[sx sy] width height scale offset-x offset-y]
  (let [center-x (/ width 2)
        center-y (/ height 2)]
    [(/ (- sx center-x offset-x) scale)
     (/ (- sy center-y offset-y) scale -1)]))

;; ════════════════════════════════════════════════════════════════════════════
;; MINIMAP VARIANTS
;; ════════════════════════════════════════════════════════════════════════════

(defn make-minimap-chart
  "Create a chart suitable for use as a minimap.

   Minimap variants:
     :overview - Poincaré ball showing global structure
     :tangent-alt - Tangent chart at a different basepoint
     :spectrum - Not a spatial chart; returns field values instead"
  [variant dim & opts]
  (case variant
    :overview
    (poincare-chart dim 0 1)

    :tangent-alt
    (let [[base-i base-j] (or (first opts) [3 4])]
      (tangent-chart dim base-i base-j))

    :klein-overview
    (klein-chart dim 0 1)

    (throw (js/Error. (str "Unknown minimap variant: " variant)))))
