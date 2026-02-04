(ns app.math.hn.batch
  "Batched rendering with incremental updates and LOD culling.

   Key optimizations:
   1. DIRTY FLAGGING
      Only recompute what changed. Track dirty regions and
      incrementally update projections.

   2. LOD BATCHING
      Group points by LOD level. Render high-detail first,
      skip low-detail when frame budget exceeded.

   3. FRUSTUM CULLING
      Skip points outside the visible region entirely.
      Use bounding balls in hyperbolic space.

   4. RENDER LISTS
      Pre-sort by depth for correct painter's algorithm.
      Cache sorted order when nothing moves.

   This module produces render commands consumed by the canvas/WebGL
   renderer, decoupling geometry from drawing."
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.chart :as chart]
            [app.math.hn.lens :as lens]
            [app.math.hn.pool :as pool]))

(def ^:const FRAME-BUDGET-MS 12)  ; Target 83fps, leave margin for drawing

;; ════════════════════════════════════════════════════════════════════════════
;; DIRTY TRACKING
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const DIRTY-COORDS    0x01)
(def ^:const DIRTY-VISIBLE   0x02)
(def ^:const DIRTY-PROJECTED 0x04)
(def ^:const DIRTY-STYLE     0x08)
(def ^:const DIRTY-ALL       0x0F)

(defn make-dirty-tracker
  "Create dirty tracking state for a pointset."
  [max-points]
  {:flags (js/Uint8Array. max-points)  ; Per-point dirty bits
   :global (atom 0)                     ; Global dirty flags
   :dirty-count (atom 0)                ; How many points are dirty
   :regions (atom [])})                 ; Dirty region bounds

(defn mark-dirty!
  "Mark a point as dirty."
  [tracker idx flags]
  (let [current (aget (:flags tracker) idx)]
    (when (zero? current)
      (swap! (:dirty-count tracker) inc))
    (aset (:flags tracker) idx (bit-or current flags))))

(defn mark-all-dirty!
  "Mark all points as needing full recompute."
  [tracker n]
  (.fill (:flags tracker) DIRTY-ALL 0 n)
  (reset! (:dirty-count tracker) n)
  (swap! (:global tracker) #(bit-or % DIRTY-ALL)))

(defn mark-clean!
  "Mark a point as clean."
  [tracker idx]
  (when (not (zero? (aget (:flags tracker) idx)))
    (swap! (:dirty-count tracker) dec))
  (aset (:flags tracker) idx 0))

(defn is-dirty?
  "Check if point needs update."
  [tracker idx]
  (not (zero? (aget (:flags tracker) idx))))

(defn needs-any-update?
  "Check if any points need update."
  [tracker]
  (pos? @(:dirty-count tracker)))

(defn clear-all-dirty!
  "Reset all dirty flags."
  [tracker n]
  (.fill (:flags tracker) 0 0 n)
  (reset! (:dirty-count tracker) 0)
  (reset! (:global tracker) 0))

;; ════════════════════════════════════════════════════════════════════════════
;; RENDER BATCH STRUCTURE
;; ════════════════════════════════════════════════════════════════════════════

(defn make-render-batch
  "Create a render batch for efficient drawing.

   A batch contains all information needed to render a frame
   without accessing the original pointset during draw calls."
  [max-points]
  {:max-points max-points
   ;; Point data (indexed by point index)
   :screen-x (js/Float32Array. max-points)
   :screen-y (js/Float32Array. max-points)
   :radius (js/Float32Array. max-points)
   :depth (js/Int16Array. max-points)
   :flags (js/Uint8Array. max-points)
   :lod (js/Uint8Array. max-points)  ; 0=high, 1=med, 2=low, 3=culled
   ;; Sorted render order (indices)
   :render-order (js/Int32Array. max-points)
   :render-count (atom 0)
   ;; LOD group boundaries in render-order
   :lod-starts (js/Int32Array. 4)  ; [lod0-start, lod1-start, lod2-start, lod3-start]
   :lod-counts (js/Int32Array. 4)
   ;; Edge data
   :edge-x1 nil  ; Lazily allocated
   :edge-y1 nil
   :edge-x2 nil
   :edge-y2 nil
   :edge-count (atom 0)
   ;; Stats
   :frame-time (atom 0)
   :projected-count (atom 0)
   :culled-count (atom 0)})

;; ════════════════════════════════════════════════════════════════════════════
;; PROJECTION WITH CULLING
;; ════════════════════════════════════════════════════════════════════════════

(defn project-batch!
  "Project points from pointset through lens into render batch.

   Only processes dirty points if incremental=true.
   Returns true if any points were processed."
  [batch ps l tracker incremental?]
  (let [start-time (js/performance.now)
        n @(:count ps)
        dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        ps-flags (:flags ps)
        chart-obj (:chart l)
        focus @(:focus l)
        {:keys [width height scale offset-x offset-y]} (:viewport l)
        {:keys [near far]} (:aperture l)
        [t1 t2 t3] (:lod-thresholds l)
        ;; Output arrays
        sx (:screen-x batch)
        sy (:screen-y batch)
        rad (:radius batch)
        depths (:depth batch)
        flags-out (:flags batch)
        lods (:lod batch)
        ;; Stats
        projected (atom 0)
        culled (atom 0)]

    (loop [i 0]
      (when (< i n)
        (let [dirty? (or (not incremental?)
                         (is-dirty? tracker i))]
          (when dirty?
            (let [off (* i stride)
                  d (H/dist focus 0 coords off dim)]

              (if (or (< d near) (> d far))
                ;; Culled
                (do
                  (aset lods i 3)
                  (swap! culled inc))

                ;; Visible - project
                (let [[cx cy] (chart/project chart-obj coords off)
                      [px py] (chart/chart-to-screen [cx cy] width height
                                                     scale offset-x offset-y)
                      lod (cond (< d t1) 0 (< d t2) 1 (< d t3) 2 :else 3)
                      ;; Radius based on LOD
                      r (case lod 0 6.0 1 4.0 2 2.0 1.0)]
                  (aset sx i px)
                  (aset sy i py)
                  (aset rad i r)
                  (aset depths i (aget (:depth ps) i))
                  (aset flags-out i (aget ps-flags i))
                  (aset lods i lod)
                  (swap! projected inc)))

              (mark-clean! tracker i))))
        (recur (inc i))))

    (reset! (:projected-count batch) @projected)
    (reset! (:culled-count batch) @culled)
    (reset! (:frame-time batch) (- (js/performance.now) start-time))

    (pos? @projected)))

;; ════════════════════════════════════════════════════════════════════════════
;; RENDER ORDER SORTING
;; ════════════════════════════════════════════════════════════════════════════

(defn sort-render-order!
  "Sort points for rendering: by LOD first, then by depth.

   This produces correct painter's algorithm ordering and
   enables LOD-based early exit."
  [batch n]
  (let [order (:render-order batch)
        lods (:lod batch)
        depths (:depth batch)
        sx (:screen-x batch)
        sy (:screen-y batch)
        lod-starts (:lod-starts batch)
        lod-counts (:lod-counts batch)
        ;; Temporary array for sorting
        items (js/Array. n)]

    ;; Fill items with [idx, lod, depth]
    (loop [i 0]
      (when (< i n)
        (aset items i #js [i (aget lods i) (aget depths i)])
        (recur (inc i))))

    ;; Sort: LOD ascending, then depth descending (far to near)
    (.sort items
           (fn [a b]
             (let [lod-cmp (- (aget a 1) (aget b 1))]
               (if (zero? lod-cmp)
                 (- (aget b 2) (aget a 2))  ; Descending depth
                 lod-cmp))))

    ;; Extract sorted indices and count LOD groups
    (.fill lod-starts 0)
    (.fill lod-counts 0)

    (loop [i 0
           current-lod -1]
      (when (< i n)
        (let [item (aget items i)
              idx (aget item 0)
              lod (aget item 1)]
          (aset order i idx)
          ;; Track LOD group boundaries
          (when (not= lod current-lod)
            (aset lod-starts lod i))
          (aset lod-counts lod (inc (aget lod-counts lod)))
          (recur (inc i) lod))))

    (reset! (:render-count batch) n)))

;; ════════════════════════════════════════════════════════════════════════════
;; EDGE PROJECTION
;; ════════════════════════════════════════════════════════════════════════════

(defn ensure-edge-buffers!
  "Allocate edge buffers if needed."
  [batch max-edges]
  (when (or (nil? (:edge-x1 batch))
            (< (.-length (:edge-x1 batch)) max-edges))
    (-> batch
        (assoc :edge-x1 (js/Float32Array. max-edges))
        (assoc :edge-y1 (js/Float32Array. max-edges))
        (assoc :edge-x2 (js/Float32Array. max-edges))
        (assoc :edge-y2 (js/Float32Array. max-edges)))))

(defn project-edges!
  "Project edges into render batch.

   Only includes edges where both endpoints are visible."
  [batch ps l]
  (let [n @(:count ps)
        parent-arr (:parent ps)
        lods (:lod batch)
        sx (:screen-x batch)
        sy (:screen-y batch)
        ;; Estimate max edges
        max-edges n
        batch (ensure-edge-buffers! batch max-edges)
        ex1 (:edge-x1 batch)
        ey1 (:edge-y1 batch)
        ex2 (:edge-x2 batch)
        ey2 (:edge-y2 batch)]

    (loop [i 0
           edge-idx 0]
      (if (>= i n)
        (do
          (reset! (:edge-count batch) edge-idx)
          batch)
        (let [parent (aget parent-arr i)]
          (if (or (= parent -1)
                  (= (aget lods i) 3)      ; Child culled
                  (= (aget lods parent) 3)) ; Parent culled
            (recur (inc i) edge-idx)
            (do
              (aset ex1 edge-idx (aget sx parent))
              (aset ey1 edge-idx (aget sy parent))
              (aset ex2 edge-idx (aget sx i))
              (aset ey2 edge-idx (aget sy i))
              (recur (inc i) (inc edge-idx)))))))))

;; ════════════════════════════════════════════════════════════════════════════
;; FRAME BUDGET MANAGEMENT
;; ════════════════════════════════════════════════════════════════════════════

(defn compute-frame-budget
  "Determine how much work we can do this frame.

   Returns {:lod-limit, :edge-limit, :can-animate}"
  [batch last-frame-ms]
  (let [budget-remaining (- FRAME-BUDGET-MS last-frame-ms)]
    (cond
      ;; Plenty of budget - do everything
      (> budget-remaining 6)
      {:lod-limit 3 :edge-limit js/Infinity :can-animate true}

      ;; Moderate budget - limit LOD
      (> budget-remaining 3)
      {:lod-limit 2 :edge-limit 1000 :can-animate true}

      ;; Low budget - only high-detail
      (> budget-remaining 0)
      {:lod-limit 1 :edge-limit 500 :can-animate false}

      ;; Over budget - emergency mode
      :else
      {:lod-limit 0 :edge-limit 100 :can-animate false})))

;; ════════════════════════════════════════════════════════════════════════════
;; RENDER COMMANDS
;; ════════════════════════════════════════════════════════════════════════════

(defn generate-draw-commands
  "Generate draw commands from batch for the renderer.

   Commands are grouped for efficient state changes:
   - CLEAR: clear canvas
   - EDGES: batch of edge draws
   - NODES_LOD_N: batch of node draws at LOD N
   - LABELS: batch of label draws"
  [batch budget]
  (let [lod-limit (:lod-limit budget)
        edge-limit (:edge-limit budget)
        lod-starts (:lod-starts batch)
        lod-counts (:lod-counts batch)
        commands (transient [])]

    ;; Clear
    (conj! commands {:type :clear})

    ;; Edges (if budget allows)
    (let [edge-count (min @(:edge-count batch) edge-limit)]
      (when (pos? edge-count)
        (conj! commands {:type :edges
                         :batch batch
                         :count edge-count})))

    ;; Nodes by LOD
    (loop [lod 0]
      (when (<= lod lod-limit)
        (let [start (aget lod-starts lod)
              count (aget lod-counts lod)]
          (when (pos? count)
            (conj! commands {:type :nodes
                             :lod lod
                             :batch batch
                             :start start
                             :count count})))
        (recur (inc lod))))

    (persistent! commands)))

;; ════════════════════════════════════════════════════════════════════════════
;; BATCH RENDERER INTERFACE
;; ════════════════════════════════════════════════════════════════════════════

(defn make-batch-renderer
  "Create a batch renderer that manages projection and drawing.

   Returns object with update! and render! methods."
  [ps l max-points]
  (let [batch (make-render-batch max-points)
        tracker (make-dirty-tracker max-points)
        last-frame-time (atom 0)]

    {:batch batch
     :tracker tracker
     :pointset ps
     :lens l

     :invalidate!
     (fn []
       (mark-all-dirty! tracker @(:count ps)))

     :update!
     (fn []
       (pool/begin-frame!)
       (let [n @(:count ps)
             changed? (project-batch! batch ps l tracker true)]
         (when changed?
           (sort-render-order! batch n)
           (project-edges! batch ps l))
         (reset! last-frame-time @(:frame-time batch))
         changed?))

     :get-commands
     (fn []
       (let [budget (compute-frame-budget batch @last-frame-time)]
         (generate-draw-commands batch budget)))

     :stats
     (fn []
       {:projected @(:projected-count batch)
        :culled @(:culled-count batch)
        :edges @(:edge-count batch)
        :frame-ms @(:frame-time batch)
        :render-count @(:render-count batch)})}))
