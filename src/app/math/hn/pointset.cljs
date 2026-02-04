(ns app.math.hn.pointset
  "Typed array container for sets of points on H^n.

   The PointSet is the fundamental data structure for the H^n engine.
   It stores:
     - N points in Lorentz coordinates (Float32Array)
     - Per-point attributes (depth, timestamp, motif, flags)
     - Sparse parent relationships (for tree structure)

   All data is stored in typed arrays for:
     - Cache-friendly memory layout
     - Zero GC pressure in hot loops
     - Easy GPU upload
     - Batch SIMD operations"
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]))

;; ════════════════════════════════════════════════════════════════════════════
;; POINTSET STRUCTURE
;; ════════════════════════════════════════════════════════════════════════════

(defn make-pointset
  "Create a new empty PointSet with capacity for max-points.

   Args:
     dim: hyperbolic dimension n (points are in R^{n+1})
     max-points: maximum number of points

   Returns a map containing:
     :dim - hyperbolic dimension
     :capacity - maximum points
     :count - current number of points (atom)
     :coords - Float32Array of Lorentz coordinates (max × (dim+1))
     :depth - Int16Array of tree depths
     :parent - Int32Array of parent indices (-1 for roots)
     :timestamp - Float32Array of creation times
     :flags - Uint8Array of per-point flags (pinned, hidden, selected, etc.)
     :motif - Int16Array of motif/cluster IDs
     :name-map - atom: name string → index
     :index-map - atom: index → {:name, :tags, :content}"
  [dim max-points]
  (let [stride (inc dim)
        coords (js/Float32Array. (* max-points stride))
        ;; Initialize all points to origin
        origin (M/origin-vec dim)]
    (loop [i 0]
      (when (< i max-points)
        (M/copy-vec! coords (* i stride) origin 0 dim)
        (recur (inc i))))

    {:dim dim
     :stride stride
     :capacity max-points
     :count (atom 0)
     :coords coords
     :depth (js/Int16Array. max-points)
     :parent (js/Int32Array. max-points)
     :timestamp (js/Float32Array. max-points)
     :flags (js/Uint8Array. max-points)
     :motif (js/Int16Array. max-points)
     :name-map (atom {})
     :index-map (atom {})}))

;; ════════════════════════════════════════════════════════════════════════════
;; FLAGS
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const FLAG-PINNED   0x01)
(def ^:const FLAG-HIDDEN   0x02)
(def ^:const FLAG-SELECTED 0x04)
(def ^:const FLAG-FOCUS    0x08)
(def ^:const FLAG-ACTIVE   0x10)  ; Has action/is interactive
(def ^:const FLAG-DIRTY    0x20)  ; Needs recomputation
(def ^:const FLAG-FOLDED   0x40)  ; Part of a fold
(def ^:const FLAG-ROOT     0x80)  ; Is a root node

(defn has-flag? [ps idx flag]
  (not (zero? (bit-and (aget (:flags ps) idx) flag))))

(defn set-flag! [ps idx flag]
  (let [flags (:flags ps)]
    (aset flags idx (bit-or (aget flags idx) flag))))

(defn clear-flag! [ps idx flag]
  (let [flags (:flags ps)]
    (aset flags idx (bit-and (aget flags idx) (bit-not flag)))))

(defn toggle-flag! [ps idx flag]
  (let [flags (:flags ps)]
    (aset flags idx (bit-xor (aget flags idx) flag))))

;; ════════════════════════════════════════════════════════════════════════════
;; POINT OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn offset
  "Get the offset into coords array for point i."
  [ps i]
  (* i (:stride ps)))

(defn get-point!
  "Copy point i into output array."
  [^js out oo ps i]
  (let [off (offset ps i)]
    (M/copy-vec! out oo (:coords ps) off (:dim ps))))

(defn set-point!
  "Set point i from source array."
  [ps i ^js src os]
  (let [off (offset ps i)]
    (M/copy-vec! (:coords ps) off src os (:dim ps))
    ;; Ensure on hyperboloid
    (H/normalize-hyperboloid! (:coords ps) off (:dim ps))))

(defn add-point!
  "Add a new point to the set.

   Args:
     ps: pointset
     coords: point coordinates (or nil for origin)
     name: string name
     parent: parent index (-1 for root)
     depth: tree depth
     meta: optional map with :tags, :content, :motif

   Returns the index of the new point, or -1 if full."
  [ps coords name parent depth meta]
  (let [n @(:count ps)
        cap (:capacity ps)]
    (if (>= n cap)
      -1  ; Full
      (let [off (* n (:stride ps))]
        ;; Set coordinates
        (if coords
          (do
            (M/copy-vec! (:coords ps) off coords 0 (:dim ps))
            (H/normalize-hyperboloid! (:coords ps) off (:dim ps)))
          ;; Default to origin
          (aset (:coords ps) off 1.0))

        ;; Set attributes
        (aset (:depth ps) n depth)
        (aset (:parent ps) n parent)
        (aset (:timestamp ps) n (js/Date.now))
        (aset (:flags ps) n (if (= parent -1) FLAG-ROOT 0))
        (aset (:motif ps) n (or (:motif meta) -1))

        ;; Update maps
        (swap! (:name-map ps) assoc name n)
        (swap! (:index-map ps) assoc n {:name name
                                         :tags (:tags meta)
                                         :content (:content meta)})

        ;; Increment count
        (swap! (:count ps) inc)
        n))))

(defn get-meta
  "Get metadata for point i."
  [ps i]
  (get @(:index-map ps) i))

(defn get-name
  "Get name of point i."
  [ps i]
  (:name (get-meta ps i)))

(defn find-by-name
  "Find point index by name."
  [ps name]
  (get @(:name-map ps) name))

;; ════════════════════════════════════════════════════════════════════════════
;; TREE OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn get-parent [ps i]
  (aget (:parent ps) i))

(defn get-depth [ps i]
  (aget (:depth ps) i))

(defn get-children
  "Get indices of all children of point i."
  [ps i]
  (let [n @(:count ps)
        parent-arr (:parent ps)]
    (loop [j 0
           children []]
      (if (>= j n)
        children
        (if (= (aget parent-arr j) i)
          (recur (inc j) (conj children j))
          (recur (inc j) children))))))

(defn get-ancestors
  "Get indices of all ancestors of point i (parent, grandparent, ...)."
  [ps i]
  (loop [current (get-parent ps i)
         ancestors []]
    (if (= current -1)
      ancestors
      (recur (get-parent ps current) (conj ancestors current)))))

(defn get-descendants
  "Get all descendants of point i (children, grandchildren, ...).

   Uses BFS for level-order traversal."
  [ps i]
  (loop [queue (get-children ps i)
         descendants []]
    (if (empty? queue)
      descendants
      (let [current (first queue)
            children (get-children ps current)]
        (recur (concat (rest queue) children)
               (conj descendants current))))))

;; ════════════════════════════════════════════════════════════════════════════
;; BATCH QUERIES
;; ════════════════════════════════════════════════════════════════════════════

(defn visible-points
  "Get indices of all visible (non-hidden) points."
  [ps]
  (let [n @(:count ps)
        flags (:flags ps)]
    (loop [i 0
           result []]
      (if (>= i n)
        result
        (if (zero? (bit-and (aget flags i) FLAG-HIDDEN))
          (recur (inc i) (conj result i))
          (recur (inc i) result))))))

(defn selected-points
  "Get indices of all selected points."
  [ps]
  (let [n @(:count ps)
        flags (:flags ps)]
    (loop [i 0
           result []]
      (if (>= i n)
        result
        (if (not (zero? (bit-and (aget flags i) FLAG-SELECTED)))
          (recur (inc i) (conj result i))
          (recur (inc i) result))))))

(defn pinned-points
  "Get indices of all pinned points."
  [ps]
  (let [n @(:count ps)
        flags (:flags ps)]
    (loop [i 0
           result []]
      (if (>= i n)
        result
        (if (not (zero? (bit-and (aget flags i) FLAG-PINNED)))
          (recur (inc i) (conj result i))
          (recur (inc i) result))))))

(defn points-at-depth
  "Get indices of all points at given depth."
  [ps d]
  (let [n @(:count ps)
        depths (:depth ps)]
    (loop [i 0
           result []]
      (if (>= i n)
        result
        (if (= (aget depths i) d)
          (recur (inc i) (conj result i))
          (recur (inc i) result))))))

;; ════════════════════════════════════════════════════════════════════════════
;; DISTANCE QUERIES
;; ════════════════════════════════════════════════════════════════════════════

(defn nearest-neighbor
  "Find the nearest point to a query point.

   Returns [index, distance] or nil if empty."
  [ps ^js query oq]
  (let [n @(:count ps)]
    (when (> n 0)
      (H/find-nearest query oq (:coords ps) n (:dim ps)))))

(defn k-nearest
  "Find k nearest neighbors."
  [ps ^js query oq k]
  (let [n @(:count ps)]
    (when (> n 0)
      (H/find-k-nearest query oq (:coords ps) n k (:dim ps)))))

(defn points-in-shell
  "Get points within distance range [r-min, r-max] from query."
  [ps ^js query oq r-min r-max]
  (let [n @(:count ps)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)]
    (loop [i 0
           result []]
      (if (>= i n)
        result
        (let [d (H/dist query oq coords (* i stride) dim)]
          (if (and (>= d r-min) (<= d r-max))
            (recur (inc i) (conj result i))
            (recur (inc i) result)))))))

;; ════════════════════════════════════════════════════════════════════════════
;; SERIALIZATION
;; ════════════════════════════════════════════════════════════════════════════

(defn to-edn
  "Export pointset to EDN for serialization."
  [ps]
  (let [n @(:count ps)
        dim (:dim ps)
        stride (:stride ps)]
    {:dim dim
     :count n
     :points
     (loop [i 0
            points []]
       (if (>= i n)
         points
         (let [off (* i stride)
               coords (loop [j 0, v []]
                        (if (> j dim)
                          v
                          (recur (inc j) (conj v (aget (:coords ps) (+ off j))))))]
           (recur (inc i)
                  (conj points
                        {:coords coords
                         :depth (aget (:depth ps) i)
                         :parent (aget (:parent ps) i)
                         :flags (aget (:flags ps) i)
                         :motif (aget (:motif ps) i)
                         :meta (get-meta ps i)})))))}))

(defn from-edn
  "Import pointset from EDN."
  [data]
  (let [dim (:dim data)
        n (:count data)
        ps (make-pointset dim (max n 1024))]

    (doseq [{:keys [coords depth parent flags motif meta]} (:points data)]
      (let [coord-arr (js/Float32Array. (clj->js coords))
            idx (add-point! ps coord-arr (:name meta) parent depth meta)]
        (when (>= idx 0)
          (aset (:flags ps) idx flags)
          (aset (:motif ps) idx motif))))

    ps))
