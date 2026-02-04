(ns app.math.hn.core
  "Core integration module for the H^n engine.

   This module:
   1. Initializes the H^n engine state
   2. Exports API for JavaScript interop
   3. Manages the manifold state and view lenses
   4. Provides the bridge between ClojureScript math and JS rendering

   Usage from JavaScript:
     const Hn = window.HnEngine;
     Hn.init(5);  // Initialize for H^5
     const ps = Hn.createPointset(1000);
     Hn.addPoint(ps, 'root', null, {});
     const projected = Hn.projectForRender(ps, lens);"
  (:require [clojure.string :as str]
            [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.isometries :as iso]
            [app.math.hn.chart :as chart]
            [app.math.hn.pointset :as ps]
            [app.math.hn.field :as field]
            [app.math.hn.lens :as lens]
            [app.math.hn.operator :as op]
            [app.math.hn.pool :as pool]
            [app.math.hn.vptree :as vptree]
            [app.math.hn.batch :as batch]
            [app.math.hn.animate :as anim]
            [app.math.hn.keyboard :as kbd]
            [app.state.persist :as persist]
            [app.state.history :as history]
            [app.ui.interact :as interact]
            [app.ui.drag :as drag]
            [app.ui.nav :as nav]
            [app.ui.export :as export]
            [app.ui.clipboard :as clipboard]
            [app.ui.context-menu :as ctx-menu]
            [app.ui.touch :as touch]
            [app.ui.style :as style]
            [app.ui.labels :as labels]
            [app.math.hn.layout :as layout]))

;; ════════════════════════════════════════════════════════════════════════════
;; GLOBAL STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce ^:private engine-state
  (atom {:initialized false
         :dim nil
         :pointsets {}
         :lenses {}
         :fields {}
         :active-lens nil
         :renderers {}      ; Batch renderers per pointset
         :indices {}        ; VP-tree indices per pointset
         :keyboard-cleanup nil}))

;; ════════════════════════════════════════════════════════════════════════════
;; INITIALIZATION
;; ════════════════════════════════════════════════════════════════════════════

(defn init!
  "Initialize the H^n engine with dimension n.

   Called once on startup. Creates default lenses and fields."
  [dim]
  (let [main-chart (chart/tangent-chart dim 1 2)
        main-lens (lens/make-lens dim main-chart
                                   :aperture-far 15.0
                                   :lod-thresholds [2.0 5.0 10.0])
        minimap-lens (lens/make-minimap-lens dim)
        density-field (field/make-density-field field/gaussian-kernel 1.0)]

    (reset! engine-state
            {:initialized true
             :dim dim
             :pointsets {}
             :lenses {:main main-lens
                      :minimap minimap-lens}
             :fields {:density density-field}
             :active-lens :main})

    (js/console.log (str "[H^n] Engine initialized for dimension " dim))
    true))

(defn before-reload!
  "Called before hot reload (shadow-cljs)."
  []
  (js/console.log "[H^n] Preparing for hot reload..."))

(defn after-reload!
  "Called after hot reload (shadow-cljs)."
  []
  (js/console.log "[H^n] Hot reload complete."))

;; ════════════════════════════════════════════════════════════════════════════
;; POINTSET MANAGEMENT
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export create-pointset
  "Create a new pointset with given capacity.

   Returns pointset ID for future reference."
  [capacity]
  (let [dim (:dim @engine-state)
        id (str "ps-" (random-uuid))
        new-ps (ps/make-pointset dim capacity)]
    (swap! engine-state assoc-in [:pointsets id] new-ps)
    id))

(defn ^:export get-pointset
  "Get a pointset by ID."
  [ps-id]
  (get-in @engine-state [:pointsets ps-id]))

(defn ^:export add-point
  "Add a point to a pointset.

   Args:
     ps-id: pointset ID
     name: string name for the point
     parent-name: parent's name (or nil for root)
     meta: JS object with optional :tags, :content, :motif

   Returns index of new point, or -1 if full."
  [ps-id name parent-name meta-obj]
  (when-let [pointset (get-pointset ps-id)]
    (let [parent-idx (if parent-name
                       (ps/find-by-name pointset parent-name)
                       -1)
          parent-idx (or parent-idx -1)
          depth (if (= parent-idx -1)
                  0
                  (inc (ps/get-depth pointset parent-idx)))
          ;; Convert JS object to map
          meta-map (when meta-obj
                     {:tags (.-tags meta-obj)
                      :content (.-content meta-obj)
                      :motif (.-motif meta-obj)})]

      ;; If parent exists, position new point near parent
      (if (= parent-idx -1)
        ;; Root: use origin
        (ps/add-point! pointset nil name -1 0 meta-map)
        ;; Child: position along random direction from parent
        (let [dim (:dim pointset)
              stride (:stride pointset)
              coords (:coords pointset)
              parent-off (* parent-idx stride)
              ;; Random tangent direction
              tangent (M/make-vec dim)
              _ (loop [i 1]
                  (when (<= i dim)
                    (aset tangent i (* 0.5 (- (js/Math.random) 0.5)))
                    (recur (inc i))))
              ;; Normalize and scale
              _ (M/tangent-project! tangent 0 coords parent-off tangent 0 dim)
              _ (M/tangent-normalize! tangent 0 dim 1e-10)
              _ (M/scale-vec! tangent 0 0.5 dim)  ; Distance 0.5 from parent
              ;; Exp map to get child position
              child-coords (M/make-vec dim)]
          (maps/exp! child-coords 0 coords parent-off tangent 0 dim)
          (ps/add-point! pointset child-coords name parent-idx depth meta-map))))))

(defn ^:export move-point
  "Move a point toward a target in the manifold.

   Args:
     ps-id: pointset ID
     idx: point index
     target-idx: target point index
     step: distance to move"
  [ps-id idx target-idx step]
  (when-let [pointset (get-pointset ps-id)]
    (let [dim (:dim pointset)
          stride (:stride pointset)
          coords (:coords pointset)
          tmp (M/make-vec dim)]
      (maps/move-toward! tmp 0
                         coords (* idx stride)
                         coords (* target-idx stride)
                         step dim tmp)
      (ps/set-point! pointset idx tmp 0))))

(defn ^:export get-point-count
  "Get number of points in a pointset."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    @(:count pointset)))

(defn ^:export get-point-meta
  "Get metadata for a point."
  [ps-id idx]
  (when-let [pointset (get-pointset ps-id)]
    (clj->js (ps/get-meta pointset idx))))

;; ════════════════════════════════════════════════════════════════════════════
;; LENS MANAGEMENT
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export set-active-lens
  "Set the active lens for rendering."
  [lens-id]
  (swap! engine-state assoc :active-lens (keyword lens-id)))

(defn ^:export set-lens-focus
  "Set focus point of a lens by point index."
  [lens-id ps-id idx]
  (when-let [l (get-in @engine-state [:lenses (keyword lens-id)])]
    (when-let [pointset (get-pointset ps-id)]
      (lens/follow-point! l pointset idx))))

(defn ^:export set-lens-viewport
  "Set viewport dimensions for a lens."
  [lens-id width height scale offset-x offset-y]
  (when-let [l (get-in @engine-state [:lenses (keyword lens-id)])]
    (swap! engine-state update-in [:lenses (keyword lens-id)]
           lens/set-viewport! width height scale offset-x offset-y)))

(defn ^:export zoom-lens
  "Adjust zoom of active lens."
  [delta]
  (let [lens-id (:active-lens @engine-state)]
    (when-let [l (get-in @engine-state [:lenses lens-id])]
      (let [current-scale (get-in l [:viewport :scale])
            new-scale (* current-scale (js/Math.pow 1.1 delta))]
        (swap! engine-state assoc-in [:lenses lens-id :viewport :scale]
               (max 10 (min 1000 new-scale)))))))

;; ════════════════════════════════════════════════════════════════════════════
;; PROJECTION FOR RENDERING
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export project-for-render
  "Project all visible points through active lens.

   Returns JS array of objects:
   [{idx, x, y, lod, dist, meta}, ...]

   Sorted by priority/depth for proper rendering order."
  [ps-id]
  (let [lens-id (:active-lens @engine-state)]
    (when-let [l (get-in @engine-state [:lenses lens-id])]
      (when-let [pointset (get-pointset ps-id)]
        (->> (lens/project-points l pointset)
             (map (fn [{:keys [idx screen lod dist]}]
                    (let [[sx sy] screen
                          meta (ps/get-meta pointset idx)]
                      #js {:idx idx
                           :x sx
                           :y sy
                           :lod lod
                           :dist dist
                           :name (:name meta)
                           :depth (ps/get-depth pointset idx)
                           :flags (aget (:flags pointset) idx)})))
             (into-array))))))

(defn ^:export project-edges
  "Get edge screen coordinates for rendering.

   Args:
     ps-id: pointset ID
     sample-geodesics: if true, sample points along geodesics

   Returns JS array of edge objects."
  [ps-id sample-geodesics]
  (let [lens-id (:active-lens @engine-state)]
    (when-let [l (get-in @engine-state [:lenses lens-id])]
      (when-let [pointset (get-pointset ps-id)]
        ;; Build edge list from parent relationships
        (let [n @(:count pointset)
              edges (loop [i 0
                           es []]
                      (if (>= i n)
                        es
                        (let [parent (ps/get-parent pointset i)]
                          (if (= parent -1)
                            (recur (inc i) es)
                            (recur (inc i) (conj es [parent i]))))))]
          (->> (lens/edge-screen-coords l pointset edges sample-geodesics)
               (map (fn [{:keys [edge from to geodesic]}]
                      (let [[i j] edge
                            [fx fy] from
                            [tx ty] to]
                        #js {:from i
                             :to j
                             :x1 fx :y1 fy
                             :x2 tx :y2 ty
                             :geodesic (when geodesic (clj->js geodesic))})))
               (into-array)))))))

;; ════════════════════════════════════════════════════════════════════════════
;; PICKING (SCREEN → MANIFOLD)
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export pick-at-screen
  "Find point at screen coordinates.

   Returns point index or -1 if none found."
  [ps-id sx sy threshold]
  (let [lens-id (:active-lens @engine-state)]
    (when-let [l (get-in @engine-state [:lenses lens-id])]
      (when-let [pointset (get-pointset ps-id)]
        (if-let [result (lens/pick-point l pointset sx sy threshold)]
          (:idx result)
          -1)))))

;; ════════════════════════════════════════════════════════════════════════════
;; FIELD QUERIES
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export sample-density-at
  "Sample density field at screen position."
  [ps-id sx sy]
  (let [lens-id (:active-lens @engine-state)
        density-field (get-in @engine-state [:fields :density])]
    (when (and density-field
               (get-in @engine-state [:lenses lens-id]))
      (when-let [pointset (get-pointset ps-id)]
        (let [l (get-in @engine-state [:lenses lens-id])
              point (lens/unproject-screen l sx sy)]
          (field/eval-density density-field point 0 pointset nil))))))

(defn ^:export get-density-grid
  "Get density field sampled on a grid.

   Returns Float32Array of density values, row-major."
  [ps-id resolution]
  (let [lens-id (:active-lens @engine-state)]
    (when-let [l (get-in @engine-state [:lenses lens-id])]
      (when-let [pointset (get-pointset ps-id)]
        (lens/sample-density-grid l pointset resolution)))))

;; ════════════════════════════════════════════════════════════════════════════
;; NAVIGATION
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export pan-lens
  "Pan the lens focus in screen-relative direction."
  [dx dy]
  (let [lens-id (:active-lens @engine-state)]
    (when-let [l (get-in @engine-state [:lenses lens-id])]
      (let [dim (:dim l)
            scale (get-in l [:viewport :scale])
            ;; Convert screen delta to tangent space
            chart-dx (/ dx scale)
            chart-dy (/ (- dy) scale)  ; Flip Y
            focus @(:focus l)
            tangent (M/make-vec dim)
            new-focus (M/make-vec dim)]

        ;; Build tangent vector
        (M/zero-vec! tangent 0 dim)
        (aset tangent 1 chart-dx)
        (aset tangent 2 chart-dy)

        ;; Exp map to move focus
        (maps/exp! new-focus 0 focus 0 tangent 0 dim)
        (lens/set-focus! l new-focus 0)))))

(defn ^:export navigate-to-point
  "Animate focus to a specific point."
  [ps-id idx duration-ms]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])
          stride (:stride pointset)
          coords (:coords pointset)
          target-off (* idx stride)
          animator (lens/animate-focus-to! l coords target-off)
          start-time (js/Date.now)]

      ;; Return animation function for external scheduling
      (fn []
        (let [elapsed (- (js/Date.now) start-time)
              t (min 1.0 (/ elapsed duration-ms))]
          (animator t)
          (>= t 1.0))))))

;; ════════════════════════════════════════════════════════════════════════════
;; DISTANCE QUERIES
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export get-distance
  "Get hyperbolic distance between two points."
  [ps-id idx1 idx2]
  (when-let [pointset (get-pointset ps-id)]
    (let [dim (:dim pointset)
          stride (:stride pointset)
          coords (:coords pointset)]
      (H/dist coords (* idx1 stride) coords (* idx2 stride) dim))))

(defn ^:export get-nearest
  "Find nearest point to a given point."
  [ps-id idx k]
  (when-let [pointset (get-pointset ps-id)]
    (let [dim (:dim pointset)
          stride (:stride pointset)
          coords (:coords pointset)
          n @(:count pointset)]
      (->> (H/find-k-nearest coords (* idx stride) coords n k dim)
           (map (fn [[i d]] #js {:idx i :dist d}))
           (into-array)))))

;; ════════════════════════════════════════════════════════════════════════════
;; SELECTION / FLAGS
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export set-selected
  "Set selection state of a point."
  [ps-id idx selected?]
  (when-let [pointset (get-pointset ps-id)]
    (if selected?
      (ps/set-flag! pointset idx ps/FLAG-SELECTED)
      (ps/clear-flag! pointset idx ps/FLAG-SELECTED))))

(defn ^:export get-selected
  "Get indices of all selected points."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (into-array (ps/selected-points pointset))))

(defn ^:export set-hidden
  "Set hidden state of a point."
  [ps-id idx hidden?]
  (when-let [pointset (get-pointset ps-id)]
    (if hidden?
      (ps/set-flag! pointset idx ps/FLAG-HIDDEN)
      (ps/clear-flag! pointset idx ps/FLAG-HIDDEN))))

;; ════════════════════════════════════════════════════════════════════════════
;; SERIALIZATION
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export export-pointset
  "Export pointset to JSON-compatible structure."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (clj->js (ps/to-edn pointset))))

(defn ^:export import-pointset
  "Import pointset from JSON structure.

   Returns new pointset ID."
  [data]
  (let [edn-data (js->clj data :keywordize-keys true)
        new-ps (ps/from-edn edn-data)
        id (str "ps-" (random-uuid))]
    (swap! engine-state assoc-in [:pointsets id] new-ps)
    id))

;; ════════════════════════════════════════════════════════════════════════════
;; OPERATORS
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export apply-operator
  "Apply a named operator to the state.

   Supported operators:
     'select-all', 'deselect-all', 'expand-selection',
     'contract-selection', 'show', 'hide',
     'fold-subtree:idx', 'unfold-subtree:idx',
     'attract-centroid:step'"
  [ps-id op-name & args]
  (when-let [pointset (get-pointset ps-id)]
    (let [state {:pointset pointset}
          operator (case op-name
                     "select-all" (op/select-all)
                     "deselect-all" (op/deselect-all)
                     "expand-selection" (op/expand-selection)
                     "expand-selection-full" (op/expand-selection-full)
                     "contract-selection" (op/contract-selection)
                     "show" (op/show)
                     "hide" (op/hide)
                     ;; Parameterized operators
                     (cond
                       (str/starts-with? op-name "fold-subtree:")
                       (let [idx (js/parseInt (subs op-name 13))]
                         (op/fold-subtree idx))

                       (str/starts-with? op-name "unfold-subtree:")
                       (let [idx (js/parseInt (subs op-name 15))]
                         (op/unfold-subtree idx))

                       (str/starts-with? op-name "attract-centroid:")
                       (let [step (js/parseFloat (subs op-name 17))]
                         (op/attract-to-centroid step))

                       (str/starts-with? op-name "prune-depth:")
                       (let [depth (js/parseInt (subs op-name 12))]
                         (op/prune-by-depth depth))

                       :else nil))]
      (when operator
        (op/apply-op operator state)
        true))))

;; ════════════════════════════════════════════════════════════════════════════
;; BATCH RENDERING API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export create-batch-renderer
  "Create a batch renderer for a pointset."
  [ps-id max-points]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])
          renderer (batch/make-batch-renderer pointset l max-points)
          id (str "renderer-" ps-id)]
      (swap! engine-state assoc-in [:renderers id] renderer)
      ((:invalidate! renderer))
      id)))

(defn ^:export update-batch!
  "Update batch renderer, return true if changed."
  [renderer-id]
  (when-let [renderer (get-in @engine-state [:renderers renderer-id])]
    ((:update! renderer))))

(defn ^:export get-batch-stats
  "Get rendering statistics."
  [renderer-id]
  (when-let [renderer (get-in @engine-state [:renderers renderer-id])]
    (clj->js ((:stats renderer)))))

;; ════════════════════════════════════════════════════════════════════════════
;; ANIMATION API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export animate-focus-to!
  "Animate lens focus to a point."
  [ps-id idx duration-ms]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])
          stride (:stride pointset)
          coords (:coords pointset)]
      (anim/animate-focus! l coords (* idx stride) duration-ms))))

(defn ^:export cancel-animations!
  "Cancel all running animations."
  []
  (anim/cancel-all!))

;; ════════════════════════════════════════════════════════════════════════════
;; KEYBOARD API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export install-keyboard-handler!
  "Install keyboard handler, return cleanup function."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])]
      ;; Cleanup previous handler
      (when-let [cleanup (:keyboard-cleanup @engine-state)]
        (cleanup))
      ;; Install new
      (let [cleanup (kbd/install-keyboard-handler! pointset l)]
        (swap! engine-state assoc :keyboard-cleanup cleanup)
        (kbd/update-focus-ring! pointset)
        true))))

(defn ^:export get-focused
  "Get currently focused point index."
  []
  (kbd/get-focused))

(defn ^:export set-focused-point!
  "Set focused point."
  [ps-id idx]
  (when-let [pointset (get-pointset ps-id)]
    (kbd/set-focused! pointset idx)))

;; ════════════════════════════════════════════════════════════════════════════
;; SPATIAL INDEX API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export query-nearest-fast
  "Query nearest neighbor using VP-tree index."
  [ps-id query-idx]
  (when-let [pointset (get-pointset ps-id)]
    (let [index-id (str "index-" ps-id)
          index (or (get-in @engine-state [:indices index-id])
                    (let [idx (vptree/make-index pointset)]
                      (swap! engine-state assoc-in [:indices index-id] idx)
                      idx))]
      (when-let [[idx dist] (vptree/query-nearest index query-idx)]
        #js {:idx idx :dist dist}))))

(defn ^:export query-k-nearest-fast
  "Query k nearest neighbors using VP-tree index."
  [ps-id query-idx k]
  (when-let [pointset (get-pointset ps-id)]
    (let [index-id (str "index-" ps-id)
          index (or (get-in @engine-state [:indices index-id])
                    (let [idx (vptree/make-index pointset)]
                      (swap! engine-state assoc-in [:indices index-id] idx)
                      idx))]
      (->> (vptree/query-k-nearest index query-idx k)
           (map (fn [[idx dist]] #js {:idx idx :dist dist}))
           (into-array)))))

;; ════════════════════════════════════════════════════════════════════════════
;; FRAME MANAGEMENT
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export begin-frame!
  "Call at start of each frame to reset frame arena."
  []
  (pool/begin-frame!))

;; ════════════════════════════════════════════════════════════════════════════
;; PERSISTENCE API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export save-workspace!
  "Save workspace to localStorage."
  [& [key]]
  (persist/save-workspace! @engine-state :key (or key "default")))

(defn ^:export load-workspace!
  "Load workspace from localStorage."
  [& [key]]
  (when-let [loaded (persist/load-workspace :key (or key "default"))]
    ;; Merge loaded pointsets into state
    (doseq [[k v] (:pointsets loaded)]
      (swap! engine-state assoc-in [:pointsets k] v))
    true))

(defn ^:export has-saved-workspace?
  "Check if saved workspace exists."
  [& [key]]
  (persist/has-saved-workspace? :key (or key "default")))

(defn ^:export enable-autosave!
  "Enable autosave."
  []
  (swap! persist/config assoc :autosave-enabled true))

(defn ^:export disable-autosave!
  "Disable autosave."
  []
  (persist/cancel-autosave!)
  (swap! persist/config assoc :autosave-enabled false))

(defn ^:export export-json
  "Export workspace as JSON string."
  []
  (persist/export-json @engine-state))

(defn ^:export download-json!
  "Download workspace as JSON file."
  [filename]
  (persist/download-json! @engine-state filename))

;; ════════════════════════════════════════════════════════════════════════════
;; HISTORY API (Undo/Redo)
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export undo!
  "Undo last operation."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (history/undo! pointset)))

(defn ^:export redo!
  "Redo last undone operation."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (history/redo! pointset)))

(defn ^:export can-undo?
  "Check if undo is available."
  []
  (history/can-undo?))

(defn ^:export can-redo?
  "Check if redo is available."
  []
  (history/can-redo?))

;; ════════════════════════════════════════════════════════════════════════════
;; INTERACTION API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export open-search!
  "Open the search palette."
  [ps-id on-select-callback]
  (when-let [pointset (get-pointset ps-id)]
    (interact/open-search! pointset on-select-callback)))

(defn ^:export close-search!
  "Close the search palette."
  []
  (interact/close-search!))

(defn ^:export search-nodes
  "Search nodes by name."
  [ps-id query max-results]
  (when-let [pointset (get-pointset ps-id)]
    (->> (interact/search-nodes pointset query max-results)
         (map clj->js)
         (into-array))))

(defn ^:export set-depth-filter!
  "Set depth filter."
  [ps-id depth]
  (when-let [pointset (get-pointset ps-id)]
    (interact/set-depth-filter! pointset depth)))

(defn ^:export clear-depth-filter!
  "Clear depth filter."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (interact/clear-depth-filter! pointset)))

(defn ^:export focus-on-node!
  "Focus view on a node with animation."
  [ps-id idx & [duration]]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])]
      (interact/focus-on-node! l pointset idx
                               :duration (or duration 400)))))

;; ════════════════════════════════════════════════════════════════════════════
;; DRAG API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export start-drag!
  "Start a drag operation."
  [ps-id idx screen-x screen-y mode]
  (when-let [pointset (get-pointset ps-id)]
    (drag/start-drag! pointset idx screen-x screen-y (keyword mode))))

(defn ^:export update-drag!
  "Update drag with mouse position. Returns true if drag is active."
  [screen-x screen-y]
  (drag/update-drag! screen-x screen-y))

(defn ^:export find-drop-target!
  "Find drop target at current position."
  [renderer-id screen-x screen-y]
  (when-let [renderer (get-in @engine-state [:renderers renderer-id])]
    (let [target (drag/find-drop-target (:batch renderer) screen-x screen-y)]
      (drag/set-drop-target! target)
      (or target -1))))

(defn ^:export end-drag!
  "Complete the drag operation."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (drag/end-drag! pointset)))

(defn ^:export cancel-drag!
  "Cancel current drag."
  []
  (drag/cancel-drag!))

(defn ^:export is-dragging?
  "Check if drag is active."
  []
  (drag/is-dragging?))

(defn ^:export get-drag-visuals
  "Get visual feedback for drag."
  []
  (clj->js (drag/get-drag-visuals)))

;; ════════════════════════════════════════════════════════════════════════════
;; NAVIGATION API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export handle-minimap-click!
  "Handle click on minimap, panning main view."
  [click-x click-y width height]
  (let [main-lens (get-in @engine-state [:lenses :main])
        minimap-lens (get-in @engine-state [:lenses :minimap])]
    (nav/handle-minimap-click! main-lens minimap-lens click-x click-y width height)))

(defn ^:export start-edge-pan!
  "Start edge panning if cursor at edge."
  [mouse-x mouse-y width height]
  (let [lens-id (:active-lens @engine-state)
        l (get-in @engine-state [:lenses lens-id])]
    (nav/start-edge-pan! l mouse-x mouse-y width height)))

(defn ^:export stop-edge-pan!
  "Stop edge panning."
  []
  (nav/stop-edge-pan!))

(defn ^:export is-edge-panning?
  "Check if edge panning is active."
  []
  (nav/is-edge-panning?))

(defn ^:export update-url-state!
  "Update URL hash with view state."
  [ps-id selected-idx]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])]
      (nav/update-url-state! l pointset selected-idx))))

(defn ^:export apply-url-state!
  "Apply URL state to current view."
  [ps-id]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])
          dim (:dim @engine-state)]
      (nav/apply-url-state! l pointset dim))))

(defn ^:export generate-share-link
  "Generate shareable link with current view state."
  [ps-id selected-idx]
  (when-let [pointset (get-pointset ps-id)]
    (let [lens-id (:active-lens @engine-state)
          l (get-in @engine-state [:lenses lens-id])]
      (nav/generate-share-link l pointset selected-idx))))

(defn ^:export save-home-position!
  "Save current view as home position."
  [space-name]
  (let [lens-id (:active-lens @engine-state)
        l (get-in @engine-state [:lenses lens-id])]
    (nav/save-home-position! space-name l)))

(defn ^:export go-home!
  "Navigate to saved home position."
  [space-name]
  (let [lens-id (:active-lens @engine-state)
        l (get-in @engine-state [:lenses lens-id])
        dim (:dim @engine-state)]
    (nav/go-home! l space-name dim)))

;; ════════════════════════════════════════════════════════════════════════════
;; EXPORT API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export download-png!
  "Download canvas as PNG file."
  [canvas filename scale]
  (export/download-png! canvas filename :scale (or scale 1)))

(defn ^:export copy-canvas-to-clipboard!
  "Copy canvas to clipboard as PNG."
  [canvas]
  (export/copy-to-clipboard! canvas))

(defn ^:export download-svg!
  "Download current view as SVG file."
  [renderer-id width height filename]
  (when-let [renderer (get-in @engine-state [:renderers renderer-id])]
    (export/download-svg! (:batch renderer) width height filename)))

(defn ^:export download-markdown!
  "Download subtree as markdown file."
  [ps-id root-idx filename include-content]
  (when-let [pointset (get-pointset ps-id)]
    (export/download-markdown! pointset root-idx filename
                               :include-content include-content)))

(defn ^:export get-mermaid-syntax
  "Get Mermaid diagram syntax for subtree."
  [ps-id root-idx direction]
  (when-let [pointset (get-pointset ps-id)]
    (export/subtree-to-mermaid pointset root-idx
                               :direction (or direction "TB"))))

(defn ^:export copy-mermaid-to-clipboard!
  "Copy Mermaid syntax to clipboard."
  [ps-id root-idx]
  (when-let [pointset (get-pointset ps-id)]
    (export/copy-mermaid-to-clipboard! pointset root-idx)))

;; ════════════════════════════════════════════════════════════════════════════
;; CLIPBOARD API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export copy-subtree!
  "Copy a subtree to clipboard."
  [ps-id root-idx]
  (when-let [pointset (get-pointset ps-id)]
    (clipboard/copy-subtree! pointset root-idx ps-id)))

(defn ^:export cut-subtree!
  "Cut a subtree (copy then mark for deletion on paste)."
  [ps-id root-idx]
  (when-let [pointset (get-pointset ps-id)]
    (clipboard/cut-subtree! pointset root-idx ps-id)))

(defn ^:export paste-subtree!
  "Paste clipboard as child of target node."
  [ps-id target-idx]
  (when-let [pointset (get-pointset ps-id)]
    (clipboard/paste-subtree! pointset target-idx ps-id)))

(defn ^:export duplicate-subtree!
  "Duplicate a subtree adjacent to the original."
  [ps-id root-idx]
  (when-let [pointset (get-pointset ps-id)]
    (clipboard/duplicate-subtree! pointset root-idx ps-id)))

(defn ^:export delete-subtree!
  "Delete a subtree."
  [ps-id root-idx]
  (when-let [pointset (get-pointset ps-id)]
    (clipboard/delete-subtree! pointset root-idx)))

(defn ^:export has-clipboard-content?
  "Check if clipboard has content."
  []
  (clipboard/has-clipboard-content?))

(defn ^:export get-clipboard-info
  "Get info about clipboard contents."
  []
  (clj->js (clipboard/get-clipboard-info)))

(defn ^:export clear-clipboard!
  "Clear clipboard contents."
  []
  (clipboard/clear-clipboard!))

;; ════════════════════════════════════════════════════════════════════════════
;; CONTEXT MENU API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export show-context-menu!
  "Show context menu at position."
  [x y ps-id target-idx on-action-callback]
  (when-let [pointset (get-pointset ps-id)]
    (ctx-menu/show-menu! x y pointset target-idx on-action-callback)
    (ctx-menu/render-menu-dom!)))

(defn ^:export hide-context-menu!
  "Hide context menu."
  []
  (ctx-menu/hide-menu!))

(defn ^:export init-context-menu!
  "Initialize context menu system."
  []
  (ctx-menu/init-context-menu!))

(defn ^:export is-context-menu-visible?
  "Check if context menu is visible."
  []
  (ctx-menu/is-menu-visible?))

;; ════════════════════════════════════════════════════════════════════════════
;; TOUCH API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export install-touch-handlers!
  "Install touch handlers on element."
  [element callbacks]
  (let [lens-id (:active-lens @engine-state)
        l (get-in @engine-state [:lenses lens-id])]
    (touch/install-touch-handlers! element (atom l) (js->clj callbacks :keywordize-keys true))))

(defn ^:export is-touching?
  "Check if touch is active."
  []
  (touch/is-touching?))

(defn ^:export current-gesture
  "Get current gesture type."
  []
  (name (or (touch/current-gesture) "none")))

;; ════════════════════════════════════════════════════════════════════════════
;; STYLE API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export set-node-style!
  "Set style for a specific node."
  [ps-id idx style-obj]
  (style/set-node-style! idx (js->clj style-obj :keywordize-keys true)))

(defn ^:export clear-node-style!
  "Clear style override for a node."
  [idx]
  (style/clear-node-style! idx))

(defn ^:export set-motif-style!
  "Set style for a motif."
  [motif-id style-obj]
  (style/set-motif-style! motif-id (js->clj style-obj :keywordize-keys true)))

(defn ^:export set-tag-style!
  "Set style for nodes with a tag."
  [tag style-obj]
  (style/set-tag-style! tag (js->clj style-obj :keywordize-keys true)))

(defn ^:export set-depth-palette!
  "Set depth color palette."
  [palette-key]
  (style/set-depth-palette! (keyword palette-key)))

(defn ^:export set-theme!
  "Set overall theme."
  [theme-key]
  (style/set-theme! (keyword theme-key)))

(defn ^:export get-theme
  "Get current theme."
  []
  (name (style/get-theme)))

(defn ^:export get-background-color
  "Get background color for current theme."
  []
  (style/get-background-color))

(defn ^:export resolve-node-style
  "Get resolved style for a node."
  [ps-id idx]
  (when-let [pointset (get-pointset ps-id)]
    (let [flags (aget (:flags pointset) idx)]
      (clj->js (style/resolve-node-style pointset idx flags)))))

;; ════════════════════════════════════════════════════════════════════════════
;; LABELS API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export compute-labels!
  "Compute visible labels for current view."
  [ps-id renderer-id viewport-obj focus-x focus-y]
  (when-let [pointset (get-pointset ps-id)]
    (when-let [renderer (get-in @engine-state [:renderers renderer-id])]
      (labels/compute-visible-labels!
       pointset
       (:batch renderer)
       (js->clj viewport-obj :keywordize-keys true)
       focus-x focus-y))))

(defn ^:export get-visible-labels
  "Get list of visible labels."
  []
  (clj->js (labels/get-visible-labels)))

(defn ^:export get-label-render-data
  "Get label data for rendering."
  [scale]
  (clj->js (labels/get-label-render-data scale)))

(defn ^:export invalidate-labels!
  "Mark labels as needing recomputation."
  []
  (labels/invalidate-labels!))

;; ════════════════════════════════════════════════════════════════════════════
;; LAYOUT API
;; ════════════════════════════════════════════════════════════════════════════

(defn ^:export radial-layout!
  "Apply radial tree layout."
  [ps-id root-idx edge-length]
  (when-let [pointset (get-pointset ps-id)]
    (layout/radial-layout! pointset root-idx
                           :edge-length (or edge-length 0.8))))

(defn ^:export force-directed-layout!
  "Run force-directed layout."
  [ps-id root-idx max-iterations]
  (when-let [pointset (get-pointset ps-id)]
    (layout/force-directed-layout! pointset root-idx
                                   :max-iterations (or max-iterations 50))))

(defn ^:export hierarchical-layout!
  "Apply hierarchical layout."
  [ps-id root-idx level-spacing]
  (when-let [pointset (get-pointset ps-id)]
    (layout/hierarchical-layout! pointset root-idx
                                 :level-spacing (or level-spacing 1.0))))

(defn ^:export spread-children!
  "Spread children evenly around parent."
  [ps-id parent-idx]
  (when-let [pointset (get-pointset ps-id)]
    (layout/spread-children! pointset parent-idx)))

(defn ^:export center-on-root!
  "Center tree so root is at origin."
  [ps-id root-idx]
  (when-let [pointset (get-pointset ps-id)]
    (layout/center-on-root! pointset root-idx)))

;; ════════════════════════════════════════════════════════════════════════════
;; UPDATED API EXPORT
;; ════════════════════════════════════════════════════════════════════════════

;; Update get-api to include new functions
(defn ^:export get-api
  "Return the full API object for JavaScript usage."
  []
  #js {:init init!
       :createPointset create-pointset
       :addPoint add-point
       :movePoint move-point
       :getPointCount get-point-count
       :getPointMeta get-point-meta
       :setActiveLens set-active-lens
       :setLensFocus set-lens-focus
       :setLensViewport set-lens-viewport
       :zoomLens zoom-lens
       :projectForRender project-for-render
       :projectEdges project-edges
       :pickAtScreen pick-at-screen
       :sampleDensityAt sample-density-at
       :getDensityGrid get-density-grid
       :panLens pan-lens
       :navigateToPoint navigate-to-point
       :getDistance get-distance
       :getNearest get-nearest
       :setSelected set-selected
       :getSelected get-selected
       :setHidden set-hidden
       :exportPointset export-pointset
       :importPointset import-pointset
       :applyOperator apply-operator
       ;; Batch rendering
       :createBatchRenderer create-batch-renderer
       :updateBatch update-batch!
       :getBatchStats get-batch-stats
       ;; Animation
       :animateFocusTo animate-focus-to!
       :cancelAnimations cancel-animations!
       ;; Keyboard
       :installKeyboardHandler install-keyboard-handler!
       :getFocused get-focused
       :setFocused set-focused-point!
       ;; Spatial index
       :queryNearest query-nearest-fast
       :queryKNearest query-k-nearest-fast
       ;; Frame management
       :beginFrame begin-frame!
       ;; Persistence
       :saveWorkspace save-workspace!
       :loadWorkspace load-workspace!
       :hasSavedWorkspace has-saved-workspace?
       :enableAutosave enable-autosave!
       :disableAutosave disable-autosave!
       :exportJson export-json
       :downloadJson download-json!
       ;; History
       :undo undo!
       :redo redo!
       :canUndo can-undo?
       :canRedo can-redo?
       ;; Interaction
       :openSearch open-search!
       :closeSearch close-search!
       :searchNodes search-nodes
       :setDepthFilter set-depth-filter!
       :clearDepthFilter clear-depth-filter!
       :focusOnNode focus-on-node!
       ;; Drag operations
       :startDrag start-drag!
       :updateDrag update-drag!
       :findDropTarget find-drop-target!
       :endDrag end-drag!
       :cancelDrag cancel-drag!
       :isDragging is-dragging?
       :getDragVisuals get-drag-visuals
       ;; Navigation
       :handleMinimapClick handle-minimap-click!
       :startEdgePan start-edge-pan!
       :stopEdgePan stop-edge-pan!
       :isEdgePanning is-edge-panning?
       :updateUrlState update-url-state!
       :applyUrlState apply-url-state!
       :generateShareLink generate-share-link
       :saveHomePosition save-home-position!
       :goHome go-home!
       ;; Export
       :downloadPng download-png!
       :copyCanvasToClipboard copy-canvas-to-clipboard!
       :downloadSvg download-svg!
       :downloadMarkdown download-markdown!
       :getMermaidSyntax get-mermaid-syntax
       :copyMermaidToClipboard copy-mermaid-to-clipboard!
       ;; Clipboard
       :copySubtree copy-subtree!
       :cutSubtree cut-subtree!
       :pasteSubtree paste-subtree!
       :duplicateSubtree duplicate-subtree!
       :deleteSubtree delete-subtree!
       :hasClipboardContent has-clipboard-content?
       :getClipboardInfo get-clipboard-info
       :clearClipboard clear-clipboard!
       ;; Context menu
       :showContextMenu show-context-menu!
       :hideContextMenu hide-context-menu!
       :initContextMenu init-context-menu!
       :isContextMenuVisible is-context-menu-visible?
       ;; Touch
       :installTouchHandlers install-touch-handlers!
       :isTouching is-touching?
       :currentGesture current-gesture
       ;; Style
       :setNodeStyle set-node-style!
       :clearNodeStyle clear-node-style!
       :setMotifStyle set-motif-style!
       :setTagStyle set-tag-style!
       :setDepthPalette set-depth-palette!
       :setTheme set-theme!
       :getTheme get-theme
       :getBackgroundColor get-background-color
       :resolveNodeStyle resolve-node-style
       ;; Labels
       :computeLabels compute-labels!
       :getVisibleLabels get-visible-labels
       :getLabelRenderData get-label-render-data
       :invalidateLabels invalidate-labels!
       ;; Layout
       :radialLayout radial-layout!
       :forceDirectedLayout force-directed-layout!
       :hierarchicalLayout hierarchical-layout!
       :spreadChildren spread-children!
       :centerOnRoot center-on-root!})

;; Auto-expose on load
(when (exists? js/window)
  (set! (.-HnEngine js/window) (get-api)))
