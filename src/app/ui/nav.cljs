(ns app.ui.nav
  "Navigation features for the hyperbolic workspace.

   Provides:
   1. MINIMAP CLICK-TO-PAN
      Click on minimap to center main view at that location.

   2. EDGE-OF-SCREEN PANNING
      Move cursor to edge to auto-pan in that direction.

   3. URL STATE ENCODING
      Encode view position and focus in URL for sharing.

   4. HOME POSITION MEMORY
      Remember and restore last view position per space.

   All navigation is animated for smoothness."
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.chart :as chart]
            [app.math.hn.lens :as lens]
            [app.math.hn.animate :as anim]))

;; ════════════════════════════════════════════════════════════════════════════
;; MINIMAP INTERACTION
;; ════════════════════════════════════════════════════════════════════════════

(defn minimap-click-to-point
  "Convert minimap click to point on H^n.

   Args:
     minimap-lens: the minimap's lens
     click-x, click-y: click position in minimap canvas coords
     width, height: minimap dimensions

   Returns point on manifold."
  [minimap-lens click-x click-y width height]
  (let [dim (:dim minimap-lens)
        ;; Convert to Poincaré disk coordinates (-1 to 1)
        cx (- (* 2 (/ click-x width)) 1)
        cy (- (* 2 (/ click-y height)) 1)
        ;; Clamp to disk
        r (js/Math.sqrt (+ (* cx cx) (* cy cy)))
        [cx cy] (if (> r 0.95)
                  [(* cx (/ 0.95 r)) (* cy (/ 0.95 r))]
                  [cx cy])
        ;; Convert from Poincaré ball to hyperboloid
        out (M/make-vec dim)]
    (chart/ball-to-hyperboloid! out 0 (js/Float32Array. #js [cx cy]) 0 dim)
    out))

(defn handle-minimap-click!
  "Handle click on minimap, panning main view to that location."
  [main-lens minimap-lens click-x click-y width height]
  (let [target (minimap-click-to-point minimap-lens click-x click-y width height)]
    (anim/animate-focus! main-lens target 0 300
                         :easing :out-cubic)))

;; ════════════════════════════════════════════════════════════════════════════
;; EDGE-OF-SCREEN PANNING
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const EDGE-MARGIN 40)      ; Pixels from edge to trigger
(def ^:const PAN-SPEED 0.002)     ; Units per ms
(def ^:const EDGE-CHECK-INTERVAL 50)  ; ms between checks

(defonce edge-pan-state
  (atom {:active false
         :direction [0 0]
         :timer-id nil
         :last-time nil}))

(defn compute-edge-direction
  "Compute pan direction based on cursor position.

   Returns [dx, dy] normalized direction, or [0, 0] if not at edge."
  [mouse-x mouse-y width height]
  (let [dx (cond
             (< mouse-x EDGE-MARGIN) -1
             (> mouse-x (- width EDGE-MARGIN)) 1
             :else 0)
        dy (cond
             (< mouse-y EDGE-MARGIN) -1
             (> mouse-y (- height EDGE-MARGIN)) 1
             :else 0)]
    [dx dy]))

(defn start-edge-pan!
  "Start edge panning if at edge."
  [l mouse-x mouse-y width height]
  (let [[dx dy] (compute-edge-direction mouse-x mouse-y width height)]
    (if (and (zero? dx) (zero? dy))
      ;; Not at edge - stop panning
      (stop-edge-pan!)
      ;; At edge - start or update
      (do
        (swap! edge-pan-state assoc
               :active true
               :direction [dx dy])
        (when (nil? (:timer-id @edge-pan-state))
          (let [timer-id (js/setInterval
                          (fn []
                            (let [now (js/Date.now)
                                  last (:last-time @edge-pan-state)
                                  dt (if last (- now last) EDGE-CHECK-INTERVAL)
                                  [dx dy] (:direction @edge-pan-state)
                                  speed (* PAN-SPEED dt)]
                              (swap! edge-pan-state assoc :last-time now)
                              ;; Pan in direction
                              (let [dim (:dim l)
                                    focus @(:focus l)
                                    tangent (M/make-vec dim)
                                    new-focus (M/make-vec dim)]
                                (M/zero-vec! tangent 0 dim)
                                (aset tangent 1 (* dx speed))
                                (aset tangent 2 (* dy speed))
                                (maps/exp! new-focus 0 focus 0 tangent 0 dim)
                                (lens/set-focus! l new-focus 0))))
                          EDGE-CHECK-INTERVAL)]
            (swap! edge-pan-state assoc :timer-id timer-id)))))))

(defn stop-edge-pan!
  "Stop edge panning."
  []
  (when-let [timer-id (:timer-id @edge-pan-state)]
    (js/clearInterval timer-id))
  (reset! edge-pan-state {:active false :direction [0 0] :timer-id nil :last-time nil}))

(defn is-edge-panning?
  "Check if edge panning is active."
  []
  (:active @edge-pan-state))

;; ════════════════════════════════════════════════════════════════════════════
;; URL STATE ENCODING
;; ════════════════════════════════════════════════════════════════════════════

(defn encode-float
  "Encode float to compact string."
  [f]
  (.toFixed f 4))

(defn decode-float
  "Decode float from string."
  [s]
  (js/parseFloat s))

(defn encode-view-state
  "Encode current view state to URL-safe string.

   Encodes:
   - Focus point (first 3 coords for compact URL)
   - Zoom level
   - Selected node name (if any)"
  [l ps selected-idx]
  (let [focus @(:focus l)
        scale (get-in l [:viewport :scale])
        parts [(encode-float (aget focus 0))
               (encode-float (aget focus 1))
               (encode-float (aget focus 2))
               (encode-float scale)]]
    ;; Add selected node name if any
    (if (and selected-idx (>= selected-idx 0))
      (let [name (ps/get-name ps selected-idx)]
        (str (clojure.string/join "," parts) ";" (js/encodeURIComponent name)))
      (clojure.string/join "," parts))))

(defn decode-view-state
  "Decode view state from URL string.

   Returns {:focus, :scale, :selected-name} or nil on error."
  [s dim]
  (try
    (let [[coords-str name-str] (clojure.string/split s #";")
          parts (clojure.string/split coords-str #",")
          focus (M/make-vec dim)]
      ;; Restore focus point
      (aset focus 0 (decode-float (nth parts 0)))
      (aset focus 1 (decode-float (nth parts 1)))
      (aset focus 2 (decode-float (nth parts 2)))
      ;; Normalize to hyperboloid
      (H/normalize-hyperboloid! focus 0 dim)

      {:focus focus
       :scale (decode-float (nth parts 3))
       :selected-name (when name-str (js/decodeURIComponent name-str))})
    (catch js/Error _
      nil)))

(defn update-url-state!
  "Update URL hash with current view state."
  [l ps selected-idx]
  (let [encoded (encode-view-state l ps selected-idx)]
    (set! (.-hash js/location) encoded)))

(defn read-url-state
  "Read view state from current URL hash."
  [dim]
  (let [hash (.-hash js/location)]
    (when (and hash (> (count hash) 1))
      (decode-view-state (subs hash 1) dim))))

(defn apply-url-state!
  "Apply URL state to lens and selection."
  [l ps dim]
  (when-let [state (read-url-state dim)]
    (when (:focus state)
      (lens/set-focus! l (:focus state) 0))
    (when (:scale state)
      (swap! l assoc-in [:viewport :scale] (:scale state)))
    (when-let [name (:selected-name state)]
      (when-let [idx (ps/find-by-name ps name)]
        (ps/set-flag! ps idx ps/FLAG-SELECTED)
        idx))))

(defn generate-share-link
  "Generate a shareable link with current view state."
  [l ps selected-idx]
  (let [base (.-origin js/location)
        path (.-pathname js/location)
        hash (encode-view-state l ps selected-idx)]
    (str base path "#" hash)))

;; ════════════════════════════════════════════════════════════════════════════
;; HOME POSITION MEMORY
;; ════════════════════════════════════════════════════════════════════════════

(def ^:const HOME-STORAGE-KEY "umbra:home-positions")

(defn save-home-position!
  "Save current view as home position for a space."
  [space-name l]
  (try
    (let [focus @(:focus l)
          scale (get-in l [:viewport :scale])
          stored (or (js->clj (js/JSON.parse
                                (.getItem js/localStorage HOME-STORAGE-KEY)))
                     {})
          updated (assoc stored space-name
                         {:focus [(aget focus 0) (aget focus 1) (aget focus 2)]
                          :scale scale})]
      (.setItem js/localStorage HOME-STORAGE-KEY
                (js/JSON.stringify (clj->js updated))))
    (catch js/Error e
      (js/console.warn "Could not save home position:" e))))

(defn load-home-position
  "Load saved home position for a space.

   Returns {:focus, :scale} or nil."
  [space-name dim]
  (try
    (when-let [stored (js/JSON.parse
                        (.getItem js/localStorage HOME-STORAGE-KEY))]
      (when-let [data (aget stored space-name)]
        (let [focus-arr (.-focus data)
              focus (M/make-vec dim)]
          (aset focus 0 (aget focus-arr 0))
          (aset focus 1 (aget focus-arr 1))
          (aset focus 2 (aget focus-arr 2))
          (H/normalize-hyperboloid! focus 0 dim)
          {:focus focus
           :scale (.-scale data)})))
    (catch js/Error _
      nil)))

(defn go-home!
  "Navigate to saved home position."
  [l space-name dim]
  (if-let [home (load-home-position space-name dim)]
    (do
      (anim/animate-focus! l (:focus home) 0 400 :easing :out-cubic)
      (anim/animate-zoom! l (:scale home) 400 :easing :out-cubic)
      true)
    ;; No home - go to origin
    (let [origin (M/origin-vec dim)]
      (anim/animate-focus! l origin 0 400 :easing :out-cubic)
      false)))
