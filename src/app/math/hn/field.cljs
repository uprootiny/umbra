(ns app.math.hn.field
  "Scalar and vector fields on H^n.

   Rather than thinking of nodes as discrete objects to be drawn,
   we treat the manifold as having continuous fields that we sample:

   1. DENSITY FIELD
      ρ(x) = Σᵢ kernel(d(x, pᵢ), σᵢ)
      Represents 'how much stuff' is near x. Used for:
        - LOD decisions (high density → need more detail)
        - Edge bundling (flow along density gradients)
        - Collision detection (avoid high-density regions)

   2. ATTENTION FIELD
      α(x) = Σᵢ wᵢ · kernel(d(x, pᵢ), σᵢ)
      Where wᵢ encodes importance (selected, focused, recent).
      Used for:
        - Camera guidance (focus on high attention)
        - Rendering priority (detailed rendering where attention is high)

   3. GRADIENT FIELDS
      ∇ρ, ∇α live in the tangent bundle TH^n.
      Used for:
        - Navigation suggestions
        - Force-directed layout in hyperbolic space

   All fields are sampled lazily at render time."
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]))

(def ^:const EPSILON 1e-10)

;; ════════════════════════════════════════════════════════════════════════════
;; KERNEL FUNCTIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn gaussian-kernel
  "Gaussian kernel: exp(-d²/2σ²).

   Falls off smoothly with distance. Good for density estimation."
  [d sigma]
  (let [ratio (/ d sigma)]
    (js/Math.exp (* -0.5 ratio ratio))))

(defn hyperbolic-kernel
  "Hyperbolic kernel: 1 / (1 + cosh(d/σ)).

   Better adapted to hyperbolic geometry - accounts for exponential
   growth of balls in H^n."
  [d sigma]
  (/ 1.0 (+ 1.0 (js/Math.cosh (/ d sigma)))))

(defn bump-kernel
  "Compactly supported bump: exp(-1/(1-x²)) for |x| < 1, else 0.

   Zero outside radius σ. Efficient for sparse evaluation."
  [d sigma]
  (let [x (/ d sigma)]
    (if (>= x 1.0)
      0.0
      (js/Math.exp (/ -1.0 (- 1.0 (* x x)))))))

(defn power-kernel
  "Power law: (1 + d/σ)^(-α).

   Heavier tails than Gaussian. Good for influence that should
   extend further in hyperbolic space."
  [d sigma alpha]
  (js/Math.pow (+ 1.0 (/ d sigma)) (- alpha)))

;; ════════════════════════════════════════════════════════════════════════════
;; DENSITY FIELD
;; ════════════════════════════════════════════════════════════════════════════

(defn make-density-field
  "Create a density field configuration.

   Args:
     kernel-fn: (d, sigma) → contribution
     default-sigma: default kernel width

   Returns field config to pass to evaluation functions."
  [kernel-fn default-sigma]
  {:type :density
   :kernel kernel-fn
   :sigma default-sigma})

(defn eval-density
  "Evaluate density field at point x.

   Args:
     field: field configuration
     x, ox: query point
     ps: pointset
     sigmas: optional per-point sigmas (or nil for default)

   Returns scalar density value."
  [field ^js x ox ps sigmas]
  (let [kernel (:kernel field)
        default-sigma (:sigma field)
        n @(:count ps)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)]
    (loop [i 0
           acc 0.0]
      (if (>= i n)
        acc
        (let [d (H/dist x ox coords (* i stride) dim)
              sigma (if sigmas (aget sigmas i) default-sigma)
              contrib (kernel d sigma)]
          (recur (inc i) (+ acc contrib)))))))

(defn eval-density-weighted
  "Evaluate weighted density (attention field).

   Each point contributes: wᵢ · kernel(d(x, pᵢ), σᵢ)"
  [field ^js x ox ps weights sigmas]
  (let [kernel (:kernel field)
        default-sigma (:sigma field)
        n @(:count ps)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)]
    (loop [i 0
           acc 0.0]
      (if (>= i n)
        acc
        (let [d (H/dist x ox coords (* i stride) dim)
              w (if weights (aget weights i) 1.0)
              sigma (if sigmas (aget sigmas i) default-sigma)
              contrib (* w (kernel d sigma))]
          (recur (inc i) (+ acc contrib)))))))

;; ════════════════════════════════════════════════════════════════════════════
;; GRADIENT COMPUTATION
;; ════════════════════════════════════════════════════════════════════════════

(defn eval-density-gradient!
  "Compute gradient of density field at x.

   ∇ρ(x) = Σᵢ ∇kernel(d(x, pᵢ)) · (direction from x to pᵢ)

   Returns tangent vector at x pointing toward higher density.

   Uses numerical differentiation via log map directions."
  [^js out oo field ^js x ox ps sigmas dim]
  (let [kernel (:kernel field)
        default-sigma (:sigma field)
        n @(:count ps)
        stride (:stride ps)
        coords (:coords ps)
        tmp (M/make-vec dim)
        h 0.01]  ; Small step for numerical derivative

    ;; Zero output
    (M/zero-vec! out oo dim)

    (loop [i 0]
      (when (< i n)
        (let [off (* i stride)
              d (H/dist x ox coords off dim)]
          (when (> d EPSILON)
            (let [sigma (if sigmas (aget sigmas i) default-sigma)
                  ;; Numerical derivative: (kernel(d-h) - kernel(d+h)) / 2h
                  ;; Note: gradient points TOWARD the point (down the distance)
                  dk (/ (- (kernel (- d h) sigma)
                           (kernel (+ d h) sigma))
                        (* 2.0 h))]
              (when (> (js/Math.abs dk) EPSILON)
                ;; Get unit direction from x toward point i
                (maps/log-direction! tmp 0 x ox coords off dim)
                ;; Accumulate: out += dk * direction
                (loop [j 0]
                  (when (<= j dim)
                    (aset out (+ oo j)
                          (+ (aget out (+ oo j))
                             (* dk (aget tmp j))))
                    (recur (inc j))))))))
        (recur (inc i))))

    ;; Project to tangent space at x
    (M/tangent-project! out oo x ox out oo dim)
    out))

;; ════════════════════════════════════════════════════════════════════════════
;; FIELD SAMPLING
;; ════════════════════════════════════════════════════════════════════════════

(defn sample-field-grid
  "Sample a scalar field on a grid in tangent space at basepoint.

   Args:
     field: field configuration
     ps: pointset
     basepoint: center of sampling grid
     resolution: grid points per axis
     extent: half-width of grid in tangent space units

   Returns Float32Array of density values, row-major."
  [field ps ^js basepoint ob resolution extent dim]
  (let [samples (js/Float32Array. (* resolution resolution))
        step (/ (* 2.0 extent) (dec resolution))
        tmp (M/make-vec dim)
        point (M/make-vec dim)]

    (loop [row 0]
      (when (< row resolution)
        (loop [col 0]
          (when (< col resolution)
            ;; Compute tangent space coordinates
            (let [tx (+ (- extent) (* col step))
                  ty (+ (- extent) (* row step))]
              ;; Build tangent vector (only spatial components)
              (M/zero-vec! tmp 0 dim)
              (aset tmp 1 tx)
              (aset tmp 2 ty)
              ;; Map to manifold
              (maps/exp! point 0 basepoint ob tmp 0 dim)
              ;; Sample density
              (aset samples (+ (* row resolution) col)
                    (eval-density field point 0 ps nil)))
            (recur (inc col))))
        (recur (inc row))))
    samples))

(defn sample-field-radial
  "Sample field along radial directions from basepoint.

   Good for visualizing field falloff and finding features.

   Args:
     n-directions: number of angular samples
     n-radii: number of radial samples
     max-radius: maximum distance from basepoint

   Returns {:angles [...] :radii [...] :values [...]}"
  [field ps ^js basepoint ob n-directions n-radii max-radius dim]
  (let [values (js/Float32Array. (* n-directions n-radii))
        radii (js/Float32Array. n-radii)
        angles (js/Float32Array. n-directions)
        tmp (M/make-vec dim)
        point (M/make-vec dim)]

    ;; Fill radii array
    (loop [r 0]
      (when (< r n-radii)
        (aset radii r (* max-radius (/ (inc r) n-radii)))
        (recur (inc r))))

    ;; Fill angles array
    (loop [a 0]
      (when (< a n-directions)
        (aset angles a (* 2.0 js/Math.PI (/ a n-directions)))
        (recur (inc a))))

    ;; Sample
    (loop [a 0]
      (when (< a n-directions)
        (let [theta (aget angles a)
              cos-t (js/Math.cos theta)
              sin-t (js/Math.sin theta)]
          (loop [r 0]
            (when (< r n-radii)
              (let [radius (aget radii r)]
                ;; Build tangent vector
                (M/zero-vec! tmp 0 dim)
                (aset tmp 1 (* radius cos-t))
                (aset tmp 2 (* radius sin-t))
                ;; Map to manifold
                (maps/exp! point 0 basepoint ob tmp 0 dim)
                ;; Sample
                (aset values (+ (* a n-radii) r)
                      (eval-density field point 0 ps nil)))
              (recur (inc r)))))
        (recur (inc a))))

    {:angles angles
     :radii radii
     :values values}))

;; ════════════════════════════════════════════════════════════════════════════
;; DERIVED FIELDS
;; ════════════════════════════════════════════════════════════════════════════

(defn edge-density-field
  "Create a field that represents edge presence.

   For each edge (i,j), contributes density along the geodesic
   connecting points i and j.

   Used for edge bundling: edges are attracted to high edge-density
   regions."
  [ps edges edge-sigma n-samples]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        tmp (M/make-vec dim)]

    ;; Returns a function that evaluates edge density at a point
    (fn [^js x ox]
      (loop [e 0
             acc 0.0]
        (if (>= e (count edges))
          acc
          (let [[i j] (nth edges e)
                ;; Sample along geodesic
                contrib (loop [s 0
                               edge-acc 0.0]
                          (if (>= s n-samples)
                            (/ edge-acc n-samples)
                            (let [t (/ s (dec n-samples))]
                              ;; Point on geodesic from i to j at t
                              (H/geodesic-lerp! tmp 0
                                                coords (* i stride)
                                                coords (* j stride)
                                                t dim)
                              (let [d (H/dist x ox tmp 0 dim)]
                                (recur (inc s)
                                       (+ edge-acc
                                          (gaussian-kernel d edge-sigma)))))))]
            (recur (inc e) (+ acc contrib))))))))

(defn hotspot-field
  "Field that highlights regions of rapid change in base field.

   High values where ∇ρ is large - identifies boundaries between
   clusters or regions of interest."
  [base-field ps sigma-gradient dim]
  (let [grad (M/make-vec dim)]
    (fn [^js x ox]
      (eval-density-gradient! grad 0 base-field x ox ps nil dim)
      (let [norm2 (M/dot-L grad 0 grad 0 dim)]
        ;; For tangent vectors, dot-L gives positive value
        (if (> norm2 0)
          (js/Math.sqrt norm2)
          0.0)))))

;; ════════════════════════════════════════════════════════════════════════════
;; FIELD COMPOSITION
;; ════════════════════════════════════════════════════════════════════════════

(defn combine-fields
  "Combine multiple fields with weights.

   Returns a new field-like function."
  [field-fns weights]
  (fn [^js x ox ps]
    (loop [i 0
           acc 0.0]
      (if (>= i (count field-fns))
        acc
        (let [f (nth field-fns i)
              w (nth weights i)]
          (recur (inc i) (+ acc (* w (f x ox ps)))))))))

(defn threshold-field
  "Apply threshold to a field.

   Returns 1 where f(x) > threshold, 0 elsewhere.
   Useful for binary decisions (inside/outside region)."
  [field-fn threshold]
  (fn [^js x ox ps]
    (if (> (field-fn x ox ps) threshold) 1.0 0.0)))

(defn smooth-threshold-field
  "Smooth threshold using sigmoid.

   Returns smooth transition from 0 to 1 around threshold."
  [field-fn threshold sharpness]
  (fn [^js x ox ps]
    (let [v (field-fn x ox ps)
          z (* sharpness (- v threshold))]
      (/ 1.0 (+ 1.0 (js/Math.exp (- z)))))))
