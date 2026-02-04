(ns app.math.hn.operator
  "Operators on the manifold state.

   This module implements the 'small algebra of operators' for
   evolving the state on H^n. Rather than imperative mutations,
   we define composable transformations that:

   1. SELECTION OPERATORS
      Act on which points are 'active' or 'focused'.
      - select / deselect
      - expand-selection (to children/descendants)
      - contract-selection (to ancestors)

   2. MOTION OPERATORS
      Move points or the camera on the manifold.
      - translate (isometry, preserves structure)
      - attract (gradient flow toward target)
      - repel (gradient flow away)
      - center (recenter view on selection)

   3. STRUCTURE OPERATORS
      Modify the tree/graph structure.
      - attach (create edge)
      - detach (remove edge)
      - fold (collapse subtree)
      - unfold (expand subtree)

   4. VISIBILITY OPERATORS
      Control what is rendered.
      - show / hide
      - set-lod (force level of detail)
      - prune (hide based on predicate)

   Operators can be composed: (comp op1 op2 op3)
   Operators can be lifted to act on selections: (lift-to-selection op)
   Operators can be animated: (animate op duration easing)"
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.isometries :as iso]
            [app.math.hn.pointset :as ps]
            [app.math.hn.field :as field]))

(def ^:const EPSILON 1e-10)

;; ════════════════════════════════════════════════════════════════════════════
;; OPERATOR PROTOCOL
;; ════════════════════════════════════════════════════════════════════════════

(defprotocol IOperator
  "Protocol for state operators."
  (apply-op [this state] "Apply operator to state, return new state")
  (inverse [this] "Return inverse operator if exists, nil otherwise")
  (compose [this other] "Compose with another operator"))

;; Simple operator record
(defrecord Op [name apply-fn inverse-fn]
  IOperator
  (apply-op [this state] (apply-fn state))
  (inverse [this] (when inverse-fn (->Op (str "inv-" name) inverse-fn apply-fn)))
  (compose [this other]
    (->Op (str name "∘" (:name other))
          (fn [s] (apply-fn (apply-op other s)))
          nil)))

(defn make-op
  "Create a simple operator."
  [name apply-fn & [inverse-fn]]
  (->Op name apply-fn inverse-fn))

;; ════════════════════════════════════════════════════════════════════════════
;; SELECTION OPERATORS
;; ════════════════════════════════════════════════════════════════════════════

(defn select
  "Operator: select points matching predicate.

   (select (fn [ps idx] (= (ps/get-depth ps idx) 0)))"
  [pred]
  (make-op
   "select"
   (fn [{:keys [pointset] :as state}]
     (let [n @(:count pointset)]
       (loop [i 0]
         (when (< i n)
           (if (pred pointset i)
             (ps/set-flag! pointset i ps/FLAG-SELECTED)
             (ps/clear-flag! pointset i ps/FLAG-SELECTED))
           (recur (inc i)))))
     state)))

(defn select-by-name
  "Operator: select point by name."
  [name]
  (make-op
   (str "select:" name)
   (fn [{:keys [pointset] :as state}]
     (when-let [idx (ps/find-by-name pointset name)]
       (ps/set-flag! pointset idx ps/FLAG-SELECTED))
     state)))

(defn select-all
  "Operator: select all points."
  []
  (select (constantly true)))

(defn deselect-all
  "Operator: deselect all points."
  []
  (make-op
   "deselect-all"
   (fn [{:keys [pointset] :as state}]
     (let [n @(:count pointset)
           flags (:flags pointset)]
       (loop [i 0]
         (when (< i n)
           (aset flags i (bit-and (aget flags i) (bit-not ps/FLAG-SELECTED)))
           (recur (inc i)))))
     state)))

(defn expand-selection
  "Operator: add children of selected points to selection."
  []
  (make-op
   "expand-selection"
   (fn [{:keys [pointset] :as state}]
     (let [selected (ps/selected-points pointset)]
       (doseq [idx selected]
         (doseq [child (ps/get-children pointset idx)]
           (ps/set-flag! pointset child ps/FLAG-SELECTED))))
     state)))

(defn expand-selection-full
  "Operator: add all descendants to selection."
  []
  (make-op
   "expand-selection-full"
   (fn [{:keys [pointset] :as state}]
     (let [selected (ps/selected-points pointset)]
       (doseq [idx selected]
         (doseq [desc (ps/get-descendants pointset idx)]
           (ps/set-flag! pointset desc ps/FLAG-SELECTED))))
     state)))

(defn contract-selection
  "Operator: replace selection with parents of selected."
  []
  (make-op
   "contract-selection"
   (fn [{:keys [pointset] :as state}]
     (let [selected (ps/selected-points pointset)
           parents (into #{} (map #(ps/get-parent pointset %) selected))]
       ;; Deselect current
       (doseq [idx selected]
         (ps/clear-flag! pointset idx ps/FLAG-SELECTED))
       ;; Select parents
       (doseq [idx parents]
         (when (>= idx 0)
           (ps/set-flag! pointset idx ps/FLAG-SELECTED))))
     state)))

;; ════════════════════════════════════════════════════════════════════════════
;; MOTION OPERATORS
;; ════════════════════════════════════════════════════════════════════════════

(defn translate
  "Operator: translate all points by an isometry.

   target: destination for origin under the isometry."
  [^js target ot]
  (make-op
   "translate"
   (fn [{:keys [pointset] :as state}]
     (let [dim (:dim pointset)
           stride (:stride pointset)
           coords (:coords pointset)
           n @(:count pointset)
           tmp (M/make-vec dim)
           origin (M/origin-vec dim)]
       (loop [i 0]
         (when (< i n)
           (let [off (* i stride)]
             ;; Apply transvection that moves origin to target
             (iso/transvect-from-origin! tmp 0 coords off target ot dim)
             (M/copy-vec! coords off tmp 0 dim))
           (recur (inc i)))))
     state)))

(defn attract-to
  "Operator: move all selected points toward target by step-size."
  [^js target ot step-size]
  (make-op
   "attract"
   (fn [{:keys [pointset] :as state}]
     (let [dim (:dim pointset)
           stride (:stride pointset)
           coords (:coords pointset)
           selected (ps/selected-points pointset)
           tmp (M/make-vec dim)]
       (doseq [idx selected]
         (let [off (* idx stride)]
           (maps/move-toward! tmp 0 coords off target ot step-size dim tmp)
           (M/copy-vec! coords off tmp 0 dim))))
     state)))

(defn attract-to-centroid
  "Operator: move selected points toward their centroid."
  [step-size]
  (make-op
   "attract-centroid"
   (fn [{:keys [pointset] :as state}]
     (let [dim (:dim pointset)
           stride (:stride pointset)
           coords (:coords pointset)
           selected (ps/selected-points pointset)
           centroid (M/make-vec dim)
           tmp (M/make-vec dim)]
       ;; Compute centroid of selection
       (when (seq selected)
         (M/zero-vec! centroid 0 dim)
         (doseq [idx selected]
           (M/add-vec! centroid 0 centroid 0 coords (* idx stride) dim))
         (H/normalize-hyperboloid! centroid 0 dim)

         ;; Move toward centroid
         (doseq [idx selected]
           (let [off (* idx stride)]
             (maps/move-toward! tmp 0 coords off centroid 0 step-size dim tmp)
             (M/copy-vec! coords off tmp 0 dim)))))
     state)))

(defn repel-from
  "Operator: move selected points away from target."
  [^js target ot step-size]
  (make-op
   "repel"
   (fn [{:keys [pointset] :as state}]
     (let [dim (:dim pointset)
           stride (:stride pointset)
           coords (:coords pointset)
           selected (ps/selected-points pointset)
           tmp (M/make-vec dim)]
       (doseq [idx selected]
         (let [off (* idx stride)]
           ;; Move away = move toward reflected point
           (maps/reflect-through! tmp 0 coords off target ot dim tmp)
           (maps/move-toward! tmp 0 coords off tmp 0 step-size dim tmp)
           (M/copy-vec! coords off tmp 0 dim))))
     state)))

(defn rotate-around
  "Operator: rotate selected points around a center point."
  [^js center oc axis-i axis-j theta]
  (make-op
   "rotate"
   (fn [{:keys [pointset] :as state}]
     (let [dim (:dim pointset)
           stride (:stride pointset)
           coords (:coords pointset)
           selected (ps/selected-points pointset)
           tmp1 (M/make-vec dim)
           tmp2 (M/make-vec dim)]
       (doseq [idx selected]
         (let [off (* idx stride)]
           (iso/rotate-around! tmp1 0 coords off center oc
                               axis-i axis-j theta dim tmp1 tmp2)
           (M/copy-vec! coords off tmp1 0 dim))))
     state)))

;; ════════════════════════════════════════════════════════════════════════════
;; STRUCTURE OPERATORS
;; ════════════════════════════════════════════════════════════════════════════

(defn attach
  "Operator: set parent of child to parent (create/modify edge)."
  [child-idx parent-idx]
  (make-op
   "attach"
   (fn [{:keys [pointset] :as state}]
     (let [old-parent (aget (:parent pointset) child-idx)]
       (aset (:parent pointset) child-idx parent-idx)
       (aset (:depth pointset) child-idx
             (inc (aget (:depth pointset) parent-idx)))
       ;; Update flags
       (ps/clear-flag! pointset child-idx ps/FLAG-ROOT)
       state))
   ;; Inverse: restore old parent
   ))

(defn detach
  "Operator: make a point into a root (remove parent edge)."
  [idx]
  (make-op
   "detach"
   (fn [{:keys [pointset] :as state}]
     (aset (:parent pointset) idx -1)
     (aset (:depth pointset) idx 0)
     (ps/set-flag! pointset idx ps/FLAG-ROOT)
     state)))

(defn fold-subtree
  "Operator: hide all descendants of a point."
  [idx]
  (make-op
   "fold"
   (fn [{:keys [pointset] :as state}]
     (let [descendants (ps/get-descendants pointset idx)]
       (doseq [desc descendants]
         (ps/set-flag! pointset desc ps/FLAG-HIDDEN)
         (ps/set-flag! pointset desc ps/FLAG-FOLDED)))
     state)))

(defn unfold-subtree
  "Operator: show all folded descendants of a point."
  [idx]
  (make-op
   "unfold"
   (fn [{:keys [pointset] :as state}]
     (let [descendants (ps/get-descendants pointset idx)]
       (doseq [desc descendants]
         (when (ps/has-flag? pointset desc ps/FLAG-FOLDED)
           (ps/clear-flag! pointset desc ps/FLAG-HIDDEN)
           (ps/clear-flag! pointset desc ps/FLAG-FOLDED))))
     state)))

;; ════════════════════════════════════════════════════════════════════════════
;; VISIBILITY OPERATORS
;; ════════════════════════════════════════════════════════════════════════════

(defn show
  "Operator: show selected points."
  []
  (make-op
   "show"
   (fn [{:keys [pointset] :as state}]
     (doseq [idx (ps/selected-points pointset)]
       (ps/clear-flag! pointset idx ps/FLAG-HIDDEN))
     state)))

(defn hide
  "Operator: hide selected points."
  []
  (make-op
   "hide"
   (fn [{:keys [pointset] :as state}]
     (doseq [idx (ps/selected-points pointset)]
       (ps/set-flag! pointset idx ps/FLAG-HIDDEN))
     state)))

(defn prune-by-distance
  "Operator: hide points beyond distance threshold from focus."
  [^js focus of threshold]
  (make-op
   "prune"
   (fn [{:keys [pointset] :as state}]
     (let [dim (:dim pointset)
           stride (:stride pointset)
           coords (:coords pointset)
           n @(:count pointset)]
       (loop [i 0]
         (when (< i n)
           (let [d (H/dist focus of coords (* i stride) dim)]
             (if (> d threshold)
               (ps/set-flag! pointset i ps/FLAG-HIDDEN)
               (ps/clear-flag! pointset i ps/FLAG-HIDDEN)))
           (recur (inc i)))))
     state)))

(defn prune-by-depth
  "Operator: hide points beyond depth threshold."
  [max-depth]
  (make-op
   "prune-depth"
   (fn [{:keys [pointset] :as state}]
     (let [n @(:count pointset)]
       (loop [i 0]
         (when (< i n)
           (if (> (ps/get-depth pointset i) max-depth)
             (ps/set-flag! pointset i ps/FLAG-HIDDEN)
             (ps/clear-flag! pointset i ps/FLAG-HIDDEN))
           (recur (inc i)))))
     state)))

;; ════════════════════════════════════════════════════════════════════════════
;; FIELD-BASED OPERATORS
;; ════════════════════════════════════════════════════════════════════════════

(defn gradient-flow
  "Operator: move selected points along density gradient.

   Positive step moves toward higher density (clustering).
   Negative step moves toward lower density (spreading)."
  [density-field step-size]
  (make-op
   "gradient-flow"
   (fn [{:keys [pointset] :as state}]
     (let [dim (:dim pointset)
           stride (:stride pointset)
           coords (:coords pointset)
           selected (ps/selected-points pointset)
           gradient (M/make-vec dim)
           tmp (M/make-vec dim)]
       (doseq [idx selected]
         (let [off (* idx stride)]
           ;; Compute gradient
           (field/eval-density-gradient! gradient 0 density-field
                                         coords off pointset nil dim)
           ;; Scale to step size
           (M/scale-vec! gradient 0 step-size dim)
           ;; Exp map to move
           (maps/exp! tmp 0 coords off gradient 0 dim)
           (M/copy-vec! coords off tmp 0 dim))))
     state)))

;; ════════════════════════════════════════════════════════════════════════════
;; OPERATOR COMBINATORS
;; ════════════════════════════════════════════════════════════════════════════

(defn sequence-ops
  "Compose operators to apply in sequence."
  [& ops]
  (make-op
   (str "seq[" (count ops) "]")
   (fn [state]
     (reduce (fn [s op] (apply-op op s)) state ops))))

(defn conditional
  "Apply operator only if predicate holds on state."
  [pred op]
  (make-op
   (str "if:" (:name op))
   (fn [state]
     (if (pred state)
       (apply-op op state)
       state))))

(defn repeat-op
  "Apply operator n times."
  [op n]
  (make-op
   (str (:name op) "×" n)
   (fn [state]
     (loop [s state
            i 0]
       (if (>= i n)
         s
         (recur (apply-op op s) (inc i)))))))

(defn on-selection
  "Wrap operator to apply to each selected point individually."
  [point-op-fn]
  (make-op
   "on-selection"
   (fn [{:keys [pointset] :as state}]
     (let [selected (ps/selected-points pointset)]
       (doseq [idx selected]
         (let [op (point-op-fn pointset idx)]
           (when op
             (apply-op op state)))))
     state)))

;; ════════════════════════════════════════════════════════════════════════════
;; ANIMATION SUPPORT
;; ════════════════════════════════════════════════════════════════════════════

(defn animate
  "Create an animated version of a motion operator.

   Returns a function (t) → state for t ∈ [0, 1]."
  [initial-state target-op interpolation-fn]
  (let [final-state (apply-op target-op initial-state)]
    (fn [t]
      (let [eased-t (interpolation-fn t)]
        ;; For now, just snap - proper interpolation needs operator-specific logic
        (if (>= eased-t 0.5)
          final-state
          initial-state)))))

;; Common easing functions
(def ease-linear identity)

(defn ease-in-out-cubic [t]
  (if (< t 0.5)
    (* 4 t t t)
    (+ 1 (* -4 (js/Math.pow (- 1 t) 3)))))

(defn ease-out-elastic [t]
  (let [c4 (/ (* 2 js/Math.PI) 3)]
    (if (or (<= t 0) (>= t 1))
      t
      (* (js/Math.pow 2 (* -10 t))
         (js/Math.sin (* (- (* t 10) 0.75) c4))
         1 ))))
