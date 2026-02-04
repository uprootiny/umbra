(ns app.math.hn.minkowski
  "Minkowski space R^{n,1} operations for the hyperboloid model of H^n.

   Metric signature: (- + + + ... +)

   The Minkowski inner product:
     <x,y>_L = -x₀y₀ + Σᵢ₌₁ⁿ xᵢyᵢ

   Points on the hyperboloid satisfy:
     <x,x>_L = -1, x₀ > 0

   All functions operate on Float32Array/Float64Array with explicit offsets
   for cache-friendly batch operations.")

;; ════════════════════════════════════════════════════════════════════════════
;; CORE OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn dot-L
  "Minkowski inner product <x,y>_L for vectors in R^{n+1}.

   Args:
     x, y: typed arrays containing the vectors
     ox, oy: offsets into the arrays
     dim: hyperbolic dimension n (vectors have n+1 components)

   Returns: <x,y>_L = -x₀y₀ + Σᵢ₌₁ⁿ xᵢyᵢ"
  [^js x ox ^js y oy dim]
  (let [x0 (aget x ox)
        y0 (aget y oy)]
    (loop [i 1
           acc (- (* x0 y0))]  ; Start with -x₀y₀
      (if (> i dim)
        acc
        (recur (inc i)
               (+ acc (* (aget x (+ ox i))
                         (aget y (+ oy i)))))))))

(defn norm-L-squared
  "Minkowski norm squared <x,x>_L."
  [^js x ox dim]
  (dot-L x ox x ox dim))

(defn spatial-norm-squared
  "Euclidean norm squared of spatial components only: Σᵢ₌₁ⁿ xᵢ²"
  [^js x ox dim]
  (loop [i 1
         acc 0.0]
    (if (> i dim)
      acc
      (let [xi (aget x (+ ox i))]
        (recur (inc i) (+ acc (* xi xi)))))))

(defn spatial-norm
  "Euclidean norm of spatial components."
  [^js x ox dim]
  (js/Math.sqrt (spatial-norm-squared x ox dim)))

;; ════════════════════════════════════════════════════════════════════════════
;; VECTOR ARITHMETIC (in-place for performance)
;; ════════════════════════════════════════════════════════════════════════════

(defn copy-vec!
  "Copy vector from src to dst. Returns dst."
  [^js dst od ^js src os dim]
  (loop [i 0]
    (when (<= i dim)
      (aset dst (+ od i) (aget src (+ os i)))
      (recur (inc i))))
  dst)

(defn zero-vec!
  "Zero out a vector. Returns v."
  [^js v ov dim]
  (loop [i 0]
    (when (<= i dim)
      (aset v (+ ov i) 0.0)
      (recur (inc i))))
  v)

(defn scale-vec!
  "Scale vector in place: v ← s·v. Returns v."
  [^js v ov s dim]
  (loop [i 0]
    (when (<= i dim)
      (aset v (+ ov i) (* s (aget v (+ ov i))))
      (recur (inc i))))
  v)

(defn add-vec!
  "Add vectors: out ← a + b. Returns out."
  [^js out oo ^js a oa ^js b ob dim]
  (loop [i 0]
    (when (<= i dim)
      (aset out (+ oo i) (+ (aget a (+ oa i))
                            (aget b (+ ob i))))
      (recur (inc i))))
  out)

(defn sub-vec!
  "Subtract vectors: out ← a - b. Returns out."
  [^js out oo ^js a oa ^js b ob dim]
  (loop [i 0]
    (when (<= i dim)
      (aset out (+ oo i) (- (aget a (+ oa i))
                            (aget b (+ ob i))))
      (recur (inc i))))
  out)

(defn add-scaled!
  "Add scaled vector: out ← out + s·v. Returns out."
  [^js out oo ^js v ov s dim]
  (loop [i 0]
    (when (<= i dim)
      (aset out (+ oo i) (+ (aget out (+ oo i))
                            (* s (aget v (+ ov i)))))
      (recur (inc i))))
  out)

(defn linear-comb!
  "Linear combination: out ← a·x + b·y. Returns out."
  [^js out oo ^js x ox a ^js y oy b dim]
  (loop [i 0]
    (when (<= i dim)
      (aset out (+ oo i) (+ (* a (aget x (+ ox i)))
                            (* b (aget y (+ oy i)))))
      (recur (inc i))))
  out)

;; ════════════════════════════════════════════════════════════════════════════
;; MINKOWSKI-SPECIFIC OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn reflect-timelike!
  "Negate the timelike component: v₀ ← -v₀. Returns v."
  [^js v ov]
  (aset v ov (- (aget v ov)))
  v)

(defn make-spacelike!
  "Zero out the timelike component, keeping only spatial part.
   Useful for extracting tangent vectors."
  [^js v ov]
  (aset v ov 0.0)
  v)

(defn tangent-project!
  "Project w onto the tangent space at x:

   For x ∈ H^n, TₓH^n = {v : <x,v>_L = 0}

   Projection: v = w + <x,w>_L · x

   (Note: + because <x,x>_L = -1)"
  [^js out oo ^js x ox ^js w ow dim]
  (let [inner (dot-L x ox w ow dim)]
    ;; out = w + inner·x
    (loop [i 0]
      (when (<= i dim)
        (aset out (+ oo i) (+ (aget w (+ ow i))
                              (* inner (aget x (+ ox i)))))
        (recur (inc i))))
    out))

(defn tangent-normalize!
  "Normalize a tangent vector at x to unit length in the Minkowski metric.

   For v ∈ TₓH^n, ||v||² = <v,v>_L (positive for spacelike tangent vectors).

   Returns the original norm, or 0 if the vector was too small."
  [^js v ov dim epsilon]
  (let [norm2 (dot-L v ov v ov dim)]
    (if (< norm2 (* epsilon epsilon))
      0.0
      (let [norm (js/Math.sqrt norm2)
            inv-norm (/ 1.0 norm)]
        (scale-vec! v ov inv-norm dim)
        norm))))

;; ════════════════════════════════════════════════════════════════════════════
;; ALLOCATION HELPERS
;; ════════════════════════════════════════════════════════════════════════════

(defn make-vec
  "Create a new Float32Array for a single vector in R^{n+1}."
  [dim]
  (js/Float32Array. (inc dim)))

(defn make-vec64
  "Create a new Float64Array for a single vector (higher precision)."
  [dim]
  (js/Float64Array. (inc dim)))

(defn origin-vec
  "Create the origin of H^n: (1, 0, 0, ..., 0).
   This is the 'north pole' of the hyperboloid."
  [dim]
  (let [v (make-vec dim)]
    (aset v 0 1.0)
    v))

(defn origin-vec64
  "Create the origin in Float64Array."
  [dim]
  (let [v (make-vec64 dim)]
    (aset v 0 1.0)
    v))

;; ════════════════════════════════════════════════════════════════════════════
;; VALIDATION
;; ════════════════════════════════════════════════════════════════════════════

(defn on-hyperboloid?
  "Check if a point satisfies <x,x>_L ≈ -1 and x₀ > 0."
  [^js x ox dim epsilon]
  (let [norm2 (norm-L-squared x ox dim)
        x0 (aget x ox)]
    (and (> x0 0)
         (< (js/Math.abs (+ norm2 1.0)) epsilon))))

(defn valid-tangent?
  "Check if v is a valid tangent vector at x: <x,v>_L ≈ 0."
  [^js x ox ^js v ov dim epsilon]
  (< (js/Math.abs (dot-L x ox v ov dim)) epsilon))
