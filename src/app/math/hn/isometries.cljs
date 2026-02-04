(ns app.math.hn.isometries
  "Isometries of H^n in the hyperboloid model.

   Isometries of H^n are exactly the linear transformations in O(1,n)
   that preserve the upper sheet:

     Isom(H^n) = O⁺(1,n) ⊂ GL(n+1, R)

   Key operations:

   1. TRANSVECTION (hyperbolic translation)
      Moves a point p to another point q along the geodesic.
      This is the 'boost' in the Lorentz group.

   2. ROTATION
      Rotates around a point. For the origin, this is just an SO(n)
      rotation of the spatial components.

   3. REFLECTION
      Reflects through a hyperplane. Combined, these generate all isometries.

   In this module, we focus on transvections (the most useful for navigation)
   and provide matrix-based operations for full generality."
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]))

(def ^:const EPSILON 1e-10)

;; ════════════════════════════════════════════════════════════════════════════
;; TRANSVECTIONS (Hyperbolic Translations / Lorentz Boosts)
;; ════════════════════════════════════════════════════════════════════════════

(defn transvect-to-origin!
  "Apply transvection that moves p to the origin (1,0,...,0).

   This is a Lorentz boost. For any point x, returns T_p(x) where
   T_p(p) = origin.

   Formula (for moving p to origin):
     If p = (cosh(d), sinh(d)·u) where u is unit spatial vector,
     then T maps by 'unboosting' in the u direction.

   Implementation uses the explicit formula:
     T(x)₀ = p₀·x₀ - Σᵢ pᵢxᵢ
     T(x)ᵢ = xᵢ + ((p₀-1)xᵢ - pᵢx₀ + pᵢ·Σⱼpⱼxⱼ/(p₀+1)) / (spatial norm of p)²
            (simplified version)"
  [^js out oo ^js x ox ^js p op dim]
  (let [p0 (aget p op)
        x0 (aget x ox)
        ;; <p,x>_L = -p₀x₀ + Σpᵢxᵢ
        inner (M/dot-L p op x ox dim)]

    (if (< (js/Math.abs (- p0 1.0)) EPSILON)
      ;; p is already at origin
      (M/copy-vec! out oo x ox dim)

      ;; General transvection
      (let [;; Spatial dot: Σpᵢxᵢ
            spatial-dot (loop [i 1, acc 0.0]
                          (if (> i dim)
                            acc
                            (recur (inc i) (+ acc (* (aget p (+ op i))
                                                     (aget x (+ ox i)))))))
            ;; Result timelike component: p₀x₀ - spatial-dot = -inner
            new-x0 (- inner)
            ;; Coefficient for spatial adjustment
            coef (/ (+ spatial-dot (* (- p0 1.0) x0)) (+ p0 1.0))]

        ;; Set timelike
        (aset out oo new-x0)

        ;; Set spatial: xᵢ' = xᵢ - pᵢ · coef
        (loop [i 1]
          (when (<= i dim)
            (aset out (+ oo i)
                  (- (aget x (+ ox i))
                     (* (aget p (+ op i)) coef)))
            (recur (inc i))))

        ;; Renormalize
        (H/normalize-hyperboloid! out oo dim)
        out))))

(defn transvect-from-origin!
  "Apply transvection that moves the origin to p.

   This is the inverse of transvect-to-origin.

   For point at origin: returns p.
   For general x: returns the image of x under T⁻¹_p."
  [^js out oo ^js x ox ^js p op dim]
  (let [p0 (aget p op)
        x0 (aget x ox)]

    (if (< (js/Math.abs (- p0 1.0)) EPSILON)
      ;; p is at origin: identity
      (M/copy-vec! out oo x ox dim)

      ;; General case
      (let [;; Spatial dot
            spatial-dot (loop [i 1, acc 0.0]
                          (if (> i dim)
                            acc
                            (recur (inc i) (+ acc (* (aget p (+ op i))
                                                     (aget x (+ ox i)))))))
            ;; New timelike: p₀x₀ + spatial-dot
            new-x0 (+ (* p0 x0) spatial-dot)
            ;; Coefficient
            coef (/ (+ spatial-dot (* (- p0 1.0) x0)) (+ p0 1.0))]

        (aset out oo new-x0)

        (loop [i 1]
          (when (<= i dim)
            (aset out (+ oo i)
                  (+ (aget x (+ ox i))
                     (* (aget p (+ op i)) coef)))
            (recur (inc i))))

        (H/normalize-hyperboloid! out oo dim)
        out))))

(defn transvect!
  "Apply transvection that moves point a to point b.

   This is the composition: T_b ∘ T_a⁻¹

   T(a) = b
   T(x) for general x is the translated point."
  [^js out oo ^js x ox ^js a oa ^js b ob dim tmp]
  ;; First move to origin (relative to a)
  (transvect-to-origin! tmp 0 x ox a oa dim)
  ;; Then move from origin to b
  (transvect-from-origin! out oo tmp 0 b ob dim))

;; ════════════════════════════════════════════════════════════════════════════
;; ROTATIONS (around the origin)
;; ════════════════════════════════════════════════════════════════════════════

(defn rotate-2d!
  "Rotate in the (i,j) plane (spatial components) by angle theta.

   This is a rotation around the origin in H^n.

   Only affects components i and j (1-indexed spatial components)."
  [^js out oo ^js x ox i j theta dim]
  (let [cos-t (js/Math.cos theta)
        sin-t (js/Math.sin theta)
        xi (aget x (+ ox i))
        xj (aget x (+ ox j))]
    ;; Copy all components
    (M/copy-vec! out oo x ox dim)
    ;; Rotate i,j
    (aset out (+ oo i) (- (* cos-t xi) (* sin-t xj)))
    (aset out (+ oo j) (+ (* sin-t xi) (* cos-t xj)))
    out))

(defn rotate-around!
  "Rotate point x around center c in the (i,j) plane by angle theta.

   1. Transvect c to origin
   2. Rotate
   3. Transvect origin back to c"
  [^js out oo ^js x ox ^js c oc i j theta dim tmp1 tmp2]
  ;; To origin
  (transvect-to-origin! tmp1 0 x ox c oc dim)
  ;; Rotate
  (rotate-2d! tmp2 0 tmp1 0 i j theta dim)
  ;; Back
  (transvect-from-origin! out oo tmp2 0 c oc dim))

;; ════════════════════════════════════════════════════════════════════════════
;; MATRIX OPERATIONS (for full generality)
;; ════════════════════════════════════════════════════════════════════════════

(defn make-matrix
  "Create an (n+1) × (n+1) identity matrix as Float32Array."
  [dim]
  (let [size (inc dim)
        m (js/Float32Array. (* size size))]
    ;; Set diagonal to 1
    (loop [i 0]
      (when (< i size)
        (aset m (+ (* i size) i) 1.0)
        (recur (inc i))))
    m))

(defn matrix-apply!
  "Apply matrix M to vector x: out = M·x.

   M is (n+1)×(n+1) stored row-major."
  [^js out oo ^js M ^js x ox dim]
  (let [size (inc dim)]
    (loop [i 0]
      (when (< i size)
        (let [row-start (* i size)]
          (aset out (+ oo i)
                (loop [j 0, acc 0.0]
                  (if (>= j size)
                    acc
                    (recur (inc j)
                           (+ acc (* (aget M (+ row-start j))
                                     (aget x (+ ox j)))))))))
        (recur (inc i))))
    out))

(defn matrix-multiply!
  "Matrix multiplication: out = A·B.

   All matrices are (n+1)×(n+1) stored row-major."
  [^js out ^js A ^js B dim]
  (let [size (inc dim)]
    (loop [i 0]
      (when (< i size)
        (loop [j 0]
          (when (< j size)
            (let [sum (loop [k 0, acc 0.0]
                        (if (>= k size)
                          acc
                          (recur (inc k)
                                 (+ acc (* (aget A (+ (* i size) k))
                                           (aget B (+ (* k size) j)))))))]
              (aset out (+ (* i size) j) sum))
            (recur (inc j))))
        (recur (inc i))))
    out))

(defn transvection-matrix!
  "Compute the transvection matrix that moves the origin to point p.

   The result is an O(1,n) matrix M such that M·origin = p."
  [^js out ^js p op dim]
  (let [size (inc dim)
        p0 (aget p op)]
    ;; Start with identity
    (loop [i 0]
      (when (< i (* size size))
        (aset out i 0.0)
        (recur (inc i))))
    (loop [i 0]
      (when (< i size)
        (aset out (+ (* i size) i) 1.0)
        (recur (inc i))))

    (when (> (js/Math.abs (- p0 1.0)) EPSILON)
      (let [factor (/ 1.0 (+ p0 1.0))]
        ;; M[0,0] = p0
        (aset out 0 p0)
        ;; M[0,j] = p[j] for j > 0
        ;; M[i,0] = p[i] for i > 0
        (loop [i 1]
          (when (<= i dim)
            (let [pi (aget p (+ op i))]
              (aset out i pi)
              (aset out (* i size) pi)
              ;; M[i,j] = delta_ij + p[i]·p[j]·factor for i,j > 0
              (loop [j 1]
                (when (<= j dim)
                  (let [pj (aget p (+ op j))
                        current (aget out (+ (* i size) j))]
                    (aset out (+ (* i size) j)
                          (+ current (* pi pj factor))))
                  (recur (inc j)))))
            (recur (inc i))))))
    out))

;; ════════════════════════════════════════════════════════════════════════════
;; CAMERA / VIEW TRANSFORMS
;; ════════════════════════════════════════════════════════════════════════════

(defn camera-transform!
  "Transform points from world coordinates to camera coordinates.

   Camera is defined by:
     - focus: point in H^n that becomes the origin
     - up: vector defining the 'up' direction in tangent space

   Returns point in camera space (origin-centered)."
  [^js out oo ^js x ox ^js focus of dim]
  (transvect-to-origin! out oo x ox focus of dim))

(defn inverse-camera-transform!
  "Transform from camera coordinates back to world coordinates."
  [^js out oo ^js x ox ^js focus of dim]
  (transvect-from-origin! out oo x ox focus of dim))
