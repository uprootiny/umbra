(ns app.ui.context-menu
  "Context menu system for right-click actions on nodes.

   Provides:
   1. NODE CONTEXT MENU
      Right-click on node shows relevant actions.

   2. CANVAS CONTEXT MENU
      Right-click on empty space shows canvas actions.

   3. KEYBOARD SHORTCUTS
      Integrates with keyboard module for shortcuts.

   Performance:
   - Lazy menu construction
   - Single DOM element reused
   - Event delegation"
  (:require [app.math.hn.pointset :as ps]
            [app.ui.clipboard :as clipboard]))

;; ════════════════════════════════════════════════════════════════════════════
;; MENU STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce menu-state
  (atom {:visible false
         :x 0
         :y 0
         :target-idx nil      ; Node index or nil for canvas
         :items []
         :on-action nil}))    ; Callback when action selected

;; ════════════════════════════════════════════════════════════════════════════
;; MENU ITEMS
;; ════════════════════════════════════════════════════════════════════════════

(defn node-menu-items
  "Get menu items for a node context."
  [ps idx]
  (let [is-selected? (ps/has-flag? ps idx ps/FLAG-SELECTED)
        is-hidden? (ps/has-flag? ps idx ps/FLAG-HIDDEN)
        is-pinned? (ps/has-flag? ps idx ps/FLAG-PINNED)
        has-children? (seq (ps/get-children ps idx))
        has-clipboard? (clipboard/has-clipboard-content?)]
    (filter some?
            [{:id :focus :label "Focus" :shortcut "Enter"}
             {:id :select :label (if is-selected? "Deselect" "Select") :shortcut "Space"}
             {:id :divider}
             {:id :rename :label "Rename" :shortcut "F2"}
             {:id :copy :label "Copy" :shortcut "Cmd+C"}
             {:id :cut :label "Cut" :shortcut "Cmd+X"}
             (when has-clipboard?
               {:id :paste :label "Paste as child" :shortcut "Cmd+V"})
             {:id :duplicate :label "Duplicate" :shortcut "Cmd+D"}
             {:id :divider}
             {:id :add-child :label "Add child" :shortcut "Cmd+Enter"}
             {:id :add-sibling :label "Add sibling" :shortcut "Shift+Enter"}
             {:id :divider}
             (when has-children?
               {:id :fold :label "Fold subtree" :shortcut "z"})
             {:id :hide :label (if is-hidden? "Show" "Hide") :shortcut "h"}
             {:id :pin :label (if is-pinned? "Unpin" "Pin")}
             {:id :divider}
             {:id :delete :label "Delete" :shortcut "Delete" :danger true}])))

(defn canvas-menu-items
  "Get menu items for canvas (empty space) context."
  [ps]
  (let [has-clipboard? (clipboard/has-clipboard-content?)
        has-selection? (seq (ps/selected-points ps))]
    (filter some?
            [{:id :add-root :label "Add root node" :shortcut "Cmd+N"}
             (when has-clipboard?
               {:id :paste-root :label "Paste as root" :shortcut "Cmd+V"})
             {:id :divider}
             (when has-selection?
               {:id :deselect-all :label "Deselect all" :shortcut "Esc"})
             {:id :select-all :label "Select all" :shortcut "Cmd+A"}
             {:id :divider}
             {:id :fit-view :label "Fit to view" :shortcut "0"}
             {:id :go-home :label "Go home" :shortcut "H"}
             {:id :save-home :label "Save as home"}
             {:id :divider}
             {:id :export-png :label "Export PNG" :shortcut "Cmd+Shift+S"}
             {:id :export-svg :label "Export SVG"}
             {:id :export-md :label "Export Markdown"}])))

;; ════════════════════════════════════════════════════════════════════════════
;; MENU VISIBILITY
;; ════════════════════════════════════════════════════════════════════════════

(defn show-menu!
  "Show context menu at position.

   Args:
     x, y: screen position
     ps: pointset
     target-idx: node index or nil for canvas
     on-action: callback (fn [action-id target-idx])"
  [x y ps target-idx on-action]
  (let [items (if target-idx
                (node-menu-items ps target-idx)
                (canvas-menu-items ps))]
    (reset! menu-state
            {:visible true
             :x x
             :y y
             :target-idx target-idx
             :items items
             :on-action on-action})))

(defn hide-menu!
  "Hide context menu."
  []
  (swap! menu-state assoc :visible false))

(defn is-menu-visible?
  "Check if menu is visible."
  []
  (:visible @menu-state))

;; ════════════════════════════════════════════════════════════════════════════
;; ACTION DISPATCH
;; ════════════════════════════════════════════════════════════════════════════

(defn dispatch-action!
  "Dispatch a menu action."
  [action-id]
  (let [{:keys [target-idx on-action]} @menu-state]
    (hide-menu!)
    (when on-action
      (on-action action-id target-idx))))

;; ════════════════════════════════════════════════════════════════════════════
;; MENU RENDERING (Virtual DOM structure)
;; ════════════════════════════════════════════════════════════════════════════

(defn render-menu-data
  "Get menu render data for external rendering.

   Returns {:visible, :x, :y, :items} or nil if not visible.
   Items are [{:id, :label, :shortcut, :danger, :disabled}]"
  []
  (let [{:keys [visible x y items]} @menu-state]
    (when visible
      {:visible true
       :x x
       :y y
       :items (remove #(= (:id %) :divider) items)
       :divider-indices (->> items
                             (map-indexed vector)
                             (filter #(= (:id (second %)) :divider))
                             (map first)
                             vec)})))

;; ════════════════════════════════════════════════════════════════════════════
;; DOM RENDERING (Optional - for standalone usage)
;; ════════════════════════════════════════════════════════════════════════════

(defonce menu-element (atom nil))

(defn create-menu-element!
  "Create the menu DOM element."
  []
  (when-not @menu-element
    (let [el (js/document.createElement "div")]
      (set! (.-id el) "hn-context-menu")
      (set! (.-className el) "hn-context-menu")
      (set! (.-innerHTML el) "")
      (.appendChild js/document.body el)
      (reset! menu-element el)
      ;; Click outside closes menu
      (.addEventListener js/document "click"
                         (fn [e]
                           (when (and (is-menu-visible?)
                                      (not (.contains el (.-target e))))
                             (hide-menu!))))
      ;; Escape closes menu
      (.addEventListener js/document "keydown"
                         (fn [e]
                           (when (and (is-menu-visible?)
                                      (= (.-key e) "Escape"))
                             (hide-menu!)
                             (.preventDefault e)))))))

(defn render-menu-dom!
  "Render menu to DOM."
  []
  (create-menu-element!)
  (let [{:keys [visible x y items]} @menu-state
        el @menu-element]
    (if visible
      (do
        (set! (.-style.display el) "block")
        (set! (.-style.left el) (str x "px"))
        (set! (.-style.top el) (str y "px"))
        ;; Render items
        (set! (.-innerHTML el) "")
        (doseq [item items]
          (if (= (:id item) :divider)
            (let [div (js/document.createElement "div")]
              (set! (.-className div) "menu-divider")
              (.appendChild el div))
            (let [btn (js/document.createElement "button")]
              (set! (.-className btn)
                    (str "menu-item" (when (:danger item) " danger")))
              (set! (.-innerHTML btn)
                    (str "<span class=\"menu-label\">" (:label item) "</span>"
                         (when (:shortcut item)
                           (str "<span class=\"menu-shortcut\">"
                                (:shortcut item) "</span>"))))
              (.addEventListener btn "click"
                                 (fn [_] (dispatch-action! (:id item))))
              (.appendChild el btn)))))
      (set! (.-style.display el) "none"))))

;; ════════════════════════════════════════════════════════════════════════════
;; CSS STYLES (Inline for portability)
;; ════════════════════════════════════════════════════════════════════════════

(defonce styles-injected (atom false))

(defn inject-styles!
  "Inject context menu CSS styles."
  []
  (when-not @styles-injected
    (let [style (js/document.createElement "style")]
      (set! (.-textContent style)
            "
.hn-context-menu {
  position: fixed;
  z-index: 10000;
  background: #1a1a24;
  border: 1px solid #3a3a4a;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 180px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  display: none;
}

.hn-context-menu .menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 8px 16px;
  background: none;
  border: none;
  color: #e0e0e0;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.hn-context-menu .menu-item:hover {
  background: #2a2a3a;
}

.hn-context-menu .menu-item.danger {
  color: #ff6060;
}

.hn-context-menu .menu-item.danger:hover {
  background: #3a2020;
}

.hn-context-menu .menu-label {
  flex: 1;
}

.hn-context-menu .menu-shortcut {
  margin-left: 20px;
  color: #707080;
  font-size: 11px;
}

.hn-context-menu .menu-divider {
  height: 1px;
  background: #3a3a4a;
  margin: 4px 8px;
}
")
      (.appendChild js/document.head style)
      (reset! styles-injected true))))

(defn init-context-menu!
  "Initialize context menu system."
  []
  (inject-styles!)
  (create-menu-element!))

;; ════════════════════════════════════════════════════════════════════════════
;; EVENT HANDLER
;; ════════════════════════════════════════════════════════════════════════════

(defn handle-context-menu!
  "Handle contextmenu event.

   Args:
     event: DOM event
     ps: pointset
     pick-fn: (fn [x y] -> node-idx or nil)
     on-action: action callback

   Returns true if handled."
  [event ps pick-fn on-action]
  (.preventDefault event)
  (let [x (.-clientX event)
        y (.-clientY event)
        target-idx (pick-fn x y)]
    (show-menu! x y ps target-idx on-action)
    (render-menu-dom!)
    true))

