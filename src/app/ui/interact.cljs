(ns app.ui.interact
  "User interaction handlers for the hyperbolic workspace.

   Provides:
   1. DOUBLE-CLICK FOCUS
      Double-click a node to center view and optionally expand subtree.

   2. INLINE RENAME
      Press R on focused node to edit name in-place.

   3. COMMAND PALETTE / SEARCH
      Cmd+K to open fuzzy search across all nodes.

   4. DEPTH FILTER
      Quick slider to limit visible tree depth.

   All interactions are designed to be responsive:
   - Event handlers do minimal work
   - Heavy operations are deferred or throttled
   - Visual feedback is immediate"
  (:require [app.math.hn.pointset :as ps]
            [app.math.hn.animate :as anim]
            [app.math.hn.keyboard :as kbd]))

;; ════════════════════════════════════════════════════════════════════════════
;; DOUBLE-CLICK FOCUS
;; ════════════════════════════════════════════════════════════════════════════

(defonce double-click-state
  (atom {:last-click-time 0
         :last-click-idx nil
         :double-click-threshold 300}))  ; ms

(defn handle-click!
  "Handle click on a node, detecting double-clicks.

   Returns :single, :double, or nil."
  [idx]
  (let [now (js/Date.now)
        {:keys [last-click-time last-click-idx double-click-threshold]} @double-click-state]
    (if (and (= idx last-click-idx)
             (< (- now last-click-time) double-click-threshold))
      ;; Double click
      (do
        (swap! double-click-state assoc :last-click-time 0 :last-click-idx nil)
        :double)
      ;; Single click - record for potential double
      (do
        (swap! double-click-state assoc :last-click-time now :last-click-idx idx)
        :single))))

(defn focus-on-node!
  "Focus view on a node with animation.

   Args:
     l: lens
     ps: pointset
     idx: node index
     opts:
       :expand? - also unfold children (default false)
       :duration - animation duration ms (default 400)"
  [l ps idx & {:keys [expand? duration] :or {duration 400}}]
  (let [stride (:stride ps)
        coords (:coords ps)]
    ;; Animate focus
    (anim/animate-focus! l coords (* idx stride) duration
                         :easing :out-cubic)
    ;; Optionally expand
    (when expand?
      (doseq [child (ps/get-children ps idx)]
        (when (ps/has-flag? ps child ps/FLAG-FOLDED)
          (ps/clear-flag! ps child ps/FLAG-HIDDEN)
          (ps/clear-flag! ps child ps/FLAG-FOLDED))))
    ;; Set keyboard focus
    (kbd/set-focused! ps idx)))

;; ════════════════════════════════════════════════════════════════════════════
;; INLINE RENAME
;; ════════════════════════════════════════════════════════════════════════════

(defonce rename-state
  (atom {:active false
         :idx nil
         :original-name nil
         :input-element nil}))

(defn start-rename!
  "Start inline rename for a node.

   Creates a positioned input over the node."
  [ps idx screen-x screen-y on-complete]
  (let [current-name (ps/get-name ps idx)
        input (js/document.createElement "input")]

    ;; Configure input
    (set! (.-type input) "text")
    (set! (.-value input) current-name)
    (set! (.-className input) "umbra-inline-rename")

    ;; Position over node
    (let [style (.-style input)]
      (set! (.-position style) "fixed")
      (set! (.-left style) (str (- screen-x 50) "px"))
      (set! (.-top style) (str (- screen-y 12) "px"))
      (set! (.-width style) "100px")
      (set! (.-padding style) "4px 8px")
      (set! (.-fontSize style) "13px")
      (set! (.-fontFamily style) "inherit")
      (set! (.-background style) "#1a1a24")
      (set! (.-color style) "#e0e0e8")
      (set! (.-border style) "2px solid #4080c0")
      (set! (.-borderRadius style) "4px")
      (set! (.-outline style) "none")
      (set! (.-zIndex style) "10000"))

    ;; Add to DOM
    (js/document.body.appendChild input)

    ;; Focus and select
    (.focus input)
    (.select input)

    ;; Save state
    (reset! rename-state
            {:active true
             :idx idx
             :original-name current-name
             :input-element input})

    ;; Handle completion
    (let [complete (fn [save?]
                     (let [new-name (.-value input)]
                       (js/document.body.removeChild input)
                       (reset! rename-state {:active false})
                       (when (and save? (not= new-name current-name))
                         ;; Update name maps
                         (swap! (:name-map ps) dissoc current-name)
                         (swap! (:name-map ps) assoc new-name idx)
                         (swap! (:index-map ps) assoc-in [idx :name] new-name))
                       (when on-complete
                         (on-complete (if save? new-name nil)))))]

      ;; Enter to save, Escape to cancel
      (.addEventListener input "keydown"
                         (fn [e]
                           (cond
                             (= (.-key e) "Enter")
                             (do (.preventDefault e) (complete true))

                             (= (.-key e) "Escape")
                             (do (.preventDefault e) (complete false)))))

      ;; Blur to save
      (.addEventListener input "blur"
                         (fn [_] (when (:active @rename-state) (complete true)))))))

(defn cancel-rename!
  "Cancel any active rename."
  []
  (when (:active @rename-state)
    (when-let [input (:input-element @rename-state)]
      (js/document.body.removeChild input))
    (reset! rename-state {:active false})))

(defn is-renaming?
  "Check if rename is active."
  []
  (:active @rename-state))

;; ════════════════════════════════════════════════════════════════════════════
;; SEARCH / COMMAND PALETTE
;; ════════════════════════════════════════════════════════════════════════════

(defonce search-state
  (atom {:open false
         :query ""
         :results []
         :selected-idx 0
         :mode :search}))  ; :search or :command

(defn fuzzy-match?
  "Simple fuzzy match: all query chars appear in order."
  [query target]
  (let [q (clojure.string/lower-case query)
        t (clojure.string/lower-case target)]
    (loop [qi 0
           ti 0]
      (cond
        (>= qi (count q)) true
        (>= ti (count t)) false
        (= (nth q qi) (nth t ti)) (recur (inc qi) (inc ti))
        :else (recur qi (inc ti))))))

(defn score-match
  "Score a fuzzy match (higher = better).

   Prefers:
   - Exact prefix matches
   - Shorter targets
   - Consecutive matches"
  [query target]
  (let [q (clojure.string/lower-case query)
        t (clojure.string/lower-case target)]
    (cond
      ;; Exact match
      (= q t) 1000

      ;; Prefix match
      (.startsWith t q) (+ 500 (- 100 (count t)))

      ;; Contains
      (.includes t q) (+ 200 (- 100 (count t)))

      ;; Fuzzy
      (fuzzy-match? q t) (+ 50 (- 100 (count t)))

      :else 0)))

(defn search-nodes
  "Search nodes by name, return sorted results.

   Returns [{:idx, :name, :score, :depth}, ...]"
  [ps query max-results]
  (when (and query (pos? (count query)))
    (let [n @(:count ps)
          index-map @(:index-map ps)]
      (->> (range n)
           (map (fn [idx]
                  (let [meta (get index-map idx)
                        name (or (:name meta) "")]
                    {:idx idx
                     :name name
                     :depth (ps/get-depth ps idx)
                     :score (score-match query name)})))
           (filter #(pos? (:score %)))
           (sort-by :score >)
           (take max-results)
           vec))))

(defn open-search!
  "Open the search palette."
  [ps on-select]
  (swap! search-state assoc
         :open true
         :query ""
         :results []
         :selected-idx 0
         :on-select on-select
         :pointset ps))

(defn close-search!
  "Close the search palette."
  []
  (swap! search-state assoc :open false))

(defn update-search-query!
  "Update search query and results."
  [query]
  (let [ps (:pointset @search-state)
        results (search-nodes ps query 20)]
    (swap! search-state assoc
           :query query
           :results results
           :selected-idx 0)))

(defn select-search-result!
  "Select current search result."
  []
  (let [{:keys [results selected-idx on-select]} @search-state]
    (when (and (seq results) (< selected-idx (count results)))
      (let [result (nth results selected-idx)]
        (close-search!)
        (when on-select
          (on-select (:idx result)))))))

(defn navigate-search-results!
  "Navigate search results with arrow keys."
  [direction]
  (let [n (count (:results @search-state))]
    (when (pos? n)
      (swap! search-state update :selected-idx
             #(mod (+ % direction) n)))))

;; ════════════════════════════════════════════════════════════════════════════
;; DEPTH FILTER
;; ════════════════════════════════════════════════════════════════════════════

(defonce depth-filter-state
  (atom {:enabled false
         :max-depth 10
         :current-depth 10}))

(defn set-depth-filter!
  "Set depth filter value."
  [ps depth]
  (swap! depth-filter-state assoc
         :enabled true
         :current-depth depth)
  ;; Apply filter
  (let [n @(:count ps)]
    (loop [i 0]
      (when (< i n)
        (let [node-depth (ps/get-depth ps i)]
          (if (> node-depth depth)
            (ps/set-flag! ps i ps/FLAG-HIDDEN)
            ;; Don't unhide manually hidden or folded
            (when (and (ps/has-flag? ps i ps/FLAG-HIDDEN)
                       (not (ps/has-flag? ps i ps/FLAG-FOLDED)))
              (ps/clear-flag! ps i ps/FLAG-HIDDEN))))
        (recur (inc i))))))

(defn clear-depth-filter!
  "Remove depth filter."
  [ps]
  (swap! depth-filter-state assoc :enabled false)
  ;; Show all non-folded
  (let [n @(:count ps)]
    (loop [i 0]
      (when (< i n)
        (when (and (ps/has-flag? ps i ps/FLAG-HIDDEN)
                   (not (ps/has-flag? ps i ps/FLAG-FOLDED)))
          (ps/clear-flag! ps i ps/FLAG-HIDDEN))
        (recur (inc i))))))

;; ════════════════════════════════════════════════════════════════════════════
;; EVENT HANDLING INTEGRATION
;; ════════════════════════════════════════════════════════════════════════════

(defn handle-keydown!
  "Handle keydown for interactions.

   Returns true if event was consumed."
  [ps l event]
  (let [key (.-key event)
        ctrl? (.-ctrlKey event)
        meta? (.-metaKey event)]

    (cond
      ;; Active rename takes all keys
      (is-renaming?)
      false  ; Let rename handler deal with it

      ;; Search open - handle navigation
      (:open @search-state)
      (cond
        (= key "ArrowDown")
        (do (navigate-search-results! 1) true)

        (= key "ArrowUp")
        (do (navigate-search-results! -1) true)

        (= key "Enter")
        (do (select-search-result!) true)

        (= key "Escape")
        (do (close-search!) true)

        :else false)

      ;; Cmd+K / Ctrl+K - open search
      (and (= key "k") (or ctrl? meta?))
      (do
        (.preventDefault event)
        (open-search! ps
                      (fn [idx]
                        (focus-on-node! l ps idx :duration 400)))
        true)

      ;; R - rename focused
      (= key "r")
      (when-let [idx (kbd/get-focused)]
        ;; Would need screen coords from batch
        true)

      ;; [ and ] - adjust depth filter
      (= key "[")
      (do
        (let [new-depth (max 0 (dec (:current-depth @depth-filter-state)))]
          (set-depth-filter! ps new-depth))
        true)

      (= key "]")
      (do
        (let [new-depth (min 20 (inc (:current-depth @depth-filter-state)))]
          (set-depth-filter! ps new-depth))
        true)

      ;; 0 - clear depth filter
      (= key "0")
      (do (clear-depth-filter! ps) true)

      :else false)))
