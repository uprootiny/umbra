(ns app.math.hn.keyboard
  "Keyboard navigation for the hyperbolic workspace.

   Provides vim-like and standard keyboard controls:
   - Arrow keys / hjkl for navigation
   - Tab / Shift+Tab for focus cycling
   - Enter to expand/collapse
   - Space to select
   - / for search
   - Escape to cancel/deselect

   Focus management tracks the 'focused' node which receives
   keyboard commands and is visually highlighted."
  (:require [app.math.hn.pointset :as ps]
            [app.math.hn.animate :as anim]))

;; ════════════════════════════════════════════════════════════════════════════
;; FOCUS STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce focus-state
  (atom {:focused-idx nil      ; Currently focused point
         :focus-ring []        ; Ring of focusable points (tab order)
         :focus-visible true   ; Show focus indicator
         :history []           ; Navigation history for back/forward
         :history-idx 0}))

(def ^:const FLAG-FOCUS 0x08)  ; From pointset.cljs

(defn get-focused
  "Get currently focused point index, or nil."
  []
  (:focused-idx @focus-state))

(defn set-focused!
  "Set focused point, updating pointset flags."
  [ps idx]
  (let [old-idx (:focused-idx @focus-state)]
    ;; Clear old focus flag
    (when (and old-idx ps (>= old-idx 0))
      (ps/clear-flag! ps old-idx FLAG-FOCUS))
    ;; Set new focus flag
    (when (and idx ps (>= idx 0))
      (ps/set-flag! ps idx FLAG-FOCUS))
    ;; Update state
    (swap! focus-state assoc :focused-idx idx)
    ;; Add to history
    (when (and idx (not= idx old-idx))
      (swap! focus-state update :history conj idx)
      (swap! focus-state assoc :history-idx (count (:history @focus-state))))
    idx))

(defn clear-focus!
  "Clear focus."
  [ps]
  (set-focused! ps nil))

;; ════════════════════════════════════════════════════════════════════════════
;; FOCUS RING (Tab Order)
;; ════════════════════════════════════════════════════════════════════════════

(defn update-focus-ring!
  "Update the focus ring based on current visible points.

   Points are ordered by tree structure: depth-first traversal."
  [ps]
  (let [n @(:count ps)
        parent-arr (:parent ps)
        ;; Build tree structure
        children (reduce
                  (fn [m i]
                    (let [p (aget parent-arr i)]
                      (if (= p -1)
                        m
                        (update m p (fnil conj []) i))))
                  {}
                  (range n))
        ;; DFS to build order
        ring (loop [stack (filterv #(= (aget parent-arr %) -1) (range n))
                    result []]
               (if (empty? stack)
                 result
                 (let [idx (peek stack)
                       stack' (pop stack)
                       kids (get children idx [])]
                   (recur (into stack' (reverse kids))
                          (conj result idx)))))]
    (swap! focus-state assoc :focus-ring ring)
    ring))

(defn focus-next!
  "Move focus to next item in ring."
  [ps]
  (let [ring (:focus-ring @focus-state)
        current (:focused-idx @focus-state)]
    (when (seq ring)
      (let [idx (if (nil? current)
                  0
                  (mod (inc (.indexOf ring current)) (count ring)))]
        (set-focused! ps (nth ring idx))))))

(defn focus-prev!
  "Move focus to previous item in ring."
  [ps]
  (let [ring (:focus-ring @focus-state)
        current (:focused-idx @focus-state)]
    (when (seq ring)
      (let [idx (if (nil? current)
                  (dec (count ring))
                  (mod (dec (.indexOf ring current)) (count ring)))]
        (set-focused! ps (nth ring idx))))))

;; ════════════════════════════════════════════════════════════════════════════
;; STRUCTURAL NAVIGATION
;; ════════════════════════════════════════════════════════════════════════════

(defn focus-parent!
  "Move focus to parent of current node."
  [ps]
  (when-let [current (:focused-idx @focus-state)]
    (let [parent (ps/get-parent ps current)]
      (when (>= parent 0)
        (set-focused! ps parent)))))

(defn focus-first-child!
  "Move focus to first child of current node."
  [ps]
  (when-let [current (:focused-idx @focus-state)]
    (let [children (ps/get-children ps current)]
      (when (seq children)
        (set-focused! ps (first children))))))

(defn focus-next-sibling!
  "Move focus to next sibling."
  [ps]
  (when-let [current (:focused-idx @focus-state)]
    (let [parent (ps/get-parent ps current)]
      (when (>= parent 0)
        (let [siblings (ps/get-children ps parent)
              idx (.indexOf siblings current)]
          (when (< (inc idx) (count siblings))
            (set-focused! ps (nth siblings (inc idx)))))))))

(defn focus-prev-sibling!
  "Move focus to previous sibling."
  [ps]
  (when-let [current (:focused-idx @focus-state)]
    (let [parent (ps/get-parent ps current)]
      (when (>= parent 0)
        (let [siblings (ps/get-children ps parent)
              idx (.indexOf siblings current)]
          (when (pos? idx)
            (set-focused! ps (nth siblings (dec idx)))))))))

;; ════════════════════════════════════════════════════════════════════════════
;; HISTORY NAVIGATION
;; ════════════════════════════════════════════════════════════════════════════

(defn focus-back!
  "Go back in focus history."
  [ps]
  (let [{:keys [history history-idx]} @focus-state]
    (when (> history-idx 1)
      (swap! focus-state update :history-idx dec)
      (let [new-idx (dec (:history-idx @focus-state))]
        (when-let [target (get history new-idx)]
          (set-focused! ps target))))))

(defn focus-forward!
  "Go forward in focus history."
  [ps]
  (let [{:keys [history history-idx]} @focus-state]
    (when (< history-idx (dec (count history)))
      (swap! focus-state update :history-idx inc)
      (when-let [target (get history (:history-idx @focus-state))]
        (set-focused! ps target)))))

;; ════════════════════════════════════════════════════════════════════════════
;; SELECTION OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn toggle-select-focused!
  "Toggle selection of focused node."
  [ps]
  (when-let [idx (:focused-idx @focus-state)]
    (ps/toggle-flag! ps idx ps/FLAG-SELECTED)))

(defn select-focused!
  "Select focused node."
  [ps]
  (when-let [idx (:focused-idx @focus-state)]
    (ps/set-flag! ps idx ps/FLAG-SELECTED)))

(defn deselect-all!
  "Deselect all nodes."
  [ps]
  (let [n @(:count ps)
        flags (:flags ps)]
    (loop [i 0]
      (when (< i n)
        (aset flags i (bit-and (aget flags i) (bit-not ps/FLAG-SELECTED)))
        (recur (inc i))))))

(defn select-focused-subtree!
  "Select focused node and all descendants."
  [ps]
  (when-let [idx (:focused-idx @focus-state)]
    (ps/set-flag! ps idx ps/FLAG-SELECTED)
    (doseq [desc (ps/get-descendants ps idx)]
      (ps/set-flag! ps desc ps/FLAG-SELECTED))))

;; ════════════════════════════════════════════════════════════════════════════
;; FOLD/UNFOLD
;; ════════════════════════════════════════════════════════════════════════════

(defn toggle-fold-focused!
  "Toggle fold state of focused node's subtree."
  [ps]
  (when-let [idx (:focused-idx @focus-state)]
    (let [children (ps/get-children ps idx)]
      (if (seq children)
        ;; Has children - check if folded
        (let [first-child (first children)
              is-folded? (ps/has-flag? ps first-child ps/FLAG-HIDDEN)]
          (if is-folded?
            ;; Unfold
            (doseq [desc (ps/get-descendants ps idx)]
              (when (ps/has-flag? ps desc ps/FLAG-FOLDED)
                (ps/clear-flag! ps desc ps/FLAG-HIDDEN)
                (ps/clear-flag! ps desc ps/FLAG-FOLDED)))
            ;; Fold
            (doseq [desc (ps/get-descendants ps idx)]
              (ps/set-flag! ps desc ps/FLAG-HIDDEN)
              (ps/set-flag! ps desc ps/FLAG-FOLDED))))))))

;; ════════════════════════════════════════════════════════════════════════════
;; KEY HANDLER
;; ════════════════════════════════════════════════════════════════════════════

(defn handle-key!
  "Process a keyboard event.

   Returns true if event was handled.

   Args:
     ps: pointset
     l: lens (for view animations)
     event: keyboard event or {:key, :shift?, :ctrl?, :meta?} map"
  [ps l event]
  (let [key (or (.-key event) (:key event))
        shift? (or (.-shiftKey event) (:shift? event))
        ctrl? (or (.-ctrlKey event) (:ctrl? event))
        meta? (or (.-metaKey event) (:meta? event))]

    (cond
      ;; Tab navigation
      (= key "Tab")
      (do
        (if shift?
          (focus-prev! ps)
          (focus-next! ps))
        true)

      ;; Arrow / hjkl navigation
      (or (= key "ArrowUp") (= key "k"))
      (do
        (if ctrl?
          (focus-parent! ps)
          (focus-prev-sibling! ps))
        true)

      (or (= key "ArrowDown") (= key "j"))
      (do
        (if ctrl?
          (focus-first-child! ps)
          (focus-next-sibling! ps))
        true)

      (or (= key "ArrowLeft") (= key "h"))
      (do
        (if (or ctrl? meta?)
          (focus-back! ps)
          (focus-parent! ps))
        true)

      (or (= key "ArrowRight") (= key "l"))
      (do
        (if (or ctrl? meta?)
          (focus-forward! ps)
          (focus-first-child! ps))
        true)

      ;; Selection
      (= key " ")
      (do
        (if shift?
          (select-focused-subtree! ps)
          (toggle-select-focused! ps))
        true)

      ;; Fold/unfold
      (= key "Enter")
      (do
        (toggle-fold-focused! ps)
        true)

      ;; Center view on focused
      (= key "c")
      (when-let [idx (:focused-idx @focus-state)]
        (let [stride (:stride ps)
              coords (:coords ps)
              off (* idx stride)]
          (anim/animate-focus! l coords off 300))
        true)

      ;; Escape - clear selection and search
      (= key "Escape")
      (do
        (deselect-all! ps)
        true)

      ;; Home - focus root
      (= key "Home")
      (let [roots (filterv #(= (ps/get-parent ps %) -1)
                           (range @(:count ps)))]
        (when (seq roots)
          (set-focused! ps (first roots)))
        true)

      ;; End - focus last visible
      (= key "End")
      (let [ring (:focus-ring @focus-state)]
        (when (seq ring)
          (set-focused! ps (last ring)))
        true)

      ;; Not handled
      :else false)))

;; ════════════════════════════════════════════════════════════════════════════
;; FOCUS RING VISUAL
;; ════════════════════════════════════════════════════════════════════════════

(defn get-focus-ring-style
  "Get CSS-like style for focus ring.

   Returns {:x, :y, :radius, :opacity, :color}"
  [ps batch]
  (when-let [idx (:focused-idx @focus-state)]
    (when (:focus-visible @focus-state)
      (let [sx (aget (:screen-x batch) idx)
            sy (aget (:screen-y batch) idx)
            rad (aget (:radius batch) idx)]
        {:x sx
         :y sy
         :radius (+ rad 4)
         :stroke-width 2
         :color "#60a0ff"
         :opacity 0.8}))))

(defn set-focus-visible!
  "Set whether focus ring is visible.

   Hidden during mouse interaction, shown on keyboard use."
  [visible?]
  (swap! focus-state assoc :focus-visible visible?))

;; ════════════════════════════════════════════════════════════════════════════
;; KEYBOARD SETUP
;; ════════════════════════════════════════════════════════════════════════════

(defn install-keyboard-handler!
  "Install keyboard event listener.

   Returns cleanup function."
  [ps l]
  (let [handler (fn [e]
                  (when (handle-key! ps l e)
                    (.preventDefault e)
                    (set-focus-visible! true)))]
    (js/document.addEventListener "keydown" handler)

    ;; Hide focus ring on mouse use
    (let [mouse-handler (fn [_] (set-focus-visible! false))]
      (js/document.addEventListener "mousedown" mouse-handler)

      ;; Return cleanup
      (fn []
        (js/document.removeEventListener "keydown" handler)
        (js/document.removeEventListener "mousedown" mouse-handler)))))
