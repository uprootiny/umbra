(ns app.ui.touch
  "Touch and gesture support for mobile devices.

   Provides:
   1. PINCH-TO-ZOOM
      Two-finger pinch scales the view.

   2. PAN GESTURE
      Single finger drag pans the view.

   3. TAP GESTURES
      Single tap selects, double tap focuses.

   4. LONG PRESS
      Shows context menu.

   Performance:
   - Uses passive event listeners
   - Minimal state tracking
   - RAF-throttled updates"
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.maps :as maps]))

;; ════════════════════════════════════════════════════════════════════════════
;; TOUCH STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce touch-state
  (atom {:active false
         :gesture nil         ; :pan :pinch :tap :long-press
         :start-time nil
         :touches []          ; Active touch points
         :initial-touches []  ; Touch positions at gesture start
         :initial-scale nil   ; Scale at pinch start
         :initial-focus nil   ; Focus at pan start
         :tap-timer nil       ; For double-tap detection
         :long-press-timer nil
         :last-tap-time 0}))

(def ^:const TAP-THRESHOLD 10)      ; Max movement for tap
(def ^:const DOUBLE-TAP-DELAY 300)  ; ms between taps
(def ^:const LONG-PRESS-DELAY 500)  ; ms for long press

;; ════════════════════════════════════════════════════════════════════════════
;; TOUCH UTILITIES
;; ════════════════════════════════════════════════════════════════════════════

(defn touch-distance
  "Get distance between two touch points."
  [[t1 t2]]
  (let [dx (- (:x t2) (:x t1))
        dy (- (:y t2) (:y t1))]
    (js/Math.sqrt (+ (* dx dx) (* dy dy)))))

(defn touch-center
  "Get center point of touches."
  [touches]
  (let [n (count touches)
        sum-x (reduce + 0 (map :x touches))
        sum-y (reduce + 0 (map :y touches))]
    {:x (/ sum-x n)
     :y (/ sum-y n)}))

(defn extract-touches
  "Extract touch points from event."
  [event]
  (->> (.-touches event)
       (array-seq)
       (map (fn [t]
              {:id (.-identifier t)
               :x (.-clientX t)
               :y (.-clientY t)}))
       vec))

;; ════════════════════════════════════════════════════════════════════════════
;; GESTURE DETECTION
;; ════════════════════════════════════════════════════════════════════════════

(defn detect-gesture
  "Detect gesture type from touch state."
  [touches prev-touches]
  (cond
    ;; Two fingers = pinch
    (= (count touches) 2)
    :pinch

    ;; One finger moving = pan
    (and (= (count touches) 1)
         (= (count prev-touches) 1))
    :pan

    ;; One finger stationary = potential tap/long-press
    (= (count touches) 1)
    :potential-tap

    :else nil))

;; ════════════════════════════════════════════════════════════════════════════
;; TOUCH START
;; ════════════════════════════════════════════════════════════════════════════

(defn handle-touch-start!
  "Handle touchstart event.

   Args:
     event: touch event
     l: current lens (for capturing initial state)
     on-long-press: callback for long press"
  [event l on-long-press]
  (let [touches (extract-touches event)
        now (js/Date.now)]
    ;; Cancel any pending long press
    (when-let [timer (:long-press-timer @touch-state)]
      (js/clearTimeout timer))

    (swap! touch-state assoc
           :active true
           :touches touches
           :initial-touches touches
           :start-time now
           :initial-scale (get-in l [:viewport :scale])
           :initial-focus @(:focus l))

    ;; Set up long press detection for single touch
    (when (and (= (count touches) 1) on-long-press)
      (let [timer (js/setTimeout
                   (fn []
                     (when (and (:active @touch-state)
                                (nil? (:gesture @touch-state)))
                       (let [[t] (:touches @touch-state)
                             [it] (:initial-touches @touch-state)
                             dx (- (:x t) (:x it))
                             dy (- (:y t) (:y it))
                             dist (js/Math.sqrt (+ (* dx dx) (* dy dy)))]
                         (when (< dist TAP-THRESHOLD)
                           (swap! touch-state assoc :gesture :long-press)
                           (on-long-press (:x t) (:y t))))))
                   LONG-PRESS-DELAY)]
        (swap! touch-state assoc :long-press-timer timer)))))

;; ════════════════════════════════════════════════════════════════════════════
;; TOUCH MOVE
;; ════════════════════════════════════════════════════════════════════════════

(defn handle-touch-move!
  "Handle touchmove event.

   Args:
     event: touch event
     l: lens to update
     update-fn: function to call when view changes

   Returns {:gesture, :delta} or nil."
  [event l update-fn]
  ;; Cancel long press on move
  (when-let [timer (:long-press-timer @touch-state)]
    (js/clearTimeout timer)
    (swap! touch-state assoc :long-press-timer nil))

  (when (:active @touch-state)
    (let [touches (extract-touches event)
          prev-touches (:touches @touch-state)
          initial-touches (:initial-touches @touch-state)
          gesture (or (:gesture @touch-state)
                      (detect-gesture touches prev-touches))]

      ;; Update state
      (swap! touch-state assoc
             :touches touches
             :gesture gesture)

      (case gesture
        :pinch
        (when (= (count touches) 2)
          (let [initial-dist (touch-distance initial-touches)
                current-dist (touch-distance touches)
                scale-factor (/ current-dist initial-dist)
                initial-scale (:initial-scale @touch-state)
                new-scale (* initial-scale scale-factor)]
            ;; Update lens scale
            (when update-fn
              (update-fn :zoom new-scale))
            {:gesture :pinch :scale new-scale}))

        :pan
        (when (= (count touches) 1)
          (let [[t] touches
                [it] initial-touches
                dx (- (:x t) (:x it))
                dy (- (:y t) (:y it))
                ;; Convert to hyperbolic motion
                dim (:dim l)
                scale (get-in l [:viewport :scale])
                chart-dx (/ (- dx) scale)
                chart-dy (/ dy scale)
                initial-focus (:initial-focus @touch-state)
                tangent (M/make-vec dim)
                new-focus (M/make-vec dim)]
            (M/zero-vec! tangent 0 dim)
            (aset tangent 1 chart-dx)
            (aset tangent 2 chart-dy)
            (maps/exp! new-focus 0 initial-focus 0 tangent 0 dim)
            ;; Update lens focus
            (when update-fn
              (update-fn :pan new-focus))
            {:gesture :pan :dx dx :dy dy}))

        nil))))

;; ════════════════════════════════════════════════════════════════════════════
;; TOUCH END
;; ════════════════════════════════════════════════════════════════════════════

(defn handle-touch-end!
  "Handle touchend event.

   Args:
     event: touch event
     on-tap: callback for tap (x, y)
     on-double-tap: callback for double tap (x, y)

   Returns {:gesture, :position} or nil."
  [event on-tap on-double-tap]
  ;; Cancel long press timer
  (when-let [timer (:long-press-timer @touch-state)]
    (js/clearTimeout timer))

  (let [touches (extract-touches event)
        {:keys [gesture initial-touches start-time last-tap-time]} @touch-state
        now (js/Date.now)
        duration (- now start-time)]

    ;; All fingers lifted
    (when (empty? touches)
      (let [result
            (cond
              ;; Already detected gesture
              (#{:pan :pinch :long-press} gesture)
              {:gesture gesture}

              ;; Quick tap
              (and (= (count initial-touches) 1)
                   (< duration 300))
              (let [[t] initial-touches
                    ;; Check for double tap
                    is-double? (< (- now last-tap-time) DOUBLE-TAP-DELAY)]
                (if is-double?
                  (do
                    (when on-double-tap
                      (on-double-tap (:x t) (:y t)))
                    {:gesture :double-tap :x (:x t) :y (:y t)})
                  (do
                    (when on-tap
                      (on-tap (:x t) (:y t)))
                    (swap! touch-state assoc :last-tap-time now)
                    {:gesture :tap :x (:x t) :y (:y t)})))

              :else nil)]

        ;; Reset state
        (reset! touch-state
                {:active false
                 :gesture nil
                 :touches []
                 :initial-touches []
                 :initial-scale nil
                 :initial-focus nil
                 :tap-timer nil
                 :long-press-timer nil
                 :last-tap-time (or (:last-tap-time @touch-state) 0)})

        result))))

;; ════════════════════════════════════════════════════════════════════════════
;; EVENT INSTALLATION
;; ════════════════════════════════════════════════════════════════════════════

(defn install-touch-handlers!
  "Install touch event handlers on element.

   Args:
     element: DOM element
     l: lens atom
     callbacks: {:on-tap, :on-double-tap, :on-long-press, :on-update}

   Returns cleanup function."
  [element l callbacks]
  (let [{:keys [on-tap on-double-tap on-long-press on-update]} callbacks

        start-handler
        (fn [e]
          (handle-touch-start! e @l on-long-press))

        move-handler
        (fn [e]
          (.preventDefault e)
          (handle-touch-move! e @l on-update))

        end-handler
        (fn [e]
          (handle-touch-end! e on-tap on-double-tap))

        cancel-handler
        (fn [_]
          (reset! touch-state
                  {:active false
                   :gesture nil
                   :touches []
                   :initial-touches []
                   :last-tap-time (:last-tap-time @touch-state)}))]

    ;; Add listeners (passive where possible for performance)
    (.addEventListener element "touchstart" start-handler #js {:passive true})
    (.addEventListener element "touchmove" move-handler #js {:passive false})
    (.addEventListener element "touchend" end-handler #js {:passive true})
    (.addEventListener element "touchcancel" cancel-handler #js {:passive true})

    ;; Return cleanup
    (fn []
      (.removeEventListener element "touchstart" start-handler)
      (.removeEventListener element "touchmove" move-handler)
      (.removeEventListener element "touchend" end-handler)
      (.removeEventListener element "touchcancel" cancel-handler))))

;; ════════════════════════════════════════════════════════════════════════════
;; GESTURE QUERIES
;; ════════════════════════════════════════════════════════════════════════════

(defn is-touching?
  "Check if touch is active."
  []
  (:active @touch-state))

(defn current-gesture
  "Get current gesture type."
  []
  (:gesture @touch-state))

(defn touch-count
  "Get number of active touches."
  []
  (count (:touches @touch-state)))

