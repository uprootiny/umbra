(ns app.math.hn.maps
  "Exponential and logarithmic maps for H^n.

   These maps connect the manifold to its tangent spaces:

   exp_p : T_p H^n → H^n
     Maps a tangent vector at p to a point on the manifold by 'shooting'
     along the geodesic in that direction.

   log_p : H^n → T_p H^n
     Inverse of exp: returns the tangent vector at p pointing toward q
     with magnitude equal to d(p,q).

   These are fundamental for:
     - Navigation: nudge in tangent space, exp back to manifold
     - Projections: log to tangent space, project to 2D, render
     - Interpolation: log, lerp in tangent space, exp
     - Gradient descent: compute gradients in tangent space"
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]))

(def ^:const EPSILON 1e-10)

;; ════════════════════════════════════════════════════════════════════════════
;; EXPONENTIAL MAP
;; ════════════════════════════════════════════════════════════════════════════

(defn exp!
  "Exponential map at p: exp_p(v) → q.

   Given:
     p ∈ H^n (base point)
     v ∈ T_p H^n (tangent vector, satisfying <p,v>_L = 0)

   Returns:
     q = cosh(||v||)·p + sinh(||v||)·(v/||v||)

   where ||v|| is the Minkowski norm (for spacelike tangent vectors,
   this is √(<v,v>_L), which is real and positive).

   The geodesic from p with initial velocity v hits q at t=1.

   Args:
     out: output array for result q
     oo: offset into out
     p: base point array
     op: offset into p
     v: tangent vector array
     ov: offset into v
     dim: hyperbolic dimension"
  [^js out oo ^js p op ^js v ov dim]
  (let [;; Tangent vectors are spacelike: <v,v>_L > 0
        v-norm2 (M/dot-L v ov v ov dim)]
    (if (< v-norm2 (* EPSILON EPSILON))
      ;; Zero velocity: stay at p
      (M/copy-vec! out oo p op dim)
      ;; Proper exponential
      (let [v-norm (js/Math.sqrt v-norm2)
            cosh-t (js/Math.cosh v-norm)
            sinh-t (js/Math.sinh v-norm)
            sinh-over-norm (/ sinh-t v-norm)]
        ;; q = cosh(||v||)·p + sinh(||v||)/||v||·v
        (loop [i 0]
          (when (<= i dim)
            (aset out (+ oo i)
                  (+ (* cosh-t (aget p (+ op i)))
                     (* sinh-over-norm (aget v (+ ov i)))))
            (recur (inc i))))
        ;; Renormalize for numerical stability
        (H/normalize-hyperboloid! out oo dim)
        out))))

(defn exp-scaled!
  "Exponential map with a scaling factor.

   exp_p(t·v) - useful for animation along geodesics.

   Equivalent to: compute v' = t·v, then exp_p(v')."
  [^js out oo ^js p op ^js v ov t dim]
  (let [v-norm2 (M/dot-L v ov v ov dim)]
    (if (or (< t EPSILON) (< v-norm2 (* EPSILON EPSILON)))
      (M/copy-vec! out oo p op dim)
      (let [v-norm (* t (js/Math.sqrt v-norm2))
            cosh-t (js/Math.cosh v-norm)
            sinh-t (js/Math.sinh v-norm)
            ;; sinh(t·||v||) / ||v|| = t · sinh(t·||v||) / (t·||v||)
            sinh-over-norm (/ sinh-t (js/Math.sqrt v-norm2))]
        (loop [i 0]
          (when (<= i dim)
            (aset out (+ oo i)
                  (+ (* cosh-t (aget p (+ op i)))
                     (* sinh-over-norm (aget v (+ ov i)))))
            (recur (inc i))))
        (H/normalize-hyperboloid! out oo dim)
        out))))

;; ════════════════════════════════════════════════════════════════════════════
;; LOGARITHMIC MAP
;; ════════════════════════════════════════════════════════════════════════════

(defn log!
  "Logarithmic map at p: log_p(q) → v.

   Given:
     p, q ∈ H^n (two points on the hyperboloid)

   Returns:
     v ∈ T_p H^n such that exp_p(v) = q

   Formula:
     v = d(p,q) · (q + <p,q>_L · p) / ||(q + <p,q>_L · p)||

   The direction from p to q is: (q + <p,q>_L · p) normalized.
   The magnitude is d(p,q).

   Args:
     out: output array for tangent vector v
     oo: offset into out
     p: base point
     op: offset into p
     q: target point
     oq: offset into q
     dim: hyperbolic dimension"
  [^js out oo ^js p op ^js q oq dim]
  (let [inner (M/dot-L p op q oq dim)  ; <p,q>_L, should be ≤ -1
        cosh-d (- inner)]              ; cosh(d) = -<p,q>_L

    (if (<= cosh-d 1.0)
      ;; Same point (or numerical error): return zero vector
      (M/zero-vec! out oo dim)

      ;; General case
      (let [d (js/Math.acosh cosh-d)
            sinh-d (js/Math.sinh d)]

        (if (< sinh-d EPSILON)
          ;; Very close: use approximation
          (M/zero-vec! out oo dim)

          ;; v = d · (q + inner·p) / sinh(d)
          ;; Since inner < 0 and we want (q + inner·p), this pushes toward q
          (let [scale (/ d sinh-d)]
            (loop [i 0]
              (when (<= i dim)
                (aset out (+ oo i)
                      (* scale (+ (aget q (+ oq i))
                                  (* inner (aget p (+ op i))))))
                (recur (inc i))))
            out))))))

(defn log-direction!
  "Compute unit tangent direction from p toward q.

   Returns: normalized tangent vector v with ||v||_L = 1.

   Useful when you want direction but not magnitude."
  [^js out oo ^js p op ^js q oq dim]
  (log! out oo p op q oq dim)
  (M/tangent-normalize! out oo dim EPSILON)
  out)

;; ════════════════════════════════════════════════════════════════════════════
;; PARALLEL TRANSPORT
;; ════════════════════════════════════════════════════════════════════════════

(defn parallel-transport!
  "Parallel transport a tangent vector from p to q along the geodesic.

   Given:
     p, q ∈ H^n
     v ∈ T_p H^n

   Returns:
     w ∈ T_q H^n such that w is the parallel transport of v.

   Formula (for unit speed geodesic from p to q):
     w = v - <v, log_p(q)>_L / d² · (log_p(q) + log_q(p))

   This preserves inner products: <w, w>_L = <v, v>_L."
  [^js out oo ^js p op ^js q oq ^js v ov dim tmp1 tmp2]
  ;; tmp1 = log_p(q)
  (log! tmp1 0 p op q oq dim)

  (let [d (H/dist p op q oq dim)]
    (if (< d EPSILON)
      ;; Same point: transport is identity
      (M/copy-vec! out oo v ov dim)

      ;; General case
      (let [d2 (* d d)
            ;; tmp2 = log_q(p)
            _ (log! tmp2 0 q oq p op dim)
            ;; Coefficient: <v, log_p(q)>_L / d²
            coef (/ (M/dot-L v ov tmp1 0 dim) d2)]

        ;; tmp1 = log_p(q) + log_q(p)
        (M/add-vec! tmp1 0 tmp1 0 tmp2 0 dim)

        ;; out = v - coef · tmp1
        (loop [i 0]
          (when (<= i dim)
            (aset out (+ oo i)
                  (- (aget v (+ ov i))
                     (* coef (aget tmp1 i))))
            (recur (inc i))))

        ;; Project to ensure tangent at q
        (M/tangent-project! out oo q oq out oo dim)
        out))))

;; ════════════════════════════════════════════════════════════════════════════
;; CONVENIENCE FUNCTIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn geodesic-at!
  "Compute point at parameter t along geodesic from p with initial velocity v.

   γ(t) = exp_p(t·v)

   For t=0: γ(0) = p
   For t=1: γ(1) = exp_p(v)"
  [^js out oo ^js p op ^js v ov t dim]
  (exp-scaled! out oo p op v ov t dim))

(defn move-toward!
  "Move from p toward q by distance step-size.

   Returns a point on the geodesic from p to q, at distance step-size from p.

   If step-size >= d(p,q), returns q."
  [^js out oo ^js p op ^js q oq step-size dim tmp]
  (let [d (H/dist p op q oq dim)]
    (if (>= step-size d)
      (M/copy-vec! out oo q oq dim)
      ;; Compute direction, scale to step-size
      (do
        (log! tmp 0 p op q oq dim)
        ;; Scale tangent vector to have norm = step-size
        (let [ratio (/ step-size d)]
          (M/scale-vec! tmp 0 ratio dim))
        (exp! out oo p op tmp 0 dim)))))

(defn reflect-through!
  "Reflect point q through p.

   Returns the point r such that p is the midpoint of q and r."
  [^js out oo ^js p op ^js q oq dim tmp]
  (log! tmp 0 p op q oq dim)
  ;; r = exp_p(-log_p(q))
  (M/scale-vec! tmp 0 -1.0 dim)
  (exp! out oo p op tmp 0 dim))
