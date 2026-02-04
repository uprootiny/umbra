(ns app.math.hn.animate
  "Smooth animation system for hyperbolic space.

   Animations in H^n follow geodesics, which requires proper
   interpolation using exp/log maps rather than naive lerp.

   Features:
   1. GEODESIC INTERPOLATION
      Points follow shortest paths on the manifold.

   2. EASING FUNCTIONS
      Standard easing curves applied to parameter t.

   3. SPRING PHYSICS
      For interactive feel, optional spring dynamics.

   4. ANIMATION QUEUE
      Multiple animations can run and chain.

   5. CANCELLATION
      Animations can be cancelled mid-flight."
  (:require [app.math.hn.minkowski :as M]
            [app.math.hn.hyperboloid :as H]
            [app.math.hn.maps :as maps]
            [app.math.hn.lens :as lens]
            [app.math.hn.pool :as pool]))

;; ════════════════════════════════════════════════════════════════════════════
;; EASING FUNCTIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn ease-linear [t] t)

(defn ease-in-quad [t] (* t t))

(defn ease-out-quad [t] (- 1 (* (- 1 t) (- 1 t))))

(defn ease-in-out-quad [t]
  (if (< t 0.5)
    (* 2 t t)
    (- 1 (/ (* (- (* -2 t) 2) (- (* -2 t) 2)) 2))))

(defn ease-in-cubic [t] (* t t t))

(defn ease-out-cubic [t]
  (let [t1 (- t 1)]
    (+ 1 (* t1 t1 t1))))

(defn ease-in-out-cubic [t]
  (if (< t 0.5)
    (* 4 t t t)
    (+ 1 (* (- (* 2 t) 2) (- (* 2 t) 2) (- (* 2 t) 2) 0.5))))

(defn ease-out-expo [t]
  (if (= t 1) 1 (- 1 (js/Math.pow 2 (* -10 t)))))

(defn ease-out-back [t]
  (let [c1 1.70158
        c3 (+ c1 1)
        t1 (- t 1)]
    (+ 1 (* c3 t1 t1 t1) (* c1 t1 t1))))

(defn ease-out-elastic [t]
  (let [c4 (/ (* 2 js/Math.PI) 3)]
    (cond
      (= t 0) 0
      (= t 1) 1
      :else (+ 1 (* (js/Math.pow 2 (* -10 t))
                    (js/Math.sin (* (- (* t 10) 0.75) c4)))))))

(def easings
  {:linear ease-linear
   :in-quad ease-in-quad
   :out-quad ease-out-quad
   :in-out-quad ease-in-out-quad
   :in-cubic ease-in-cubic
   :out-cubic ease-out-cubic
   :in-out-cubic ease-in-out-cubic
   :out-expo ease-out-expo
   :out-back ease-out-back
   :out-elastic ease-out-elastic})

;; ════════════════════════════════════════════════════════════════════════════
;; ANIMATION PRIMITIVES
;; ════════════════════════════════════════════════════════════════════════════

(defrecord Animation
  [id              ; Unique identifier
   start-time      ; When animation began
   duration        ; Total duration in ms
   easing          ; Easing function
   on-update       ; (t) → called each frame with eased t
   on-complete     ; () → called when done
   cancelled?])    ; Atom: has this been cancelled?

(defn make-animation
  "Create an animation.

   Args:
     duration: time in milliseconds
     on-update: (t) → side effect, t ∈ [0, 1] (eased)
     opts:
       :easing - keyword or function (default :out-cubic)
       :on-complete - called when animation finishes
       :id - identifier for cancellation"
  [duration on-update & {:keys [easing on-complete id]
                          :or {easing :out-cubic}}]
  (->Animation
   (or id (str (random-uuid)))
   nil  ; Set on start
   duration
   (if (keyword? easing) (get easings easing ease-out-cubic) easing)
   on-update
   on-complete
   (atom false)))

(defn start-animation!
  "Start an animation, returning it with start time set."
  [anim]
  (assoc anim :start-time (js/performance.now)))

(defn update-animation!
  "Update animation for current frame.

   Returns :running, :complete, or :cancelled."
  [anim now]
  (cond
    @(:cancelled? anim)
    :cancelled

    (nil? (:start-time anim))
    :pending

    :else
    (let [elapsed (- now (:start-time anim))
          t-raw (/ elapsed (:duration anim))
          t (min 1.0 t-raw)
          t-eased ((:easing anim) t)]
      ((:on-update anim) t-eased)
      (if (>= t 1.0)
        (do
          (when (:on-complete anim)
            ((:on-complete anim)))
          :complete)
        :running))))

(defn cancel-animation!
  "Cancel an animation."
  [anim]
  (reset! (:cancelled? anim) true))

;; ════════════════════════════════════════════════════════════════════════════
;; ANIMATION MANAGER
;; ════════════════════════════════════════════════════════════════════════════

(defonce animation-queue (atom []))
(defonce animation-frame-id (atom nil))

(defn- tick-animations!
  "Process one frame of animations."
  [now]
  (let [anims @animation-queue
        results (map #(update-animation! % now) anims)
        ;; Keep only running animations
        still-running (mapv first
                            (filter #(= :running (second %))
                                    (map vector anims results)))]
    (reset! animation-queue still-running)

    ;; Continue loop if animations remain
    (if (seq still-running)
      (reset! animation-frame-id
              (js/requestAnimationFrame tick-animations!))
      (reset! animation-frame-id nil))))

(defn- ensure-animation-loop!
  "Start animation loop if not already running."
  []
  (when (nil? @animation-frame-id)
    (reset! animation-frame-id
            (js/requestAnimationFrame tick-animations!))))

(defn animate!
  "Add and start an animation.

   Returns the animation for cancellation."
  [anim]
  (let [started (start-animation! anim)]
    (swap! animation-queue conj started)
    (ensure-animation-loop!)
    started))

(defn cancel-all!
  "Cancel all running animations."
  []
  (doseq [anim @animation-queue]
    (cancel-animation! anim))
  (reset! animation-queue []))

(defn cancel-by-id!
  "Cancel animation by ID."
  [id]
  (doseq [anim @animation-queue]
    (when (= (:id anim) id)
      (cancel-animation! anim))))

;; ════════════════════════════════════════════════════════════════════════════
;; HYPERBOLIC ANIMATIONS
;; ════════════════════════════════════════════════════════════════════════════

(defn animate-focus!
  "Animate lens focus to a target point.

   The focus follows a geodesic in H^n."
  [l target-point ot duration & {:keys [easing on-complete]
                                  :or {easing :out-cubic}}]
  (let [dim (:dim l)
        start-focus (js/Float32Array. (inc dim))
        _ (M/copy-vec! start-focus 0 @(:focus l) 0 dim)
        interp (pool/acquire-vec dim)]

    (animate!
     (make-animation
      duration
      (fn [t]
        ;; Geodesic interpolation
        (H/geodesic-lerp! interp 0 start-focus 0 target-point ot t dim)
        (lens/set-focus! l interp 0))
      :easing easing
      :on-complete (fn []
                     (pool/release-vec interp)
                     (when on-complete (on-complete)))
      :id "focus-animation"))))

(defn animate-zoom!
  "Animate zoom level."
  [l target-scale duration & {:keys [easing on-complete]
                               :or {easing :out-cubic}}]
  (let [start-scale (get-in l [:viewport :scale])]
    (animate!
     (make-animation
      duration
      (fn [t]
        (let [new-scale (+ start-scale (* t (- target-scale start-scale)))]
          (swap! (.-viewport l) assoc :scale new-scale)))
      :easing easing
      :on-complete on-complete
      :id "zoom-animation"))))

(defn animate-point-to!
  "Animate a point to a target position.

   Moves along geodesic in H^n."
  [ps idx target-point ot duration & {:keys [easing on-complete]
                                        :or {easing :out-cubic}}]
  (let [dim (:dim ps)
        stride (:stride ps)
        coords (:coords ps)
        off (* idx stride)
        start-pos (pool/acquire-vec dim)
        _ (M/copy-vec! start-pos 0 coords off dim)
        interp (pool/acquire-vec dim)]

    (animate!
     (make-animation
      duration
      (fn [t]
        (H/geodesic-lerp! interp 0 start-pos 0 target-point ot t dim)
        (M/copy-vec! coords off interp 0 dim))
      :easing easing
      :on-complete (fn []
                     (pool/release-vec start-pos)
                     (pool/release-vec interp)
                     (when on-complete (on-complete)))
      :id (str "point-" idx "-animation")))))

;; ════════════════════════════════════════════════════════════════════════════
;; SPRING DYNAMICS
;; ════════════════════════════════════════════════════════════════════════════

(defrecord Spring
  [position    ; Current value
   velocity    ; Current velocity
   target      ; Target value
   stiffness   ; Spring constant (higher = faster)
   damping     ; Damping ratio (1 = critical, <1 = bouncy)
   precision]) ; Stop when within this of target

(defn make-spring
  "Create a spring for smooth value animation."
  [initial target & {:keys [stiffness damping precision]
                      :or {stiffness 200
                           damping 0.8
                           precision 0.001}}]
  (->Spring initial 0 target stiffness damping precision))

(defn spring-step
  "Advance spring by dt seconds.

   Returns [new-spring settled?]"
  [spring dt]
  (let [{:keys [position velocity target stiffness damping precision]} spring
        ;; Spring force: F = -k * (x - target)
        displacement (- position target)
        spring-force (* (- stiffness) displacement)
        ;; Damping force: F = -c * v
        damping-force (* (- (* 2 (js/Math.sqrt stiffness) damping)) velocity)
        ;; Acceleration
        acceleration (+ spring-force damping-force)
        ;; Integration (semi-implicit Euler)
        new-velocity (+ velocity (* acceleration dt))
        new-position (+ position (* new-velocity dt))
        ;; Check if settled
        settled? (and (< (js/Math.abs (- new-position target)) precision)
                      (< (js/Math.abs new-velocity) precision))]
    [(->Spring new-position new-velocity target stiffness damping precision)
     settled?]))

(defn animate-spring!
  "Run spring animation until settled."
  [initial target on-update & {:keys [stiffness damping on-complete]
                                :or {stiffness 200 damping 0.8}}]
  (let [spring (atom (make-spring initial target :stiffness stiffness :damping damping))
        last-time (atom nil)]
    (animate!
     (make-animation
      10000  ; Max duration
      (fn [_]
        (let [now (js/performance.now)
              dt (if @last-time
                   (/ (- now @last-time) 1000)
                   0.016)
              [new-spring settled?] (spring-step @spring (min dt 0.033))]
          (reset! last-time now)
          (reset! spring new-spring)
          (on-update (:position new-spring))
          (when settled?
            ;; Complete early
            (on-update target))))
      :easing ease-linear
      :on-complete on-complete
      :id "spring-animation"))))

;; ════════════════════════════════════════════════════════════════════════════
;; ANIMATION SEQUENCES
;; ════════════════════════════════════════════════════════════════════════════

(defn sequence!
  "Run animations in sequence.

   animations: vector of (fn [] → animation) thunks"
  [animations & {:keys [on-complete]}]
  (let [remaining (atom animations)]
    (letfn [(run-next []
              (if (empty? @remaining)
                (when on-complete (on-complete))
                (let [next-fn (first @remaining)]
                  (swap! remaining rest)
                  (let [anim (next-fn)]
                    (swap! anim assoc :on-complete run-next)
                    (animate! anim)))))]
      (run-next))))

(defn parallel!
  "Run animations in parallel.

   on-complete called when all finish."
  [animations & {:keys [on-complete]}]
  (let [count (atom (count animations))
        check-done (fn []
                     (swap! count dec)
                     (when (zero? @count)
                       (when on-complete (on-complete))))]
    (doseq [anim-fn animations]
      (let [anim (anim-fn)]
        (let [orig-complete (:on-complete anim)]
          (animate! (assoc anim :on-complete
                           (fn []
                             (when orig-complete (orig-complete))
                             (check-done)))))))))
