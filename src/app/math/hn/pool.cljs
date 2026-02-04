(ns app.math.hn.pool
  "Object pooling for typed arrays and scratch buffers.

   Memory allocation is expensive and triggers GC. For hot paths
   (projection, distance computation, animation), we reuse buffers
   from pools instead of allocating fresh.

   Usage:
     (let [v (acquire-vec pool dim)]
       ;; use v...
       (release-vec pool v))

   Or with macro:
     (with-pooled-vec [v pool dim]
       ;; v is available here
       (do-work v))
     ;; v automatically released

   Pool sizes are tuned for typical usage patterns:
     - Small vecs (dim 5-10): high frequency, many concurrent
     - Large vecs (dim 50+): rare, few concurrent
     - Matrices: very rare, reused heavily

   Thread-safety: Not thread-safe. ClojureScript is single-threaded
   so this is fine, but be careful with async boundaries."
  (:require [app.math.hn.minkowski :as M]))

;; ════════════════════════════════════════════════════════════════════════════
;; POOL STRUCTURE
;; ════════════════════════════════════════════════════════════════════════════

(defn make-pool
  "Create a typed array pool.

   Args:
     create-fn: (size) → new typed array
     initial-capacity: how many to pre-allocate per size class
     max-cached: maximum arrays to cache per size class

   Returns pool object."
  [create-fn initial-capacity max-cached]
  {:create-fn create-fn
   :max-cached max-cached
   :pools (atom {})  ; size → [available arrays]
   :stats (atom {:hits 0 :misses 0 :releases 0})})

(defn- get-or-create-size-pool!
  "Get pool for specific size, creating if needed."
  [pool size]
  (let [pools (:pools pool)]
    (when-not (contains? @pools size)
      (swap! pools assoc size []))
    (@pools size)))

(defn acquire!
  "Get an array of given size from pool.

   Returns existing array if available, creates new otherwise.
   The array contents are NOT zeroed - caller must initialize."
  [pool size]
  (let [pools (:pools pool)
        stats (:stats pool)]
    (if-let [available (peek (get @pools size))]
      (do
        (swap! pools update size pop)
        (swap! stats update :hits inc)
        available)
      (do
        (swap! stats update :misses inc)
        ((:create-fn pool) size)))))

(defn release!
  "Return an array to the pool for reuse.

   Only caches up to max-cached per size class."
  [pool arr]
  (let [size (.-length arr)
        pools (:pools pool)
        max-cached (:max-cached pool)
        stats (:stats pool)]
    (when (< (count (get @pools size [])) max-cached)
      (swap! pools update size (fnil conj []) arr)
      (swap! stats update :releases inc))))

(defn pool-stats
  "Get pool statistics for monitoring."
  [pool]
  (let [stats @(:stats pool)
        pools @(:pools pool)
        total-cached (reduce + (map count (vals pools)))]
    (assoc stats
           :cached total-cached
           :hit-rate (if (pos? (+ (:hits stats) (:misses stats)))
                       (/ (:hits stats) (+ (:hits stats) (:misses stats)))
                       0))))

(defn clear-pool!
  "Release all cached arrays (for memory pressure situations)."
  [pool]
  (reset! (:pools pool) {})
  (reset! (:stats pool) {:hits 0 :misses 0 :releases 0}))

;; ════════════════════════════════════════════════════════════════════════════
;; SPECIALIZED POOLS
;; ════════════════════════════════════════════════════════════════════════════

(def float-pool
  "Global pool for Float32Arrays (coords, tangent vectors)."
  (make-pool #(js/Float32Array. %) 8 32))

(def int-pool
  "Global pool for Int32Arrays (indices, parent refs)."
  (make-pool #(js/Int32Array. %) 4 16))

(def byte-pool
  "Global pool for Uint8Arrays (flags, small data)."
  (make-pool #(js/Uint8Array. %) 4 16))

;; ════════════════════════════════════════════════════════════════════════════
;; VECTOR-SPECIFIC HELPERS
;; ════════════════════════════════════════════════════════════════════════════

(defn acquire-vec
  "Get a vector buffer for H^n operations.

   dim: hyperbolic dimension (buffer size is dim+1)"
  [dim]
  (acquire! float-pool (inc dim)))

(defn release-vec
  "Return a vector buffer to the pool."
  [v]
  (release! float-pool v))

(defn acquire-matrix
  "Get a matrix buffer for isometry operations.

   dim: hyperbolic dimension (matrix is (dim+1) × (dim+1))"
  [dim]
  (let [size (inc dim)]
    (acquire! float-pool (* size size))))

(defn release-matrix
  "Return a matrix buffer to the pool."
  [m]
  (release! float-pool m))

;; ════════════════════════════════════════════════════════════════════════════
;; SCRATCH BUFFER MANAGER
;; ════════════════════════════════════════════════════════════════════════════

(defonce ^:private scratch-registry
  (atom {}))

(defn register-scratch!
  "Register a scratch buffer need for a specific operation.

   Returns a function that acquires the buffer."
  [op-name dim count]
  (let [key [op-name dim count]
        size (* (inc dim) count)]
    (swap! scratch-registry assoc key
           {:size size
            :buffer (atom nil)
            :in-use (atom false)})))

(defn with-scratch
  "Execute f with a scratch buffer, managing lifecycle.

   The scratch buffer is reused across calls to the same operation."
  [op-name dim count f]
  (let [key [op-name dim count]
        entry (or (get @scratch-registry key)
                  (do (register-scratch! op-name dim count)
                      (get @scratch-registry key)))
        buffer-atom (:buffer entry)
        in-use-atom (:in-use entry)]

    (when @in-use-atom
      (js/console.warn "Scratch buffer collision for" op-name))

    (let [buf (or @buffer-atom
                  (let [b (js/Float32Array. (:size entry))]
                    (reset! buffer-atom b)
                    b))]
      (reset! in-use-atom true)
      (try
        (f buf)
        (finally
          (reset! in-use-atom false))))))

;; ════════════════════════════════════════════════════════════════════════════
;; BATCH OPERATION BUFFERS
;; ════════════════════════════════════════════════════════════════════════════

(defn make-batch-context
  "Create a batch processing context with pre-allocated buffers.

   For operations that process many points, this avoids per-point
   allocation overhead."
  [dim max-points]
  (let [stride (inc dim)]
    {:dim dim
     :stride stride
     :max-points max-points
     ;; Scratch vectors for intermediate computations
     :tmp1 (js/Float32Array. stride)
     :tmp2 (js/Float32Array. stride)
     :tmp3 (js/Float32Array. stride)
     ;; Tangent vector scratch
     :tangent (js/Float32Array. stride)
     ;; Output buffers
     :screen-coords (js/Float32Array. (* max-points 2))
     :distances (js/Float32Array. max-points)
     :indices (js/Int32Array. max-points)
     ;; Flags for tracking what's computed
     :dirty (js/Uint8Array. max-points)}))

(defn reset-batch-context!
  "Clear computed data from batch context for reuse."
  [ctx]
  (let [max (:max-points ctx)]
    ;; Just mark everything as dirty rather than clearing
    (.fill (:dirty ctx) 1)
    ctx))

;; ════════════════════════════════════════════════════════════════════════════
;; ARENA ALLOCATOR
;; ════════════════════════════════════════════════════════════════════════════

(defn make-arena
  "Create an arena allocator for temporary allocations.

   Arena allocations are O(1) and the entire arena is freed at once.
   Perfect for frame-local temporaries."
  [total-floats]
  {:buffer (js/Float32Array. total-floats)
   :offset (atom 0)
   :capacity total-floats})

(defn arena-alloc!
  "Allocate from arena. Returns [buffer, offset] pair.

   Returns nil if arena exhausted."
  [arena size]
  (let [current @(:offset arena)
        new-offset (+ current size)]
    (if (<= new-offset (:capacity arena))
      (do
        (reset! (:offset arena) new-offset)
        [(:buffer arena) current])
      nil)))

(defn arena-reset!
  "Reset arena for reuse. O(1) operation."
  [arena]
  (reset! (:offset arena) 0))

(defn arena-remaining
  "How many floats remain in arena."
  [arena]
  (- (:capacity arena) @(:offset arena)))

;; Frame-local arena for per-frame temporaries
(defonce frame-arena
  (make-arena 65536))  ; 256KB, should be plenty for one frame

(defn begin-frame!
  "Call at start of each frame to reset frame arena."
  []
  (arena-reset! frame-arena))

(defn frame-alloc!
  "Allocate temporary buffer for current frame only.

   These are automatically freed at next begin-frame! call."
  [size]
  (arena-alloc! frame-arena size))
