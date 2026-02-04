(ns app.math.hn.lens
  "Lenses: view abstractions over the hyperbolic manifold.

   A lens is a section of the view sheaf - it extracts observable
   quantities from the latent manifold state and presents them
   for rendering.

   Key concepts:

   1. FOCUS
      Where on the manifold is the viewer 'looking from'?
      This is a point p ∈ H^n that serves as the center of projection.

   2. APERTURE
      How much of the manifold is visible?
      Controlled by distance thresholds and LOD parameters.

   3. SAMPLING
      What points/values are extracted for rendering?
      The lens samples fields and selects discrete points.

   4. TRANSFORM
      How is the manifold mapped to screen space?
      Combines chart projection with viewport transform.

   Different lenses can be composed to create:
   - Main view (tangent projection, high detail)
   - Minimap (Poincaré projection, global overview)
   - Spectrum view (non-spatial, shows field values)
   - Tree view (hierarchical layout derived from parent structure)"
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.chart :as chart]
            [app.math.hn.field :as field]
            [app.math.hn.pointset :as ps]))

(def ^:const EPSILON 1e-10)

;; ════════════════════════════════════════════════════════════════════════════
;; LENS STRUCTURE
;; ════════════════════════════════════════════════════════════════════════════

(defn make-lens
  "Create a lens for viewing the manifold.

   Args:
     dim: hyperbolic dimension
     chart: chart for projection (from chart.cljs)
     opts: optional configuration
       :aperture-near - near clipping distance (default 0)
       :aperture-far - far clipping distance (default Infinity)
       :lod-thresholds - [d1 d2 d3] for level-of-detail shells
       :density-field - field for adaptive sampling
       :priority-fn - (ps, idx) → priority for rendering order

   Returns lens object."
  [dim chart-obj & {:keys [aperture-near aperture-far
                            lod-thresholds density-field priority-fn]
                    :or {aperture-near 0
                         aperture-far js/Infinity
                         lod-thresholds [2.0 5.0 10.0]}}]
  {:dim dim
   :chart chart-obj
   :focus (atom (M/origin-vec dim))
   :aperture {:near aperture-near
              :far aperture-far}
   :lod-thresholds lod-thresholds
   :density-field density-field
   :priority-fn priority-fn
   :viewport {:width 800
              :height 600
              :scale 100.0
              :offset-x 0
              :offset-y 0}
   :cache (atom nil)})

(defn set-focus!
  "Set the focus point of the lens."
  [lens ^js p op]
  (M/copy-vec! @(:focus lens) 0 p op (:dim lens))
  ;; Update chart basepoint if tangent chart
  (when (= (:type (:chart lens)) :tangent)
    (chart/set-basepoint! (:chart lens) p op))
  ;; Invalidate cache
  (reset! (:cache lens) nil)
  lens)

(defn set-viewport!
  "Set viewport dimensions and transform."
  [lens width height scale offset-x offset-y]
  (-> lens
      (assoc-in [:viewport :width] width)
      (assoc-in [:viewport :height] height)
      (assoc-in [:viewport :scale] scale)
      (assoc-in [:viewport :offset-x] offset-x)
      (assoc-in [:viewport :offset-y] offset-y)))

(defn set-aperture!
  "Set aperture (visibility range)."
  [lens near far]
  (-> lens
      (assoc-in [:aperture :near] near)
      (assoc-in [:aperture :far] far)))

;; ════════════════════════════════════════════════════════════════════════════
;; VISIBILITY DETERMINATION
;; ════════════════════════════════════════════════════════════════════════════

(defn point-visible?
  "Check if a point is within the lens aperture."
  [lens ^js p op]
  (let [focus @(:focus lens)
        dim (:dim lens)
        d (H/dist focus 0 p op dim)
        {:keys [near far]} (:aperture lens)]
    (and (>= d near) (<= d far))))

(defn get-lod-level
  "Determine LOD level for a point based on distance.

   Returns 0 (highest detail) to 3 (lowest/culled)."
  [lens ^js p op]
  (let [focus @(:focus lens)
        dim (:dim lens)
        d (H/dist focus 0 p op dim)
        [t1 t2 t3] (:lod-thresholds lens)]
    (cond
      (< d t1) 0
      (< d t2) 1
      (< d t3) 2
      :else 3)))

(defn classify-points
  "Classify all points in a pointset by LOD level.

   Returns map {:lod0 [indices] :lod1 [...] :lod2 [...] :lod3 [...]}."
  [lens ps]
  (let [focus @(:focus lens)
        dim (:dim lens)
        [t1 t2 t3] (:lod-thresholds lens)
        n @(:count ps)
        stride (:stride ps)
        coords (:coords ps)]
    (loop [i 0
           result {:lod0 [] :lod1 [] :lod2 [] :lod3 []}]
      (if (>= i n)
        result
        (let [d (H/dist focus 0 coords (* i stride) dim)
              key (cond
                    (< d t1) :lod0
                    (< d t2) :lod1
                    (< d t3) :lod2
                    :else :lod3)]
          (recur (inc i) (update result key conj i)))))))

;; ════════════════════════════════════════════════════════════════════════════
;; PROJECTION
;; ════════════════════════════════════════════════════════════════════════════

(defn project-point
  "Project a single point through the lens to screen coordinates.

   Returns [sx, sy] or nil if outside aperture."
  [lens ^js p op]
  (when (point-visible? lens p op)
    (let [[cx cy] (chart/project (:chart lens) p op)
          {:keys [width height scale offset-x offset-y]} (:viewport lens)]
      (chart/chart-to-screen [cx cy] width height scale offset-x offset-y))))

(defn project-points
  "Project multiple points, returning screen coords and metadata.

   Returns vector of {:idx, :screen [x,y], :lod, :priority}
   sorted by priority (highest first)."
  [lens ps]
  (let [focus @(:focus lens)
        dim (:dim lens)
        chart-obj (:chart lens)
        {:keys [width height scale offset-x offset-y]} (:viewport lens)
        {:keys [near far]} (:aperture lens)
        [t1 t2 t3] (:lod-thresholds lens)
        priority-fn (or (:priority-fn lens) (constantly 0))
        n @(:count ps)
        stride (:stride ps)
        coords (:coords ps)]
    (->> (loop [i 0
                result []]
           (if (>= i n)
             result
             (let [off (* i stride)
                   d (H/dist focus 0 coords off dim)]
               (if (or (< d near) (> d far))
                 (recur (inc i) result)
                 (let [[cx cy] (chart/project chart-obj coords off)
                       [sx sy] (chart/chart-to-screen [cx cy] width height
                                                       scale offset-x offset-y)
                       lod (cond (< d t1) 0 (< d t2) 1 (< d t3) 2 :else 3)]
                   (recur (inc i)
                          (conj result
                                {:idx i
                                 :screen [sx sy]
                                 :chart [cx cy]
                                 :dist d
                                 :lod lod
                                 :priority (priority-fn ps i)})))))))
         (sort-by :priority >))))

;; ════════════════════════════════════════════════════════════════════════════
;; INVERSE PROJECTION (PICKING)
;; ════════════════════════════════════════════════════════════════════════════

(defn unproject-screen
  "Convert screen coordinates back to a point on H^n.

   Returns the manifold point corresponding to screen position [sx, sy]."
  [lens sx sy]
  (let [{:keys [width height scale offset-x offset-y]} (:viewport lens)
        [cx cy] (chart/screen-to-chart [sx sy] width height
                                        scale offset-x offset-y)
        chart-obj (:chart lens)
        dim (:dim lens)
        out (M/make-vec dim)]

    (when (= (:type chart-obj) :tangent)
      (chart/unproject-tangent! out 0 chart-obj cx cy))
    out))

(defn pick-point
  "Find the nearest point to a screen position.

   Returns {:idx, :dist, :screen-dist} or nil if none within threshold."
  [lens ps sx sy screen-threshold]
  (let [projected (project-points lens ps)
        matches (->> projected
                     (map (fn [{:keys [idx screen] :as m}]
                            (let [[px py] screen
                                  dx (- sx px)
                                  dy (- sy py)
                                  sd (js/Math.sqrt (+ (* dx dx) (* dy dy)))]
                              (assoc m :screen-dist sd))))
                     (filter #(< (:screen-dist %) screen-threshold))
                     (sort-by :screen-dist))]
    (first matches)))

;; ════════════════════════════════════════════════════════════════════════════
;; FIELD SAMPLING THROUGH LENS
;; ════════════════════════════════════════════════════════════════════════════

(defn sample-density-grid
  "Sample density field as visible through this lens.

   Returns a 2D grid of density values in screen space."
  [lens ps resolution]
  (when-let [density-field (:density-field lens)]
    (let [{:keys [width height scale]} (:viewport lens)
          dim (:dim lens)
          chart-obj (:chart lens)
          focus @(:focus lens)
          ;; Extent in chart coordinates
          extent (/ (max width height) scale 2)
          samples (js/Float32Array. (* resolution resolution))
          step (/ (* 2.0 extent) (dec resolution))
          point (M/make-vec dim)]

      (loop [row 0]
        (when (< row resolution)
          (loop [col 0]
            (when (< col resolution)
              ;; Chart coordinates
              (let [cx (+ (- extent) (* col step))
                    cy (+ (- extent) (* row step))]
                ;; Unproject to manifold
                (when (= (:type chart-obj) :tangent)
                  (chart/unproject-tangent! point 0 chart-obj cx cy)
                  ;; Sample density
                  (aset samples (+ (* row resolution) col)
                        (field/eval-density density-field point 0 ps nil))))
              (recur (inc col))))
          (recur (inc row))))
      samples)))

;; ════════════════════════════════════════════════════════════════════════════
;; DERIVED OBSERVABLES
;; ════════════════════════════════════════════════════════════════════════════

(defn visible-edges
  "Compute which edges should be rendered based on visibility.

   An edge (i,j) is visible if both endpoints are visible OR
   if the geodesic passes through the visible region."
  [lens ps edges]
  (let [focus @(:focus lens)
        dim (:dim lens)
        {:keys [near far]} (:aperture lens)
        stride (:stride ps)
        coords (:coords ps)]
    (->> edges
         (filter (fn [[i j]]
                   (let [di (H/dist focus 0 coords (* i stride) dim)
                         dj (H/dist focus 0 coords (* j stride) dim)]
                     ;; Both visible, or one visible and edge crosses aperture
                     (or (and (<= near di far) (<= near dj far))
                         (and (<= near di far) (< dj (* 2 far)))
                         (and (<= near dj far) (< di (* 2 far)))))))
         vec)))

(defn edge-screen-coords
  "Get screen coordinates for edge endpoints.

   Returns vector of {:edge [i j], :from [x y], :to [x y], :geodesic [...]}."
  [lens ps edges sample-geodesic?]
  (let [focus @(:focus lens)
        dim (:dim lens)
        chart-obj (:chart lens)
        {:keys [width height scale offset-x offset-y]} (:viewport lens)
        stride (:stride ps)
        coords (:coords ps)
        tmp (M/make-vec dim)]

    (mapv (fn [[i j]]
            (let [oi (* i stride)
                  oj (* j stride)
                  [ci1 ci2] (chart/project chart-obj coords oi)
                  [cj1 cj2] (chart/project chart-obj coords oj)
                  from (chart/chart-to-screen [ci1 ci2] width height
                                               scale offset-x offset-y)
                  to (chart/chart-to-screen [cj1 cj2] width height
                                             scale offset-x offset-y)

                  ;; Optionally sample geodesic for curved rendering
                  geodesic (when sample-geodesic?
                             (let [n-samples 8]
                               (loop [s 1
                                      pts []]
                                 (if (>= s n-samples)
                                   pts
                                   (let [t (/ s n-samples)]
                                     (H/geodesic-lerp! tmp 0 coords oi
                                                       coords oj t dim)
                                     (let [[cx cy] (chart/project chart-obj tmp 0)
                                           [sx sy] (chart/chart-to-screen
                                                    [cx cy] width height
                                                    scale offset-x offset-y)]
                                       (recur (inc s) (conj pts [sx sy]))))))))]
              {:edge [i j]
               :from from
               :to to
               :geodesic geodesic}))
          edges)))

;; ════════════════════════════════════════════════════════════════════════════
;; LENS COMPOSITION
;; ════════════════════════════════════════════════════════════════════════════

(defn make-minimap-lens
  "Create a minimap lens showing global overview.

   Uses Poincaré ball projection for seeing everything at once."
  [dim]
  (let [poincare-chart (chart/poincare-chart dim 0 1)]
    (make-lens dim poincare-chart
               :aperture-near 0
               :aperture-far js/Infinity
               :lod-thresholds [js/Infinity js/Infinity js/Infinity])))

(defn make-detail-lens
  "Create a detail lens for close-up view.

   Uses tangent projection centered on focus, with LOD shells."
  [dim]
  (let [tangent-chart (chart/tangent-chart dim 1 2)]
    (make-lens dim tangent-chart
               :aperture-near 0
               :aperture-far 15.0
               :lod-thresholds [2.0 5.0 10.0])))

(defn sync-lenses!
  "Synchronize focus between multiple lenses.

   Main lens focus becomes the focus for all secondary lenses,
   but each lens keeps its own projection/viewport settings."
  [main-lens & secondary-lenses]
  (let [focus @(:focus main-lens)
        dim (:dim main-lens)]
    (doseq [lens secondary-lenses]
      (set-focus! lens focus 0))))

;; ════════════════════════════════════════════════════════════════════════════
;; ANIMATION HELPERS
;; ════════════════════════════════════════════════════════════════════════════

(defn animate-focus-to!
  "Create animation state for moving focus toward target.

   Returns function (t) → updated lens for t ∈ [0, 1]."
  [lens target-point ot]
  (let [start-focus (js/Float32Array. (alength @(:focus lens)))
        _ (M/copy-vec! start-focus 0 @(:focus lens) 0 (:dim lens))
        dim (:dim lens)
        tmp (M/make-vec dim)]

    (fn [t]
      (H/geodesic-lerp! tmp 0 start-focus 0 target-point ot t dim)
      (set-focus! lens tmp 0)
      lens)))

(defn follow-point!
  "Set lens to follow a specific point in the pointset.

   Useful for 'camera follows selection' behavior."
  [lens ps idx]
  (let [stride (:stride ps)
        coords (:coords ps)
        off (* idx stride)]
    (set-focus! lens coords off)))
