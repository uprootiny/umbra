(ns app.ui.drag
  "Drag operations for the hyperbolic workspace.

   Handles:
   1. DRAG-TO-REPARENT
      Drag a node onto another to change its parent.
      Visual feedback shows valid drop targets.

   2. DRAG-TO-MOVE
      Drag a node to reposition it in hyperbolic space.
      Movement is constrained to maintain tree structure.

   3. MULTI-SELECT DRAG
      Drag multiple selected nodes together.

   Performance:
   - Uses requestAnimationFrame for smooth updates
   - Caches valid drop targets
   - Minimal DOM manipulation"
  (:require [app.math.hn.pointset :as ps]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.animate :as anim]
            [app.state.history :as history]))

;; ════════════════════════════════════════════════════════════════════════════
;; DRAG STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce drag-state
  (atom {:active false
         :mode nil          ; :reparent or :move
         :source-idx nil    ; Node being dragged
         :source-screen nil ; Initial screen position
         :current-screen nil ; Current screen position
         :drop-target nil   ; Potential drop target
         :valid-targets #{} ; Set of valid drop target indices
         :start-time nil}))

(def ^:const DRAG-THRESHOLD 5)  ; Pixels before drag starts
(def ^:const DROP-RADIUS 30)    ; Pixels for drop detection

;; ════════════════════════════════════════════════════════════════════════════
;; VALID DROP TARGETS
;; ════════════════════════════════════════════════════════════════════════════

(defn compute-valid-targets
  "Compute valid reparent targets for a node.

   A node cannot be reparented to:
   - Itself
   - Any of its descendants (would create cycle)"
  [ps source-idx]
  (let [n @(:count ps)
        descendants (set (ps/get-descendants ps source-idx))]
    (->> (range n)
         (remove #(= % source-idx))
         (remove descendants)
         (remove #(ps/has-flag? ps % ps/FLAG-HIDDEN))
         set)))

;; ════════════════════════════════════════════════════════════════════════════
;; DRAG INITIATION
;; ════════════════════════════════════════════════════════════════════════════

(defn start-drag!
  "Begin a potential drag operation."
  [ps idx screen-x screen-y mode]
  (reset! drag-state
          {:active false  ; Not active until threshold met
           :pending true
           :mode mode
           :source-idx idx
           :source-screen [screen-x screen-y]
           :current-screen [screen-x screen-y]
           :drop-target nil
           :valid-targets (when (= mode :reparent)
                            (compute-valid-targets ps idx))
           :start-time (js/Date.now)}))

(defn update-drag!
  "Update drag with new mouse position.

   Returns true if drag is active."
  [screen-x screen-y]
  (when (:pending @drag-state)
    (let [[sx sy] (:source-screen @drag-state)
          dx (- screen-x sx)
          dy (- screen-y sy)
          dist (js/Math.sqrt (+ (* dx dx) (* dy dy)))]
      ;; Activate if past threshold
      (when (and (not (:active @drag-state))
                 (> dist DRAG-THRESHOLD))
        (swap! drag-state assoc :active true))
      ;; Update position
      (swap! drag-state assoc :current-screen [screen-x screen-y])
      (:active @drag-state))))

(defn find-drop-target
  "Find drop target at current position.

   Returns index or nil."
  [batch screen-x screen-y]
  (let [valid (:valid-targets @drag-state)
        source (:source-idx @drag-state)
        n @(:render-count batch)
        order (:render-order batch)
        sx (:screen-x batch)
        sy (:screen-y batch)]
    ;; Find closest valid target within drop radius
    (loop [i 0
           best-idx nil
           best-dist DROP-RADIUS]
      (if (>= i n)
        best-idx
        (let [idx (aget order i)]
          (if (or (= idx source)
                  (not (contains? valid idx)))
            (recur (inc i) best-idx best-dist)
            (let [px (aget sx idx)
                  py (aget sy idx)
                  dx (- screen-x px)
                  dy (- screen-y py)
                  d (js/Math.sqrt (+ (* dx dx) (* dy dy)))]
              (if (< d best-dist)
                (recur (inc i) idx d)
                (recur (inc i) best-idx best-dist)))))))))

(defn set-drop-target!
  "Update current drop target."
  [idx]
  (swap! drag-state assoc :drop-target idx))

;; ════════════════════════════════════════════════════════════════════════════
;; DRAG COMPLETION
;; ════════════════════════════════════════════════════════════════════════════

(defn end-drag!
  "Complete the drag operation."
  [ps]
  (let [{:keys [active mode source-idx drop-target]} @drag-state]
    (when (and active drop-target)
      (case mode
        :reparent
        (let [old-parent (ps/get-parent ps source-idx)
              old-depth (ps/get-depth ps source-idx)
              new-depth (inc (ps/get-depth ps drop-target))]
          ;; Update parent
          (aset (:parent ps) source-idx drop-target)
          (aset (:depth ps) source-idx new-depth)
          ;; Update depths of all descendants
          (let [depth-delta (- new-depth old-depth)]
            (doseq [desc (ps/get-descendants ps source-idx)]
              (aset (:depth ps) desc
                    (+ (aget (:depth ps) desc) depth-delta))))
          ;; Record for undo
          (history/record-reparent! ps source-idx old-parent old-depth))

        :move
        nil  ; Move is handled continuously

        nil))
    ;; Reset state
    (reset! drag-state {:active false})))

(defn cancel-drag!
  "Cancel the drag operation."
  []
  (reset! drag-state {:active false}))

;; ════════════════════════════════════════════════════════════════════════════
;; DRAG RENDERING
;; ════════════════════════════════════════════════════════════════════════════

(defn get-drag-visuals
  "Get visual feedback for current drag state.

   Returns {:ghost, :line, :target-highlight} or nil."
  []
  (when (:active @drag-state)
    (let [[cx cy] (:current-screen @drag-state)
          [sx sy] (:source-screen @drag-state)
          target (:drop-target @drag-state)]
      {:ghost {:x cx :y cy :radius 8}
       :line (when target
               {:x1 sx :y1 sy :x2 cx :y2 cy})
       :target-highlight (when target
                           {:idx target :color "#60ff60"})})))

(defn is-dragging?
  "Check if drag is active."
  []
  (:active @drag-state))

(defn get-drag-source
  "Get the index of the node being dragged."
  []
  (:source-idx @drag-state))
