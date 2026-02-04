(ns app.math.hn.vptree
  "Vantage-Point Tree for O(log n) nearest neighbor queries in H^n.

   A VP-tree is a metric space data structure that uses the triangle
   inequality for efficient pruning. It's ideal for hyperbolic space
   because:
     1. Only requires a distance function (no coordinates)
     2. Works with any metric (hyperbolic distance satisfies this)
     3. Average O(log n) query time for nearest neighbor
     4. Simple to implement and maintain

   Structure:
     Each node stores:
       - vantage point index
       - median distance from vantage to descendants
       - inside subtree (points closer than median)
       - outside subtree (points farther than median)

   Building: O(n log n)
   Query: O(log n) average, O(n) worst case
   Space: O(n)

   For dynamic updates, we use a lazy rebuild strategy:
     - Small changes accumulate in a buffer
     - When buffer exceeds threshold, rebuild affected subtree"
  (:require [app.math.hn.hyperboloid :as H]
            [app.math.hn.pool :as pool]))

(def ^:const LEAF-SIZE 8)  ; Max points in leaf before splitting

;; ════════════════════════════════════════════════════════════════════════════
;; TREE STRUCTURE
;; ════════════════════════════════════════════════════════════════════════════

(defrecord VPNode [vantage-idx  ; Index of vantage point in pointset
                   median       ; Median distance to descendants
                   inside       ; Subtree of points closer than median
                   outside      ; Subtree of points farther than median
                   indices])    ; For leaves: array of point indices

(defn leaf?
  "Check if node is a leaf."
  [node]
  (some? (:indices node)))

(defn- select-vantage
  "Select vantage point from candidates.

   Uses random selection - simple and effective.
   Could use spread maximization for better trees."
  [indices]
  (nth indices (rand-int (count indices))))

(defn- partition-by-distance
  "Partition points into inside/outside based on median distance.

   Returns [inside outside median] where:
     inside: points with d < median
     outside: points with d >= median"
  [vantage-idx other-indices dist-fn]
  (let [;; Compute distances to vantage
        dists (mapv (fn [idx] [(dist-fn vantage-idx idx) idx]) other-indices)
        ;; Sort by distance
        sorted (sort-by first dists)
        ;; Find median
        n (count sorted)
        mid (quot n 2)
        median (first (nth sorted mid))
        ;; Partition
        inside (mapv second (take mid sorted))
        outside (mapv second (drop mid sorted))]
    [inside outside median]))

(defn build-tree
  "Build VP-tree from point indices.

   Args:
     indices: vector of point indices to include
     dist-fn: (i, j) → distance between points i and j

   Returns root VPNode."
  [indices dist-fn]
  (cond
    ;; Empty
    (empty? indices)
    nil

    ;; Leaf
    (<= (count indices) LEAF-SIZE)
    (->VPNode nil 0 nil nil (vec indices))

    ;; Internal node
    :else
    (let [vantage (select-vantage indices)
          others (filterv #(not= % vantage) indices)
          [inside outside median] (partition-by-distance vantage others dist-fn)]
      (->VPNode vantage
                median
                (when (seq inside) (build-tree inside dist-fn))
                (when (seq outside) (build-tree outside dist-fn))
                nil))))

;; ════════════════════════════════════════════════════════════════════════════
;; NEAREST NEIGHBOR QUERY
;; ════════════════════════════════════════════════════════════════════════════

(defn- search-leaf
  "Search a leaf node for nearest neighbor."
  [node query-idx dist-fn best-idx best-dist]
  (loop [remaining (:indices node)
         bi best-idx
         bd best-dist]
    (if (empty? remaining)
      [bi bd]
      (let [idx (first remaining)]
        (if (= idx query-idx)
          (recur (rest remaining) bi bd)
          (let [d (dist-fn query-idx idx)]
            (if (< d bd)
              (recur (rest remaining) idx d)
              (recur (rest remaining) bi bd))))))))

(defn nearest-neighbor
  "Find nearest neighbor to query point.

   Args:
     tree: VP-tree root
     query-idx: index of query point
     dist-fn: (i, j) → distance

   Returns [idx distance] or nil if tree empty."
  [tree query-idx dist-fn]
  (when tree
    (loop [stack [tree]
           best-idx -1
           best-dist js/Infinity]
      (if (empty? stack)
        (when (>= best-idx 0) [best-idx best-dist])
        (let [node (peek stack)
              stack' (pop stack)]
          (if (leaf? node)
            ;; Search leaf
            (let [[bi bd] (search-leaf node query-idx dist-fn best-idx best-dist)]
              (recur stack' bi bd))
            ;; Internal node
            (let [vp (:vantage-idx node)
                  mu (:median node)
                  d-vp (if (= vp query-idx) 0 (dist-fn query-idx vp))
                  ;; Update best if vantage is closer
                  [best-idx best-dist] (if (and (not= vp query-idx) (< d-vp best-dist))
                                         [vp d-vp]
                                         [best-idx best-dist])
                  ;; Determine search order
                  inside-first? (< d-vp mu)
                  first-child (if inside-first? (:inside node) (:outside node))
                  second-child (if inside-first? (:outside node) (:inside node))
                  ;; Can we prune second child?
                  ;; If d-vp - best_dist > mu, inside is too far
                  ;; If d-vp + best_dist < mu, outside is too far
                  can-prune-second? (if inside-first?
                                      (> (- d-vp best-dist) mu)
                                      (< (+ d-vp best-dist) mu))
                  stack' (cond-> stack'
                           (and second-child (not can-prune-second?))
                           (conj second-child)
                           first-child
                           (conj first-child))]
              (recur stack' best-idx best-dist))))))))

;; ════════════════════════════════════════════════════════════════════════════
;; K-NEAREST NEIGHBORS
;; ════════════════════════════════════════════════════════════════════════════

(defn- insert-into-heap
  "Insert into a max-heap of k elements (sorted by distance descending).

   Keeps only k nearest."
  [heap idx dist k]
  (let [new-entry [dist idx]
        heap' (conj heap new-entry)]
    (if (> (count heap') k)
      (vec (rest (sort-by first > heap')))
      (vec (sort-by first > heap')))))

(defn k-nearest
  "Find k nearest neighbors.

   Returns vector of [idx distance] pairs, sorted by distance."
  [tree query-idx k dist-fn]
  (when tree
    (loop [stack [tree]
           heap []]  ; Max-heap by distance
      (if (empty? stack)
        (vec (sort-by first (map (fn [[d i]] [i d]) heap)))
        (let [node (peek stack)
              stack' (pop stack)
              ;; Current k-th distance (or infinity if < k found)
              tau (if (< (count heap) k) js/Infinity (first (first heap)))]
          (if (leaf? node)
            ;; Search leaf
            (let [heap' (reduce
                         (fn [h idx]
                           (if (= idx query-idx)
                             h
                             (let [d (dist-fn query-idx idx)]
                               (if (or (< (count h) k) (< d (first (first h))))
                                 (insert-into-heap h idx d k)
                                 h))))
                         heap
                         (:indices node))]
              (recur stack' heap'))
            ;; Internal node
            (let [vp (:vantage-idx node)
                  mu (:median node)
                  d-vp (if (= vp query-idx) 0 (dist-fn query-idx vp))
                  heap' (if (and (not= vp query-idx)
                                 (or (< (count heap) k) (< d-vp tau)))
                          (insert-into-heap heap vp d-vp k)
                          heap)
                  tau' (if (< (count heap') k) js/Infinity (first (first heap')))
                  ;; Search order
                  inside-first? (< d-vp mu)
                  first-child (if inside-first? (:inside node) (:outside node))
                  second-child (if inside-first? (:outside node) (:inside node))
                  ;; Pruning with updated tau
                  can-prune-second? (if inside-first?
                                      (> (- d-vp tau') mu)
                                      (< (+ d-vp tau') mu))
                  stack' (cond-> stack'
                           (and second-child (not can-prune-second?))
                           (conj second-child)
                           first-child
                           (conj first-child))]
              (recur stack' heap'))))))))

;; ════════════════════════════════════════════════════════════════════════════
;; RANGE QUERY
;; ════════════════════════════════════════════════════════════════════════════

(defn range-query
  "Find all points within distance r of query.

   Returns vector of [idx distance] pairs."
  [tree query-idx r dist-fn]
  (when tree
    (loop [stack [tree]
           results []]
      (if (empty? stack)
        results
        (let [node (peek stack)
              stack' (pop stack)]
          (if (leaf? node)
            ;; Check all in leaf
            (let [matches (reduce
                           (fn [acc idx]
                             (if (= idx query-idx)
                               acc
                               (let [d (dist-fn query-idx idx)]
                                 (if (<= d r)
                                   (conj acc [idx d])
                                   acc))))
                           []
                           (:indices node))]
              (recur stack' (into results matches)))
            ;; Internal node
            (let [vp (:vantage-idx node)
                  mu (:median node)
                  d-vp (if (= vp query-idx) 0 (dist-fn query-idx vp))
                  results' (if (and (not= vp query-idx) (<= d-vp r))
                             (conj results [vp d-vp])
                             results)
                  ;; Which subtrees to search?
                  search-inside? (< (- d-vp r) mu)
                  search-outside? (> (+ d-vp r) mu)
                  stack' (cond-> stack'
                           (and search-outside? (:outside node))
                           (conj (:outside node))
                           (and search-inside? (:inside node))
                           (conj (:inside node)))]
              (recur stack' results'))))))))

;; ════════════════════════════════════════════════════════════════════════════
;; INTEGRATION WITH POINTSET
;; ════════════════════════════════════════════════════════════════════════════

(defn build-from-pointset
  "Build VP-tree from a pointset.

   Returns tree that can be queried with point indices."
  [ps]
  (let [n @(:count ps)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        dist-fn (fn [i j]
                  (H/dist coords (* i stride) coords (* j stride) dim))
        indices (vec (range n))]
    (build-tree indices dist-fn)))

(defn make-index
  "Create a spatial index wrapper for a pointset.

   Returns an object that tracks the tree and rebuilds as needed."
  [ps]
  {:pointset ps
   :tree (atom nil)
   :version (atom 0)
   :ps-version (atom @(:count ps))
   :pending-inserts (atom [])
   :rebuild-threshold 32})

(defn ensure-built!
  "Ensure tree is built and up-to-date."
  [index]
  (let [ps (:pointset index)
        current-count @(:count ps)
        cached-count @(:ps-version index)]
    (when (or (nil? @(:tree index))
              (not= current-count cached-count)
              (> (count @(:pending-inserts index)) (:rebuild-threshold index)))
      ;; Rebuild
      (reset! (:tree index) (build-from-pointset ps))
      (reset! (:ps-version index) current-count)
      (reset! (:pending-inserts index) [])
      (swap! (:version index) inc)))
  @(:tree index))

(defn query-nearest
  "Query for nearest neighbor using the index."
  [index query-idx]
  (let [tree (ensure-built! index)
        ps (:pointset index)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)]
    (nearest-neighbor tree query-idx
                      (fn [i j]
                        (H/dist coords (* i stride) coords (* j stride) dim)))))

(defn query-k-nearest
  "Query for k nearest neighbors using the index."
  [index query-idx k]
  (let [tree (ensure-built! index)
        ps (:pointset index)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)]
    (k-nearest tree query-idx k
               (fn [i j]
                 (H/dist coords (* i stride) coords (* j stride) dim)))))

(defn query-range
  "Query for all points within distance r."
  [index query-idx r]
  (let [tree (ensure-built! index)
        ps (:pointset index)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)]
    (range-query tree query-idx r
                 (fn [i j]
                   (H/dist coords (* i stride) coords (* j stride) dim)))))
