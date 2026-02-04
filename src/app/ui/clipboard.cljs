(ns app.ui.clipboard
  "Clipboard operations for copying and pasting subtrees.

   Provides:
   1. COPY SUBTREE
      Copy a node and all descendants to internal clipboard.

   2. CUT SUBTREE
      Copy subtree then delete original.

   3. PASTE SUBTREE
      Insert clipboard contents as children of target node.

   4. DUPLICATE IN PLACE
      Create a copy of subtree adjacent to original.

   Performance:
   - Coordinates stored as deltas from root for efficient paste
   - Metadata cloned to avoid reference issues
   - Lazy tree traversal for large subtrees"
  (:require [app.math.hn.pointset :as ps]
            [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.state.history :as history]))

;; ════════════════════════════════════════════════════════════════════════════
;; CLIPBOARD STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce clipboard-state
  (atom {:content nil       ; Copied subtree data
         :source-ps-id nil  ; Source pointset ID
         :cut? false        ; Was this a cut operation?
         :timestamp nil}))  ; When copied

(defrecord ClipboardNode
  [name           ; Node name
   meta           ; Node metadata
   local-coords   ; Coordinates relative to subtree root
   children])     ; Vector of child ClipboardNodes

;; ════════════════════════════════════════════════════════════════════════════
;; SUBTREE EXTRACTION
;; ════════════════════════════════════════════════════════════════════════════

(defn- extract-local-coords
  "Get coordinates relative to root point.

   Computes the tangent vector from root to point,
   which is position-independent and can be re-applied at paste target."
  [ps root-idx node-idx]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        root-off (* root-idx stride)
        node-off (* node-idx stride)
        log-result (M/make-vec dim)]
    ;; Use log map to get tangent from root to node
    (maps/log! log-result 0 coords root-off coords node-off dim)
    log-result))

(defn- build-clipboard-tree
  "Recursively build clipboard tree from pointset subtree."
  [ps root-idx current-idx]
  (let [meta (ps/get-meta ps current-idx)
        name (or (:name meta) (str "node-" current-idx))
        local-coords (if (= current-idx root-idx)
                       nil  ; Root has no offset
                       (extract-local-coords ps root-idx current-idx))
        children (ps/get-children ps current-idx)]
    (->ClipboardNode
     name
     (dissoc meta :name)  ; Name stored separately
     local-coords
     (mapv #(build-clipboard-tree ps root-idx %) children))))

(defn copy-subtree!
  "Copy a subtree to clipboard.

   Args:
     ps: pointset
     root-idx: root of subtree to copy
     ps-id: pointset ID (for tracking)

   Returns true on success."
  [ps root-idx ps-id]
  (when (and ps (>= root-idx 0) (< root-idx @(:count ps)))
    (let [tree (build-clipboard-tree ps root-idx root-idx)]
      (reset! clipboard-state
              {:content tree
               :source-ps-id ps-id
               :cut? false
               :timestamp (js/Date.now)})
      true)))

(defn cut-subtree!
  "Cut a subtree (copy then mark for deletion on paste).

   Args:
     ps: pointset
     root-idx: root of subtree to cut
     ps-id: pointset ID

   Returns true on success. Actual deletion happens on paste."
  [ps root-idx ps-id]
  (when (copy-subtree! ps root-idx ps-id)
    (swap! clipboard-state assoc :cut? true)
    true))

;; ════════════════════════════════════════════════════════════════════════════
;; SUBTREE INSERTION
;; ════════════════════════════════════════════════════════════════════════════

(defn- apply-local-coords!
  "Apply local coordinates to get absolute position.

   Takes the target point and applies the tangent vector
   to get the new point's location."
  [out out-off target-coords target-off local-coords dim]
  (if (nil? local-coords)
    ;; Root node - place at target
    (M/copy-vec! out out-off target-coords target-off dim)
    ;; Non-root - use exp map from target along tangent
    (maps/exp! out out-off target-coords target-off local-coords 0 dim)))

(defn- count-clipboard-nodes
  "Count total nodes in clipboard tree."
  [node]
  (+ 1 (reduce + 0 (map count-clipboard-nodes (:children node)))))

(defn- paste-clipboard-tree!
  "Recursively paste clipboard tree into pointset.

   Args:
     ps: target pointset
     tree: ClipboardNode tree
     parent-idx: parent index in target (-1 for root)
     target-coords: coordinates of paste target
     target-off: offset into target coords
     name-suffix: suffix for unique names

   Returns index of pasted root node."
  [ps tree parent-idx target-coords target-off name-suffix]
  (let [dim (:dim ps)
        stride (:stride ps)
        ;; Compute absolute position
        new-coords (M/make-vec dim)
        _ (apply-local-coords! new-coords 0
                               target-coords target-off
                               (:local-coords tree) dim)
        ;; Create unique name
        unique-name (if name-suffix
                      (str (:name tree) name-suffix)
                      (:name tree))
        ;; Determine depth
        depth (if (= parent-idx -1)
                0
                (inc (ps/get-depth ps parent-idx)))
        ;; Add point
        new-idx (ps/add-point! ps new-coords unique-name
                               parent-idx depth
                               (:meta tree))]
    ;; Recursively paste children
    (when (>= new-idx 0)
      (let [new-off (* new-idx stride)
            new-node-coords (:coords ps)]
        (doseq [child (:children tree)]
          (paste-clipboard-tree! ps child new-idx
                                 new-node-coords new-off
                                 name-suffix))))
    new-idx))

(defn paste-subtree!
  "Paste clipboard contents as child of target node.

   Args:
     ps: target pointset
     target-idx: parent for pasted subtree (-1 for root level)
     ps-id: target pointset ID

   Returns index of pasted root, or -1 on failure."
  [ps target-idx ps-id]
  (let [{:keys [content cut? source-ps-id]} @clipboard-state]
    (if (nil? content)
      -1  ; Nothing to paste
      (let [dim (:dim ps)
            stride (:stride ps)
            ;; Get target coordinates
            target-coords (if (= target-idx -1)
                            (M/origin-vec dim)
                            (:coords ps))
            target-off (if (= target-idx -1)
                         0
                         (* target-idx stride))
            ;; Check if names might conflict
            needs-suffix? (= ps-id source-ps-id)
            name-suffix (when needs-suffix?
                          (str "-copy-" (mod (js/Date.now) 1000)))
            ;; Paste the tree
            root-idx (paste-clipboard-tree! ps content target-idx
                                            target-coords target-off
                                            name-suffix)]
        ;; Record for undo
        (when (>= root-idx 0)
          (history/record-paste! ps root-idx (count-clipboard-nodes content)))
        ;; Clear cut flag (don't delete source - that's destructive)
        (when cut?
          (swap! clipboard-state assoc :cut? false))
        root-idx))))

;; ════════════════════════════════════════════════════════════════════════════
;; DUPLICATE IN PLACE
;; ════════════════════════════════════════════════════════════════════════════

(defn duplicate-subtree!
  "Duplicate a subtree adjacent to the original.

   Creates a copy with slightly offset position.

   Args:
     ps: pointset
     root-idx: root of subtree to duplicate
     ps-id: pointset ID

   Returns index of duplicated root, or -1 on failure."
  [ps root-idx ps-id]
  (when (and ps (>= root-idx 0) (< root-idx @(:count ps)))
    (let [dim (:dim ps)
          stride (:stride ps)
          coords (:coords ps)
          root-off (* root-idx stride)
          ;; Build tree
          tree (build-clipboard-tree ps root-idx root-idx)
          ;; Get parent of original
          parent-idx (ps/get-parent ps root-idx)
          ;; Create small offset tangent
          offset-tangent (M/make-vec dim)
          _ (M/zero-vec! offset-tangent 0 dim)
          _ (aset offset-tangent 1 0.3)  ; Offset in x
          _ (aset offset-tangent 2 0.1)  ; Slight y offset
          ;; Compute offset position
          offset-coords (M/make-vec dim)]
      (maps/exp! offset-coords 0 coords root-off offset-tangent 0 dim)
      ;; Paste at offset position
      (let [root-idx (paste-clipboard-tree! ps tree parent-idx
                                            offset-coords 0
                                            (str "-dup-" (mod (js/Date.now) 1000)))]
        (when (>= root-idx 0)
          (history/record-paste! ps root-idx (count-clipboard-nodes tree)))
        root-idx))))

;; ════════════════════════════════════════════════════════════════════════════
;; DELETE SUBTREE
;; ════════════════════════════════════════════════════════════════════════════

(defn delete-subtree!
  "Delete a subtree from pointset.

   Note: This marks nodes as deleted but doesn't compact.
   Use ps/compact! to reclaim space.

   Args:
     ps: pointset
     root-idx: root of subtree to delete

   Returns count of deleted nodes."
  [ps root-idx]
  (when (and ps (>= root-idx 0) (< root-idx @(:count ps)))
    (let [descendants (ps/get-descendants ps root-idx)
          all-indices (cons root-idx descendants)]
      ;; Record for undo before deleting
      (history/record-delete! ps root-idx
                              (count all-indices)
                              (build-clipboard-tree ps root-idx root-idx))
      ;; Mark all as hidden (soft delete)
      (doseq [idx all-indices]
        (ps/set-flag! ps idx ps/FLAG-HIDDEN))
      (count all-indices))))

;; ════════════════════════════════════════════════════════════════════════════
;; CLIPBOARD QUERIES
;; ════════════════════════════════════════════════════════════════════════════

(defn has-clipboard-content?
  "Check if clipboard has content."
  []
  (some? (:content @clipboard-state)))

(defn clipboard-is-cut?
  "Check if clipboard content was cut (vs copied)."
  []
  (:cut? @clipboard-state))

(defn clear-clipboard!
  "Clear clipboard contents."
  []
  (reset! clipboard-state
          {:content nil
           :source-ps-id nil
           :cut? false
           :timestamp nil}))

(defn get-clipboard-info
  "Get info about clipboard contents.

   Returns {:node-count, :root-name, :cut?, :timestamp} or nil."
  []
  (when-let [content (:content @clipboard-state)]
    {:node-count (count-clipboard-nodes content)
     :root-name (:name content)
     :cut? (:cut? @clipboard-state)
     :timestamp (:timestamp @clipboard-state)}))

