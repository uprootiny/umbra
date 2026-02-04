/**
 * @fileoverview Externs for Umbra H^n Engine
 * @externs
 */

/**
 * H^n Engine API exposed to JavaScript
 * @type {Object}
 */
var HnEngine;

/**
 * @param {number} dim
 * @return {boolean}
 */
HnEngine.init = function(dim) {};

/**
 * @param {number} capacity
 * @return {string}
 */
HnEngine.createPointset = function(capacity) {};

/**
 * @param {string} psId
 * @param {string} name
 * @param {?string} parentName
 * @param {Object} meta
 * @return {number}
 */
HnEngine.addPoint = function(psId, name, parentName, meta) {};

/**
 * @param {string} psId
 * @param {number} idx
 * @param {number} targetIdx
 * @param {number} step
 */
HnEngine.movePoint = function(psId, idx, targetIdx, step) {};

/**
 * @param {string} psId
 * @return {number}
 */
HnEngine.getPointCount = function(psId) {};

/**
 * @param {string} psId
 * @param {number} idx
 * @return {Object}
 */
HnEngine.getPointMeta = function(psId, idx) {};

/**
 * @param {string} lensId
 */
HnEngine.setActiveLens = function(lensId) {};

/**
 * @param {string} lensId
 * @param {string} psId
 * @param {number} idx
 */
HnEngine.setLensFocus = function(lensId, psId, idx) {};

/**
 * @param {string} lensId
 * @param {number} width
 * @param {number} height
 * @param {number} scale
 * @param {number} offsetX
 * @param {number} offsetY
 */
HnEngine.setLensViewport = function(lensId, width, height, scale, offsetX, offsetY) {};

/**
 * @param {number} delta
 */
HnEngine.zoomLens = function(delta) {};

/**
 * @param {string} psId
 * @return {Array<Object>}
 */
HnEngine.projectForRender = function(psId) {};

/**
 * @param {string} psId
 * @param {boolean} sampleGeodesics
 * @return {Array<Object>}
 */
HnEngine.projectEdges = function(psId, sampleGeodesics) {};

/**
 * @param {string} psId
 * @param {number} sx
 * @param {number} sy
 * @param {number} threshold
 * @return {number}
 */
HnEngine.pickAtScreen = function(psId, sx, sy, threshold) {};

/**
 * @param {string} psId
 * @param {number} sx
 * @param {number} sy
 * @return {number}
 */
HnEngine.sampleDensityAt = function(psId, sx, sy) {};

/**
 * @param {string} psId
 * @param {number} resolution
 * @return {Float32Array}
 */
HnEngine.getDensityGrid = function(psId, resolution) {};

/**
 * @param {number} dx
 * @param {number} dy
 */
HnEngine.panLens = function(dx, dy) {};

/**
 * @param {string} psId
 * @param {number} idx
 * @param {number} durationMs
 * @return {Function}
 */
HnEngine.navigateToPoint = function(psId, idx, durationMs) {};

/**
 * @param {string} psId
 * @param {number} idx1
 * @param {number} idx2
 * @return {number}
 */
HnEngine.getDistance = function(psId, idx1, idx2) {};

/**
 * @param {string} psId
 * @param {number} idx
 * @param {number} k
 * @return {Array<Object>}
 */
HnEngine.getNearest = function(psId, idx, k) {};

/**
 * @param {string} psId
 * @param {number} idx
 * @param {boolean} selected
 */
HnEngine.setSelected = function(psId, idx, selected) {};

/**
 * @param {string} psId
 * @return {Array<number>}
 */
HnEngine.getSelected = function(psId) {};

/**
 * @param {string} psId
 * @param {number} idx
 * @param {boolean} hidden
 */
HnEngine.setHidden = function(psId, idx, hidden) {};

/**
 * @param {string} psId
 * @return {Object}
 */
HnEngine.exportPointset = function(psId) {};

/**
 * @param {Object} data
 * @return {string}
 */
HnEngine.importPointset = function(data) {};
