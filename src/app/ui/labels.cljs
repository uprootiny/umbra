(ns app.ui.labels
  "Smart label positioning for node labels.

   Provides:
   1. COLLISION AVOIDANCE
      Labels don't overlap each other.

   2. ANCHOR POSITIONING
      Labels positioned relative to nodes.

   3. PRIORITY CULLING
      Only show labels for important nodes.

   4. LEVEL OF DETAIL
      Fade/hide labels based on zoom.

   Performance:
   - Grid-based collision detection
   - Priority queue for visible labels
   - Cached positions across frames"
  (:require [app.math.hn.pointset :as ps]))

;; ════════════════════════════════════════════════════════════════════════════
;; LABEL CONFIGURATION
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const MAX-VISIBLE-LABELS 50)
(def ^:const LABEL-PADDING 4)
(def ^:const MIN-ZOOM-FOR-LABELS 0.5)
(def ^:const FADE-DISTANCE 10)  ; Distance at which labels start fading

(def default-label-style
  {:font-size 12
   :font-family "system-ui, sans-serif"
   :color "#e0e0e0"
   :background "rgba(20, 20, 30, 0.8)"
   :padding 4
   :border-radius 3})

;; ════════════════════════════════════════════════════════════════════════════
;; LABEL STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce label-state
  (atom {:positions {}     ; idx -> {:x :y :width :height :anchor}
         :visible #{}      ; Set of visible label indices
         :grid {}          ; Spatial grid for collision detection
         :dirty true}))

;; ════════════════════════════════════════════════════════════════════════════
;; ANCHOR POSITIONS
;; ════════════════════════════════════════════════════════════════════════════

(def anchor-offsets
  "Offset multipliers for different anchor positions."
  {:top-center    [0.0 -1.2]
   :bottom-center [0.0  1.2]
   :left-center   [-1.2 0.0]
   :right-center  [1.2  0.0]
   :top-left      [-0.8 -0.8]
   :top-right     [0.8  -0.8]
   :bottom-left   [-0.8  0.8]
   :bottom-right  [0.8   0.8]})

(def anchor-priority
  "Priority order for anchor selection."
  [:right-center :bottom-center :left-center :top-center
   :bottom-right :bottom-left :top-right :top-left])

(defn compute-label-rect
  "Compute label rectangle for a given anchor.

   Args:
     node-x, node-y: node center
     node-radius: node radius
     label-width, label-height: label dimensions
     anchor: anchor keyword

   Returns {:x :y :width :height}"
  [node-x node-y node-radius label-width label-height anchor]
  (let [[ox oy] (get anchor-offsets anchor [1.0 0.0])
        ;; Position relative to node edge
        cx (+ node-x (* ox (+ node-radius LABEL-PADDING)))
        cy (+ node-y (* oy (+ node-radius LABEL-PADDING)))
        ;; Adjust for anchor alignment
        x (case anchor
            (:left-center :top-left :bottom-left)
            (- cx label-width)
            (:right-center :top-right :bottom-right)
            cx
            ;; center
            (- cx (/ label-width 2)))
        y (case anchor
            (:top-center :top-left :top-right)
            (- cy label-height)
            (:bottom-center :bottom-left :bottom-right)
            cy
            ;; center
            (- cy (/ label-height 2)))]
    {:x x :y y :width label-width :height label-height :anchor anchor}))

;; ════════════════════════════════════════════════════════════════════════════
;; COLLISION DETECTION
;; ════════════════════════════════════════════════════════════════════════════

(defn rects-overlap?
  "Check if two rectangles overlap."
  [r1 r2]
  (let [margin 2]
    (not (or (> (:x r1) (+ (:x r2) (:width r2) margin))
             (> (:x r2) (+ (:x r1) (:width r1) margin))
             (> (:y r1) (+ (:y r2) (:height r2) margin))
             (> (:y r2) (+ (:y r1) (:height r1) margin))))))

(defn grid-key
  "Get grid cell key for a position."
  [x y cell-size]
  [(js/Math.floor (/ x cell-size))
   (js/Math.floor (/ y cell-size))])

(defn rect-grid-cells
  "Get all grid cells a rectangle occupies."
  [{:keys [x y width height]} cell-size]
  (let [x1 (js/Math.floor (/ x cell-size))
        y1 (js/Math.floor (/ y cell-size))
        x2 (js/Math.floor (/ (+ x width) cell-size))
        y2 (js/Math.floor (/ (+ y height) cell-size))]
    (for [gx (range x1 (inc x2))
          gy (range y1 (inc y2))]
      [gx gy])))

(defn check-collision
  "Check if a rect collides with any existing labels in grid."
  [rect grid cell-size]
  (let [cells (rect-grid-cells rect cell-size)]
    (some (fn [cell]
            (some #(rects-overlap? rect %)
                  (get grid cell [])))
          cells)))

(defn add-to-grid
  "Add a rect to the spatial grid."
  [grid rect cell-size]
  (reduce (fn [g cell]
            (update g cell (fnil conj []) rect))
          grid
          (rect-grid-cells rect cell-size)))

;; ════════════════════════════════════════════════════════════════════════════
;; LABEL PLACEMENT
;; ════════════════════════════════════════════════════════════════════════════

(defn find-best-anchor
  "Find best non-colliding anchor position.

   Returns rect or nil if no position works."
  [node-x node-y node-radius label-width label-height grid cell-size]
  (loop [anchors anchor-priority]
    (when (seq anchors)
      (let [anchor (first anchors)
            rect (compute-label-rect node-x node-y node-radius
                                     label-width label-height anchor)]
        (if (check-collision rect grid cell-size)
          (recur (rest anchors))
          rect)))))

(defn estimate-label-size
  "Estimate label dimensions from text.

   Uses approximate character width."
  [text style]
  (let [font-size (:font-size style 12)
        char-width (* font-size 0.6)
        padding (* 2 (:padding style 4))]
    {:width (+ (* (count text) char-width) padding)
     :height (+ font-size padding)}))

;; ════════════════════════════════════════════════════════════════════════════
;; PRIORITY CALCULATION
;; ════════════════════════════════════════════════════════════════════════════

(defn label-priority
  "Calculate label priority for a node.

   Higher priority = more likely to be shown.

   Factors:
   - Depth (roots more important)
   - Selection state
   - Screen size (larger = more important)
   - Distance from focus"
  [ps idx screen-radius dist-from-focus flags]
  (let [depth (ps/get-depth ps idx)
        is-selected? (not (zero? (bit-and flags ps/FLAG-SELECTED)))
        is-focused? (not (zero? (bit-and flags ps/FLAG-FOCUS)))
        is-pinned? (not (zero? (bit-and flags ps/FLAG-PINNED)))]
    (+ (* 100 (if is-focused? 1 0))
       (* 50 (if is-selected? 1 0))
       (* 30 (if is-pinned? 1 0))
       (* 10 (max 0 (- 5 depth)))  ; Boost for shallow nodes
       (* 5 (min 10 screen-radius))  ; Boost for larger nodes
       (* -1 dist-from-focus))))  ; Penalty for distance

;; ════════════════════════════════════════════════════════════════════════════
;; MAIN COMPUTATION
;; ════════════════════════════════════════════════════════════════════════════

(defn compute-visible-labels!
  "Compute which labels to show and their positions.

   Args:
     ps: pointset
     batch: render batch with screen positions
     viewport: {:width :height :scale}
     focus-x, focus-y: screen focus position

   Updates label-state atom."
  [ps batch viewport focus-x focus-y]
  (let [{:keys [width height scale]} viewport
        n @(:render-count batch)
        order (:render-order batch)
        sx (:screen-x batch)
        sy (:screen-y batch)
        rad (:radius batch)
        flags (:flags ps)
        cell-size 50

        ;; Build priority list
        prioritized
        (->> (range n)
             (map (fn [i]
                    (let [idx (aget order i)
                          x (aget sx idx)
                          y (aget sy idx)
                          r (aget rad idx)
                          f (aget flags idx)
                          dx (- x focus-x)
                          dy (- y focus-y)
                          dist (js/Math.sqrt (+ (* dx dx) (* dy dy)))
                          meta (ps/get-meta ps idx)
                          name (or (:name meta) "")]
                      {:idx idx
                       :x x :y y :radius r
                       :name name
                       :priority (label-priority ps idx r dist f)
                       :flags f})))
             ;; Filter out unnamed, hidden, or off-screen
             (filter (fn [{:keys [name x y radius]}]
                       (and (seq name)
                            (> x (- radius))
                            (< x (+ width radius))
                            (> y (- radius))
                            (< y (+ height radius)))))
             ;; Sort by priority
             (sort-by :priority >)
             ;; Take top candidates
             (take (* 2 MAX-VISIBLE-LABELS)))]

    ;; Place labels avoiding collisions
    (loop [remaining prioritized
           placed []
           grid {}
           count 0]
      (if (or (empty? remaining)
              (>= count MAX-VISIBLE-LABELS))
        ;; Done - update state
        (reset! label-state
                {:positions (into {} (map (fn [p] [(:idx p) p]) placed))
                 :visible (set (map :idx placed))
                 :grid grid
                 :dirty false})

        ;; Try to place next label
        (let [{:keys [idx x y radius name]} (first remaining)
              {:keys [width height]} (estimate-label-size name default-label-style)
              rect (find-best-anchor x y radius width height grid cell-size)]
          (if rect
            ;; Placed successfully
            (recur (rest remaining)
                   (conj placed (assoc rect :idx idx :name name
                                       :node-x x :node-y y))
                   (add-to-grid grid rect cell-size)
                   (inc count))
            ;; Collision - skip this label
            (recur (rest remaining) placed grid count)))))))

;; ════════════════════════════════════════════════════════════════════════════
;; QUERIES
;; ════════════════════════════════════════════════════════════════════════════

(defn get-visible-labels
  "Get list of visible labels with positions.

   Returns [{:idx :name :x :y :width :height :anchor :node-x :node-y}]"
  []
  (vals (:positions @label-state)))

(defn is-label-visible?
  "Check if label for node is currently visible."
  [idx]
  (contains? (:visible @label-state) idx))

(defn get-label-position
  "Get position for a specific label."
  [idx]
  (get-in @label-state [:positions idx]))

(defn invalidate-labels!
  "Mark labels as needing recomputation."
  []
  (swap! label-state assoc :dirty true))

(defn labels-dirty?
  "Check if labels need recomputation."
  []
  (:dirty @label-state))

;; ════════════════════════════════════════════════════════════════════════════
;; RENDER DATA
;; ════════════════════════════════════════════════════════════════════════════

(defn get-label-render-data
  "Get label data formatted for rendering.

   Returns array of label objects for external renderer."
  [scale]
  (let [labels (get-visible-labels)
        opacity-scale (min 1.0 (/ scale MIN-ZOOM-FOR-LABELS))]
    (->> labels
         (map (fn [{:keys [idx name x y width height node-x node-y]}]
                {:idx idx
                 :text name
                 :x x
                 :y y
                 :width width
                 :height height
                 :opacity opacity-scale
                 :style default-label-style
                 :line {:x1 node-x :y1 node-y :x2 (+ x (/ width 2)) :y2 (+ y (/ height 2))}}))
         vec)))

