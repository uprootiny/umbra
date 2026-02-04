(ns app.ui.style
  "Node styling system for visual customization.

   Provides:
   1. PER-NODE STYLES
      Color, size, shape overrides per node.

   2. DEPTH-BASED STYLING
      Automatic color gradients by depth.

   3. MOTIF/TAG STYLING
      Style rules based on motif or tags.

   4. SELECTION/FOCUS STYLES
      Visual feedback for interaction states.

   Performance:
   - Precomputed style lookups
   - Efficient typed array storage for hot path
   - Lazy style resolution"
  (:require [app.math.hn.pointset :as ps]))

;; ════════════════════════════════════════════════════════════════════════════
;; STYLE RECORDS
;; ════════════════════════════════════════════════════════════════════════════

(defrecord NodeStyle
  [fill           ; Fill color (CSS string or nil for default)
   stroke         ; Stroke color
   stroke-width   ; Stroke width
   radius-scale   ; Multiplier for node radius
   shape          ; :circle :square :diamond :triangle
   opacity        ; 0-1
   glow           ; Glow effect {:color :radius :intensity}
   label-style])  ; {:color :size :font :position}

(def default-node-style
  (->NodeStyle
   nil           ; fill - use depth-based
   "#4a4a5a"    ; stroke
   1.0          ; stroke-width
   1.0          ; radius-scale
   :circle      ; shape
   1.0          ; opacity
   nil          ; glow
   nil))        ; label-style

;; ════════════════════════════════════════════════════════════════════════════
;; STYLE STATE
;; ════════════════════════════════════════════════════════════════════════════

(defonce style-state
  (atom {:node-overrides {}     ; idx -> NodeStyle overrides
         :motif-styles {}       ; motif-id -> NodeStyle
         :tag-styles {}         ; tag-string -> NodeStyle
         :depth-palette nil     ; Custom depth color palette
         :theme :dark}))        ; :dark or :light

;; ════════════════════════════════════════════════════════════════════════════
;; COLOR PALETTES
;; ════════════════════════════════════════════════════════════════════════════

(def depth-palettes
  {:dark
   {:base-hue 220
    :saturation 50
    :lightness-range [45 25]  ; Near to far
    :hue-shift 45}            ; Hue shift per depth

   :light
   {:base-hue 220
    :saturation 60
    :lightness-range [40 60]
    :hue-shift 45}

   :warm
   {:base-hue 30
    :saturation 70
    :lightness-range [50 30]
    :hue-shift 30}

   :cool
   {:base-hue 200
    :saturation 60
    :lightness-range [50 30]
    :hue-shift 20}

   :rainbow
   {:base-hue 0
    :saturation 65
    :lightness-range [50 40]
    :hue-shift 60}

   :mono
   {:base-hue 0
    :saturation 0
    :lightness-range [60 30]
    :hue-shift 0}})

(def selection-colors
  {:selected "#60a0ff"
   :focused "#80ffff"
   :hovered "#ffffff20"
   :drop-target "#60ff60"})

(def interaction-glows
  {:selected {:color "#60a0ff" :radius 8 :intensity 0.4}
   :focused {:color "#80ffff" :radius 12 :intensity 0.6}
   :hovered {:color "#ffffff" :radius 4 :intensity 0.2}})

;; ════════════════════════════════════════════════════════════════════════════
;; DEPTH-BASED COLORING
;; ════════════════════════════════════════════════════════════════════════════

(defn depth-color
  "Get color for a given depth.

   Args:
     depth: tree depth (0 = root)
     palette-key: :dark :light :warm :cool :rainbow :mono

   Returns CSS HSL color string."
  [depth palette-key]
  (let [palette (get depth-palettes palette-key (:dark depth-palettes))
        {:keys [base-hue saturation lightness-range hue-shift]} palette
        [l-near l-far] lightness-range
        ;; Hue shifts with depth
        hue (mod (+ base-hue (* depth hue-shift)) 360)
        ;; Lightness decreases with depth (capped)
        lightness (max l-far (- l-near (* depth 3)))]
    (str "hsl(" hue ", " saturation "%, " lightness "%)")))

(defn set-depth-palette!
  "Set the depth color palette."
  [palette-key]
  (swap! style-state assoc :depth-palette palette-key))

;; ════════════════════════════════════════════════════════════════════════════
;; STYLE OVERRIDES
;; ════════════════════════════════════════════════════════════════════════════

(defn set-node-style!
  "Set style override for a specific node.

   Args:
     idx: node index
     style-map: partial style map {:fill, :stroke, etc}"
  [idx style-map]
  (swap! style-state update :node-overrides assoc idx style-map))

(defn clear-node-style!
  "Clear style override for a node."
  [idx]
  (swap! style-state update :node-overrides dissoc idx))

(defn set-motif-style!
  "Set style for a motif ID.

   All nodes with this motif will inherit the style."
  [motif-id style-map]
  (swap! style-state update :motif-styles assoc motif-id style-map))

(defn set-tag-style!
  "Set style for nodes with a specific tag."
  [tag style-map]
  (swap! style-state update :tag-styles assoc tag style-map))

;; ════════════════════════════════════════════════════════════════════════════
;; STYLE RESOLUTION
;; ════════════════════════════════════════════════════════════════════════════

(defn resolve-node-style
  "Resolve full style for a node.

   Priority: node override > motif style > tag style > depth default

   Args:
     ps: pointset
     idx: node index
     flags: node flags (for selection state)

   Returns merged NodeStyle."
  [ps idx flags]
  (let [{:keys [node-overrides motif-styles tag-styles depth-palette theme]} @style-state
        depth (ps/get-depth ps idx)
        motif (aget (:motif ps) idx)
        meta (ps/get-meta ps idx)
        tags (get meta :tags [])

        ;; Base depth color
        palette (or depth-palette theme :dark)
        base-fill (depth-color depth palette)

        ;; Layer styles (last wins)
        tag-style (some #(get tag-styles %) tags)
        motif-style (get motif-styles motif)
        node-style (get node-overrides idx)

        ;; Merge
        merged (merge {:fill base-fill}
                      (when tag-style tag-style)
                      (when motif-style motif-style)
                      (when node-style node-style))

        ;; Selection state overrides
        is-selected? (not (zero? (bit-and flags ps/FLAG-SELECTED)))
        is-focused? (not (zero? (bit-and flags ps/FLAG-FOCUS)))

        final-fill (cond
                     is-selected? (:selected selection-colors)
                     is-focused? (:focused selection-colors)
                     :else (:fill merged))

        final-glow (cond
                     is-focused? (:focused interaction-glows)
                     is-selected? (:selected interaction-glows)
                     :else (:glow merged))]

    (map->NodeStyle
     (merge default-node-style
            merged
            {:fill final-fill
             :glow final-glow}))))

;; ════════════════════════════════════════════════════════════════════════════
;; BATCH STYLE COMPUTATION
;; ════════════════════════════════════════════════════════════════════════════

(defn compute-batch-colors!
  "Compute colors for a batch of nodes.

   Fills the provided typed arrays with color data.

   Args:
     ps: pointset
     indices: array of node indices
     count: number of nodes
     out-r, out-g, out-b, out-a: Uint8Array outputs"
  [ps indices n out-r out-g out-b out-a]
  (let [{:keys [depth-palette theme]} @style-state
        palette (or depth-palette theme :dark)
        flags (:flags ps)
        depths (:depth ps)]
    (loop [i 0]
      (when (< i n)
        (let [idx (aget indices i)
              depth (aget depths idx)
              f (aget flags idx)
              is-selected? (not (zero? (bit-and f ps/FLAG-SELECTED)))
              is-focused? (not (zero? (bit-and f ps/FLAG-FOCUS)))
              ;; Fast path for common cases
              [r g b a] (cond
                          is-focused? [128 255 255 255]
                          is-selected? [96 160 255 255]
                          :else
                          ;; Depth-based color (simplified HSL→RGB)
                          (let [palette-data (get depth-palettes palette)
                                {:keys [base-hue saturation lightness-range hue-shift]} palette-data
                                [l-near l-far] lightness-range
                                hue (mod (+ base-hue (* depth hue-shift)) 360)
                                light (max l-far (- l-near (* depth 3)))
                                ;; Simplified HSL to RGB
                                c (/ (* saturation (- 100 (js/Math.abs (- (* 2 light) 100)))) 10000)
                                x (* c (- 1 (js/Math.abs (- (mod (/ hue 60) 2) 1))))
                                m (- (/ light 100) (/ c 2))
                                [r' g' b'] (cond
                                             (< hue 60) [c x 0]
                                             (< hue 120) [x c 0]
                                             (< hue 180) [0 c x]
                                             (< hue 240) [0 x c]
                                             (< hue 300) [x 0 c]
                                             :else [c 0 x])]
                            [(js/Math.round (* 255 (+ r' m)))
                             (js/Math.round (* 255 (+ g' m)))
                             (js/Math.round (* 255 (+ b' m)))
                             255]))]
          (aset out-r i r)
          (aset out-g i g)
          (aset out-b i b)
          (aset out-a i a))
        (recur (inc i))))))

;; ════════════════════════════════════════════════════════════════════════════
;; EDGE STYLING
;; ════════════════════════════════════════════════════════════════════════════

(defn edge-style
  "Get style for an edge.

   Args:
     from-depth: depth of parent
     to-depth: depth of child
     selected?: is edge part of selection

   Returns {:color, :width, :opacity, :dash}"
  [from-depth to-depth selected?]
  (let [base-color (if selected? "#60a0ff" "#3a3a4a")
        width (if selected? 2 1)
        ;; Fade edges at greater depth
        opacity (max 0.3 (- 1.0 (* 0.1 (max from-depth to-depth))))]
    {:color base-color
     :width width
     :opacity opacity
     :dash nil}))

;; ════════════════════════════════════════════════════════════════════════════
;; THEME MANAGEMENT
;; ════════════════════════════════════════════════════════════════════════════

(defn set-theme!
  "Set overall theme."
  [theme-key]
  (swap! style-state assoc :theme theme-key))

(defn get-theme
  "Get current theme."
  []
  (:theme @style-state))

(defn get-background-color
  "Get background color for current theme."
  []
  (case (:theme @style-state)
    :light "#f8f8f8"
    :dark "#0d0d14"
    "#0d0d14"))

(defn get-grid-color
  "Get grid color for current theme."
  []
  (case (:theme @style-state)
    :light "#e0e0e0"
    :dark "#1a1a24"
    "#1a1a24"))

