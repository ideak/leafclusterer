/**
 * @name L.Marker.Clusterer
 * @version 1.0
 * @author Xiaoxi Wu
 * @author Imre Deak, ported for Leaflet
 * @author Bruno Bergot / b_b, ported to use Leaflet classes
 * @copyright (c) 2009 Xiaoxi Wu
 * @fileoverview
 * This javascript library creates and manages per-zoom-level 
 * clusters for large amounts of markers (hundreds or thousands).
 * This library was inspired by the <a href="http://www.maptimize.com">
 * Maptimize</a> hosted clustering solution.
 * <br /><br/>
 * <b>How it works</b>:<br/>
 * The <code>L.Marker.Clusterer</code> will group markers into clusters according to
 * their distance from a cluster's center. When a marker is added,
 * the marker cluster will find a position in all the clusters, and 
 * if it fails to find one, it will create a new cluster with the marker.
 * The number of markers in a cluster will be displayed
 * on the cluster marker. When the map viewport changes,
 * <code>L.Marker.Clusterer</code> will destroy the clusters in the viewport 
 * and regroup them into new clusters.
 *
 */

/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * @name L.Marker.Clusterer.Options
 * @class This class represents optional arguments to the {@link L.Marker.Clusterer}
 * constructor.
 * @property {Number} [maxZoom] The max zoom level monitored by a
 * marker cluster. If not given, the marker cluster assumes the maximum map
 * zoom level. When maxZoom is reached or exceeded all markers will be shown
 * without cluster.
 * @property {Number} [gridSize=60] The grid size of a cluster in pixel. Each
 * cluster will be a square. If you want the algorithm to run faster, you can set
 * this value larger.
 * @property {Array of MarkerStyleOptions} [styles]
 * Custom styles for the cluster markers.
 * The array should be ordered according to increasing cluster size,
 * with the style for the smallest clusters first, and the style for the
 * largest clusters last.
 */

/**
 * @name MarkerStyleOptions
 * @class An array of these is passed into the {@link L.Marker.Clusterer.Options}
 * styles option.
 * @property {String} [url] Image url.
 * @property {Number} [height] Image height.
 * @property {Number} [height] Image width.
 * @property {Array of Number} [opt_anchor] Anchor for label text, like [24, 12]. 
 *    If not set, the text will align center and middle.
 * @property {String} [opt_textColor="black"] Text color.
 */

/**
 * Creates a new Clusterer to cluster markers on the map.
 *
 * @constructor
 * @param {L.Map} map The map that the markers should be added to.
 * @param {Array of L.Marker} opt_markers Initial set of markers to be clustered.
 * @param {L.Marker.Clusterer.Options} opt_opts A container for optional arguments.
 */
L.Marker.Clusterer = L.Class.extend({
	
	includes: [L.Mixin.Events],
	
	initialize: function (map, opt_markers, opt_opts) {
		// private members
		this._clusters = [];
		this._map = map;
		this._maxZoom = null;
		this._gridSize = 40;
		this._sizes = [53, 56, 66, 78, 90];
		this._styles = [];
		this._leftMarkers = [];
		this._mcfn = null;

		var i = 0;
		for (i = 1; i <= 5; ++i) {
			this._styles.push({
				'url': "http://gmaps-utility-library.googlecode.com/svn/trunk/markerclusterer/images/m" + i + ".png",
				'height': this._sizes[i - 1],
				'width': this._sizes[i - 1]
			});
		}

		if (typeof opt_opts === "object" && opt_opts !== null) {
			if (typeof opt_opts.gridSize === "number" && opt_opts.gridSize > 0) {
				this._gridSize = opt_opts.gridSize;
			}
			if (typeof opt_opts.maxZoom === "number") {
				this._maxZoom = opt_opts.maxZoom;
			}
			if (typeof opt_opts.styles === "object" && opt_opts.styles !== null && opt_opts.styles.length !== 0) {
				this._styles = opt_opts.styles;
			}
		}

		// initialize
		if (typeof opt_markers === "object" && opt_markers !== null) {
			this.addMarkers(opt_markers);
		}

		// when map move end, regroup.
		this._mcfn = this._map.on("moveend", function() { this.resetViewport(); }, this);

	},

	/**
	* When we add a marker, the marker may not in the viewport of map, then we don't deal with it, instead
	* we add the marker into a array called this._leftMarkers. When we reset L.Marker.Clusterer we should add the
	* this._leftMarkers into L.Marker.Clusterer.
	*/
	_addLeftMarkers: function () {
		if (this._leftMarkers.length === 0) {
			return;
		}
		var leftMarkers = [];
		for (i = 0; i < this._leftMarkers.length; ++i) {
			this.addMarker(this._leftMarkers[i], true, null, null, true);
		}
		this._leftMarkers = leftMarkers;
	},

	/**
	* Get cluster marker images of this marker cluster. Mostly used by {@link L.Marker.Cluster}
	* @private
	* @return {Array of String}
	*/
	getStyles: function () {
		return this._styles;
	},

	/**
	* Remove all markers from L.Marker.Clusterer.
	*/
	clearMarkers: function () {
		for (var i = 0; i < this._clusters.length; ++i) {
			if (typeof this._clusters[i] !== "undefined" && this._clusters[i] !== null) {
				this._clusters[i].clearMarkers();
			}
		}
		this._clusters = [];
		this._leftMarkers = [];
		this._map.off(this._mcfn);
	},

	/**
	* Check a marker, whether it is in current map viewport.
	* @private
	* @return {Boolean} if it is in current map viewport
	*/
	_isMarkerInViewport: function (marker) {
		return this._map.getBounds().contains(marker.getLatLng());
	},

	/**
	* When reset L.Marker.Clusterer, there will be some markers get out of its cluster.
	* These markers should be add to new clusters.
	* @param {Array of L.Marker} markers Markers to add.
	*/
	_reAddMarkers: function (markers) {
		var len = markers.length;
		var clusters = [];
		for (var i = len - 1; i >= 0; --i) {
			this.addMarker(markers[i].marker, true, markers[i].isAdded, clusters, true);
		}
		this._addLeftMarkers();
	},

	/**
	* Add a marker.
	* @private
	* @param {L.Marker} marker Marker you want to add
	* @param {Boolean} opt_isNodraw Whether redraw the cluster contained the marker
	* @param {Boolean} opt_isAdded Whether the marker is added to map. Never use it.
	* @param {Array of L.Marker.Cluster} opt_clusters Provide a list of clusters, the marker
	*     cluster will only check these cluster where the marker should join.
	*/
	addMarker: function (marker, opt_isNodraw, opt_isAdded, opt_clusters, opt_isNoCheck) {
		if (opt_isNoCheck !== true) {
			if (!this._isMarkerInViewport(marker)) {
				this._leftMarkers.push(marker);
				return;
			}
		}

		var isAdded = opt_isAdded;
		var clusters = opt_clusters;
		var pos = this._map.latLngToLayerPoint(marker.getLatLng());

		if (typeof isAdded !== "boolean") {
			isAdded = false;
		}
		if (typeof clusters !== "object" || clusters === null) {
			clusters = this._clusters;
		}

		var length = clusters.length;
		var cluster = null;
		for (var i = length - 1; i >= 0; i--) {
			cluster = clusters[i];
			var center = cluster.getCenter();
			if (center === null) {
				continue;
			}
			center = this._map.latLngToLayerPoint(center);

			// Found a cluster which contains the marker.
			if (pos.x >= center.x - this._gridSize && pos.x <= center.x + this._gridSize &&
				pos.y >= center.y - this._gridSize && pos.y <= center.y + this._gridSize)
			{
				cluster.addMarker({
					'isAdded': isAdded,
					'marker': marker
				});
				if (!opt_isNodraw) {
					cluster._redraw();
				}
				return;
			}
		}

		// No cluster contain the marker, create a new cluster.
		cluster = new L.Marker.Cluster(this, this._map);
		cluster.addMarker({
			'isAdded': isAdded,
			'marker': marker
		});
		if (!opt_isNodraw) {
			cluster._redraw();
		}

		// Add this cluster both in clusters provided and this._clusters
		clusters.push(cluster);
		if (clusters !== this._clusters) {
			this._clusters.push(cluster);
		}
	},

	/**
	* Remove a marker.
	*
	* @param {L.Marker} marker The marker you want to remove.
	*/
	removeMarker: function (marker) {
		for (var i = 0; i < this._clusters.length; ++i) {
			if (this._clusters[i].remove(marker)) {
				this._clusters[i]._redraw();
				return;
			}
		}
	},

	/**
	* Redraw all clusters in viewport.
	*/
	redraw: function () {
		var clusters = this.getClustersInViewport();
		for (var i = 0; i < clusters.length; ++i) {
			clusters[i]._redraw(true);
		}
	},

	/**
	* Get all clusters in viewport.
	* @return {Array of L.Marker.Cluster}
	*/
	getClustersInViewport: function () {
		var clusters = [];
		var curBounds = this._map.getBounds();
		for (var i = 0; i < this._clusters.length; i ++) {
			if (this._clusters[i].isInBounds(curBounds)) {
				clusters.push(this._clusters[i]);
			}
		}
		return clusters;
	},

	/**
	* Get max zoom level.
	* @private
	* @return {Number}
	*/
	getMaxZoom: function () {
		return this._maxZoom;
	},

	/**
	* Get map object.
	* @private
	* @return {L.Map}
	*/
	getMap: function () {
		return this._map;
	},

	/**
	* Get grid size
	* @private
	* @return {Number}
	*/
	getGridSize: function () {
	return this._gridSize;
	},

	/**
	* Get total number of markers.
	* @return {Number}
	*/
	getTotalMarkers: function () {
		var result = 0;
		for (var i = 0; i < this._clusters.length; ++i) {
			result += this._clusters[i].getTotalMarkers();
		}
		return result;
	},

	/**
	* Get total number of clusters.
	* @return {int}
	*/
	getTotalClusters: function () {
		return this._clusters.length;
	},

	/**
	* Collect all markers of clusters in viewport and regroup them.
	*/
	resetViewport: function () {
		var clusters = this.getClustersInViewport();
		var tmpMarkers = [];
		var removed = 0;

		for (var i = 0; i < clusters.length; ++i) {
			var cluster = clusters[i];
			var oldZoom = cluster.getCurrentZoom();
			if (oldZoom === null) {
				continue;
			}
			var curZoom = this._map.getZoom();
			if (curZoom !== oldZoom) {
				// If the cluster zoom level changed then destroy the cluster
				// and collect its markers.
				var mks = cluster.getMarkers();
				for (var j = 0; j < mks.length; ++j) {
					var newMarker = {
						'isAdded': false,
						'marker': mks[j].marker
					};
					tmpMarkers.push(newMarker);
				}
				cluster.clearMarkers();
				removed++;
				for (j = 0; j < this._clusters.length; ++j) {
					if (cluster === this._clusters[j]) {
						this._clusters.splice(j, 1);
					}
				}
			}
		}

		// Add the markers collected into marker cluster to reset
		this._reAddMarkers(tmpMarkers);
		this.redraw();
	},

	/**
	* Add a set of markers.
	*
	* @param {Array of L.Marker} markers The markers you want to add.
	*/
	addMarkers: function (markers) {
		for (var i = 0; i < markers.length; ++i) {
			this.addMarker(markers[i], true);
		}
		this.redraw();
	}
});

/**
 * Create a cluster to collect markers.
 * A cluster includes some markers which are in a block of area.
 * If there are more than one markers in cluster, the cluster
 * will create a {@link L.Marker.ClusterMarker} and show the total number
 * of markers in cluster.
 *
 * @constructor
 * @private
 * @param {clusterer} clusterer The marker clusterer object
 */
L.Marker.Cluster = L.Class.extend({
	initialize: function (clusterer) {
		this._center = null;
		this._markers = [];
		this._clusterer = clusterer;
		this._map = clusterer.getMap();
		this._clusterMarker = null;
		this._zoom = this._map.getZoom();
	},

	/**
	* Get markers of this cluster.
	*
	* @return {Array of L.Marker}
	*/
	getMarkers: function () {
		return this._markers;
	},

	/**
	* If this cluster intersects certain bounds.
	*
	* @param {GLatLngBounds} bounds A bounds to test
	* @return {Boolean} Is this cluster intersects the bounds
	*/
	isInBounds: function (bounds) {
		if (this._center === null) {
			return false;
		}
		if (!bounds) {
			bounds = this._map.getBounds();
		}
		var sw = this._map.latLngToLayerPoint(bounds.getSouthWest());
		var ne = this._map.latLngToLayerPoint(bounds.getNorthEast());

		var centerxy = this._map.latLngToLayerPoint(this._center);
		var inViewport = true;
		var gridSize = this._clusterer.getGridSize();
		if (this._zoom !== this._map.getZoom()) {
			var dl = this._map.getZoom() - this._zoom;
			gridSize = Math.pow(2, dl) * gridSize;
		}
		if (ne.x !== sw.x && (centerxy.x + gridSize < sw.x || centerxy.x - gridSize > ne.x)) {
			inViewport = false;
		}
		if (inViewport && (centerxy.y + gridSize < ne.y || centerxy.y - gridSize > sw.y)) {
			inViewport = false;
		}
		return inViewport;
	},

	/**
	* Get cluster center.
	*
	* @return {GLatLng}
	*/
	getCenter: function () {
		return this._center;
	},

	/**
	* Add a marker.
	*
	* @param {Object} marker An object of marker you want to add:
	*   {Boolean} isAdded If the marker is added on map.
	*   {L.Marker} marker The marker you want to add.
	*/
	addMarker: function (marker) {
		if (this._center === null) {
			this._center = marker.marker.getLatLng();
		}
		this._markers.push(marker);
	},

	/**
	* Remove a marker from cluster.
	*
	* @param {L.Marker} marker The marker you want to remove.
	* @return {Boolean} Whether find the marker to be removed.
	*/
	removeMarker: function (marker) {
		for (var i = 0; i < this._markers.length; ++i) {
			if (marker === this._markers[i].marker) {
				if (this._markers[i].isAdded) {
					this._map.removeLayer(this._markers[i].marker);
				}
				this._markers.splice(i, 1);
				return true;
			}
		}
		return false;
	},

	/**
	* Get current zoom level of this cluster.
	* Note: the cluster zoom level and map zoom level not always the same.
	*
	* @return {Number}
	*/
	getCurrentZoom: function () {
		return this._zoom;
	},

	/**
	* Redraw a cluster.
	* @private
	* @param {Boolean} isForce If redraw by force, no matter if the cluster is
	*     in viewport.
	*/
	_redraw: function (isForce) {
		if (!isForce && !this.isInBounds()) {
			return;
		}

		// Set cluster zoom level.
		this._zoom = this._map.getZoom();
		var i = 0;
		var mz = this._clusterer.getMaxZoom();
		if (mz === null) {
			mz = this._map.getMaxZoom();
		}
		if (this._zoom >= mz || this.getTotalMarkers() === 1) {
			// If current zoom level is beyond the max zoom level or the cluster
			// have only one marker, the marker(s) in cluster will be showed on map.
			for (i = 0; i < this._markers.length; ++i) {
				this._map.addLayer(this._markers[i].marker);
				this._markers[i].isAdded = true;
			}
			if (this._clusterMarker !== null)
			this._clusterMarker.hide();
		} else {
			// Else add a cluster marker on map to show the number of markers in
			// this cluster.
			for (i = 0; i < this._markers.length; ++i) {
				if (this._markers[i].isAdded) {
					this._map.removeLayer(this._markers[i].marker);
				}
			}
			if (this._clusterMarker === null) {
				this._clusterMarker = new L.Marker.ClusterMarker(this, this._clusterer.getStyles());
				this._map.addLayer(this._clusterMarker);
			} else {
				this._clusterMarker.reset({count: this.getTotalMarkers()});
				this._clusterMarker.redraw();
				if (this._clusterMarker.isHidden()) {
					this._clusterMarker.show();
				}
			}
		}
	},

	/**
	* Remove all the markers from this cluster.
	*/
	clearMarkers: function () {
		if (this._clusterMarker !== null) {
			this._map.removeLayer(this._clusterMarker);
		}
		for (var i = 0; i < this._markers.length; ++i) {
			if (this._markers[i].isAdded) {
				this._map.removeLayer(this._markers[i].marker);
			}
		}
		this._markers = [];
	},

	/**
	* Get number of markers.
	* @return {Number}
	*/
	getTotalMarkers: function () {
		return this._markers.length;
	}
});

L.Marker.ClusterMarker = L.Class.extend({
	initialize: function(cluster, styles) {
		this._cluster = cluster;
		this.reset({
			latLng:cluster.getCenter(),
			count: cluster.getTotalMarkers(),
			styles: styles,
			padding: cluster._clusterer.getGridSize() / 2
		});
	},
  
	reset: function(opts) {
		if (!opts || typeof opts !== "object")
			return;

		var updated = 0;
		if (typeof opts.latLng === "object" && opts.latLng != this._latlng) {
			this._latlng = opts.latLng;
			updated = 1;
		}

		var styles_updated = 0;
		if (typeof opts.styles === "object" && opts.styles != this._styles) {
			this._styles = opts.styles;
			updated = 1;
			styles_updated = 1;
		}

		if (typeof opts.count === "number" && opts.count != this._count || styles_updated) {
			this._count = opts.count;

			var index = 0;
			var dv = this._count;
			while (dv !== 0) {
				dv = parseInt(dv / 10, 10);
				index ++;
			}

			var styles = this._styles;

			if (styles.length < index) {
				index = styles.length;
			}
			this.url_ = styles[index - 1].url;
			this.height_ = styles[index - 1].height;
			this.width_ = styles[index - 1].width;
			this.textColor_ = styles[index - 1].opt_textColor;
			this.anchor_ = styles[index - 1].opt_anchor;
			this.index_ = index;
		}

		if (typeof opts.padding === "number" && this._padding != opts.padding) {
			this._padding = opts.padding;
			updated = 1;
		}

		this.updated |= updated;
	},

	onAdd: function(map) {
		this._map = map;
		this._container = L.DomUtil.create('div', 'cluster-marker-container');
		map.getPanes().overlayPane.appendChild(this._container);
		var me = this;
		
		if (this._container.addEventListener) {
			this._container.addEventListener("click", function() { me._onClick(); }, me); 
		} else if (this._container.attachEvent) {
			this._container.attachEvent("onclick", function() { me._onClick(); }, me);     
		}   
		map.on('viewreset', this.redraw, this);
		this.redraw();
	},
    
	_onClick: function() {
		var padding = this._padding;
		var map = this._map;

		var pos = map.latLngToLayerPoint(this._latlng);
		var sw = new L.Point(pos.x - padding, pos.y + padding);
		sw = map.layerPointToLatLng(sw);
		var ne = new L.Point(pos.x + padding, pos.y - padding);
		ne = map.layerPointToLatLng(ne);
		var zoom = map.getBoundsZoom(new L.LatLngBounds(sw, ne));
		map.setView(this._latlng, zoom);
		// fire click event for clusterer
		this._cluster._clusterer.fire("click", {cluster: this._cluster});
	},

	onRemove: function(map) {
		map.getPanes().overlayPane.removeChild(this._container);
		map.off('viewreset', this.redraw, this);
	},

	redraw: function() {
		if (this._div && this.updated) {
			this._container.removeChild(this._div);
			this._div = null;
		}
		if (!this._div) {
			this._div = this.initLayout_();
			this._container.appendChild(this._div);
		}

		var pos = this._map.latLngToLayerPoint(this._latlng);
		pos.x -= parseInt(this.width_ / 2, 10);
		pos.y -= parseInt(this.height_ / 2, 10);
		this._container.style.top =  pos.y + "px";
		this._container.style.left = pos.x + "px";
	},

	hide: function() {
		this._div.style.display = "none";
	},

	show: function() {
		this._div.style.display = "";
	},

	isHidden: function () {
		return this._div.style.display === "none";
	},

	initLayout_: function() {
		var div = L.DomUtil.create('div', 'cluster-marker');
		var latlng = this._latlng;
		var pos = this._map.latLngToLayerPoint(latlng);
		pos.x -= parseInt(this.width_ / 2, 10);
		pos.y -= parseInt(this.height_ / 2, 10);
		var mstyle = "";

		if (document.all) {
			mstyle = 'filter:progid:DXImageTransform.Microsoft.AlphaImageLoader(sizingMethod=scale,src="' + this.url_ + '");';
		} else {
			mstyle = "background:url(" + this.url_ + ");";
		}
		if (typeof this.anchor_ === "object") {
			if (typeof this.anchor_[0] === "number" && this.anchor_[0] > 0 && this.anchor_[0] < this.height_) {
				mstyle += 'height:' + (this.height_ - this.anchor_[0]) + 'px;padding-top:' + this.anchor_[0] + 'px;';
			} else {
				mstyle += 'height:' + this.height_ + 'px;line-height:' + this.height_ + 'px;';
			}
			if (typeof this.anchor_[1] === "number" && this.anchor_[1] > 0 && this.anchor_[1] < this.width_) {
				mstyle += 'width:' + (this.width_ - this.anchor_[1]) + 'px;padding-left:' + this.anchor_[1] + 'px;';
			} else {
				mstyle += 'width:' + this.width_ + 'px;text-align:center;';
			}
		} else {
			mstyle += 'height:' + this.height_ + 'px;line-height:' + this.height_ + 'px;';
			mstyle += 'width:' + this.width_ + 'px;text-align:center;';
		}
		var txtColor = this.textColor_ ? this.textColor_ : 'black';

		div.style.cssText = mstyle + 'cursor:pointer;top:' + pos.y + "px;left:" +
		pos.x + "px;color:" + txtColor +  ";position:absolute;font-size:11px;" +
		'font-family:Arial,sans-serif;font-weight:bold';
		div.innerHTML = this._count;

		return div;
	}
});
