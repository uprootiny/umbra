(ns app.math.hn.layout
  "Layout algorithms for hyperbolic tree visualization.

   Provides:
   1. RADIAL TREE LAYOUT
      Children arranged in sectors around parent.

   2. FORCE-DIRECTED LAYOUT
      Physics simulation for organic placement.

   3. HIERARCHICAL LAYOUT
      Top-down or left-right tree layout.

   4. CLUSTER LAYOUT
      Group related nodes together.

   All layouts work in hyperbolic space, using exp map
   for positioning."
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.pointset :as ps]))

;; ════════════════════════════════════════════════════════════════════════════
;; LAYOUT PARAMETERS
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const DEFAULT-EDGE-LENGTH 0.8)
(def ^:const DEFAULT-SIBLING-SPREAD (/ js/Math.PI 3))  ; 60 degrees
(def ^:const FORCE-REPULSION 0.5)
(def ^:const FORCE-ATTRACTION 0.3)
(def ^:const FORCE-DAMPING 0.9)
(def ^:const MAX-FORCE-ITERATIONS 50)

;; ════════════════════════════════════════════════════════════════════════════
;; RADIAL TREE LAYOUT
;; ════════════════════════════════════════════════════════════════════════════

(defn count-descendants
  "Count total descendants of a node."
  [ps idx]
  (let [children (ps/get-children ps idx)]
    (+ (count children)
       (reduce + 0 (map #(count-descendants ps %) children)))))

(defn compute-subtree-weights
  "Compute weight (descendant count) for each subtree."
  [ps root-idx]
  (let [children (ps/get-children ps root-idx)]
    (mapv (fn [child]
            {:idx child
             :weight (inc (count-descendants ps child))})
          children)))

(defn radial-layout!
  "Apply radial tree layout starting from root.

   Children are placed at equal angular distances around parent,
   with subtree size determining angular allocation.

   Args:
     ps: pointset
     root-idx: root of subtree to layout
     opts: {:edge-length, :start-angle, :spread-angle}"
  [ps root-idx & {:keys [edge-length start-angle spread-angle]
                  :or {edge-length DEFAULT-EDGE-LENGTH
                       start-angle 0
                       spread-angle (* 2 js/Math.PI)}}]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)]
    (letfn [(layout-subtree! [parent-idx parent-angle available-angle depth]
              (let [children (compute-subtree-weights ps parent-idx)
                    total-weight (reduce + 0 (map :weight children))
                    parent-off (* parent-idx stride)
                    ;; Compute distance based on depth (closer to root = longer edges)
                    dist (* edge-length (/ 1.0 (+ 1.0 (* 0.2 depth))))]
                (loop [remaining children
                       current-angle (- parent-angle (/ available-angle 2))
                       angles []]
                  (if (empty? remaining)
                    angles
                    (let [{:keys [idx weight]} (first remaining)
                          ;; Proportional angle allocation
                          child-angle (if (zero? total-weight)
                                        (/ available-angle (count children))
                                        (* available-angle (/ weight total-weight)))
                          ;; Center of child's arc
                          child-center (+ current-angle (/ child-angle 2))
                          ;; Build tangent vector in direction
                          tangent (M/make-vec dim)
                          _ (M/zero-vec! tangent 0 dim)
                          _ (aset tangent 1 (* dist (js/Math.cos child-center)))
                          _ (aset tangent 2 (* dist (js/Math.sin child-center)))
                          ;; Move to new position
                          child-off (* idx stride)]
                      (maps/exp! coords child-off coords parent-off tangent 0 dim)
                      ;; Recursively layout children
                      (layout-subtree! idx child-center (* child-angle 0.8) (inc depth))
                      (recur (rest remaining)
                             (+ current-angle child-angle)
                             (conj angles child-center)))))))]
      ;; Layout from root
      (layout-subtree! root-idx start-angle spread-angle 0))))

;; ════════════════════════════════════════════════════════════════════════════
;; FORCE-DIRECTED LAYOUT
;; ════════════════════════════════════════════════════════════════════════════

(defn compute-repulsion-force
  "Compute repulsive force between two nodes.

   Uses inverse square law in hyperbolic distance."
  [ps i j dim temp-vec]
  (let [stride (:stride ps)
        coords (:coords ps)
        d (H/dist coords (* i stride) coords (* j stride) dim)]
    (when (and (pos? d) (< d 5.0))  ; Cutoff for performance
      ;; Log direction from i to j
      (maps/log! temp-vec 0 coords (* i stride) coords (* j stride) dim)
      ;; Normalize and scale by inverse square
      (let [len (M/norm temp-vec 0 dim)]
        (when (pos? len)
          (M/scale-vec! temp-vec 0 (/ (* (- FORCE-REPULSION) (/ 1 (* d d))) len) dim)))
      temp-vec)))

(defn compute-attraction-force
  "Compute attractive force along edge (to parent).

   Uses spring-like force."
  [ps child-idx parent-idx target-dist dim temp-vec]
  (let [stride (:stride ps)
        coords (:coords ps)
        d (H/dist coords (* child-idx stride) coords (* parent-idx stride) dim)
        delta (- d target-dist)]
    ;; Log direction from child to parent
    (maps/log! temp-vec 0 coords (* child-idx stride) coords (* parent-idx stride) dim)
    ;; Scale by distance error
    (let [len (M/norm temp-vec 0 dim)]
      (when (pos? len)
        (M/scale-vec! temp-vec 0 (/ (* FORCE-ATTRACTION delta) len) dim)))
    temp-vec))

(defn force-directed-step!
  "Perform one step of force-directed layout.

   Args:
     ps: pointset
     root-idx: root (fixed in place)

   Returns total force magnitude (for convergence check)."
  [ps root-idx]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        n @(:count ps)
        forces (make-array n)  ; Array of force vectors
        temp (M/make-vec dim)]

    ;; Initialize forces
    (dotimes [i n]
      (aset forces i (M/make-vec dim))
      (M/zero-vec! (aget forces i) 0 dim))

    ;; Compute repulsive forces (all pairs)
    ;; For efficiency, only consider visible nodes
    (dotimes [i n]
      (when (not (ps/has-flag? ps i ps/FLAG-HIDDEN))
        (dotimes [j n]
          (when (and (not= i j)
                     (not (ps/has-flag? ps j ps/FLAG-HIDDEN)))
            (when-let [force (compute-repulsion-force ps i j dim temp)]
              (M/add-vec! (aget forces i) 0 force 0 dim))))))

    ;; Compute attractive forces (edges only)
    (dotimes [i n]
      (when (not (ps/has-flag? ps i ps/FLAG-HIDDEN))
        (let [parent (ps/get-parent ps i)]
          (when (and (>= parent 0)
                     (not (ps/has-flag? ps parent ps/FLAG-HIDDEN)))
            (let [force (compute-attraction-force ps i parent DEFAULT-EDGE-LENGTH dim temp)]
              (M/add-vec! (aget forces i) 0 force 0 dim))))))

    ;; Apply forces with damping
    (let [total-force (atom 0)]
      (dotimes [i n]
        (when (and (not= i root-idx)  ; Don't move root
                   (not (ps/has-flag? ps i ps/FLAG-PINNED))
                   (not (ps/has-flag? ps i ps/FLAG-HIDDEN)))
          (let [force (aget forces i)
                mag (M/norm force 0 dim)]
            (swap! total-force + mag)
            ;; Apply capped force
            (when (pos? mag)
              (let [capped-mag (min 0.3 mag)]
                (M/scale-vec! force 0 (/ (* FORCE-DAMPING capped-mag) mag) dim)
                ;; Move point
                (let [new-pos (M/make-vec dim)]
                  (maps/exp! new-pos 0 coords (* i stride) force 0 dim)
                  (M/copy-vec! coords (* i stride) new-pos 0 dim)))))))
      @total-force)))

(defn force-directed-layout!
  "Run force-directed layout until convergence.

   Args:
     ps: pointset
     root-idx: fixed root node
     opts: {:max-iterations, :tolerance}"
  [ps root-idx & {:keys [max-iterations tolerance]
                  :or {max-iterations MAX-FORCE-ITERATIONS
                       tolerance 0.01}}]
  (loop [iteration 0
         last-force js/Infinity]
    (when (and (< iteration max-iterations)
               (> last-force tolerance))
      (let [force (force-directed-step! ps root-idx)]
        (recur (inc iteration) force)))))

;; ════════════════════════════════════════════════════════════════════════════
;; HIERARCHICAL LAYOUT
;; ════════════════════════════════════════════════════════════════════════════

(defn hierarchical-layout!
  "Apply top-down hierarchical layout.

   Each depth level is placed on a hyperbolic geodesic circle.

   Args:
     ps: pointset
     root-idx: root of subtree
     opts: {:level-spacing, :horizontal-spread}"
  [ps root-idx & {:keys [level-spacing horizontal-spread]
                  :or {level-spacing 1.0
                       horizontal-spread 2.0}}]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        ;; Collect nodes by depth
        by-depth (atom {})
        _ (doseq [i (range @(:count ps))]
            (when (not (ps/has-flag? ps i ps/FLAG-HIDDEN))
              (let [d (ps/get-depth ps i)]
                (swap! by-depth update d (fnil conj []) i))))
        depths (sort (keys @by-depth))]

    ;; Place each level
    (doseq [depth depths]
      (let [nodes (get @by-depth depth)
            n (count nodes)
            ;; Distance from root
            dist (* depth level-spacing)
            ;; Horizontal spread at this level
            spread (* horizontal-spread (/ 1.0 (+ 1.0 (* 0.3 depth))))]
        (doseq [[i node] (map-indexed vector nodes)]
          (when (not= node root-idx)
            ;; Horizontal position
            (let [x (if (= n 1)
                      0
                      (* spread (- (/ i (dec n)) 0.5)))
                  ;; Build tangent
                  tangent (M/make-vec dim)
                  root-off (* root-idx stride)]
              (M/zero-vec! tangent 0 dim)
              (aset tangent 1 x)
              (aset tangent 2 dist)
              ;; Place node
              (maps/exp! coords (* node stride) coords root-off tangent 0 dim))))))))

;; ════════════════════════════════════════════════════════════════════════════
;; CLUSTER LAYOUT
;; ════════════════════════════════════════════════════════════════════════════

(defn cluster-by-motif
  "Group nodes by motif into clusters."
  [ps]
  (let [n @(:count ps)
        motifs (:motif ps)]
    (loop [i 0
           clusters {}]
      (if (>= i n)
        clusters
        (let [m (aget motifs i)]
          (recur (inc i)
                 (update clusters m (fnil conj []) i)))))))

(defn compact-cluster!
  "Move cluster nodes closer together.

   Args:
     ps: pointset
     indices: nodes in cluster
     center-idx: cluster center (or first node)
     radius: target cluster radius"
  [ps indices center-idx radius]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        center-off (* center-idx stride)
        n (count indices)]
    (doseq [[i idx] (map-indexed vector indices)]
      (when (not= idx center-idx)
        (let [;; Angle for this node
              angle (* 2 js/Math.PI (/ i n))
              ;; Random offset for organic look
              r (* radius (+ 0.8 (* 0.4 (js/Math.random))))
              tangent (M/make-vec dim)]
          (M/zero-vec! tangent 0 dim)
          (aset tangent 1 (* r (js/Math.cos angle)))
          (aset tangent 2 (* r (js/Math.sin angle)))
          (maps/exp! coords (* idx stride) coords center-off tangent 0 dim))))))

;; ════════════════════════════════════════════════════════════════════════════
;; LAYOUT HELPERS
;; ════════════════════════════════════════════════════════════════════════════

(defn center-on-root!
  "Move entire tree so root is at origin."
  [ps root-idx]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        n @(:count ps)
        root-off (* root-idx stride)
        ;; Isometry that sends root to origin
        origin (M/origin-vec dim)]
    ;; For each point, apply translation
    (dotimes [i n]
      (when (not= i root-idx)
        (let [off (* i stride)
              ;; Get tangent from root to this point
              tangent (M/make-vec dim)]
          (maps/log! tangent 0 coords root-off coords off dim)
          ;; Apply from origin
          (maps/exp! coords off origin 0 tangent 0 dim))))
    ;; Move root to origin
    (M/copy-vec! coords root-off origin 0 dim)))

(defn spread-children!
  "Spread children of a node evenly around it.

   Useful for quickly organizing a single node's children."
  [ps parent-idx]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        children (ps/get-children ps parent-idx)
        n (count children)
        parent-off (* parent-idx stride)]
    (when (pos? n)
      (doseq [[i child] (map-indexed vector children)]
        (let [angle (* 2 js/Math.PI (/ i n))
              dist DEFAULT-EDGE-LENGTH
              tangent (M/make-vec dim)]
          (M/zero-vec! tangent 0 dim)
          (aset tangent 1 (* dist (js/Math.cos angle)))
          (aset tangent 2 (* dist (js/Math.sin angle)))
          (maps/exp! coords (* child stride) coords parent-off tangent 0 dim))))))

