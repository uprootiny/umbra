(ns app.state.history
  "Undo/redo system for the hyperbolic workspace.

   Uses a command pattern with efficient delta storage:
   - Each operation records what changed
   - Undo reverses the change
   - Redo re-applies it

   Memory-efficient:
   - Only stores deltas, not full snapshots
   - Coalesces rapid successive edits
   - Caps history length

   Operations tracked:
   - Point creation/deletion
   - Point movement
   - Reparenting
   - Rename
   - Selection changes (grouped)
   - Fold/unfold"
  (:require [app.math.hn.pointset :as ps]
            [app.math.hn.minkowski :as M]))

;; ════════════════════════════════════════════════════════════════════════════
;; HISTORY STATE
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const MAX-HISTORY 100)
(def ^:const COALESCE-WINDOW 500)  ; ms

(defonce history-state
  (atom {:stack []      ; Past operations (most recent first)
         :future []     ; Future operations (for redo)
         :last-time 0   ; For coalescing
         :last-type nil
         :enabled true}))

;; ════════════════════════════════════════════════════════════════════════════
;; OPERATION RECORDS
;; ════════════════════════════════════════════════════════════════════════════

(defrecord CreatePoint [idx name parent coords meta-data])
(defrecord DeletePoint [idx name parent depth coords flags motif meta-data])
(defrecord MovePoint [idx old-coords new-coords])
(defrecord ReparentPoint [idx old-parent new-parent old-depth new-depth])
(defrecord RenamePoint [idx old-name new-name])
(defrecord ToggleFlag [idx flag old-value new-value])
(defrecord BatchOperation [operations])

;; ════════════════════════════════════════════════════════════════════════════
;; APPLYING OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defmulti apply-op
  "Apply an operation to the pointset."
  (fn [ps op] (type op)))

(defmulti reverse-op
  "Get the reverse of an operation."
  (fn [op] (type op)))

(defmethod apply-op CreatePoint [ps op]
  ;; For redo: recreate the point
  ;; Note: simplified - full impl would restore at exact idx
  (ps/add-point! ps (:coords op) (:name op) (:parent op) 0 (:meta-data op)))

(defmethod reverse-op CreatePoint [op]
  ;; Reverse of create is delete
  (->DeletePoint (:idx op) (:name op) (:parent op)
                 0 (:coords op) 0 -1 (:meta-data op)))

(defmethod apply-op DeletePoint [ps op]
  ;; Mark as hidden (soft delete)
  (ps/set-flag! ps (:idx op) ps/FLAG-HIDDEN))

(defmethod reverse-op DeletePoint [op]
  ;; Reverse of delete is create
  (->CreatePoint (:idx op) (:name op) (:parent op)
                 (:coords op) (:meta-data op)))

(defmethod apply-op MovePoint [ps op]
  (ps/set-point! ps (:idx op) (:new-coords op) 0))

(defmethod reverse-op MovePoint [op]
  (->MovePoint (:idx op) (:new-coords op) (:old-coords op)))

(defmethod apply-op ReparentPoint [ps op]
  (aset (:parent ps) (:idx op) (:new-parent op))
  (aset (:depth ps) (:idx op) (:new-depth op)))

(defmethod reverse-op ReparentPoint [op]
  (->ReparentPoint (:idx op) (:new-parent op) (:old-parent op)
                   (:new-depth op) (:old-depth op)))

(defmethod apply-op RenamePoint [ps op]
  (let [idx (:idx op)]
    (swap! (:name-map ps) dissoc (:old-name op))
    (swap! (:name-map ps) assoc (:new-name op) idx)
    (swap! (:index-map ps) assoc-in [idx :name] (:new-name op))))

(defmethod reverse-op RenamePoint [op]
  (->RenamePoint (:idx op) (:new-name op) (:old-name op)))

(defmethod apply-op ToggleFlag [ps op]
  (if (:new-value op)
    (ps/set-flag! ps (:idx op) (:flag op))
    (ps/clear-flag! ps (:idx op) (:flag op))))

(defmethod reverse-op ToggleFlag [op]
  (->ToggleFlag (:idx op) (:flag op) (:new-value op) (:old-value op)))

(defmethod apply-op BatchOperation [ps op]
  (doseq [sub-op (:operations op)]
    (apply-op ps sub-op)))

(defmethod reverse-op BatchOperation [op]
  (->BatchOperation (mapv reverse-op (reverse (:operations op)))))

;; ════════════════════════════════════════════════════════════════════════════
;; RECORDING OPERATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn should-coalesce?
  "Check if this operation should coalesce with previous."
  [op-type]
  (let [{:keys [last-time last-type]} @history-state
        now (js/Date.now)]
    (and (= op-type last-type)
         (< (- now last-time) COALESCE-WINDOW))))

(defn record!
  "Record an operation for undo.

   Clears redo stack (future)."
  [op & {:keys [coalesce?] :or {coalesce? false}}]
  (when (:enabled @history-state)
    (let [op-type (type op)]
      (swap! history-state
             (fn [state]
               (let [stack (:stack state)
                     ;; Coalesce if same type and recent
                     stack' (if (and coalesce?
                                     (should-coalesce? op-type)
                                     (seq stack))
                              ;; Replace last with this
                              (assoc stack 0 op)
                              ;; Add new
                              (vec (take MAX-HISTORY (cons op stack))))]
                 (assoc state
                        :stack stack'
                        :future []
                        :last-time (js/Date.now)
                        :last-type op-type)))))))

(defn record-batch!
  "Record multiple operations as a single undo unit."
  [operations]
  (when (seq operations)
    (record! (->BatchOperation operations))))

;; ════════════════════════════════════════════════════════════════════════════
;; UNDO / REDO
;; ════════════════════════════════════════════════════════════════════════════

(defn can-undo?
  "Check if undo is available."
  []
  (seq (:stack @history-state)))

(defn can-redo?
  "Check if redo is available."
  []
  (seq (:future @history-state)))

(defn undo!
  "Undo the last operation."
  [ps]
  (when (can-undo?)
    (let [op (first (:stack @history-state))
          rev (reverse-op op)]
      ;; Apply reverse
      (apply-op ps rev)
      ;; Update history
      (swap! history-state
             (fn [state]
               (-> state
                   (update :stack rest)
                   (update :future #(cons op %)))))
      true)))

(defn redo!
  "Redo the last undone operation."
  [ps]
  (when (can-redo?)
    (let [op (first (:future @history-state))]
      ;; Apply operation
      (apply-op ps op)
      ;; Update history
      (swap! history-state
             (fn [state]
               (-> state
                   (update :future rest)
                   (update :stack #(cons op %)))))
      true)))

(defn clear-history!
  "Clear all history."
  []
  (reset! history-state
          {:stack []
           :future []
           :last-time 0
           :last-type nil
           :enabled true}))

;; ════════════════════════════════════════════════════════════════════════════
;; OPERATION BUILDERS
;; ════════════════════════════════════════════════════════════════════════════

(defn record-point-creation!
  "Record creation of a point."
  [ps idx]
  (let [meta (ps/get-meta ps idx)]
    (record! (->CreatePoint idx
                            (:name meta)
                            (ps/get-parent ps idx)
                            nil  ; Could capture coords
                            meta))))

(defn record-point-move!
  "Record movement of a point."
  [ps idx old-coords]
  (let [dim (:dim ps)
        stride (:stride ps)
        new-coords (js/Float32Array. (inc dim))]
    (M/copy-vec! new-coords 0 (:coords ps) (* idx stride) dim)
    (record! (->MovePoint idx old-coords new-coords)
             :coalesce? true)))

(defn record-reparent!
  "Record reparenting of a point."
  [ps idx old-parent old-depth]
  (record! (->ReparentPoint idx
                            old-parent
                            (ps/get-parent ps idx)
                            old-depth
                            (ps/get-depth ps idx))))

(defn record-rename!
  "Record renaming of a point."
  [ps idx old-name new-name]
  (record! (->RenamePoint idx old-name new-name)))

(defn record-flag-toggle!
  "Record flag change on a point."
  [ps idx flag old-value new-value]
  (record! (->ToggleFlag idx flag old-value new-value)))

(defrecord PasteSubtree [root-idx node-count])
(defrecord DeleteSubtree [root-idx node-count tree-data])

(defn record-paste!
  "Record pasting of a subtree."
  [ps root-idx node-count]
  (record! (->PasteSubtree root-idx node-count)))

(defn record-delete!
  "Record deletion of a subtree."
  [ps root-idx node-count tree-data]
  (record! (->DeleteSubtree root-idx node-count tree-data)))

(defmethod apply-op PasteSubtree [ps op]
  ;; For undo: mark pasted nodes as deleted
  (let [root-idx (:root-idx op)]
    (when (< root-idx @(:count ps))
      (ps/set-flag! ps root-idx ps/FLAG-HIDDEN))))

(defmethod reverse-op PasteSubtree [op]
  (->DeleteSubtree (:root-idx op) (:node-count op) nil))

(defmethod apply-op DeleteSubtree [ps op]
  ;; For undo: undelete the nodes (clear hidden flag)
  (let [root-idx (:root-idx op)]
    (when (< root-idx @(:count ps))
      (ps/clear-flag! ps root-idx ps/FLAG-HIDDEN))))

(defmethod reverse-op DeleteSubtree [op]
  (->PasteSubtree (:root-idx op) (:node-count op)))

;; ════════════════════════════════════════════════════════════════════════════
;; TRANSACTION SUPPORT
;; ════════════════════════════════════════════════════════════════════════════

(defonce transaction-buffer (atom []))

(defn begin-transaction!
  "Start a transaction - operations will be batched."
  []
  (reset! transaction-buffer []))

(defn add-to-transaction!
  "Add operation to current transaction."
  [op]
  (swap! transaction-buffer conj op))

(defn commit-transaction!
  "Commit transaction as single undo unit."
  []
  (let [ops @transaction-buffer]
    (reset! transaction-buffer [])
    (when (seq ops)
      (record-batch! ops))))

(defn rollback-transaction!
  "Discard transaction."
  []
  (reset! transaction-buffer []))

;; ════════════════════════════════════════════════════════════════════════════
;; KEYBOARD INTEGRATION
;; ════════════════════════════════════════════════════════════════════════════

(defn handle-undo-redo!
  "Handle undo/redo keyboard shortcuts.

   Returns true if handled."
  [ps event]
  (let [key (.-key event)
        meta? (or (.-metaKey event) (.-ctrlKey event))
        shift? (.-shiftKey event)]
    (cond
      (and meta? (= key "z") (not shift?))
      (do (undo! ps) true)

      (and meta? (= key "z") shift?)
      (do (redo! ps) true)

      (and meta? (= key "y"))
      (do (redo! ps) true)

      :else false)))
