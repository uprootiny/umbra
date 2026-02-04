(ns app.render.webgl
  "WebGL renderer for GPU-accelerated hyperbolic visualization.

   Uses instanced rendering for efficient drawing of many nodes:
   - Single draw call for all nodes at same LOD
   - GPU-side computation of node appearance
   - Minimal CPU-GPU data transfer

   Shaders handle:
   - Circle/node rendering with anti-aliasing
   - Edge rendering with proper blending
   - Focus ring and selection highlights
   - LOD-based sizing"
  (:require [app.math.hn.batch :as batch]))

;; ════════════════════════════════════════════════════════════════════════════
;; SHADER SOURCES
;; ════════════════════════════════════════════════════════════════════════════

(def node-vertex-shader
  "
  #version 300 es
  precision highp float;

  // Per-vertex (quad corners)
  in vec2 a_corner;

  // Per-instance (node data)
  in vec2 a_position;   // Screen position
  in float a_radius;    // Node radius
  in float a_depth;     // Tree depth (for coloring)
  in float a_flags;     // Selection/focus flags

  // Uniforms
  uniform vec2 u_resolution;

  // Outputs to fragment shader
  out vec2 v_uv;
  out float v_radius;
  out float v_depth;
  out float v_flags;

  void main() {
    // Expand corner by radius
    vec2 worldPos = a_position + a_corner * a_radius;

    // Convert to clip space
    vec2 clipPos = (worldPos / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;  // Flip Y for screen coords

    gl_Position = vec4(clipPos, 0.0, 1.0);

    v_uv = a_corner;
    v_radius = a_radius;
    v_depth = a_depth;
    v_flags = a_flags;
  }
  ")

(def node-fragment-shader
  "
  #version 300 es
  precision highp float;

  in vec2 v_uv;
  in float v_radius;
  in float v_depth;
  in float v_flags;

  out vec4 fragColor;

  // Depth-based color palette (8 colors cycling)
  vec3 depthColor(float depth) {
    float t = mod(depth, 8.0) / 8.0;
    // Rainbow-ish palette
    vec3 c = vec3(
      0.5 + 0.5 * cos(6.28318 * (t + 0.0)),
      0.5 + 0.5 * cos(6.28318 * (t + 0.33)),
      0.5 + 0.5 * cos(6.28318 * (t + 0.67))
    );
    return mix(c, vec3(0.3, 0.4, 0.6), 0.3);  // Desaturate slightly
  }

  void main() {
    // Distance from center
    float dist = length(v_uv);

    // Anti-aliased circle
    float aa = fwidth(dist);
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, dist);

    // Skip fragments outside circle
    if (alpha < 0.01) discard;

    // Base color from depth
    vec3 color = depthColor(v_depth);

    // Selection highlight
    float isSelected = mod(floor(v_flags / 4.0), 2.0);
    if (isSelected > 0.5) {
      color = mix(color, vec3(0.4, 0.6, 1.0), 0.6);
    }

    // Focus ring
    float isFocused = mod(floor(v_flags / 8.0), 2.0);
    if (isFocused > 0.5 && dist > 0.7) {
      color = vec3(0.4, 0.7, 1.0);
      alpha = smoothstep(0.7, 0.75, dist) * (1.0 - smoothstep(0.95, 1.0, dist));
    }

    // Border
    float borderWidth = 0.1;
    if (dist > 1.0 - borderWidth) {
      color = mix(color, vec3(0.2), 0.5);
    }

    fragColor = vec4(color, alpha);
  }
  ")

(def edge-vertex-shader
  "
  #version 300 es
  precision highp float;

  in vec2 a_position;

  uniform vec2 u_resolution;

  void main() {
    vec2 clipPos = (a_position / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;
    gl_Position = vec4(clipPos, 0.0, 1.0);
  }
  ")

(def edge-fragment-shader
  "
  #version 300 es
  precision highp float;

  uniform vec4 u_color;

  out vec4 fragColor;

  void main() {
    fragColor = u_color;
  }
  ")

;; ════════════════════════════════════════════════════════════════════════════
;; SHADER COMPILATION
;; ════════════════════════════════════════════════════════════════════════════

(defn- compile-shader
  "Compile a shader from source."
  [gl type source]
  (let [shader (.createShader gl type)]
    (.shaderSource gl shader source)
    (.compileShader gl shader)
    (if (.getShaderParameter gl shader (.-COMPILE_STATUS gl))
      shader
      (do
        (js/console.error "Shader compile error:" (.getShaderInfoLog gl shader))
        (.deleteShader gl shader)
        nil))))

(defn- link-program
  "Link vertex and fragment shaders into a program."
  [gl vs fs]
  (let [program (.createProgram gl)]
    (.attachShader gl program vs)
    (.attachShader gl program fs)
    (.linkProgram gl program)
    (if (.getProgramParameter gl program (.-LINK_STATUS gl))
      program
      (do
        (js/console.error "Program link error:" (.getProgramInfoLog gl program))
        (.deleteProgram gl program)
        nil))))

;; ════════════════════════════════════════════════════════════════════════════
;; WEBGL CONTEXT
;; ════════════════════════════════════════════════════════════════════════════

(defn create-context
  "Create WebGL context from canvas."
  [canvas]
  (or (.getContext canvas "webgl2")
      (.getContext canvas "webgl")
      (do (js/console.error "WebGL not supported") nil)))

(defn make-renderer
  "Create WebGL renderer.

   Returns renderer object with draw methods."
  [canvas]
  (when-let [gl (create-context canvas)]
    (let [;; Compile shaders
          node-vs (compile-shader gl (.-VERTEX_SHADER gl) node-vertex-shader)
          node-fs (compile-shader gl (.-FRAGMENT_SHADER gl) node-fragment-shader)
          node-program (when (and node-vs node-fs) (link-program gl node-vs node-fs))

          edge-vs (compile-shader gl (.-VERTEX_SHADER gl) edge-vertex-shader)
          edge-fs (compile-shader gl (.-FRAGMENT_SHADER gl) edge-fragment-shader)
          edge-program (when (and edge-vs edge-fs) (link-program gl edge-vs edge-fs))

          ;; Create quad geometry for node instancing
          quad-verts (js/Float32Array. #js [-1 -1, 1 -1, 1 1, -1 1])
          quad-indices (js/Uint16Array. #js [0 1 2, 0 2 3])

          quad-vbo (.createBuffer gl)
          quad-ibo (.createBuffer gl)

          ;; Instance data buffers (resized as needed)
          instance-vbo (.createBuffer gl)
          edge-vbo (.createBuffer gl)

          ;; VAO for nodes
          node-vao (.createVertexArray gl)]

      ;; Upload quad geometry
      (.bindBuffer gl (.-ARRAY_BUFFER gl) quad-vbo)
      (.bufferData gl (.-ARRAY_BUFFER gl) quad-verts (.-STATIC_DRAW gl))

      (.bindBuffer gl (.-ELEMENT_ARRAY_BUFFER gl) quad-ibo)
      (.bufferData gl (.-ELEMENT_ARRAY_BUFFER gl) quad-indices (.-STATIC_DRAW gl))

      ;; Setup node VAO
      (.bindVertexArray gl node-vao)

      ;; Quad corners (per-vertex)
      (.bindBuffer gl (.-ARRAY_BUFFER gl) quad-vbo)
      (let [loc (.getAttribLocation gl node-program "a_corner")]
        (.enableVertexAttribArray gl loc)
        (.vertexAttribPointer gl loc 2 (.-FLOAT gl) false 0 0))

      ;; Instance data (will be bound before draw)
      (.bindBuffer gl (.-ARRAY_BUFFER gl) instance-vbo)

      ;; a_position (vec2)
      (let [loc (.getAttribLocation gl node-program "a_position")]
        (.enableVertexAttribArray gl loc)
        (.vertexAttribPointer gl loc 2 (.-FLOAT gl) false 20 0)
        (.vertexAttribDivisor gl loc 1))

      ;; a_radius (float)
      (let [loc (.getAttribLocation gl node-program "a_radius")]
        (.enableVertexAttribArray gl loc)
        (.vertexAttribPointer gl loc 1 (.-FLOAT gl) false 20 8)
        (.vertexAttribDivisor gl loc 1))

      ;; a_depth (float)
      (let [loc (.getAttribLocation gl node-program "a_depth")]
        (.enableVertexAttribArray gl loc)
        (.vertexAttribPointer gl loc 1 (.-FLOAT gl) false 20 12)
        (.vertexAttribDivisor gl loc 1))

      ;; a_flags (float)
      (let [loc (.getAttribLocation gl node-program "a_flags")]
        (.enableVertexAttribArray gl loc)
        (.vertexAttribPointer gl loc 1 (.-FLOAT gl) false 20 16)
        (.vertexAttribDivisor gl loc 1))

      (.bindBuffer gl (.-ELEMENT_ARRAY_BUFFER gl) quad-ibo)

      (.bindVertexArray gl nil)

      ;; Enable blending
      (.enable gl (.-BLEND gl))
      (.blendFunc gl (.-SRC_ALPHA gl) (.-ONE_MINUS_SRC_ALPHA gl))

      {:gl gl
       :node-program node-program
       :edge-program edge-program
       :node-vao node-vao
       :instance-vbo instance-vbo
       :edge-vbo edge-vbo
       :instance-data nil  ; Float32Array, updated each frame
       :max-instances 0
       :canvas canvas})))

;; ════════════════════════════════════════════════════════════════════════════
;; DRAWING
;; ════════════════════════════════════════════════════════════════════════════

(defn resize-if-needed!
  "Resize canvas to match display size."
  [renderer]
  (let [canvas (:canvas renderer)
        dpr (or js/window.devicePixelRatio 1)
        display-width (js/Math.floor (* (.-clientWidth canvas) dpr))
        display-height (js/Math.floor (* (.-clientHeight canvas) dpr))]
    (when (or (not= (.-width canvas) display-width)
              (not= (.-height canvas) display-height))
      (set! (.-width canvas) display-width)
      (set! (.-height canvas) display-height)
      (.viewport (:gl renderer) 0 0 display-width display-height))))

(defn prepare-instance-data!
  "Prepare instance data buffer from render batch."
  [renderer rb]
  (let [n @(:render-count rb)
        gl (:gl renderer)
        ;; Each instance: x, y, radius, depth, flags (5 floats = 20 bytes)
        data (or (:instance-data renderer)
                 (js/Float32Array. (* n 5)))]

    ;; Resize if needed
    (when (< (.-length data) (* n 5))
      (set! (.-instance-data renderer) (js/Float32Array. (* n 5 2))))

    (let [data (.-instance-data renderer)
          order (:render-order rb)
          sx (:screen-x rb)
          sy (:screen-y rb)
          rad (:radius rb)
          depths (:depth rb)
          flags (:flags rb)]

      ;; Fill data in render order
      (loop [i 0]
        (when (< i n)
          (let [idx (aget order i)
                off (* i 5)]
            (aset data off (aget sx idx))
            (aset data (+ off 1) (aget sy idx))
            (aset data (+ off 2) (aget rad idx))
            (aset data (+ off 3) (aget depths idx))
            (aset data (+ off 4) (aget flags idx)))
          (recur (inc i))))

      ;; Upload to GPU
      (.bindBuffer gl (.-ARRAY_BUFFER gl) (:instance-vbo renderer))
      (.bufferData gl (.-ARRAY_BUFFER gl) data (.-DYNAMIC_DRAW gl))

      n)))

(defn draw-nodes!
  "Draw all nodes using instanced rendering."
  [renderer rb count]
  (let [gl (:gl renderer)
        program (:node-program renderer)]
    (.useProgram gl program)

    ;; Set resolution uniform
    (let [loc (.getUniformLocation gl program "u_resolution")]
      (.uniform2f gl loc (.-width (:canvas renderer)) (.-height (:canvas renderer))))

    ;; Bind VAO and draw
    (.bindVertexArray gl (:node-vao renderer))
    (.drawElementsInstanced gl (.-TRIANGLES gl) 6 (.-UNSIGNED_SHORT gl) 0 count)))

(defn draw-edges!
  "Draw edges as lines."
  [renderer rb]
  (let [gl (:gl renderer)
        program (:edge-program renderer)
        n @(:edge-count rb)]

    (when (pos? n)
      (.useProgram gl program)

      ;; Set uniforms
      (let [res-loc (.getUniformLocation gl program "u_resolution")
            col-loc (.getUniformLocation gl program "u_color")]
        (.uniform2f gl res-loc (.-width (:canvas renderer)) (.-height (:canvas renderer)))
        (.uniform4f gl col-loc 0.3 0.35 0.4 0.6))

      ;; Prepare edge vertex data
      (let [data (js/Float32Array. (* n 4))  ; 2 vertices * 2 floats each
            ex1 (:edge-x1 rb)
            ey1 (:edge-y1 rb)
            ex2 (:edge-x2 rb)
            ey2 (:edge-y2 rb)]
        (loop [i 0]
          (when (< i n)
            (let [off (* i 4)]
              (aset data off (aget ex1 i))
              (aset data (+ off 1) (aget ey1 i))
              (aset data (+ off 2) (aget ex2 i))
              (aset data (+ off 3) (aget ey2 i)))
            (recur (inc i))))

        (.bindBuffer gl (.-ARRAY_BUFFER gl) (:edge-vbo renderer))
        (.bufferData gl (.-ARRAY_BUFFER gl) data (.-DYNAMIC_DRAW gl))

        ;; Setup attribute
        (let [loc (.getAttribLocation gl program "a_position")]
          (.enableVertexAttribArray gl loc)
          (.vertexAttribPointer gl loc 2 (.-FLOAT gl) false 0 0))

        (.drawArrays gl (.-LINES gl) 0 (* n 2))))))

(defn clear!
  "Clear the canvas."
  [renderer]
  (let [gl (:gl renderer)]
    (.clearColor gl 0.05 0.05 0.08 1.0)
    (.clear gl (.-COLOR_BUFFER_BIT gl))))

(defn render-frame!
  "Render a complete frame from a render batch."
  [renderer rb]
  (resize-if-needed! renderer)
  (clear! renderer)
  (draw-edges! renderer rb)
  (let [count (prepare-instance-data! renderer rb)]
    (draw-nodes! renderer rb count)))

;; ════════════════════════════════════════════════════════════════════════════
;; CLEANUP
;; ════════════════════════════════════════════════════════════════════════════

(defn destroy!
  "Clean up WebGL resources."
  [renderer]
  (let [gl (:gl renderer)]
    (.deleteProgram gl (:node-program renderer))
    (.deleteProgram gl (:edge-program renderer))
    (.deleteVertexArray gl (:node-vao renderer))
    (.deleteBuffer gl (:instance-vbo renderer))
    (.deleteBuffer gl (:edge-vbo renderer))))
