(ns app.ui.export
  "Export functionality for the hyperbolic workspace.

   Provides:
   1. SCREENSHOT TO PNG
      Capture canvas as PNG image with optional scaling.

   2. EXPORT TO SVG
      Vector export for print-quality output.

   3. MARKDOWN EXPORT
      Export tree structure as nested markdown list.

   4. MERMAID EXPORT
      Generate Mermaid diagram syntax.

   All exports happen client-side with no server round-trip."
  (:require [app.math.hn.pointset :as ps]))

;; ════════════════════════════════════════════════════════════════════════════
;; PNG SCREENSHOT
;; ════════════════════════════════════════════════════════════════════════════

(defn capture-canvas-to-png
  "Capture canvas contents as PNG data URL.

   Args:
     canvas: the canvas element
     scale: optional scale factor (default 1)

   Returns data URL string."
  [canvas & {:keys [scale background] :or {scale 1 background "#0d0d14"}}]
  (if (= scale 1)
    ;; Simple case - just get data URL
    (.toDataURL canvas "image/png")
    ;; Scaled - need to create temp canvas
    (let [temp (js/document.createElement "canvas")
          ctx (.getContext temp "2d")
          w (* (.-width canvas) scale)
          h (* (.-height canvas) scale)]
      (set! (.-width temp) w)
      (set! (.-height temp) h)
      ;; Fill background
      (set! (.-fillStyle ctx) background)
      (.fillRect ctx 0 0 w h)
      ;; Draw scaled
      (.scale ctx scale scale)
      (.drawImage ctx canvas 0 0)
      (.toDataURL temp "image/png"))))

(defn download-png!
  "Download canvas as PNG file."
  [canvas filename & opts]
  (let [data-url (apply capture-canvas-to-png canvas opts)
        a (js/document.createElement "a")]
    (set! (.-href a) data-url)
    (set! (.-download a) (or filename "umbra-screenshot.png"))
    (.click a)))

(defn copy-to-clipboard!
  "Copy canvas to clipboard as PNG.

   Note: Requires clipboard API support."
  [canvas]
  (-> (.toBlob canvas
               (fn [blob]
                 (let [item (js/ClipboardItem. #js {"image/png" blob})]
                   (-> (js/navigator.clipboard.write #js [item])
                       (.then #(js/console.log "Copied to clipboard"))
                       (.catch #(js/console.error "Clipboard error:" %)))))
               "image/png")))

;; ════════════════════════════════════════════════════════════════════════════
;; SVG EXPORT
;; ════════════════════════════════════════════════════════════════════════════

(defn batch-to-svg
  "Convert render batch to SVG string.

   Args:
     batch: render batch with projected data
     width, height: SVG dimensions
     opts: styling options"
  [batch width height & {:keys [background node-stroke edge-color]
                          :or {background "#0d0d14"
                               node-stroke "#4a4a5a"
                               edge-color "#3a3a4a"}}]
  (let [n @(:render-count batch)
        order (:render-order batch)
        sx (:screen-x batch)
        sy (:screen-y batch)
        rad (:radius batch)
        depths (:depth batch)
        flags (:flags batch)
        edge-count @(:edge-count batch)
        ;; Build SVG
        parts (transient [(str "<svg xmlns=\"http://www.w3.org/2000/svg\" "
                               "width=\"" width "\" height=\"" height "\" "
                               "viewBox=\"0 0 " width " " height "\">\n")
                          (str "<rect width=\"100%\" height=\"100%\" fill=\"" background "\"/>\n")
                          "<g id=\"edges\">\n"])]

    ;; Edges
    (when (and (:edge-x1 batch) (pos? edge-count))
      (let [ex1 (:edge-x1 batch)
            ey1 (:edge-y1 batch)
            ex2 (:edge-x2 batch)
            ey2 (:edge-y2 batch)]
        (loop [i 0]
          (when (< i edge-count)
            (conj! parts (str "<line x1=\"" (aget ex1 i) "\" y1=\"" (aget ey1 i)
                              "\" x2=\"" (aget ex2 i) "\" y2=\"" (aget ey2 i)
                              "\" stroke=\"" edge-color "\" stroke-width=\"1\"/>\n"))
            (recur (inc i))))))

    (conj! parts "</g>\n<g id=\"nodes\">\n")

    ;; Nodes
    (loop [i 0]
      (when (< i n)
        (let [idx (aget order i)
              x (aget sx idx)
              y (aget sy idx)
              r (aget rad idx)
              d (aget depths idx)
              f (aget flags idx)
              selected? (not (zero? (bit-and f 4)))
              ;; Color based on depth
              hue (mod (* d 45) 360)
              fill (if selected?
                     "#60a0ff"
                     (str "hsl(" hue ", 50%, 45%)"))]
          (conj! parts (str "<circle cx=\"" x "\" cy=\"" y "\" r=\"" r
                            "\" fill=\"" fill "\" stroke=\"" node-stroke
                            "\" stroke-width=\"1\"/>\n")))
        (recur (inc i))))

    (conj! parts "</g>\n</svg>")
    (apply str (persistent! parts))))

(defn download-svg!
  "Download current view as SVG file."
  [batch width height filename]
  (let [svg (batch-to-svg batch width height)
        blob (js/Blob. #js [svg] #js {:type "image/svg+xml"})
        url (js/URL.createObjectURL blob)
        a (js/document.createElement "a")]
    (set! (.-href a) url)
    (set! (.-download a) (or filename "umbra-export.svg"))
    (.click a)
    (js/URL.revokeObjectURL url)))

;; ════════════════════════════════════════════════════════════════════════════
;; MARKDOWN EXPORT
;; ════════════════════════════════════════════════════════════════════════════

(defn subtree-to-markdown
  "Export subtree as nested markdown list.

   Args:
     ps: pointset
     root-idx: root of subtree (or nil for all roots)
     opts: {:include-content, :max-depth}"
  [ps root-idx & {:keys [include-content max-depth]
                   :or {include-content false max-depth 100}}]
  (let [sb (js/Array.)]
    (letfn [(emit [idx depth]
              (when (<= depth max-depth)
                (let [indent (apply str (repeat (* depth 2) " "))
                      meta (ps/get-meta ps idx)
                      name (or (:name meta) (str "node-" idx))
                      line (str indent "- " name)]
                  (.push sb line)
                  ;; Optionally include content
                  (when (and include-content (:content meta))
                    (.push sb (str indent "  " (:content meta))))
                  ;; Recurse to children
                  (doseq [child (ps/get-children ps idx)]
                    (emit child (inc depth))))))]
      (if root-idx
        (emit root-idx 0)
        ;; All roots
        (doseq [i (range @(:count ps))]
          (when (= (ps/get-parent ps i) -1)
            (emit i 0)))))
    (.join sb "\n")))

(defn download-markdown!
  "Download subtree as markdown file."
  [ps root-idx filename & opts]
  (let [md (apply subtree-to-markdown ps root-idx opts)
        blob (js/Blob. #js [md] #js {:type "text/markdown"})
        url (js/URL.createObjectURL blob)
        a (js/document.createElement "a")]
    (set! (.-href a) url)
    (set! (.-download a) (or filename "umbra-export.md"))
    (.click a)
    (js/URL.revokeObjectURL url)))

;; ════════════════════════════════════════════════════════════════════════════
;; MERMAID EXPORT
;; ════════════════════════════════════════════════════════════════════════════

(defn sanitize-mermaid-id
  "Sanitize a name for use as Mermaid node ID."
  [s]
  (-> s
      (clojure.string/replace #"[^a-zA-Z0-9_]" "_")
      (clojure.string/replace #"^[0-9]" "_$0")))

(defn subtree-to-mermaid
  "Export subtree as Mermaid flowchart syntax.

   Args:
     ps: pointset
     root-idx: root of subtree
     direction: TB, BT, LR, RL"
  [ps root-idx & {:keys [direction] :or {direction "TB"}}]
  (let [lines (transient [(str "flowchart " direction)])]
    (letfn [(emit [idx]
              (let [meta (ps/get-meta ps idx)
                    name (or (:name meta) (str "node-" idx))
                    id (sanitize-mermaid-id name)]
                ;; Node definition
                (conj! lines (str "    " id "[\"" name "\"]"))
                ;; Edges to children
                (doseq [child (ps/get-children ps idx)]
                  (let [child-meta (ps/get-meta ps child)
                        child-name (or (:name child-meta) (str "node-" child))
                        child-id (sanitize-mermaid-id child-name)]
                    (conj! lines (str "    " id " --> " child-id))))
                ;; Recurse
                (doseq [child (ps/get-children ps idx)]
                  (emit child))))]
      (if root-idx
        (emit root-idx)
        ;; All roots
        (doseq [i (range @(:count ps))]
          (when (= (ps/get-parent ps i) -1)
            (emit i)))))
    (clojure.string/join "\n" (persistent! lines))))

(defn copy-mermaid-to-clipboard!
  "Copy Mermaid diagram syntax to clipboard."
  [ps root-idx]
  (let [mermaid (subtree-to-mermaid ps root-idx)]
    (-> (js/navigator.clipboard.writeText mermaid)
        (.then #(js/console.log "Mermaid copied to clipboard"))
        (.catch #(js/console.error "Clipboard error:" %)))))
