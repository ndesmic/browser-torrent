(function(f) {
    if (typeof exports === "object" && typeof module !== "undefined") {
        module.exports = f();
    } else if (typeof define === "function" && define.amd) {
        define([], f);
    } else {
        var g;
        if (typeof window !== "undefined") {
            g = window;
        } else if (typeof global !== "undefined") {
            g = global;
        } else if (typeof self !== "undefined") {
            g = self;
        } else {
            g = this;
        }
        g.WebTorrent = f();
    }
})(function() {
    var define, module, exports;
    return function e(t, n, r) {
        function s(o, u) {
            if (!n[o]) {
                if (!t[o]) {
                    var a = typeof require == "function" && require;
                    if (!u && a) return a(o, !0);
                    if (i) return i(o, !0);
                    var f = new Error("Cannot find module '" + o + "'");
                    throw f.code = "MODULE_NOT_FOUND", f;
                }
                var l = n[o] = {
                    exports: {}
                };
                t[o][0].call(l.exports, function(e) {
                    var n = t[o][1][e];
                    return s(n ? n : e);
                }, l, l.exports, e, t, n, r);
            }
            return n[o].exports;
        }
        var i = typeof require == "function" && require;
        for (var o = 0; o < r.length; o++) s(r[o]);
        return s;
    }({
        1: [ function(require, module, exports) {
            module.exports = FileStream;
            var debug = require("debug")("webtorrent:file-stream");
            var inherits = require("inherits");
            var stream = require("readable-stream");
            inherits(FileStream, stream.Readable);
            function FileStream(file, opts) {
                stream.Readable.call(this, opts);
                this.destroyed = false;
                this._torrent = file._torrent;
                var start = opts && opts.start || 0;
                var end = opts && opts.end && opts.end < file.length ? opts.end : file.length - 1;
                var pieceLength = file._torrent.pieceLength;
                this._startPiece = (start + file.offset) / pieceLength | 0;
                this._endPiece = (end + file.offset) / pieceLength | 0;
                this._piece = this._startPiece;
                this._offset = start + file.offset - this._startPiece * pieceLength;
                this._missing = end - start + 1;
                this._reading = false;
                this._notifying = false;
                this._criticalLength = Math.min(1024 * 1024 / pieceLength | 0, 2);
            }
            FileStream.prototype._read = function() {
                if (this._reading) return;
                this._reading = true;
                this._notify();
            };
            FileStream.prototype._notify = function() {
                var self = this;
                if (!self._reading || self._missing === 0) return;
                if (!self._torrent.bitfield.get(self._piece)) {
                    return self._torrent.critical(self._piece, self._piece + self._criticalLength);
                }
                if (self._notifying) return;
                self._notifying = true;
                var p = self._piece;
                self._torrent.store.get(p, function(err, buffer) {
                    self._notifying = false;
                    if (self.destroyed) return;
                    if (err) return self._destroy(err);
                    debug("read %s (length %s) (err %s)", p, buffer.length, err && err.message);
                    if (self._offset) {
                        buffer = buffer.slice(self._offset);
                        self._offset = 0;
                    }
                    if (self._missing < buffer.length) {
                        buffer = buffer.slice(0, self._missing);
                    }
                    self._missing -= buffer.length;
                    debug("pushing buffer of length %s", buffer.length);
                    self._reading = false;
                    self.push(buffer);
                    if (self._missing === 0) self.push(null);
                });
                self._piece += 1;
            };
            FileStream.prototype.destroy = function(onclose) {
                this._destroy(null, onclose);
            };
            FileStream.prototype._destroy = function(err, onclose) {
                if (this.destroyed) return;
                this.destroyed = true;
                if (!this._torrent.destroyed) {
                    this._torrent.deselect(this._startPiece, this._endPiece, true);
                }
                if (err) this.emit("error", err);
                this.emit("close");
                if (onclose) onclose();
            };
        }, {
            debug: 63,
            inherits: 71,
            "readable-stream": 99
        } ],
        2: [ function(require, module, exports) {
            (function(process) {
                module.exports = File;
                var eos = require("end-of-stream");
                var EventEmitter = require("events").EventEmitter;
                var FileStream = require("./file-stream");
                var inherits = require("inherits");
                var path = require("path");
                var render = require("render-media");
                var stream = require("readable-stream");
                var streamToBlob = require("stream-to-blob");
                var streamToBlobURL = require("stream-to-blob-url");
                var streamToBuffer = require("stream-with-known-length-to-buffer");
                inherits(File, EventEmitter);
                function File(torrent, file) {
                    EventEmitter.call(this);
                    this._torrent = torrent;
                    this._destroyed = false;
                    this.name = file.name;
                    this.path = file.path;
                    this.length = file.length;
                    this.offset = file.offset;
                    this.done = false;
                    var start = file.offset;
                    var end = start + file.length - 1;
                    this._startPiece = start / this._torrent.pieceLength | 0;
                    this._endPiece = end / this._torrent.pieceLength | 0;
                    if (this.length === 0) {
                        this.done = true;
                        this.emit("done");
                    }
                }
                File.prototype.select = function(priority) {
                    if (this.length === 0) return;
                    this._torrent.select(this._startPiece, this._endPiece, priority);
                };
                File.prototype.deselect = function() {
                    if (this.length === 0) return;
                    this._torrent.deselect(this._startPiece, this._endPiece, false);
                };
                File.prototype.createReadStream = function(opts) {
                    var self = this;
                    if (this.length === 0) {
                        var empty = new stream.PassThrough();
                        process.nextTick(function() {
                            empty.end();
                        });
                        return empty;
                    }
                    var fileStream = new FileStream(self, opts);
                    self._torrent.select(fileStream._startPiece, fileStream._endPiece, true, function() {
                        fileStream._notify();
                    });
                    eos(fileStream, function() {
                        if (self._destroyed) return;
                        if (!self._torrent.destroyed) {
                            self._torrent.deselect(fileStream._startPiece, fileStream._endPiece, true);
                        }
                    });
                    return fileStream;
                };
                File.prototype.getBuffer = function(cb) {
                    streamToBuffer(this.createReadStream(), this.length, cb);
                };
                File.prototype.getBlob = function(cb) {
                    if (typeof window === "undefined") throw new Error("browser-only method");
                    streamToBlob(this.createReadStream(), this._getMimeType(), cb);
                };
                File.prototype.getBlobURL = function(cb) {
                    if (typeof window === "undefined") throw new Error("browser-only method");
                    streamToBlobURL(this.createReadStream(), this._getMimeType(), cb);
                };
                File.prototype.appendTo = function(elem, cb) {
                    if (typeof window === "undefined") throw new Error("browser-only method");
                    render.append(this, elem, cb);
                };
                File.prototype.renderTo = function(elem, cb) {
                    if (typeof window === "undefined") throw new Error("browser-only method");
                    render.render(this, elem, cb);
                };
                File.prototype._getMimeType = function() {
                    return render.mime[path.extname(this.name).toLowerCase()];
                };
                File.prototype._destroy = function() {
                    this._destroyed = true;
                    this._torrent = null;
                };
            }).call(this, require("_process"));
        }, {
            "./file-stream": 1,
            _process: 30,
            "end-of-stream": 66,
            events: 26,
            inherits: 71,
            path: 29,
            "readable-stream": 99,
            "render-media": 100,
            "stream-to-blob": 132,
            "stream-to-blob-url": 131,
            "stream-with-known-length-to-buffer": 135
        } ],
        3: [ function(require, module, exports) {
            var arrayRemove = require("unordered-array-remove");
            var debug = require("debug")("webtorrent:peer");
            var Wire = require("bittorrent-protocol");
            var WebConn = require("./webconn");
            var CONNECT_TIMEOUT_TCP = 5e3;
            var CONNECT_TIMEOUT_WEBRTC = 25e3;
            var HANDSHAKE_TIMEOUT = 25e3;
            exports.createWebRTCPeer = function(conn, swarm) {
                var peer = new Peer(conn.id, "webrtc");
                peer.conn = conn;
                peer.swarm = swarm;
                if (peer.conn.connected) {
                    peer.onConnect();
                } else {
                    peer.conn.once("connect", function() {
                        peer.onConnect();
                    });
                    peer.conn.once("error", function(err) {
                        peer.destroy(err);
                    });
                    peer.startConnectTimeout();
                }
                return peer;
            };
            exports.createTCPIncomingPeer = function(conn) {
                var addr = conn.remoteAddress + ":" + conn.remotePort;
                var peer = new Peer(addr, "tcpIncoming");
                peer.conn = conn;
                peer.addr = addr;
                peer.onConnect();
                return peer;
            };
            exports.createTCPOutgoingPeer = function(addr, swarm) {
                var peer = new Peer(addr, "tcpOutgoing");
                peer.addr = addr;
                peer.swarm = swarm;
                return peer;
            };
            exports.createWebSeedPeer = function(url, swarm) {
                var peer = new Peer(url, "webSeed");
                peer.swarm = swarm;
                peer.conn = new WebConn(url, swarm);
                peer.onConnect();
                return peer;
            };
            function Peer(id, type) {
                var self = this;
                self.id = id;
                self.type = type;
                debug("new Peer %s", id);
                self.addr = null;
                self.conn = null;
                self.swarm = null;
                self.wire = null;
                self.connected = false;
                self.destroyed = false;
                self.timeout = null;
                self.retries = 0;
                self.sentHandshake = false;
            }
            Peer.prototype.onConnect = function() {
                var self = this;
                if (self.destroyed) return;
                self.connected = true;
                debug("Peer %s connected", self.id);
                clearTimeout(self.connectTimeout);
                var conn = self.conn;
                conn.once("end", function() {
                    self.destroy();
                });
                conn.once("close", function() {
                    self.destroy();
                });
                conn.once("finish", function() {
                    self.destroy();
                });
                conn.once("error", function(err) {
                    self.destroy(err);
                });
                var wire = self.wire = new Wire();
                wire.type = self.type;
                wire.once("end", function() {
                    self.destroy();
                });
                wire.once("close", function() {
                    self.destroy();
                });
                wire.once("finish", function() {
                    self.destroy();
                });
                wire.once("error", function(err) {
                    self.destroy(err);
                });
                wire.once("handshake", function(infoHash, peerId) {
                    self.onHandshake(infoHash, peerId);
                });
                self.startHandshakeTimeout();
                conn.pipe(wire).pipe(conn);
                if (self.swarm && !self.sentHandshake) self.handshake();
            };
            Peer.prototype.onHandshake = function(infoHash, peerId) {
                var self = this;
                if (!self.swarm) return;
                if (self.destroyed) return;
                if (self.swarm.destroyed) {
                    return self.destroy(new Error("swarm already destroyed"));
                }
                if (infoHash !== self.swarm.infoHash) {
                    return self.destroy(new Error("unexpected handshake info hash for this swarm"));
                }
                if (peerId === self.swarm.peerId) {
                    return self.destroy(new Error("refusing to connect to ourselves"));
                }
                debug("Peer %s got handshake %s", self.id, infoHash);
                clearTimeout(self.handshakeTimeout);
                self.retries = 0;
                var addr = self.addr;
                if (!addr && self.conn.remoteAddress) {
                    addr = self.conn.remoteAddress + ":" + self.conn.remotePort;
                }
                self.swarm._onWire(self.wire, addr);
                if (!self.swarm || self.swarm.destroyed) return;
                if (!self.sentHandshake) self.handshake();
            };
            Peer.prototype.handshake = function() {
                var self = this;
                var opts = {
                    dht: self.swarm.private ? false : !!self.swarm.client.dht
                };
                self.wire.handshake(self.swarm.infoHash, self.swarm.client.peerId, opts);
                self.sentHandshake = true;
            };
            Peer.prototype.startConnectTimeout = function() {
                var self = this;
                clearTimeout(self.connectTimeout);
                self.connectTimeout = setTimeout(function() {
                    self.destroy(new Error("connect timeout"));
                }, self.type === "webrtc" ? CONNECT_TIMEOUT_WEBRTC : CONNECT_TIMEOUT_TCP);
                if (self.connectTimeout.unref) self.connectTimeout.unref();
            };
            Peer.prototype.startHandshakeTimeout = function() {
                var self = this;
                clearTimeout(self.handshakeTimeout);
                self.handshakeTimeout = setTimeout(function() {
                    self.destroy(new Error("handshake timeout"));
                }, HANDSHAKE_TIMEOUT);
                if (self.handshakeTimeout.unref) self.handshakeTimeout.unref();
            };
            Peer.prototype.destroy = function(err) {
                var self = this;
                if (self.destroyed) return;
                self.destroyed = true;
                self.connected = false;
                debug("destroy %s (error: %s)", self.id, err && (err.message || err));
                clearTimeout(self.connectTimeout);
                clearTimeout(self.handshakeTimeout);
                var swarm = self.swarm;
                var conn = self.conn;
                var wire = self.wire;
                self.swarm = null;
                self.conn = null;
                self.wire = null;
                if (swarm && wire) {
                    arrayRemove(swarm.wires, swarm.wires.indexOf(wire));
                }
                if (conn) {
                    conn.on("error", noop);
                    conn.destroy();
                }
                if (wire) wire.destroy();
                if (swarm) swarm.removePeer(self.id);
            };
            function noop() {}
        }, {
            "./webconn": 6,
            "bittorrent-protocol": 9,
            debug: 63,
            "unordered-array-remove": 141
        } ],
        4: [ function(require, module, exports) {
            module.exports = RarityMap;
            function RarityMap(torrent) {
                var self = this;
                self._torrent = torrent;
                self._numPieces = torrent.pieces.length;
                self._pieces = [];
                self._onWire = function(wire) {
                    self.recalculate();
                    self._initWire(wire);
                };
                self._onWireHave = function(index) {
                    self._pieces[index] += 1;
                };
                self._onWireBitfield = function() {
                    self.recalculate();
                };
                self._torrent.wires.forEach(function(wire) {
                    self._initWire(wire);
                });
                self._torrent.on("wire", self._onWire);
                self.recalculate();
            }
            RarityMap.prototype.getRarestPiece = function(pieceFilterFunc) {
                if (!pieceFilterFunc) pieceFilterFunc = trueFn;
                var candidates = [];
                var min = Infinity;
                for (var i = 0; i < this._numPieces; ++i) {
                    if (!pieceFilterFunc(i)) continue;
                    var availability = this._pieces[i];
                    if (availability === min) {
                        candidates.push(i);
                    } else if (availability < min) {
                        candidates = [ i ];
                        min = availability;
                    }
                }
                if (candidates.length > 0) {
                    return candidates[Math.random() * candidates.length | 0];
                } else {
                    return -1;
                }
            };
            RarityMap.prototype.destroy = function() {
                var self = this;
                self._torrent.removeListener("wire", self._onWire);
                self._torrent.wires.forEach(function(wire) {
                    self._cleanupWireEvents(wire);
                });
                self._torrent = null;
                self._pieces = null;
                self._onWire = null;
                self._onWireHave = null;
                self._onWireBitfield = null;
            };
            RarityMap.prototype._initWire = function(wire) {
                var self = this;
                wire._onClose = function() {
                    self._cleanupWireEvents(wire);
                    for (var i = 0; i < this._numPieces; ++i) {
                        self._pieces[i] -= wire.peerPieces.get(i);
                    }
                };
                wire.on("have", self._onWireHave);
                wire.on("bitfield", self._onWireBitfield);
                wire.once("close", wire._onClose);
            };
            RarityMap.prototype.recalculate = function() {
                var i;
                for (i = 0; i < this._numPieces; ++i) {
                    this._pieces[i] = 0;
                }
                var numWires = this._torrent.wires.length;
                for (i = 0; i < numWires; ++i) {
                    var wire = this._torrent.wires[i];
                    for (var j = 0; j < this._numPieces; ++j) {
                        this._pieces[j] += wire.peerPieces.get(j);
                    }
                }
            };
            RarityMap.prototype._cleanupWireEvents = function(wire) {
                wire.removeListener("have", this._onWireHave);
                wire.removeListener("bitfield", this._onWireBitfield);
                if (wire._onClose) wire.removeListener("close", wire._onClose);
                wire._onClose = null;
            };
            function trueFn() {
                return true;
            }
        }, {} ],
        5: [ function(require, module, exports) {
            (function(process, global) {
                module.exports = Torrent;
                var addrToIPPort = require("addr-to-ip-port");
                var BitField = require("bitfield");
                var ChunkStoreWriteStream = require("chunk-store-stream/write");
                var debug = require("debug")("webtorrent:torrent");
                var Discovery = require("torrent-discovery");
                var EventEmitter = require("events").EventEmitter;
                var extend = require("xtend");
                var extendMutable = require("xtend/mutable");
                var fs = require("fs");
                var FSChunkStore = require("fs-chunk-store");
                var get = require("simple-get");
                var ImmediateChunkStore = require("immediate-chunk-store");
                var inherits = require("inherits");
                var MultiStream = require("multistream");
                var net = require("net");
                var os = require("os");
                var parallel = require("run-parallel");
                var parallelLimit = require("run-parallel-limit");
                var parseTorrent = require("parse-torrent");
                var path = require("path");
                var Piece = require("torrent-piece");
                var pump = require("pump");
                var randomIterate = require("random-iterate");
                var sha1 = require("simple-sha1");
                var speedometer = require("speedometer");
                var uniq = require("uniq");
                var utMetadata = require("ut_metadata");
                var utPex = require("ut_pex");
                var File = require("./file");
                var Peer = require("./peer");
                var RarityMap = require("./rarity-map");
                var Server = require("./server");
                var MAX_BLOCK_LENGTH = 128 * 1024;
                var PIECE_TIMEOUT = 3e4;
                var CHOKE_TIMEOUT = 5e3;
                var SPEED_THRESHOLD = 3 * Piece.BLOCK_LENGTH;
                var PIPELINE_MIN_DURATION = .5;
                var PIPELINE_MAX_DURATION = 1;
                var RECHOKE_INTERVAL = 1e4;
                var RECHOKE_OPTIMISTIC_DURATION = 2;
                var FILESYSTEM_CONCURRENCY = 2;
                var RECONNECT_WAIT = [ 1e3, 5e3, 15e3 ];
                var VERSION = require("../package.json").version;
                var TMP;
                try {
                    TMP = path.join(fs.statSync("/tmp") && "/tmp", "webtorrent");
                } catch (err) {
                    TMP = path.join(typeof os.tmpDir === "function" ? os.tmpDir() : "/", "webtorrent");
                }
                inherits(Torrent, EventEmitter);
                function Torrent(torrentId, client, opts) {
                    EventEmitter.call(this);
                    this.client = client;
                    this._debugId = this.client.peerId.slice(32);
                    this._debug("new torrent");
                    this.announce = opts.announce;
                    this.urlList = opts.urlList;
                    this.path = opts.path;
                    this._store = opts.store || FSChunkStore;
                    this._getAnnounceOpts = opts.getAnnounceOpts;
                    this.strategy = opts.strategy || "sequential";
                    this.maxWebConns = opts.maxWebConns || 4;
                    this._rechokeNumSlots = opts.uploads === false || opts.uploads === 0 ? 0 : +opts.uploads || 10;
                    this._rechokeOptimisticWire = null;
                    this._rechokeOptimisticTime = 0;
                    this._rechokeIntervalId = null;
                    this.ready = false;
                    this.destroyed = false;
                    this.paused = false;
                    this.done = false;
                    this.metadata = null;
                    this.store = null;
                    this.files = [];
                    this.pieces = [];
                    this._amInterested = false;
                    this._selections = [];
                    this._critical = [];
                    this.wires = [];
                    this._queue = [];
                    this._peers = {};
                    this._peersLength = 0;
                    this.received = 0;
                    this.uploaded = 0;
                    this._downloadSpeed = speedometer();
                    this._uploadSpeed = speedometer();
                    this._servers = [];
                    this._xsRequests = [];
                    this._fileModtimes = opts.fileModtimes;
                    if (torrentId !== null) this._onTorrentId(torrentId);
                }
                Object.defineProperty(Torrent.prototype, "timeRemaining", {
                    get: function() {
                        if (this.done) return 0;
                        if (this.downloadSpeed === 0) return Infinity;
                        return (this.length - this.downloaded) / this.downloadSpeed * 1e3;
                    }
                });
                Object.defineProperty(Torrent.prototype, "downloaded", {
                    get: function() {
                        if (!this.bitfield) return 0;
                        var downloaded = 0;
                        for (var index = 0, len = this.pieces.length; index < len; ++index) {
                            if (this.bitfield.get(index)) {
                                downloaded += index === len - 1 ? this.lastPieceLength : this.pieceLength;
                            } else {
                                var piece = this.pieces[index];
                                downloaded += piece.length - piece.missing;
                            }
                        }
                        return downloaded;
                    }
                });
                Object.defineProperty(Torrent.prototype, "downloadSpeed", {
                    get: function() {
                        return this._downloadSpeed();
                    }
                });
                Object.defineProperty(Torrent.prototype, "uploadSpeed", {
                    get: function() {
                        return this._uploadSpeed();
                    }
                });
                Object.defineProperty(Torrent.prototype, "progress", {
                    get: function() {
                        return this.length ? this.downloaded / this.length : 0;
                    }
                });
                Object.defineProperty(Torrent.prototype, "ratio", {
                    get: function() {
                        return this.uploaded / (this.received || 1);
                    }
                });
                Object.defineProperty(Torrent.prototype, "numPeers", {
                    get: function() {
                        return this.wires.length;
                    }
                });
                Object.defineProperty(Torrent.prototype, "torrentFileBlobURL", {
                    get: function() {
                        if (typeof window === "undefined") throw new Error("browser-only property");
                        if (!this.torrentFile) return null;
                        return URL.createObjectURL(new Blob([ this.torrentFile ], {
                            type: "application/x-bittorrent"
                        }));
                    }
                });
                Object.defineProperty(Torrent.prototype, "_numQueued", {
                    get: function() {
                        return this._queue.length + (this._peersLength - this._numConns);
                    }
                });
                Object.defineProperty(Torrent.prototype, "_numConns", {
                    get: function() {
                        var self = this;
                        var numConns = 0;
                        for (var id in self._peers) {
                            if (self._peers[id].connected) numConns += 1;
                        }
                        return numConns;
                    }
                });
                Object.defineProperty(Torrent.prototype, "swarm", {
                    get: function() {
                        console.warn("WebTorrent: `torrent.swarm` is deprecated. Use `torrent` directly instead.");
                        return this;
                    }
                });
                Torrent.prototype._onTorrentId = function(torrentId) {
                    var self = this;
                    if (self.destroyed) return;
                    var parsedTorrent;
                    try {
                        parsedTorrent = parseTorrent(torrentId);
                    } catch (err) {}
                    if (parsedTorrent) {
                        self.infoHash = parsedTorrent.infoHash;
                        process.nextTick(function() {
                            if (self.destroyed) return;
                            self._onParsedTorrent(parsedTorrent);
                        });
                    } else {
                        parseTorrent.remote(torrentId, function(err, parsedTorrent) {
                            if (self.destroyed) return;
                            if (err) return self._destroy(err);
                            self._onParsedTorrent(parsedTorrent);
                        });
                    }
                };
                Torrent.prototype._onParsedTorrent = function(parsedTorrent) {
                    var self = this;
                    if (self.destroyed) return;
                    self._processParsedTorrent(parsedTorrent);
                    if (!self.infoHash) {
                        return self._destroy(new Error("Malformed torrent data: No info hash"));
                    }
                    if (!self.path) self.path = path.join(TMP, self.infoHash);
                    self._rechokeIntervalId = setInterval(function() {
                        self._rechoke();
                    }, RECHOKE_INTERVAL);
                    if (self._rechokeIntervalId.unref) self._rechokeIntervalId.unref();
                    self.emit("_infoHash", self.infoHash);
                    if (self.destroyed) return;
                    self.emit("infoHash", self.infoHash);
                    if (self.destroyed) return;
                    if (self.client.listening) {
                        self._onListening();
                    } else {
                        self.client.once("listening", function() {
                            self._onListening();
                        });
                    }
                };
                Torrent.prototype._processParsedTorrent = function(parsedTorrent) {
                    if (this.announce) {
                        parsedTorrent.announce = parsedTorrent.announce.concat(this.announce);
                    }
                    if (this.client.tracker && global.WEBTORRENT_ANNOUNCE && !this.private) {
                        parsedTorrent.announce = parsedTorrent.announce.concat(global.WEBTORRENT_ANNOUNCE);
                    }
                    if (this.urlList) {
                        parsedTorrent.urlList = parsedTorrent.urlList.concat(this.urlList);
                    }
                    uniq(parsedTorrent.announce);
                    uniq(parsedTorrent.urlList);
                    extendMutable(this, parsedTorrent);
                    this.magnetURI = parseTorrent.toMagnetURI(parsedTorrent);
                    this.torrentFile = parseTorrent.toTorrentFile(parsedTorrent);
                };
                Torrent.prototype._onListening = function() {
                    var self = this;
                    if (self.discovery || self.destroyed) return;
                    var trackerOpts = self.client.tracker;
                    if (trackerOpts) {
                        trackerOpts = extend(self.client.tracker, {
                            getAnnounceOpts: function() {
                                var opts = {
                                    uploaded: self.uploaded,
                                    downloaded: self.downloaded,
                                    left: Math.max(self.length - self.downloaded, 0)
                                };
                                if (self.client.tracker.getAnnounceOpts) {
                                    extendMutable(opts, self.client.tracker.getAnnounceOpts());
                                }
                                if (self._getAnnounceOpts) {
                                    extendMutable(opts, self._getAnnounceOpts());
                                }
                                return opts;
                            }
                        });
                    }
                    self.discovery = new Discovery({
                        infoHash: self.infoHash,
                        announce: self.announce,
                        peerId: self.client.peerId,
                        dht: !self.private && self.client.dht,
                        tracker: trackerOpts,
                        port: self.client.torrentPort
                    });
                    self.discovery.on("error", onError);
                    self.discovery.on("peer", onPeer);
                    self.discovery.on("trackerAnnounce", onTrackerAnnounce);
                    self.discovery.on("dhtAnnounce", onDHTAnnounce);
                    self.discovery.on("warning", onWarning);
                    function onError(err) {
                        self._destroy(err);
                    }
                    function onPeer(peer) {
                        if (typeof peer === "string" && self.done) return;
                        self.addPeer(peer);
                    }
                    function onTrackerAnnounce() {
                        self.emit("trackerAnnounce");
                        if (self.numPeers === 0) self.emit("noPeers", "tracker");
                    }
                    function onDHTAnnounce() {
                        self.emit("dhtAnnounce");
                        if (self.numPeers === 0) self.emit("noPeers", "dht");
                    }
                    function onWarning(err) {
                        self.emit("warning", err);
                    }
                    if (self.info) {
                        self._onMetadata(self);
                    } else if (self.xs) {
                        self._getMetadataFromServer();
                    }
                };
                Torrent.prototype._getMetadataFromServer = function() {
                    var self = this;
                    var urls = Array.isArray(self.xs) ? self.xs : [ self.xs ];
                    var tasks = urls.map(function(url) {
                        return function(cb) {
                            getMetadataFromURL(url, cb);
                        };
                    });
                    parallel(tasks);
                    function getMetadataFromURL(url, cb) {
                        if (url.indexOf("http://") !== 0 && url.indexOf("https://") !== 0) {
                            self._debug("skipping non-http xs param: %s", url);
                            return cb(null);
                        }
                        var opts = {
                            url: url,
                            method: "GET",
                            headers: {
                                "user-agent": "WebTorrent/" + VERSION + " (https://webtorrent.io)"
                            }
                        };
                        var req;
                        try {
                            req = get.concat(opts, onResponse);
                        } catch (err) {
                            self._debug("skipping invalid url xs param: %s", url);
                            return cb(null);
                        }
                        self._xsRequests.push(req);
                        function onResponse(err, res, torrent) {
                            if (self.destroyed) return cb(null);
                            if (self.metadata) return cb(null);
                            if (err) {
                                self._debug("http error from xs param: %s", url);
                                return cb(null);
                            }
                            if (res.statusCode !== 200) {
                                self._debug("non-200 status code %s from xs param: %s", res.statusCode, url);
                                return cb(null);
                            }
                            var parsedTorrent;
                            try {
                                parsedTorrent = parseTorrent(torrent);
                            } catch (err) {}
                            if (!parsedTorrent) {
                                self._debug("got invalid torrent file from xs param: %s", url);
                                return cb(null);
                            }
                            if (parsedTorrent.infoHash !== self.infoHash) {
                                self._debug("got torrent file with incorrect info hash from xs param: %s", url);
                                return cb(null);
                            }
                            self._onMetadata(parsedTorrent);
                            cb(null);
                        }
                    }
                };
                Torrent.prototype._onMetadata = function(metadata) {
                    var self = this;
                    if (self.metadata || self.destroyed) return;
                    self._debug("got metadata");
                    self._xsRequests.forEach(function(req) {
                        req.abort();
                    });
                    self._xsRequests = [];
                    var parsedTorrent;
                    if (metadata && metadata.infoHash) {
                        parsedTorrent = metadata;
                    } else {
                        try {
                            parsedTorrent = parseTorrent(metadata);
                        } catch (err) {
                            return self._destroy(err);
                        }
                    }
                    self._processParsedTorrent(parsedTorrent);
                    self.metadata = self.torrentFile;
                    self.urlList.forEach(function(url) {
                        self.addWebSeed(url);
                    });
                    self._rarityMap = new RarityMap(self);
                    self.store = new ImmediateChunkStore(new self._store(self.pieceLength, {
                        torrent: {
                            infoHash: self.infoHash
                        },
                        files: self.files.map(function(file) {
                            return {
                                path: path.join(self.path, file.path),
                                length: file.length,
                                offset: file.offset
                            };
                        }),
                        length: self.length
                    }));
                    self.files = self.files.map(function(file) {
                        return new File(self, file);
                    });
                    self._hashes = self.pieces;
                    self.pieces = self.pieces.map(function(hash, i) {
                        var pieceLength = i === self.pieces.length - 1 ? self.lastPieceLength : self.pieceLength;
                        return new Piece(pieceLength);
                    });
                    self._reservations = self.pieces.map(function() {
                        return [];
                    });
                    self.bitfield = new BitField(self.pieces.length);
                    self.wires.forEach(function(wire) {
                        if (wire.ut_metadata) wire.ut_metadata.setMetadata(self.metadata);
                        self._onWireWithMetadata(wire);
                    });
                    self._debug("verifying existing torrent data");
                    if (self._fileModtimes && self._store === FSChunkStore) {
                        self.getFileModtimes(function(err, fileModtimes) {
                            if (err) return self._destroy(err);
                            var unchanged = self.files.map(function(_, index) {
                                return fileModtimes[index] === self._fileModtimes[index];
                            }).every(function(x) {
                                return x;
                            });
                            if (unchanged) {
                                for (var index = 0; index < self.pieces.length; index++) {
                                    self._markVerified(index);
                                }
                                self._onStore();
                            } else {
                                self._verifyPieces();
                            }
                        });
                    } else {
                        self._verifyPieces();
                    }
                    self.emit("metadata");
                };
                Torrent.prototype.getFileModtimes = function(cb) {
                    var self = this;
                    var ret = [];
                    parallelLimit(self.files.map(function(file, index) {
                        return function(cb) {
                            fs.stat(path.join(self.path, file.path), function(err, stat) {
                                if (err && err.code !== "ENOENT") return cb(err);
                                ret[index] = stat && stat.mtime.getTime();
                                cb(null);
                            });
                        };
                    }), FILESYSTEM_CONCURRENCY, function(err) {
                        self._debug("done getting file modtimes");
                        cb(err, ret);
                    });
                };
                Torrent.prototype._verifyPieces = function() {
                    var self = this;
                    parallelLimit(self.pieces.map(function(_, index) {
                        return function(cb) {
                            if (self.destroyed) return cb(new Error("torrent is destroyed"));
                            self.store.get(index, function(err, buf) {
                                if (err) return cb(null);
                                sha1(buf, function(hash) {
                                    if (hash === self._hashes[index]) {
                                        if (!self.pieces[index]) return;
                                        self._debug("piece verified %s", index);
                                        self._markVerified(index);
                                    } else {
                                        self._debug("piece invalid %s", index);
                                    }
                                    cb(null);
                                });
                            });
                        };
                    }), FILESYSTEM_CONCURRENCY, function(err) {
                        if (err) return self._destroy(err);
                        self._debug("done verifying");
                        self._onStore();
                    });
                };
                Torrent.prototype._markVerified = function(index) {
                    this.pieces[index] = null;
                    this._reservations[index] = null;
                    this.bitfield.set(index, true);
                };
                Torrent.prototype._onStore = function() {
                    var self = this;
                    if (self.destroyed) return;
                    self._debug("on store");
                    if (self.pieces.length !== 0) {
                        self.select(0, self.pieces.length - 1, false);
                    }
                    self.ready = true;
                    self.emit("ready");
                    self._checkDone();
                    self._updateSelections();
                };
                Torrent.prototype.destroy = function(cb) {
                    var self = this;
                    self._destroy(null, cb);
                };
                Torrent.prototype._destroy = function(err, cb) {
                    var self = this;
                    if (self.destroyed) return;
                    self.destroyed = true;
                    self._debug("destroy");
                    self.client._remove(self);
                    clearInterval(self._rechokeIntervalId);
                    self._xsRequests.forEach(function(req) {
                        req.abort();
                    });
                    if (self._rarityMap) {
                        self._rarityMap.destroy();
                    }
                    for (var id in self._peers) {
                        self.removePeer(id);
                    }
                    self.files.forEach(function(file) {
                        if (file instanceof File) file._destroy();
                    });
                    var tasks = self._servers.map(function(server) {
                        return function(cb) {
                            server.destroy(cb);
                        };
                    });
                    if (self.discovery) {
                        tasks.push(function(cb) {
                            self.discovery.destroy(cb);
                        });
                    }
                    if (self.store) {
                        tasks.push(function(cb) {
                            self.store.close(cb);
                        });
                    }
                    parallel(tasks, cb);
                    if (err) {
                        if (self.listenerCount("error") === 0) {
                            self.client.emit("error", err);
                        } else {
                            self.emit("error", err);
                        }
                    }
                    self.emit("close");
                    self.client = null;
                    self.files = [];
                    self.discovery = null;
                    self.store = null;
                    self._rarityMap = null;
                    self._peers = null;
                    self._servers = null;
                    self._xsRequests = null;
                };
                Torrent.prototype.addPeer = function(peer) {
                    var self = this;
                    if (self.destroyed) throw new Error("torrent is destroyed");
                    if (!self.infoHash) throw new Error("addPeer() must not be called before the `infoHash` event");
                    if (self.client.blocked) {
                        var host;
                        if (typeof peer === "string") {
                            var parts;
                            try {
                                parts = addrToIPPort(peer);
                            } catch (e) {
                                self._debug("ignoring peer: invalid %s", peer);
                                self.emit("invalidPeer", peer);
                                return false;
                            }
                            host = parts[0];
                        } else if (typeof peer.remoteAddress === "string") {
                            host = peer.remoteAddress;
                        }
                        if (host && self.client.blocked.contains(host)) {
                            self._debug("ignoring peer: blocked %s", peer);
                            if (typeof peer !== "string") peer.destroy();
                            self.emit("blockedPeer", peer);
                            return false;
                        }
                    }
                    var wasAdded = !!self._addPeer(peer);
                    if (wasAdded) {
                        self.emit("peer", peer);
                    } else {
                        self.emit("invalidPeer", peer);
                    }
                    return wasAdded;
                };
                Torrent.prototype._addPeer = function(peer) {
                    var self = this;
                    if (self.destroyed) {
                        self._debug("ignoring peer: torrent is destroyed");
                        if (typeof peer !== "string") peer.destroy();
                        return null;
                    }
                    if (typeof peer === "string" && !self._validAddr(peer)) {
                        self._debug("ignoring peer: invalid %s", peer);
                        return null;
                    }
                    var id = peer && peer.id || peer;
                    if (self._peers[id]) {
                        self._debug("ignoring peer: duplicate (%s)", id);
                        if (typeof peer !== "string") peer.destroy();
                        return null;
                    }
                    if (self.paused) {
                        self._debug("ignoring peer: torrent is paused");
                        if (typeof peer !== "string") peer.destroy();
                        return null;
                    }
                    self._debug("add peer %s", id);
                    var newPeer;
                    if (typeof peer === "string") {
                        newPeer = Peer.createTCPOutgoingPeer(peer, self);
                    } else {
                        newPeer = Peer.createWebRTCPeer(peer, self);
                    }
                    self._peers[newPeer.id] = newPeer;
                    self._peersLength += 1;
                    if (typeof peer === "string") {
                        self._queue.push(newPeer);
                        self._drain();
                    }
                    return newPeer;
                };
                Torrent.prototype.addWebSeed = function(url) {
                    if (this.destroyed) throw new Error("torrent is destroyed");
                    if (!/^https?:\/\/.+/.test(url)) {
                        this._debug("ignoring invalid web seed %s", url);
                        this.emit("invalidPeer", url);
                        return;
                    }
                    if (this._peers[url]) {
                        this._debug("ignoring duplicate web seed %s", url);
                        this.emit("invalidPeer", url);
                        return;
                    }
                    this._debug("add web seed %s", url);
                    var newPeer = Peer.createWebSeedPeer(url, this);
                    this._peers[newPeer.id] = newPeer;
                    this._peersLength += 1;
                    this.emit("peer", url);
                };
                Torrent.prototype._addIncomingPeer = function(peer) {
                    var self = this;
                    if (self.destroyed) return peer.destroy(new Error("torrent is destroyed"));
                    if (self.paused) return peer.destroy(new Error("torrent is paused"));
                    this._debug("add incoming peer %s", peer.id);
                    self._peers[peer.id] = peer;
                    self._peersLength += 1;
                };
                Torrent.prototype.removePeer = function(peer) {
                    var self = this;
                    var id = peer && peer.id || peer;
                    peer = self._peers[id];
                    if (!peer) return;
                    this._debug("removePeer %s", id);
                    delete self._peers[id];
                    self._peersLength -= 1;
                    peer.destroy();
                    self._drain();
                };
                Torrent.prototype.select = function(start, end, priority, notify) {
                    var self = this;
                    if (self.destroyed) throw new Error("torrent is destroyed");
                    if (start < 0 || end < start || self.pieces.length <= end) {
                        throw new Error("invalid selection ", start, ":", end);
                    }
                    priority = Number(priority) || 0;
                    self._debug("select %s-%s (priority %s)", start, end, priority);
                    self._selections.push({
                        from: start,
                        to: end,
                        offset: 0,
                        priority: priority,
                        notify: notify || noop
                    });
                    self._selections.sort(function(a, b) {
                        return b.priority - a.priority;
                    });
                    self._updateSelections();
                };
                Torrent.prototype.deselect = function(start, end, priority) {
                    var self = this;
                    if (self.destroyed) throw new Error("torrent is destroyed");
                    priority = Number(priority) || 0;
                    self._debug("deselect %s-%s (priority %s)", start, end, priority);
                    for (var i = 0; i < self._selections.length; ++i) {
                        var s = self._selections[i];
                        if (s.from === start && s.to === end && s.priority === priority) {
                            self._selections.splice(i--, 1);
                            break;
                        }
                    }
                    self._updateSelections();
                };
                Torrent.prototype.critical = function(start, end) {
                    var self = this;
                    if (self.destroyed) throw new Error("torrent is destroyed");
                    self._debug("critical %s-%s", start, end);
                    for (var i = start; i <= end; ++i) {
                        self._critical[i] = true;
                    }
                    self._updateSelections();
                };
                Torrent.prototype._onWire = function(wire, addr) {
                    var self = this;
                    self._debug("got wire %s (%s)", wire._debugId, addr || "Unknown");
                    wire.on("download", function(downloaded) {
                        if (self.destroyed) return;
                        self.received += downloaded;
                        self._downloadSpeed(downloaded);
                        self.client._downloadSpeed(downloaded);
                        self.emit("download", downloaded);
                        self.client.emit("download", downloaded);
                    });
                    wire.on("upload", function(uploaded) {
                        if (self.destroyed) return;
                        self.uploaded += uploaded;
                        self._uploadSpeed(uploaded);
                        self.client._uploadSpeed(uploaded);
                        self.emit("upload", uploaded);
                        self.client.emit("upload", uploaded);
                    });
                    self.wires.push(wire);
                    if (addr) {
                        var parts = addrToIPPort(addr);
                        wire.remoteAddress = parts[0];
                        wire.remotePort = parts[1];
                    }
                    if (self.client.dht && self.client.dht.listening) {
                        wire.on("port", function(port) {
                            if (self.destroyed || self.client.dht.destroyed) {
                                return;
                            }
                            if (!wire.remoteAddress) {
                                return self._debug("ignoring PORT from peer with no address");
                            }
                            if (port === 0 || port > 65536) {
                                return self._debug("ignoring invalid PORT from peer");
                            }
                            self._debug("port: %s (from %s)", port, addr);
                            self.client.dht.addNode({
                                host: wire.remoteAddress,
                                port: port
                            });
                        });
                    }
                    wire.on("timeout", function() {
                        self._debug("wire timeout (%s)", addr);
                        wire.destroy();
                    });
                    wire.setTimeout(PIECE_TIMEOUT, true);
                    wire.setKeepAlive(true);
                    wire.use(utMetadata(self.metadata));
                    wire.ut_metadata.on("warning", function(err) {
                        self._debug("ut_metadata warning: %s", err.message);
                    });
                    if (!self.metadata) {
                        wire.ut_metadata.on("metadata", function(metadata) {
                            self._debug("got metadata via ut_metadata");
                            self._onMetadata(metadata);
                        });
                        wire.ut_metadata.fetch();
                    }
                    if (typeof utPex === "function" && !self.private) {
                        wire.use(utPex());
                        wire.ut_pex.on("peer", function(peer) {
                            if (self.done) return;
                            self._debug("ut_pex: got peer: %s (from %s)", peer, addr);
                            self.addPeer(peer);
                        });
                        wire.ut_pex.on("dropped", function(peer) {
                            var peerObj = self._peers[peer];
                            if (peerObj && !peerObj.connected) {
                                self._debug("ut_pex: dropped peer: %s (from %s)", peer, addr);
                                self.removePeer(peer);
                            }
                        });
                        wire.once("close", function() {
                            wire.ut_pex.reset();
                        });
                    }
                    self.emit("wire", wire, addr);
                    if (self.metadata) {
                        process.nextTick(function() {
                            self._onWireWithMetadata(wire);
                        });
                    }
                };
                Torrent.prototype._onWireWithMetadata = function(wire) {
                    var self = this;
                    var timeoutId = null;
                    function onChokeTimeout() {
                        if (self.destroyed || wire.destroyed) return;
                        if (self._numQueued > 2 * (self._numConns - self.numPeers) && wire.amInterested) {
                            wire.destroy();
                        } else {
                            timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT);
                            if (timeoutId.unref) timeoutId.unref();
                        }
                    }
                    var i = 0;
                    function updateSeedStatus() {
                        if (wire.peerPieces.length !== self.pieces.length) return;
                        for (;i < self.pieces.length; ++i) {
                            if (!wire.peerPieces.get(i)) return;
                        }
                        wire.isSeeder = true;
                        wire.choke();
                    }
                    wire.on("bitfield", function() {
                        updateSeedStatus();
                        self._update();
                    });
                    wire.on("have", function() {
                        updateSeedStatus();
                        self._update();
                    });
                    wire.once("interested", function() {
                        wire.unchoke();
                    });
                    wire.once("close", function() {
                        clearTimeout(timeoutId);
                    });
                    wire.on("choke", function() {
                        clearTimeout(timeoutId);
                        timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT);
                        if (timeoutId.unref) timeoutId.unref();
                    });
                    wire.on("unchoke", function() {
                        clearTimeout(timeoutId);
                        self._update();
                    });
                    wire.on("request", function(index, offset, length, cb) {
                        if (length > MAX_BLOCK_LENGTH) {
                            return wire.destroy();
                        }
                        if (self.pieces[index]) return;
                        self.store.get(index, {
                            offset: offset,
                            length: length
                        }, cb);
                    });
                    wire.bitfield(self.bitfield);
                    wire.interested();
                    if (wire.peerExtensions.dht && self.client.dht && self.client.dht.listening) {
                        wire.port(self.client.dht.address().port);
                    }
                    timeoutId = setTimeout(onChokeTimeout, CHOKE_TIMEOUT);
                    if (timeoutId.unref) timeoutId.unref();
                    wire.isSeeder = false;
                    updateSeedStatus();
                };
                Torrent.prototype._updateSelections = function() {
                    var self = this;
                    if (!self.ready || self.destroyed) return;
                    process.nextTick(function() {
                        self._gcSelections();
                    });
                    self._updateInterest();
                    self._update();
                };
                Torrent.prototype._gcSelections = function() {
                    var self = this;
                    for (var i = 0; i < self._selections.length; i++) {
                        var s = self._selections[i];
                        var oldOffset = s.offset;
                        while (self.bitfield.get(s.from + s.offset) && s.from + s.offset < s.to) {
                            s.offset++;
                        }
                        if (oldOffset !== s.offset) s.notify();
                        if (s.to !== s.from + s.offset) continue;
                        if (!self.bitfield.get(s.from + s.offset)) continue;
                        self._selections.splice(i--, 1);
                        s.notify();
                        self._updateInterest();
                    }
                    if (!self._selections.length) self.emit("idle");
                };
                Torrent.prototype._updateInterest = function() {
                    var self = this;
                    var prev = self._amInterested;
                    self._amInterested = !!self._selections.length;
                    self.wires.forEach(function(wire) {
                        if (self._amInterested) wire.interested(); else wire.uninterested();
                    });
                    if (prev === self._amInterested) return;
                    if (self._amInterested) self.emit("interested"); else self.emit("uninterested");
                };
                Torrent.prototype._update = function() {
                    var self = this;
                    if (self.destroyed) return;
                    var ite = randomIterate(self.wires);
                    var wire;
                    while (wire = ite()) {
                        self._updateWire(wire);
                    }
                };
                Torrent.prototype._updateWire = function(wire) {
                    var self = this;
                    if (wire.peerChoking) return;
                    if (!wire.downloaded) return validateWire();
                    var minOutstandingRequests = getBlockPipelineLength(wire, PIPELINE_MIN_DURATION);
                    if (wire.requests.length >= minOutstandingRequests) return;
                    var maxOutstandingRequests = getBlockPipelineLength(wire, PIPELINE_MAX_DURATION);
                    trySelectWire(false) || trySelectWire(true);
                    function genPieceFilterFunc(start, end, tried, rank) {
                        return function(i) {
                            return i >= start && i <= end && !(i in tried) && wire.peerPieces.get(i) && (!rank || rank(i));
                        };
                    }
                    function validateWire() {
                        if (wire.requests.length) return;
                        var i = self._selections.length;
                        while (i--) {
                            var next = self._selections[i];
                            var piece;
                            if (self.strategy === "rarest") {
                                var start = next.from + next.offset;
                                var end = next.to;
                                var len = end - start + 1;
                                var tried = {};
                                var tries = 0;
                                var filter = genPieceFilterFunc(start, end, tried);
                                while (tries < len) {
                                    piece = self._rarityMap.getRarestPiece(filter);
                                    if (piece < 0) break;
                                    if (self._request(wire, piece, false)) return;
                                    tried[piece] = true;
                                    tries += 1;
                                }
                            } else {
                                for (piece = next.to; piece >= next.from + next.offset; --piece) {
                                    if (!wire.peerPieces.get(piece)) continue;
                                    if (self._request(wire, piece, false)) return;
                                }
                            }
                        }
                    }
                    function speedRanker() {
                        var speed = wire.downloadSpeed() || 1;
                        if (speed > SPEED_THRESHOLD) return function() {
                            return true;
                        };
                        var secs = Math.max(1, wire.requests.length) * Piece.BLOCK_LENGTH / speed;
                        var tries = 10;
                        var ptr = 0;
                        return function(index) {
                            if (!tries || self.bitfield.get(index)) return true;
                            var missing = self.pieces[index].missing;
                            for (;ptr < self.wires.length; ptr++) {
                                var otherWire = self.wires[ptr];
                                var otherSpeed = otherWire.downloadSpeed();
                                if (otherSpeed < SPEED_THRESHOLD) continue;
                                if (otherSpeed <= speed) continue;
                                if (!otherWire.peerPieces.get(index)) continue;
                                if ((missing -= otherSpeed * secs) > 0) continue;
                                tries--;
                                return false;
                            }
                            return true;
                        };
                    }
                    function shufflePriority(i) {
                        var last = i;
                        for (var j = i; j < self._selections.length && self._selections[j].priority; j++) {
                            last = j;
                        }
                        var tmp = self._selections[i];
                        self._selections[i] = self._selections[last];
                        self._selections[last] = tmp;
                    }
                    function trySelectWire(hotswap) {
                        if (wire.requests.length >= maxOutstandingRequests) return true;
                        var rank = speedRanker();
                        for (var i = 0; i < self._selections.length; i++) {
                            var next = self._selections[i];
                            var piece;
                            if (self.strategy === "rarest") {
                                var start = next.from + next.offset;
                                var end = next.to;
                                var len = end - start + 1;
                                var tried = {};
                                var tries = 0;
                                var filter = genPieceFilterFunc(start, end, tried, rank);
                                while (tries < len) {
                                    piece = self._rarityMap.getRarestPiece(filter);
                                    if (piece < 0) break;
                                    while (self._request(wire, piece, self._critical[piece] || hotswap)) {}
                                    if (wire.requests.length < maxOutstandingRequests) {
                                        tried[piece] = true;
                                        tries++;
                                        continue;
                                    }
                                    if (next.priority) shufflePriority(i);
                                    return true;
                                }
                            } else {
                                for (piece = next.from + next.offset; piece <= next.to; piece++) {
                                    if (!wire.peerPieces.get(piece) || !rank(piece)) continue;
                                    while (self._request(wire, piece, self._critical[piece] || hotswap)) {}
                                    if (wire.requests.length < maxOutstandingRequests) continue;
                                    if (next.priority) shufflePriority(i);
                                    return true;
                                }
                            }
                        }
                        return false;
                    }
                };
                Torrent.prototype._rechoke = function() {
                    var self = this;
                    if (!self.ready) return;
                    if (self._rechokeOptimisticTime > 0) self._rechokeOptimisticTime -= 1; else self._rechokeOptimisticWire = null;
                    var peers = [];
                    self.wires.forEach(function(wire) {
                        if (!wire.isSeeder && wire !== self._rechokeOptimisticWire) {
                            peers.push({
                                wire: wire,
                                downloadSpeed: wire.downloadSpeed(),
                                uploadSpeed: wire.uploadSpeed(),
                                salt: Math.random(),
                                isChoked: true
                            });
                        }
                    });
                    peers.sort(rechokeSort);
                    var unchokeInterested = 0;
                    var i = 0;
                    for (;i < peers.length && unchokeInterested < self._rechokeNumSlots; ++i) {
                        peers[i].isChoked = false;
                        if (peers[i].wire.peerInterested) unchokeInterested += 1;
                    }
                    if (!self._rechokeOptimisticWire && i < peers.length && self._rechokeNumSlots) {
                        var candidates = peers.slice(i).filter(function(peer) {
                            return peer.wire.peerInterested;
                        });
                        var optimistic = candidates[randomInt(candidates.length)];
                        if (optimistic) {
                            optimistic.isChoked = false;
                            self._rechokeOptimisticWire = optimistic.wire;
                            self._rechokeOptimisticTime = RECHOKE_OPTIMISTIC_DURATION;
                        }
                    }
                    peers.forEach(function(peer) {
                        if (peer.wire.amChoking !== peer.isChoked) {
                            if (peer.isChoked) peer.wire.choke(); else peer.wire.unchoke();
                        }
                    });
                    function rechokeSort(peerA, peerB) {
                        if (peerA.downloadSpeed !== peerB.downloadSpeed) {
                            return peerB.downloadSpeed - peerA.downloadSpeed;
                        }
                        if (peerA.uploadSpeed !== peerB.uploadSpeed) {
                            return peerB.uploadSpeed - peerA.uploadSpeed;
                        }
                        if (peerA.wire.amChoking !== peerB.wire.amChoking) {
                            return peerA.wire.amChoking ? 1 : -1;
                        }
                        return peerA.salt - peerB.salt;
                    }
                };
                Torrent.prototype._hotswap = function(wire, index) {
                    var self = this;
                    var speed = wire.downloadSpeed();
                    if (speed < Piece.BLOCK_LENGTH) return false;
                    if (!self._reservations[index]) return false;
                    var r = self._reservations[index];
                    if (!r) {
                        return false;
                    }
                    var minSpeed = Infinity;
                    var minWire;
                    var i;
                    for (i = 0; i < r.length; i++) {
                        var otherWire = r[i];
                        if (!otherWire || otherWire === wire) continue;
                        var otherSpeed = otherWire.downloadSpeed();
                        if (otherSpeed >= SPEED_THRESHOLD) continue;
                        if (2 * otherSpeed > speed || otherSpeed > minSpeed) continue;
                        minWire = otherWire;
                        minSpeed = otherSpeed;
                    }
                    if (!minWire) return false;
                    for (i = 0; i < r.length; i++) {
                        if (r[i] === minWire) r[i] = null;
                    }
                    for (i = 0; i < minWire.requests.length; i++) {
                        var req = minWire.requests[i];
                        if (req.piece !== index) continue;
                        self.pieces[index].cancel(req.offset / Piece.BLOCK_LENGTH | 0);
                    }
                    self.emit("hotswap", minWire, wire, index);
                    return true;
                };
                Torrent.prototype._request = function(wire, index, hotswap) {
                    var self = this;
                    var numRequests = wire.requests.length;
                    var isWebSeed = wire.type === "webSeed";
                    if (self.bitfield.get(index)) return false;
                    var maxOutstandingRequests = isWebSeed ? Math.min(getPiecePipelineLength(wire, PIPELINE_MAX_DURATION, self.pieceLength), self.maxWebConns) : getBlockPipelineLength(wire, PIPELINE_MAX_DURATION);
                    if (numRequests >= maxOutstandingRequests) return false;
                    var piece = self.pieces[index];
                    var reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve();
                    if (reservation === -1 && hotswap && self._hotswap(wire, index)) {
                        reservation = isWebSeed ? piece.reserveRemaining() : piece.reserve();
                    }
                    if (reservation === -1) return false;
                    var r = self._reservations[index];
                    if (!r) r = self._reservations[index] = [];
                    var i = r.indexOf(null);
                    if (i === -1) i = r.length;
                    r[i] = wire;
                    var chunkOffset = piece.chunkOffset(reservation);
                    var chunkLength = isWebSeed ? piece.chunkLengthRemaining(reservation) : piece.chunkLength(reservation);
                    wire.request(index, chunkOffset, chunkLength, function onChunk(err, chunk) {
                        if (!self.ready) return self.once("ready", function() {
                            onChunk(err, chunk);
                        });
                        if (r[i] === wire) r[i] = null;
                        if (piece !== self.pieces[index]) return onUpdateTick();
                        if (err) {
                            self._debug("error getting piece %s (offset: %s length: %s) from %s: %s", index, chunkOffset, chunkLength, wire.remoteAddress + ":" + wire.remotePort, err.message);
                            isWebSeed ? piece.cancelRemaining(reservation) : piece.cancel(reservation);
                            onUpdateTick();
                            return;
                        }
                        self._debug("got piece %s (offset: %s length: %s) from %s", index, chunkOffset, chunkLength, wire.remoteAddress + ":" + wire.remotePort);
                        if (!piece.set(reservation, chunk, wire)) return onUpdateTick();
                        var buf = piece.flush();
                        sha1(buf, function(hash) {
                            if (hash === self._hashes[index]) {
                                if (!self.pieces[index]) return;
                                self._debug("piece verified %s", index);
                                self.pieces[index] = null;
                                self._reservations[index] = null;
                                self.bitfield.set(index, true);
                                self.store.put(index, buf);
                                self.wires.forEach(function(wire) {
                                    wire.have(index);
                                });
                                self._checkDone();
                            } else {
                                self.pieces[index] = new Piece(piece.length);
                                self.emit("warning", new Error("Piece " + index + " failed verification"));
                            }
                            onUpdateTick();
                        });
                    });
                    function onUpdateTick() {
                        process.nextTick(function() {
                            self._update();
                        });
                    }
                    return true;
                };
                Torrent.prototype._checkDone = function() {
                    var self = this;
                    if (self.destroyed) return;
                    self.files.forEach(function(file) {
                        if (file.done) return;
                        for (var i = file._startPiece; i <= file._endPiece; ++i) {
                            if (!self.bitfield.get(i)) return;
                        }
                        file.done = true;
                        file.emit("done");
                        self._debug("file done: " + file.name);
                    });
                    var done = true;
                    for (var i = 0; i < self._selections.length; i++) {
                        var selection = self._selections[i];
                        for (var piece = selection.from; piece <= selection.to; piece++) {
                            if (!self.bitfield.get(piece)) {
                                done = false;
                                break;
                            }
                        }
                        if (!done) break;
                    }
                    if (!self.done && done) {
                        self.done = true;
                        self._debug("torrent done: " + self.infoHash);
                        if (self.discovery.tracker) {
                            self.discovery.tracker.complete();
                        }
                        self.emit("done");
                    }
                    self._gcSelections();
                };
                Torrent.prototype.load = function(streams, cb) {
                    var self = this;
                    if (self.destroyed) throw new Error("torrent is destroyed");
                    if (!self.ready) return self.once("ready", function() {
                        self.load(streams, cb);
                    });
                    if (!Array.isArray(streams)) streams = [ streams ];
                    if (!cb) cb = noop;
                    var readable = new MultiStream(streams);
                    var writable = new ChunkStoreWriteStream(self.store, self.pieceLength);
                    pump(readable, writable, function(err) {
                        if (err) return cb(err);
                        self.pieces.forEach(function(piece, index) {
                            self.pieces[index] = null;
                            self._reservations[index] = null;
                            self.bitfield.set(index, true);
                        });
                        self._checkDone();
                        cb(null);
                    });
                };
                Torrent.prototype.createServer = function(opts) {
                    if (typeof Server !== "function") throw new Error("node.js-only method");
                    if (this.destroyed) throw new Error("torrent is destroyed");
                    var server = new Server(this, opts);
                    this._servers.push(server);
                    return server;
                };
                Torrent.prototype.pause = function() {
                    if (this.destroyed) return;
                    this._debug("pause");
                    this.paused = true;
                };
                Torrent.prototype.resume = function() {
                    if (this.destroyed) return;
                    this._debug("resume");
                    this.paused = false;
                    this._drain();
                };
                Torrent.prototype._debug = function() {
                    var args = [].slice.call(arguments);
                    args[0] = "[" + this._debugId + "] " + args[0];
                    debug.apply(null, args);
                };
                Torrent.prototype._drain = function() {
                    var self = this;
                    this._debug("_drain numConns %s maxConns %s", self._numConns, self.client.maxConns);
                    if (typeof net.connect !== "function" || self.destroyed || self.paused || self._numConns >= self.client.maxConns) {
                        return;
                    }
                    this._debug("drain (%s queued, %s/%s peers)", self._numQueued, self.numPeers, self.client.maxConns);
                    var peer = self._queue.shift();
                    if (!peer) return;
                    this._debug("tcp connect attempt to %s", peer.addr);
                    var parts = addrToIPPort(peer.addr);
                    var opts = {
                        host: parts[0],
                        port: parts[1]
                    };
                    var conn = peer.conn = net.connect(opts);
                    conn.once("connect", function() {
                        peer.onConnect();
                    });
                    conn.once("error", function(err) {
                        peer.destroy(err);
                    });
                    peer.startConnectTimeout();
                    conn.on("close", function() {
                        if (self.destroyed) return;
                        if (peer.retries >= RECONNECT_WAIT.length) {
                            self._debug("conn %s closed: will not re-add (max %s attempts)", peer.addr, RECONNECT_WAIT.length);
                            return;
                        }
                        var ms = RECONNECT_WAIT[peer.retries];
                        self._debug("conn %s closed: will re-add to queue in %sms (attempt %s)", peer.addr, ms, peer.retries + 1);
                        var reconnectTimeout = setTimeout(function reconnectTimeout() {
                            var newPeer = self._addPeer(peer.addr);
                            if (newPeer) newPeer.retries = peer.retries + 1;
                        }, ms);
                        if (reconnectTimeout.unref) reconnectTimeout.unref();
                    });
                };
                Torrent.prototype._validAddr = function(addr) {
                    var parts;
                    try {
                        parts = addrToIPPort(addr);
                    } catch (e) {
                        return false;
                    }
                    var host = parts[0];
                    var port = parts[1];
                    return port > 0 && port < 65535 && !(host === "127.0.0.1" && port === this.client.torrentPort);
                };
                function getBlockPipelineLength(wire, duration) {
                    return 2 + Math.ceil(duration * wire.downloadSpeed() / Piece.BLOCK_LENGTH);
                }
                function getPiecePipelineLength(wire, duration, pieceLength) {
                    return 1 + Math.ceil(duration * wire.downloadSpeed() / pieceLength);
                }
                function randomInt(high) {
                    return Math.random() * high | 0;
                }
                function noop() {}
            }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {
            "../package.json": 149,
            "./file": 2,
            "./peer": 3,
            "./rarity-map": 4,
            "./server": 21,
            _process: 30,
            "addr-to-ip-port": 7,
            bitfield: 8,
            "chunk-store-stream/write": 45,
            debug: 63,
            events: 26,
            fs: 20,
            "fs-chunk-store": 72,
            "immediate-chunk-store": 70,
            inherits: 71,
            multistream: 73,
            net: 21,
            os: 21,
            "parse-torrent": 74,
            path: 29,
            pump: 84,
            "random-iterate": 87,
            "run-parallel": 118,
            "run-parallel-limit": 117,
            "simple-get": 121,
            "simple-sha1": 128,
            speedometer: 130,
            "torrent-discovery": 138,
            "torrent-piece": 139,
            uniq: 140,
            ut_metadata: 142,
            ut_pex: 21,
            xtend: 146,
            "xtend/mutable": 147
        } ],
        6: [ function(require, module, exports) {
            module.exports = WebConn;
            var BitField = require("bitfield");
            var Buffer = require("safe-buffer").Buffer;
            var debug = require("debug")("webtorrent:webconn");
            var get = require("simple-get");
            var inherits = require("inherits");
            var sha1 = require("simple-sha1");
            var Wire = require("bittorrent-protocol");
            var VERSION = require("../package.json").version;
            inherits(WebConn, Wire);
            function WebConn(url, torrent) {
                Wire.call(this);
                this.url = url;
                this.webPeerId = sha1.sync(url);
                this._torrent = torrent;
                this._init();
            }
            WebConn.prototype._init = function() {
                var self = this;
                self.setKeepAlive(true);
                self.once("handshake", function(infoHash, peerId) {
                    if (self.destroyed) return;
                    self.handshake(infoHash, self.webPeerId);
                    var numPieces = self._torrent.pieces.length;
                    var bitfield = new BitField(numPieces);
                    for (var i = 0; i <= numPieces; i++) {
                        bitfield.set(i, true);
                    }
                    self.bitfield(bitfield);
                });
                self.once("interested", function() {
                    debug("interested");
                    self.unchoke();
                });
                self.on("uninterested", function() {
                    debug("uninterested");
                });
                self.on("choke", function() {
                    debug("choke");
                });
                self.on("unchoke", function() {
                    debug("unchoke");
                });
                self.on("bitfield", function() {
                    debug("bitfield");
                });
                self.on("request", function(pieceIndex, offset, length, callback) {
                    debug("request pieceIndex=%d offset=%d length=%d", pieceIndex, offset, length);
                    self.httpRequest(pieceIndex, offset, length, callback);
                });
            };
            WebConn.prototype.httpRequest = function(pieceIndex, offset, length, cb) {
                var self = this;
                var pieceOffset = pieceIndex * self._torrent.pieceLength;
                var rangeStart = pieceOffset + offset;
                var rangeEnd = rangeStart + length - 1;
                var files = self._torrent.files;
                var requests;
                if (files.length <= 1) {
                    requests = [ {
                        url: self.url,
                        start: rangeStart,
                        end: rangeEnd
                    } ];
                } else {
                    var requestedFiles = files.filter(function(file) {
                        return file.offset <= rangeEnd && file.offset + file.length > rangeStart;
                    });
                    if (requestedFiles.length < 1) {
                        return cb(new Error("Could not find file corresponnding to web seed range request"));
                    }
                    requests = requestedFiles.map(function(requestedFile) {
                        var fileEnd = requestedFile.offset + requestedFile.length - 1;
                        var url = self.url + (self.url[self.url.length - 1] === "/" ? "" : "/") + requestedFile.path;
                        return {
                            url: url,
                            fileOffsetInRange: Math.max(requestedFile.offset - rangeStart, 0),
                            start: Math.max(rangeStart - requestedFile.offset, 0),
                            end: Math.min(fileEnd, rangeEnd - requestedFile.offset)
                        };
                    });
                }
                var numRequestsSucceeded = 0;
                var hasError = false;
                var ret;
                if (requests.length > 1) {
                    ret = Buffer.alloc(length);
                }
                requests.forEach(function(request) {
                    var url = request.url;
                    var start = request.start;
                    var end = request.end;
                    debug("Requesting url=%s pieceIndex=%d offset=%d length=%d start=%d end=%d", url, pieceIndex, offset, length, start, end);
                    var opts = {
                        url: url,
                        method: "GET",
                        headers: {
                            "user-agent": "WebTorrent/" + VERSION + " (https://webtorrent.io)",
                            range: "bytes=" + start + "-" + end
                        }
                    };
                    get.concat(opts, function(err, res, data) {
                        if (hasError) return;
                        if (err) {
                            hasError = true;
                            return cb(err);
                        }
                        if (res.statusCode < 200 || res.statusCode >= 300) {
                            hasError = true;
                            return cb(new Error("Unexpected HTTP status code " + res.statusCode));
                        }
                        debug("Got data of length %d", data.length);
                        if (requests.length === 1) {
                            cb(null, data);
                        } else {
                            data.copy(ret, request.fileOffsetInRange);
                            if (++numRequestsSucceeded === requests.length) {
                                cb(null, ret);
                            }
                        }
                    });
                });
            };
            WebConn.prototype.destroy = function() {
                Wire.prototype.destroy.call(this);
                this._torrent = null;
            };
        }, {
            "../package.json": 149,
            bitfield: 8,
            "bittorrent-protocol": 9,
            debug: 63,
            inherits: 71,
            "safe-buffer": 119,
            "simple-get": 121,
            "simple-sha1": 128
        } ],
        7: [ function(require, module, exports) {
            var ADDR_RE = /^\[?([^\]]+)\]?:(\d+)$/;
            var cache = {};
            var size = 0;
            module.exports = function addrToIPPort(addr) {
                if (size === 1e5) module.exports.reset();
                if (!cache[addr]) {
                    var m = ADDR_RE.exec(addr);
                    if (!m) throw new Error("invalid addr: " + addr);
                    cache[addr] = [ m[1], Number(m[2]) ];
                    size += 1;
                }
                return cache[addr];
            };
            module.exports.reset = function reset() {
                cache = {};
                size = 0;
            };
        }, {} ],
        8: [ function(require, module, exports) {
            (function(Buffer) {
                var Container = typeof Buffer !== "undefined" ? Buffer : typeof Int8Array !== "undefined" ? Int8Array : function(l) {
                    var a = new Array(l);
                    for (var i = 0; i < l; i++) a[i] = 0;
                };
                function BitField(data, opts) {
                    if (!(this instanceof BitField)) {
                        return new BitField(data, opts);
                    }
                    if (arguments.length === 0) {
                        data = 0;
                    }
                    this.grow = opts && (isFinite(opts.grow) && getByteSize(opts.grow) || opts.grow) || 0;
                    if (typeof data === "number" || data === undefined) {
                        data = new Container(getByteSize(data));
                        if (data.fill && !data._isBuffer) data.fill(0);
                    }
                    this.buffer = data;
                }
                function getByteSize(num) {
                    var out = num >> 3;
                    if (num % 8 !== 0) out++;
                    return out;
                }
                BitField.prototype.get = function(i) {
                    var j = i >> 3;
                    return j < this.buffer.length && !!(this.buffer[j] & 128 >> i % 8);
                };
                BitField.prototype.set = function(i, b) {
                    var j = i >> 3;
                    if (b || arguments.length === 1) {
                        if (this.buffer.length < j + 1) this._grow(Math.max(j + 1, Math.min(2 * this.buffer.length, this.grow)));
                        this.buffer[j] |= 128 >> i % 8;
                    } else if (j < this.buffer.length) {
                        this.buffer[j] &= ~(128 >> i % 8);
                    }
                };
                BitField.prototype._grow = function(length) {
                    if (this.buffer.length < length && length <= this.grow) {
                        var newBuffer = new Container(length);
                        if (newBuffer.fill) newBuffer.fill(0);
                        if (this.buffer.copy) this.buffer.copy(newBuffer, 0); else {
                            for (var i = 0; i < this.buffer.length; i++) {
                                newBuffer[i] = this.buffer[i];
                            }
                        }
                        this.buffer = newBuffer;
                    }
                };
                if (typeof module !== "undefined") module.exports = BitField;
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        9: [ function(require, module, exports) {
            module.exports = Wire;
            var bencode = require("bencode");
            var BitField = require("bitfield");
            var Buffer = require("safe-buffer").Buffer;
            var debug = require("debug")("bittorrent-protocol");
            var extend = require("xtend");
            var hat = require("hat");
            var inherits = require("inherits");
            var speedometer = require("speedometer");
            var stream = require("readable-stream");
            var BITFIELD_GROW = 4e5;
            var KEEP_ALIVE_TIMEOUT = 55e3;
            var MESSAGE_PROTOCOL = Buffer.from("BitTorrent protocol");
            var MESSAGE_KEEP_ALIVE = Buffer.from([ 0, 0, 0, 0 ]);
            var MESSAGE_CHOKE = Buffer.from([ 0, 0, 0, 1, 0 ]);
            var MESSAGE_UNCHOKE = Buffer.from([ 0, 0, 0, 1, 1 ]);
            var MESSAGE_INTERESTED = Buffer.from([ 0, 0, 0, 1, 2 ]);
            var MESSAGE_UNINTERESTED = Buffer.from([ 0, 0, 0, 1, 3 ]);
            var MESSAGE_RESERVED = [ 0, 0, 0, 0, 0, 0, 0, 0 ];
            var MESSAGE_PORT = [ 0, 0, 0, 3, 9, 0, 0 ];
            function Request(piece, offset, length, callback) {
                this.piece = piece;
                this.offset = offset;
                this.length = length;
                this.callback = callback;
            }
            inherits(Wire, stream.Duplex);
            function Wire() {
                if (!(this instanceof Wire)) return new Wire();
                stream.Duplex.call(this);
                this._debugId = hat(32);
                this._debug("new wire");
                this.peerId = null;
                this.peerIdBuffer = null;
                this.type = null;
                this.amChoking = true;
                this.amInterested = false;
                this.peerChoking = true;
                this.peerInterested = false;
                this.peerPieces = new BitField(0, {
                    grow: BITFIELD_GROW
                });
                this.peerExtensions = {};
                this.requests = [];
                this.peerRequests = [];
                this.extendedMapping = {};
                this.peerExtendedMapping = {};
                this.extendedHandshake = {};
                this.peerExtendedHandshake = {};
                this._ext = {};
                this._nextExt = 1;
                this.uploaded = 0;
                this.downloaded = 0;
                this.uploadSpeed = speedometer();
                this.downloadSpeed = speedometer();
                this._keepAliveInterval = null;
                this._timeout = null;
                this._timeoutMs = 0;
                this.destroyed = false;
                this._finished = false;
                this._parserSize = 0;
                this._parser = null;
                this._buffer = [];
                this._bufferSize = 0;
                this.on("finish", this._onFinish);
                this._parseHandshake();
            }
            Wire.prototype.setKeepAlive = function(enable) {
                var self = this;
                self._debug("setKeepAlive %s", enable);
                clearInterval(self._keepAliveInterval);
                if (enable === false) return;
                self._keepAliveInterval = setInterval(function() {
                    self.keepAlive();
                }, KEEP_ALIVE_TIMEOUT);
            };
            Wire.prototype.setTimeout = function(ms, unref) {
                this._debug("setTimeout ms=%d unref=%s", ms, unref);
                this._clearTimeout();
                this._timeoutMs = ms;
                this._timeoutUnref = !!unref;
                this._updateTimeout();
            };
            Wire.prototype.destroy = function() {
                if (this.destroyed) return;
                this.destroyed = true;
                this._debug("destroy");
                this.emit("close");
                this.end();
            };
            Wire.prototype.end = function() {
                this._debug("end");
                this._onUninterested();
                this._onChoke();
                stream.Duplex.prototype.end.apply(this, arguments);
            };
            Wire.prototype.use = function(Extension) {
                var name = Extension.prototype.name;
                if (!name) {
                    throw new Error('Extension class requires a "name" property on the prototype');
                }
                this._debug("use extension.name=%s", name);
                var ext = this._nextExt;
                var handler = new Extension(this);
                function noop() {}
                if (typeof handler.onHandshake !== "function") {
                    handler.onHandshake = noop;
                }
                if (typeof handler.onExtendedHandshake !== "function") {
                    handler.onExtendedHandshake = noop;
                }
                if (typeof handler.onMessage !== "function") {
                    handler.onMessage = noop;
                }
                this.extendedMapping[ext] = name;
                this._ext[name] = handler;
                this[name] = handler;
                this._nextExt += 1;
            };
            Wire.prototype.keepAlive = function() {
                this._debug("keep-alive");
                this._push(MESSAGE_KEEP_ALIVE);
            };
            Wire.prototype.handshake = function(infoHash, peerId, extensions) {
                var infoHashBuffer, peerIdBuffer;
                if (typeof infoHash === "string") {
                    infoHashBuffer = Buffer.from(infoHash, "hex");
                } else {
                    infoHashBuffer = infoHash;
                    infoHash = infoHashBuffer.toString("hex");
                }
                if (typeof peerId === "string") {
                    peerIdBuffer = Buffer.from(peerId, "hex");
                } else {
                    peerIdBuffer = peerId;
                    peerId = peerIdBuffer.toString("hex");
                }
                if (infoHashBuffer.length !== 20 || peerIdBuffer.length !== 20) {
                    throw new Error("infoHash and peerId MUST have length 20");
                }
                this._debug("handshake i=%s p=%s exts=%o", infoHash, peerId, extensions);
                var reserved = Buffer.from(MESSAGE_RESERVED);
                reserved[5] |= 16;
                if (extensions && extensions.dht) reserved[7] |= 1;
                this._push(Buffer.concat([ MESSAGE_PROTOCOL, reserved, infoHashBuffer, peerIdBuffer ]));
                this._handshakeSent = true;
                if (this.peerExtensions.extended && !this._extendedHandshakeSent) {
                    this._sendExtendedHandshake();
                }
            };
            Wire.prototype._sendExtendedHandshake = function() {
                var msg = extend(this.extendedHandshake);
                msg.m = {};
                for (var ext in this.extendedMapping) {
                    var name = this.extendedMapping[ext];
                    msg.m[name] = Number(ext);
                }
                this.extended(0, bencode.encode(msg));
                this._extendedHandshakeSent = true;
            };
            Wire.prototype.choke = function() {
                if (this.amChoking) return;
                this.amChoking = true;
                this._debug("choke");
                this.peerRequests.splice(0, this.peerRequests.length);
                this._push(MESSAGE_CHOKE);
            };
            Wire.prototype.unchoke = function() {
                if (!this.amChoking) return;
                this.amChoking = false;
                this._debug("unchoke");
                this._push(MESSAGE_UNCHOKE);
            };
            Wire.prototype.interested = function() {
                if (this.amInterested) return;
                this.amInterested = true;
                this._debug("interested");
                this._push(MESSAGE_INTERESTED);
            };
            Wire.prototype.uninterested = function() {
                if (!this.amInterested) return;
                this.amInterested = false;
                this._debug("uninterested");
                this._push(MESSAGE_UNINTERESTED);
            };
            Wire.prototype.have = function(index) {
                this._debug("have %d", index);
                this._message(4, [ index ], null);
            };
            Wire.prototype.bitfield = function(bitfield) {
                this._debug("bitfield");
                if (!Buffer.isBuffer(bitfield)) bitfield = bitfield.buffer;
                this._message(5, [], bitfield);
            };
            Wire.prototype.request = function(index, offset, length, cb) {
                if (!cb) cb = function() {};
                if (this._finished) return cb(new Error("wire is closed"));
                if (this.peerChoking) return cb(new Error("peer is choking"));
                this._debug("request index=%d offset=%d length=%d", index, offset, length);
                this.requests.push(new Request(index, offset, length, cb));
                this._updateTimeout();
                this._message(6, [ index, offset, length ], null);
            };
            Wire.prototype.piece = function(index, offset, buffer) {
                this._debug("piece index=%d offset=%d", index, offset);
                this.uploaded += buffer.length;
                this.uploadSpeed(buffer.length);
                this.emit("upload", buffer.length);
                this._message(7, [ index, offset ], buffer);
            };
            Wire.prototype.cancel = function(index, offset, length) {
                this._debug("cancel index=%d offset=%d length=%d", index, offset, length);
                this._callback(pull(this.requests, index, offset, length), new Error("request was cancelled"), null);
                this._message(8, [ index, offset, length ], null);
            };
            Wire.prototype.port = function(port) {
                this._debug("port %d", port);
                var message = Buffer.from(MESSAGE_PORT);
                message.writeUInt16BE(port, 5);
                this._push(message);
            };
            Wire.prototype.extended = function(ext, obj) {
                this._debug("extended ext=%s", ext);
                if (typeof ext === "string" && this.peerExtendedMapping[ext]) {
                    ext = this.peerExtendedMapping[ext];
                }
                if (typeof ext === "number") {
                    var extId = Buffer.from([ ext ]);
                    var buf = Buffer.isBuffer(obj) ? obj : bencode.encode(obj);
                    this._message(20, [], Buffer.concat([ extId, buf ]));
                } else {
                    throw new Error("Unrecognized extension: " + ext);
                }
            };
            Wire.prototype._read = function() {};
            Wire.prototype._message = function(id, numbers, data) {
                var dataLength = data ? data.length : 0;
                var buffer = Buffer.allocUnsafe(5 + 4 * numbers.length);
                buffer.writeUInt32BE(buffer.length + dataLength - 4, 0);
                buffer[4] = id;
                for (var i = 0; i < numbers.length; i++) {
                    buffer.writeUInt32BE(numbers[i], 5 + 4 * i);
                }
                this._push(buffer);
                if (data) this._push(data);
            };
            Wire.prototype._push = function(data) {
                if (this._finished) return;
                return this.push(data);
            };
            Wire.prototype._onKeepAlive = function() {
                this._debug("got keep-alive");
                this.emit("keep-alive");
            };
            Wire.prototype._onHandshake = function(infoHashBuffer, peerIdBuffer, extensions) {
                var infoHash = infoHashBuffer.toString("hex");
                var peerId = peerIdBuffer.toString("hex");
                this._debug("got handshake i=%s p=%s exts=%o", infoHash, peerId, extensions);
                this.peerId = peerId;
                this.peerIdBuffer = peerIdBuffer;
                this.peerExtensions = extensions;
                this.emit("handshake", infoHash, peerId, extensions);
                var name;
                for (name in this._ext) {
                    this._ext[name].onHandshake(infoHash, peerId, extensions);
                }
                if (extensions.extended && this._handshakeSent && !this._extendedHandshakeSent) {
                    this._sendExtendedHandshake();
                }
            };
            Wire.prototype._onChoke = function() {
                this.peerChoking = true;
                this._debug("got choke");
                this.emit("choke");
                while (this.requests.length) {
                    this._callback(this.requests.shift(), new Error("peer is choking"), null);
                }
            };
            Wire.prototype._onUnchoke = function() {
                this.peerChoking = false;
                this._debug("got unchoke");
                this.emit("unchoke");
            };
            Wire.prototype._onInterested = function() {
                this.peerInterested = true;
                this._debug("got interested");
                this.emit("interested");
            };
            Wire.prototype._onUninterested = function() {
                this.peerInterested = false;
                this._debug("got uninterested");
                this.emit("uninterested");
            };
            Wire.prototype._onHave = function(index) {
                if (this.peerPieces.get(index)) return;
                this._debug("got have %d", index);
                this.peerPieces.set(index, true);
                this.emit("have", index);
            };
            Wire.prototype._onBitField = function(buffer) {
                this.peerPieces = new BitField(buffer);
                this._debug("got bitfield");
                this.emit("bitfield", this.peerPieces);
            };
            Wire.prototype._onRequest = function(index, offset, length) {
                var self = this;
                if (self.amChoking) return;
                self._debug("got request index=%d offset=%d length=%d", index, offset, length);
                var respond = function(err, buffer) {
                    if (request !== pull(self.peerRequests, index, offset, length)) return;
                    if (err) return self._debug("error satisfying request index=%d offset=%d length=%d (%s)", index, offset, length, err.message);
                    self.piece(index, offset, buffer);
                };
                var request = new Request(index, offset, length, respond);
                self.peerRequests.push(request);
                self.emit("request", index, offset, length, respond);
            };
            Wire.prototype._onPiece = function(index, offset, buffer) {
                this._debug("got piece index=%d offset=%d", index, offset);
                this._callback(pull(this.requests, index, offset, buffer.length), null, buffer);
                this.downloaded += buffer.length;
                this.downloadSpeed(buffer.length);
                this.emit("download", buffer.length);
                this.emit("piece", index, offset, buffer);
            };
            Wire.prototype._onCancel = function(index, offset, length) {
                this._debug("got cancel index=%d offset=%d length=%d", index, offset, length);
                pull(this.peerRequests, index, offset, length);
                this.emit("cancel", index, offset, length);
            };
            Wire.prototype._onPort = function(port) {
                this._debug("got port %d", port);
                this.emit("port", port);
            };
            Wire.prototype._onExtended = function(ext, buf) {
                if (ext === 0) {
                    var info;
                    try {
                        info = bencode.decode(buf);
                    } catch (err) {
                        this._debug("ignoring invalid extended handshake: %s", err.message || err);
                    }
                    if (!info) return;
                    this.peerExtendedHandshake = info;
                    var name;
                    if (typeof info.m === "object") {
                        for (name in info.m) {
                            this.peerExtendedMapping[name] = Number(info.m[name].toString());
                        }
                    }
                    for (name in this._ext) {
                        if (this.peerExtendedMapping[name]) {
                            this._ext[name].onExtendedHandshake(this.peerExtendedHandshake);
                        }
                    }
                    this._debug("got extended handshake");
                    this.emit("extended", "handshake", this.peerExtendedHandshake);
                } else {
                    if (this.extendedMapping[ext]) {
                        ext = this.extendedMapping[ext];
                        if (this._ext[ext]) {
                            this._ext[ext].onMessage(buf);
                        }
                    }
                    this._debug("got extended message ext=%s", ext);
                    this.emit("extended", ext, buf);
                }
            };
            Wire.prototype._onTimeout = function() {
                this._debug("request timed out");
                this._callback(this.requests.shift(), new Error("request has timed out"), null);
                this.emit("timeout");
            };
            Wire.prototype._write = function(data, encoding, cb) {
                this._bufferSize += data.length;
                this._buffer.push(data);
                while (this._bufferSize >= this._parserSize) {
                    var buffer = this._buffer.length === 1 ? this._buffer[0] : Buffer.concat(this._buffer);
                    this._bufferSize -= this._parserSize;
                    this._buffer = this._bufferSize ? [ buffer.slice(this._parserSize) ] : [];
                    this._parser(buffer.slice(0, this._parserSize));
                }
                cb(null);
            };
            Wire.prototype._callback = function(request, err, buffer) {
                if (!request) return;
                this._clearTimeout();
                if (!this.peerChoking && !this._finished) this._updateTimeout();
                request.callback(err, buffer);
            };
            Wire.prototype._clearTimeout = function() {
                if (!this._timeout) return;
                clearTimeout(this._timeout);
                this._timeout = null;
            };
            Wire.prototype._updateTimeout = function() {
                var self = this;
                if (!self._timeoutMs || !self.requests.length || self._timeout) return;
                self._timeout = setTimeout(function() {
                    self._onTimeout();
                }, self._timeoutMs);
                if (self._timeoutUnref && self._timeout.unref) self._timeout.unref();
            };
            Wire.prototype._parse = function(size, parser) {
                this._parserSize = size;
                this._parser = parser;
            };
            Wire.prototype._onMessageLength = function(buffer) {
                var length = buffer.readUInt32BE(0);
                if (length > 0) {
                    this._parse(length, this._onMessage);
                } else {
                    this._onKeepAlive();
                    this._parse(4, this._onMessageLength);
                }
            };
            Wire.prototype._onMessage = function(buffer) {
                this._parse(4, this._onMessageLength);
                switch (buffer[0]) {
                  case 0:
                    return this._onChoke();

                  case 1:
                    return this._onUnchoke();

                  case 2:
                    return this._onInterested();

                  case 3:
                    return this._onUninterested();

                  case 4:
                    return this._onHave(buffer.readUInt32BE(1));

                  case 5:
                    return this._onBitField(buffer.slice(1));

                  case 6:
                    return this._onRequest(buffer.readUInt32BE(1), buffer.readUInt32BE(5), buffer.readUInt32BE(9));

                  case 7:
                    return this._onPiece(buffer.readUInt32BE(1), buffer.readUInt32BE(5), buffer.slice(9));

                  case 8:
                    return this._onCancel(buffer.readUInt32BE(1), buffer.readUInt32BE(5), buffer.readUInt32BE(9));

                  case 9:
                    return this._onPort(buffer.readUInt16BE(1));

                  case 20:
                    return this._onExtended(buffer.readUInt8(1), buffer.slice(2));

                  default:
                    this._debug("got unknown message");
                    return this.emit("unknownmessage", buffer);
                }
            };
            Wire.prototype._parseHandshake = function() {
                var self = this;
                self._parse(1, function(buffer) {
                    var pstrlen = buffer.readUInt8(0);
                    self._parse(pstrlen + 48, function(handshake) {
                        var protocol = handshake.slice(0, pstrlen);
                        if (protocol.toString() !== "BitTorrent protocol") {
                            self._debug("Error: wire not speaking BitTorrent protocol (%s)", protocol.toString());
                            self.end();
                            return;
                        }
                        handshake = handshake.slice(pstrlen);
                        self._onHandshake(handshake.slice(8, 28), handshake.slice(28, 48), {
                            dht: !!(handshake[7] & 1),
                            extended: !!(handshake[5] & 16)
                        });
                        self._parse(4, self._onMessageLength);
                    });
                });
            };
            Wire.prototype._onFinish = function() {
                this._finished = true;
                this.push(null);
                while (this.read()) {}
                clearInterval(this._keepAliveInterval);
                this._parse(Number.MAX_VALUE, function() {});
                this.peerRequests = [];
                while (this.requests.length) {
                    this._callback(this.requests.shift(), new Error("wire was closed"), null);
                }
            };
            Wire.prototype._debug = function() {
                var args = [].slice.call(arguments);
                args[0] = "[" + this._debugId + "] " + args[0];
                debug.apply(null, args);
            };
            function pull(requests, piece, offset, length) {
                for (var i = 0; i < requests.length; i++) {
                    var req = requests[i];
                    if (req.piece !== piece || req.offset !== offset || req.length !== length) continue;
                    if (i === 0) requests.shift(); else requests.splice(i, 1);
                    return req;
                }
                return null;
            }
        }, {
            bencode: 12,
            bitfield: 8,
            debug: 63,
            hat: 69,
            inherits: 71,
            "readable-stream": 99,
            "safe-buffer": 119,
            speedometer: 130,
            xtend: 146
        } ],
        10: [ function(require, module, exports) {
            (function(Buffer) {
                function decode(data, start, end, encoding) {
                    if (typeof start !== "number" && encoding == null) {
                        encoding = start;
                        start = undefined;
                    }
                    if (typeof end !== "number" && encoding == null) {
                        encoding = end;
                        end = undefined;
                    }
                    decode.position = 0;
                    decode.encoding = encoding || null;
                    decode.data = !Buffer.isBuffer(data) ? new Buffer(data) : data.slice(start, end);
                    decode.bytes = decode.data.length;
                    return decode.next();
                }
                decode.bytes = 0;
                decode.position = 0;
                decode.data = null;
                decode.encoding = null;
                decode.next = function() {
                    switch (decode.data[decode.position]) {
                      case 100:
                        return decode.dictionary();

                      case 108:
                        return decode.list();

                      case 105:
                        return decode.integer();

                      default:
                        return decode.buffer();
                    }
                };
                decode.find = function(chr) {
                    var i = decode.position;
                    var c = decode.data.length;
                    var d = decode.data;
                    while (i < c) {
                        if (d[i] === chr) return i;
                        i++;
                    }
                    throw new Error('Invalid data: Missing delimiter "' + String.fromCharCode(chr) + '" [0x' + chr.toString(16) + "]");
                };
                decode.dictionary = function() {
                    decode.position++;
                    var dict = {};
                    while (decode.data[decode.position] !== 101) {
                        dict[decode.buffer()] = decode.next();
                    }
                    decode.position++;
                    return dict;
                };
                decode.list = function() {
                    decode.position++;
                    var lst = [];
                    while (decode.data[decode.position] !== 101) {
                        lst.push(decode.next());
                    }
                    decode.position++;
                    return lst;
                };
                decode.integer = function() {
                    var end = decode.find(101);
                    var number = decode.data.toString("ascii", decode.position + 1, end);
                    decode.position += end + 1 - decode.position;
                    return parseInt(number, 10);
                };
                decode.buffer = function() {
                    var sep = decode.find(58);
                    var length = parseInt(decode.data.toString("ascii", decode.position, sep), 10);
                    var end = ++sep + length;
                    decode.position = end;
                    return decode.encoding ? decode.data.toString(decode.encoding, sep, end) : decode.data.slice(sep, end);
                };
                module.exports = decode;
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        11: [ function(require, module, exports) {
            (function(Buffer) {
                function encode(data, buffer, offset) {
                    var buffers = [];
                    var result = null;
                    encode._encode(buffers, data);
                    result = Buffer.concat(buffers);
                    encode.bytes = result.length;
                    if (Buffer.isBuffer(buffer)) {
                        result.copy(buffer, offset);
                        return buffer;
                    }
                    return result;
                }
                encode.bytes = -1;
                encode._floatConversionDetected = false;
                encode._encode = function(buffers, data) {
                    if (Buffer.isBuffer(data)) {
                        buffers.push(new Buffer(data.length + ":"));
                        buffers.push(data);
                        return;
                    }
                    switch (typeof data) {
                      case "string":
                        encode.buffer(buffers, data);
                        break;

                      case "number":
                        encode.number(buffers, data);
                        break;

                      case "object":
                        data.constructor === Array ? encode.list(buffers, data) : encode.dict(buffers, data);
                        break;

                      case "boolean":
                        encode.number(buffers, data ? 1 : 0);
                        break;
                    }
                };
                var buffE = new Buffer("e");
                var buffD = new Buffer("d");
                var buffL = new Buffer("l");
                encode.buffer = function(buffers, data) {
                    buffers.push(new Buffer(Buffer.byteLength(data) + ":" + data));
                };
                encode.number = function(buffers, data) {
                    var maxLo = 2147483648;
                    var hi = data / maxLo << 0;
                    var lo = data % maxLo << 0;
                    var val = hi * maxLo + lo;
                    buffers.push(new Buffer("i" + val + "e"));
                    if (val !== data && !encode._floatConversionDetected) {
                        encode._floatConversionDetected = true;
                        console.warn('WARNING: Possible data corruption detected with value "' + data + '":', 'Bencoding only defines support for integers, value was converted to "' + val + '"');
                        console.trace();
                    }
                };
                encode.dict = function(buffers, data) {
                    buffers.push(buffD);
                    var j = 0;
                    var k;
                    var keys = Object.keys(data).sort();
                    var kl = keys.length;
                    for (;j < kl; j++) {
                        k = keys[j];
                        encode.buffer(buffers, k);
                        encode._encode(buffers, data[k]);
                    }
                    buffers.push(buffE);
                };
                encode.list = function(buffers, data) {
                    var i = 0;
                    var c = data.length;
                    buffers.push(buffL);
                    for (;i < c; i++) {
                        encode._encode(buffers, data[i]);
                    }
                    buffers.push(buffE);
                };
                module.exports = encode;
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        12: [ function(require, module, exports) {
            var bencode = module.exports;
            bencode.encode = require("./encode");
            bencode.decode = require("./decode");
            bencode.byteLength = bencode.encodingLength = function(value) {
                return bencode.encode(value).length;
            };
        }, {
            "./decode": 10,
            "./encode": 11
        } ],
        13: [ function(require, module, exports) {
            (function(process) {
                module.exports = Client;
                var Buffer = require("safe-buffer").Buffer;
                var debug = require("debug")("bittorrent-tracker");
                var EventEmitter = require("events").EventEmitter;
                var extend = require("xtend");
                var inherits = require("inherits");
                var once = require("once");
                var parallel = require("run-parallel");
                var Peer = require("simple-peer");
                var uniq = require("uniq");
                var url = require("url");
                var common = require("./lib/common");
                var HTTPTracker = require("./lib/client/http-tracker");
                var UDPTracker = require("./lib/client/udp-tracker");
                var WebSocketTracker = require("./lib/client/websocket-tracker");
                inherits(Client, EventEmitter);
                function Client(opts) {
                    var self = this;
                    if (!(self instanceof Client)) return new Client(opts);
                    EventEmitter.call(self);
                    if (!opts) opts = {};
                    if (!opts.peerId) throw new Error("Option `peerId` is required");
                    if (!opts.infoHash) throw new Error("Option `infoHash` is required");
                    if (!opts.announce) throw new Error("Option `announce` is required");
                    if (!process.browser && !opts.port) throw new Error("Option `port` is required");
                    self.peerId = typeof opts.peerId === "string" ? opts.peerId : opts.peerId.toString("hex");
                    self._peerIdBuffer = Buffer.from(self.peerId, "hex");
                    self._peerIdBinary = self._peerIdBuffer.toString("binary");
                    self.infoHash = typeof opts.infoHash === "string" ? opts.infoHash : opts.infoHash.toString("hex");
                    self._infoHashBuffer = Buffer.from(self.infoHash, "hex");
                    self._infoHashBinary = self._infoHashBuffer.toString("binary");
                    self._port = opts.port;
                    self.destroyed = false;
                    self._rtcConfig = opts.rtcConfig;
                    self._wrtc = opts.wrtc;
                    self._getAnnounceOpts = opts.getAnnounceOpts;
                    debug("new client %s", self.infoHash);
                    var webrtcSupport = self._wrtc !== false && (!!self._wrtc || Peer.WEBRTC_SUPPORT);
                    var announce = typeof opts.announce === "string" ? [ opts.announce ] : opts.announce == null ? [] : opts.announce;
                    announce = announce.map(function(announceUrl) {
                        announceUrl = announceUrl.toString();
                        if (announceUrl[announceUrl.length - 1] === "/") {
                            announceUrl = announceUrl.substring(0, announceUrl.length - 1);
                        }
                        return announceUrl;
                    });
                    announce = uniq(announce);
                    self._trackers = announce.map(function(announceUrl) {
                        var protocol = url.parse(announceUrl).protocol;
                        if ((protocol === "http:" || protocol === "https:") && typeof HTTPTracker === "function") {
                            return new HTTPTracker(self, announceUrl);
                        } else if (protocol === "udp:" && typeof UDPTracker === "function") {
                            return new UDPTracker(self, announceUrl);
                        } else if ((protocol === "ws:" || protocol === "wss:") && webrtcSupport) {
                            if (protocol === "ws:" && typeof window !== "undefined" && window.location.protocol === "https:") {
                                nextTickWarn(new Error("Unsupported tracker protocol: " + announceUrl));
                                return null;
                            }
                            return new WebSocketTracker(self, announceUrl);
                        } else {
                            nextTickWarn(new Error("Unsupported tracker protocol: " + announceUrl));
                            return null;
                        }
                    }).filter(Boolean);
                    function nextTickWarn(err) {
                        process.nextTick(function() {
                            self.emit("warning", err);
                        });
                    }
                }
                Client.scrape = function(opts, cb) {
                    cb = once(cb);
                    if (!opts.infoHash) throw new Error("Option `infoHash` is required");
                    if (!opts.announce) throw new Error("Option `announce` is required");
                    var clientOpts = extend(opts, {
                        infoHash: Array.isArray(opts.infoHash) ? opts.infoHash[0] : opts.infoHash,
                        peerId: Buffer.from("01234567890123456789"),
                        port: 6881
                    });
                    var client = new Client(clientOpts);
                    client.once("error", cb);
                    var len = Array.isArray(opts.infoHash) ? opts.infoHash.length : 1;
                    var results = {};
                    client.on("scrape", function(data) {
                        len -= 1;
                        results[data.infoHash] = data;
                        if (len === 0) {
                            client.destroy();
                            var keys = Object.keys(results);
                            if (keys.length === 1) {
                                cb(null, results[keys[0]]);
                            } else {
                                cb(null, results);
                            }
                        }
                    });
                    opts.infoHash = Array.isArray(opts.infoHash) ? opts.infoHash.map(function(infoHash) {
                        return Buffer.from(infoHash, "hex");
                    }) : Buffer.from(opts.infoHash, "hex");
                    client.scrape({
                        infoHash: opts.infoHash
                    });
                    return client;
                };
                Client.prototype.start = function(opts) {
                    var self = this;
                    debug("send `start`");
                    opts = self._defaultAnnounceOpts(opts);
                    opts.event = "started";
                    self._announce(opts);
                    self._trackers.forEach(function(tracker) {
                        tracker.setInterval();
                    });
                };
                Client.prototype.stop = function(opts) {
                    var self = this;
                    debug("send `stop`");
                    opts = self._defaultAnnounceOpts(opts);
                    opts.event = "stopped";
                    self._announce(opts);
                };
                Client.prototype.complete = function(opts) {
                    var self = this;
                    debug("send `complete`");
                    if (!opts) opts = {};
                    opts = self._defaultAnnounceOpts(opts);
                    opts.event = "completed";
                    self._announce(opts);
                };
                Client.prototype.update = function(opts) {
                    var self = this;
                    debug("send `update`");
                    opts = self._defaultAnnounceOpts(opts);
                    if (opts.event) delete opts.event;
                    self._announce(opts);
                };
                Client.prototype._announce = function(opts) {
                    var self = this;
                    self._trackers.forEach(function(tracker) {
                        tracker.announce(opts);
                    });
                };
                Client.prototype.scrape = function(opts) {
                    var self = this;
                    debug("send `scrape`");
                    if (!opts) opts = {};
                    self._trackers.forEach(function(tracker) {
                        tracker.scrape(opts);
                    });
                };
                Client.prototype.setInterval = function(intervalMs) {
                    var self = this;
                    debug("setInterval %d", intervalMs);
                    self._trackers.forEach(function(tracker) {
                        tracker.setInterval(intervalMs);
                    });
                };
                Client.prototype.destroy = function(cb) {
                    var self = this;
                    if (self.destroyed) return;
                    self.destroyed = true;
                    debug("destroy");
                    var tasks = self._trackers.map(function(tracker) {
                        return function(cb) {
                            tracker.destroy(cb);
                        };
                    });
                    parallel(tasks, cb);
                    self._trackers = [];
                    self._getAnnounceOpts = null;
                };
                Client.prototype._defaultAnnounceOpts = function(opts) {
                    var self = this;
                    if (!opts) opts = {};
                    if (opts.numwant == null) opts.numwant = common.DEFAULT_ANNOUNCE_PEERS;
                    if (opts.uploaded == null) opts.uploaded = 0;
                    if (opts.downloaded == null) opts.downloaded = 0;
                    if (self._getAnnounceOpts) opts = extend(opts, self._getAnnounceOpts());
                    return opts;
                };
            }).call(this, require("_process"));
        }, {
            "./lib/client/http-tracker": 21,
            "./lib/client/udp-tracker": 21,
            "./lib/client/websocket-tracker": 15,
            "./lib/common": 16,
            _process: 30,
            debug: 63,
            events: 26,
            inherits: 71,
            once: 18,
            "run-parallel": 118,
            "safe-buffer": 119,
            "simple-peer": 124,
            uniq: 140,
            url: 41,
            xtend: 146
        } ],
        14: [ function(require, module, exports) {
            module.exports = Tracker;
            var EventEmitter = require("events").EventEmitter;
            var inherits = require("inherits");
            inherits(Tracker, EventEmitter);
            function Tracker(client, announceUrl) {
                var self = this;
                EventEmitter.call(self);
                self.client = client;
                self.announceUrl = announceUrl;
                self.interval = null;
                self.destroyed = false;
            }
            Tracker.prototype.setInterval = function(intervalMs) {
                var self = this;
                if (intervalMs == null) intervalMs = self.DEFAULT_ANNOUNCE_INTERVAL;
                clearInterval(self.interval);
                if (intervalMs) {
                    self.interval = setInterval(function() {
                        self.announce(self.client._defaultAnnounceOpts());
                    }, intervalMs);
                    if (self.interval.unref) self.interval.unref();
                }
            };
        }, {
            events: 26,
            inherits: 71
        } ],
        15: [ function(require, module, exports) {
            module.exports = WebSocketTracker;
            var debug = require("debug")("bittorrent-tracker:websocket-tracker");
            var extend = require("xtend");
            var hat = require("hat");
            var inherits = require("inherits");
            var Peer = require("simple-peer");
            var Socket = require("simple-websocket");
            var common = require("../common");
            var Tracker = require("./tracker");
            var socketPool = {};
            var RECONNECT_MINIMUM = 15 * 1e3;
            var RECONNECT_MAXIMUM = 30 * 60 * 1e3;
            var RECONNECT_VARIANCE = 30 * 1e3;
            var OFFER_TIMEOUT = 50 * 1e3;
            inherits(WebSocketTracker, Tracker);
            function WebSocketTracker(client, announceUrl, opts) {
                var self = this;
                Tracker.call(self, client, announceUrl);
                debug("new websocket tracker %s", announceUrl);
                self.peers = {};
                self.socket = null;
                self.reconnecting = false;
                self.retries = 0;
                self.reconnectTimer = null;
                self._openSocket();
            }
            WebSocketTracker.prototype.DEFAULT_ANNOUNCE_INTERVAL = 30 * 1e3;
            WebSocketTracker.prototype.announce = function(opts) {
                var self = this;
                if (self.destroyed || self.reconnecting) return;
                if (!self.socket.connected) {
                    self.socket.once("connect", function() {
                        self.announce(opts);
                    });
                    return;
                }
                var params = extend(opts, {
                    action: "announce",
                    info_hash: self.client._infoHashBinary,
                    peer_id: self.client._peerIdBinary
                });
                if (self._trackerId) params.trackerid = self._trackerId;
                if (opts.event === "stopped") {
                    self._send(params);
                } else {
                    var numwant = Math.min(opts.numwant, 5);
                    self._generateOffers(numwant, function(offers) {
                        params.numwant = numwant;
                        params.offers = offers;
                        self._send(params);
                    });
                }
            };
            WebSocketTracker.prototype.scrape = function(opts) {
                var self = this;
                if (self.destroyed || self.reconnecting) return;
                if (!self.socket.connected) {
                    self.socket.once("connect", function() {
                        self.scrape(opts);
                    });
                    return;
                }
                var infoHashes = Array.isArray(opts.infoHash) && opts.infoHash.length > 0 ? opts.infoHash.map(function(infoHash) {
                    return infoHash.toString("binary");
                }) : opts.infoHash && opts.infoHash.toString("binary") || self.client._infoHashBinary;
                var params = {
                    action: "scrape",
                    info_hash: infoHashes
                };
                self._send(params);
            };
            WebSocketTracker.prototype.destroy = function(cb) {
                var self = this;
                if (!cb) cb = noop;
                if (self.destroyed) return cb(null);
                self.destroyed = true;
                clearInterval(self.interval);
                clearTimeout(self.reconnectTimer);
                if (self.socket) {
                    self.socket.removeListener("connect", self._onSocketConnectBound);
                    self.socket.removeListener("data", self._onSocketDataBound);
                    self.socket.removeListener("close", self._onSocketCloseBound);
                    self.socket.removeListener("error", self._onSocketErrorBound);
                }
                self._onSocketConnectBound = null;
                self._onSocketErrorBound = null;
                self._onSocketDataBound = null;
                self._onSocketCloseBound = null;
                for (var peerId in self.peers) {
                    var peer = self.peers[peerId];
                    clearTimeout(peer.trackerTimeout);
                    peer.destroy();
                }
                self.peers = null;
                if (socketPool[self.announceUrl]) {
                    socketPool[self.announceUrl].consumers -= 1;
                }
                if (socketPool[self.announceUrl].consumers === 0) {
                    delete socketPool[self.announceUrl];
                    try {
                        self.socket.on("error", noop);
                        self.socket.destroy(cb);
                    } catch (err) {
                        cb(null);
                    }
                } else {
                    cb(null);
                }
                self.socket = null;
            };
            WebSocketTracker.prototype._openSocket = function() {
                var self = this;
                self.destroyed = false;
                if (!self.peers) self.peers = {};
                self._onSocketConnectBound = function() {
                    self._onSocketConnect();
                };
                self._onSocketErrorBound = function(err) {
                    self._onSocketError(err);
                };
                self._onSocketDataBound = function(data) {
                    self._onSocketData(data);
                };
                self._onSocketCloseBound = function() {
                    self._onSocketClose();
                };
                self.socket = socketPool[self.announceUrl];
                if (self.socket) {
                    socketPool[self.announceUrl].consumers += 1;
                } else {
                    self.socket = socketPool[self.announceUrl] = new Socket(self.announceUrl);
                    self.socket.consumers = 1;
                    self.socket.on("connect", self._onSocketConnectBound);
                }
                self.socket.on("data", self._onSocketDataBound);
                self.socket.on("close", self._onSocketCloseBound);
                self.socket.on("error", self._onSocketErrorBound);
            };
            WebSocketTracker.prototype._onSocketConnect = function() {
                var self = this;
                if (self.destroyed) return;
                if (self.reconnecting) {
                    self.reconnecting = false;
                    self.retries = 0;
                    self.announce(self.client._defaultAnnounceOpts());
                }
            };
            WebSocketTracker.prototype._onSocketData = function(data) {
                var self = this;
                if (self.destroyed) return;
                try {
                    data = JSON.parse(data);
                } catch (err) {
                    self.client.emit("warning", new Error("Invalid tracker response"));
                    return;
                }
                if (data.action === "announce") {
                    self._onAnnounceResponse(data);
                } else if (data.action === "scrape") {
                    self._onScrapeResponse(data);
                } else {
                    self._onSocketError(new Error("invalid action in WS response: " + data.action));
                }
            };
            WebSocketTracker.prototype._onAnnounceResponse = function(data) {
                var self = this;
                if (data.info_hash !== self.client._infoHashBinary) {
                    debug("ignoring websocket data from %s for %s (looking for %s: reused socket)", self.announceUrl, common.binaryToHex(data.info_hash), self.client.infoHash);
                    return;
                }
                if (data.peer_id && data.peer_id === self.client._peerIdBinary) {
                    return;
                }
                debug("received %s from %s for %s", JSON.stringify(data), self.announceUrl, self.client.infoHash);
                var failure = data["failure reason"];
                if (failure) return self.client.emit("warning", new Error(failure));
                var warning = data["warning message"];
                if (warning) self.client.emit("warning", new Error(warning));
                var interval = data.interval || data["min interval"];
                if (interval) self.setInterval(interval * 1e3);
                var trackerId = data["tracker id"];
                if (trackerId) {
                    self._trackerId = trackerId;
                }
                if (data.complete != null) {
                    self.client.emit("update", {
                        announce: self.announceUrl,
                        complete: data.complete,
                        incomplete: data.incomplete
                    });
                }
                var peer;
                if (data.offer && data.peer_id) {
                    debug("creating peer (from remote offer)");
                    peer = new Peer({
                        trickle: false,
                        config: self.client._rtcConfig,
                        wrtc: self.client._wrtc
                    });
                    peer.id = common.binaryToHex(data.peer_id);
                    peer.once("signal", function(answer) {
                        var params = {
                            action: "announce",
                            info_hash: self.client._infoHashBinary,
                            peer_id: self.client._peerIdBinary,
                            to_peer_id: data.peer_id,
                            answer: answer,
                            offer_id: data.offer_id
                        };
                        if (self._trackerId) params.trackerid = self._trackerId;
                        self._send(params);
                    });
                    peer.signal(data.offer);
                    self.client.emit("peer", peer);
                }
                if (data.answer && data.peer_id) {
                    var offerId = common.binaryToHex(data.offer_id);
                    peer = self.peers[offerId];
                    if (peer) {
                        peer.id = common.binaryToHex(data.peer_id);
                        peer.signal(data.answer);
                        self.client.emit("peer", peer);
                        clearTimeout(peer.trackerTimeout);
                        peer.trackerTimeout = null;
                        delete self.peers[offerId];
                    } else {
                        debug("got unexpected answer: " + JSON.stringify(data.answer));
                    }
                }
            };
            WebSocketTracker.prototype._onScrapeResponse = function(data) {
                var self = this;
                data = data.files || {};
                var keys = Object.keys(data);
                if (keys.length === 0) {
                    self.client.emit("warning", new Error("invalid scrape response"));
                    return;
                }
                keys.forEach(function(infoHash) {
                    var response = data[infoHash];
                    self.client.emit("scrape", {
                        announce: self.announceUrl,
                        infoHash: common.binaryToHex(infoHash),
                        complete: response.complete,
                        incomplete: response.incomplete,
                        downloaded: response.downloaded
                    });
                });
            };
            WebSocketTracker.prototype._onSocketClose = function() {
                var self = this;
                if (self.destroyed) return;
                self.destroy();
                self._startReconnectTimer();
            };
            WebSocketTracker.prototype._onSocketError = function(err) {
                var self = this;
                if (self.destroyed) return;
                self.destroy();
                self.client.emit("warning", err);
                self._startReconnectTimer();
            };
            WebSocketTracker.prototype._startReconnectTimer = function() {
                var self = this;
                var ms = Math.floor(Math.random() * RECONNECT_VARIANCE) + Math.min(Math.pow(2, self.retries) * RECONNECT_MINIMUM, RECONNECT_MAXIMUM);
                self.reconnecting = true;
                clearTimeout(self.reconnectTimer);
                self.reconnectTimer = setTimeout(function() {
                    self.retries++;
                    self._openSocket();
                }, ms);
                if (self.reconnectTimer.unref) self.reconnectTimer.unref();
                debug("reconnecting socket in %s ms", ms);
            };
            WebSocketTracker.prototype._send = function(params) {
                var self = this;
                if (self.destroyed) return;
                var message = JSON.stringify(params);
                debug("send %s", message);
                self.socket.send(message);
            };
            WebSocketTracker.prototype._generateOffers = function(numwant, cb) {
                var self = this;
                var offers = [];
                debug("generating %s offers", numwant);
                for (var i = 0; i < numwant; ++i) {
                    generateOffer();
                }
                checkDone();
                function generateOffer() {
                    var offerId = hat(160);
                    debug("creating peer (from _generateOffers)");
                    var peer = self.peers[offerId] = new Peer({
                        initiator: true,
                        trickle: false,
                        config: self.client._rtcConfig,
                        wrtc: self.client._wrtc
                    });
                    peer.once("signal", function(offer) {
                        offers.push({
                            offer: offer,
                            offer_id: common.hexToBinary(offerId)
                        });
                        checkDone();
                    });
                    peer.trackerTimeout = setTimeout(function() {
                        debug("tracker timeout: destroying peer");
                        peer.trackerTimeout = null;
                        delete self.peers[offerId];
                        peer.destroy();
                    }, OFFER_TIMEOUT);
                    if (peer.trackerTimeout.unref) peer.trackerTimeout.unref();
                }
                function checkDone() {
                    if (offers.length === numwant) {
                        debug("generated %s offers", numwant);
                        cb(offers);
                    }
                }
            };
            function noop() {}
        }, {
            "../common": 16,
            "./tracker": 14,
            debug: 63,
            hat: 69,
            inherits: 71,
            "simple-peer": 124,
            "simple-websocket": 19,
            xtend: 146
        } ],
        16: [ function(require, module, exports) {
            var Buffer = require("safe-buffer").Buffer;
            var extend = require("xtend/mutable");
            exports.DEFAULT_ANNOUNCE_PEERS = 50;
            exports.MAX_ANNOUNCE_PEERS = 82;
            exports.binaryToHex = function(str) {
                if (typeof str !== "string") {
                    str = String(str);
                }
                return Buffer.from(str, "binary").toString("hex");
            };
            exports.hexToBinary = function(str) {
                if (typeof str !== "string") {
                    str = String(str);
                }
                return Buffer.from(str, "hex").toString("binary");
            };
            var config = require("./common-node");
            extend(exports, config);
        }, {
            "./common-node": 21,
            "safe-buffer": 119,
            "xtend/mutable": 147
        } ],
        17: [ function(require, module, exports) {
            module.exports = wrappy;
            function wrappy(fn, cb) {
                if (fn && cb) return wrappy(fn)(cb);
                if (typeof fn !== "function") throw new TypeError("need wrapper function");
                Object.keys(fn).forEach(function(k) {
                    wrapper[k] = fn[k];
                });
                return wrapper;
                function wrapper() {
                    var args = new Array(arguments.length);
                    for (var i = 0; i < args.length; i++) {
                        args[i] = arguments[i];
                    }
                    var ret = fn.apply(this, args);
                    var cb = args[args.length - 1];
                    if (typeof ret === "function" && ret !== cb) {
                        Object.keys(cb).forEach(function(k) {
                            ret[k] = cb[k];
                        });
                    }
                    return ret;
                }
            }
        }, {} ],
        18: [ function(require, module, exports) {
            var wrappy = require("wrappy");
            module.exports = wrappy(once);
            once.proto = once(function() {
                Object.defineProperty(Function.prototype, "once", {
                    value: function() {
                        return once(this);
                    },
                    configurable: true
                });
            });
            function once(fn) {
                var f = function() {
                    if (f.called) return f.value;
                    f.called = true;
                    return f.value = fn.apply(this, arguments);
                };
                f.called = false;
                return f;
            }
        }, {
            wrappy: 17
        } ],
        19: [ function(require, module, exports) {
            (function(process, Buffer) {
                module.exports = Socket;
                var debug = require("debug")("simple-websocket");
                var inherits = require("inherits");
                var stream = require("readable-stream");
                var ws = require("ws");
                var _WebSocket = typeof WebSocket !== "undefined" ? WebSocket : ws;
                inherits(Socket, stream.Duplex);
                function Socket(url, opts) {
                    var self = this;
                    if (!(self instanceof Socket)) return new Socket(url, opts);
                    if (!opts) opts = {};
                    debug("new websocket: %s %o", url, opts);
                    opts.allowHalfOpen = false;
                    if (opts.highWaterMark == null) opts.highWaterMark = 1024 * 1024;
                    stream.Duplex.call(self, opts);
                    self.url = url;
                    self.connected = false;
                    self.destroyed = false;
                    self._maxBufferedAmount = opts.highWaterMark;
                    self._chunk = null;
                    self._cb = null;
                    self._interval = null;
                    try {
                        if (typeof WebSocket === "undefined") {
                            self._ws = new _WebSocket(self.url, opts);
                        } else {
                            self._ws = new _WebSocket(self.url);
                        }
                    } catch (err) {
                        process.nextTick(function() {
                            self._onError(err);
                        });
                        return;
                    }
                    self._ws.binaryType = "arraybuffer";
                    self._ws.onopen = function() {
                        self._onOpen();
                    };
                    self._ws.onmessage = function(event) {
                        self._onMessage(event);
                    };
                    self._ws.onclose = function() {
                        self._onClose();
                    };
                    self._ws.onerror = function() {
                        self._onError(new Error("connection error to " + self.url));
                    };
                    self.on("finish", function() {
                        if (self.connected) {
                            setTimeout(function() {
                                self._destroy();
                            }, 100);
                        } else {
                            self.once("connect", function() {
                                setTimeout(function() {
                                    self._destroy();
                                }, 100);
                            });
                        }
                    });
                }
                Socket.WEBSOCKET_SUPPORT = !!_WebSocket;
                Socket.prototype.send = function(chunk) {
                    var self = this;
                    var len = chunk.length || chunk.byteLength || chunk.size;
                    self._ws.send(chunk);
                    debug("write: %d bytes", len);
                };
                Socket.prototype.destroy = function(onclose) {
                    var self = this;
                    self._destroy(null, onclose);
                };
                Socket.prototype._destroy = function(err, onclose) {
                    var self = this;
                    if (self.destroyed) return;
                    if (onclose) self.once("close", onclose);
                    debug("destroy (error: %s)", err && err.message);
                    this.readable = this.writable = false;
                    if (!self._readableState.ended) self.push(null);
                    if (!self._writableState.finished) self.end();
                    self.connected = false;
                    self.destroyed = true;
                    clearInterval(self._interval);
                    self._interval = null;
                    self._chunk = null;
                    self._cb = null;
                    if (self._ws) {
                        var ws = self._ws;
                        var onClose = function() {
                            ws.onclose = null;
                            self.emit("close");
                        };
                        if (ws.readyState === _WebSocket.CLOSED) {
                            onClose();
                        } else {
                            try {
                                ws.onclose = onClose;
                                ws.close();
                            } catch (err) {
                                onClose();
                            }
                        }
                        ws.onopen = null;
                        ws.onmessage = null;
                        ws.onerror = null;
                    }
                    self._ws = null;
                    if (err) self.emit("error", err);
                };
                Socket.prototype._read = function() {};
                Socket.prototype._write = function(chunk, encoding, cb) {
                    var self = this;
                    if (self.destroyed) return cb(new Error("cannot write after socket is destroyed"));
                    if (self.connected) {
                        try {
                            self.send(chunk);
                        } catch (err) {
                            return self._onError(err);
                        }
                        if (typeof ws !== "function" && self._ws.bufferedAmount > self._maxBufferedAmount) {
                            debug("start backpressure: bufferedAmount %d", self._ws.bufferedAmount);
                            self._cb = cb;
                        } else {
                            cb(null);
                        }
                    } else {
                        debug("write before connect");
                        self._chunk = chunk;
                        self._cb = cb;
                    }
                };
                Socket.prototype._onMessage = function(event) {
                    var self = this;
                    if (self.destroyed) return;
                    var data = event.data;
                    debug("read: %d bytes", data.byteLength || data.length);
                    if (data instanceof ArrayBuffer) data = new Buffer(data);
                    self.push(data);
                };
                Socket.prototype._onOpen = function() {
                    var self = this;
                    if (self.connected || self.destroyed) return;
                    self.connected = true;
                    if (self._chunk) {
                        try {
                            self.send(self._chunk);
                        } catch (err) {
                            return self._onError(err);
                        }
                        self._chunk = null;
                        debug('sent chunk from "write before connect"');
                        var cb = self._cb;
                        self._cb = null;
                        cb(null);
                    }
                    if (typeof ws !== "function") {
                        self._interval = setInterval(function() {
                            if (!self._cb || !self._ws || self._ws.bufferedAmount > self._maxBufferedAmount) {
                                return;
                            }
                            debug("ending backpressure: bufferedAmount %d", self._ws.bufferedAmount);
                            var cb = self._cb;
                            self._cb = null;
                            cb(null);
                        }, 150);
                        if (self._interval.unref) self._interval.unref();
                    }
                    debug("connect");
                    self.emit("connect");
                };
                Socket.prototype._onClose = function() {
                    var self = this;
                    if (self.destroyed) return;
                    debug("on close");
                    self._destroy();
                };
                Socket.prototype._onError = function(err) {
                    var self = this;
                    if (self.destroyed) return;
                    debug("error: %s", err.message || err);
                    self._destroy(err);
                };
            }).call(this, require("_process"), require("buffer").Buffer);
        }, {
            _process: 30,
            buffer: 22,
            debug: 63,
            inherits: 71,
            "readable-stream": 99,
            ws: 21
        } ],
        20: [ function(require, module, exports) {}, {} ],
        21: [ function(require, module, exports) {
            arguments[4][20][0].apply(exports, arguments);
        }, {
            dup: 20
        } ],
        22: [ function(require, module, exports) {
            (function(global) {
                "use strict";
                var base64 = require("base64-js");
                var ieee754 = require("ieee754");
                var isArray = require("isarray");
                exports.Buffer = Buffer;
                exports.SlowBuffer = SlowBuffer;
                exports.INSPECT_MAX_BYTES = 50;
                Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined ? global.TYPED_ARRAY_SUPPORT : typedArraySupport();
                exports.kMaxLength = kMaxLength();
                function typedArraySupport() {
                    try {
                        var arr = new Uint8Array(1);
                        arr.__proto__ = {
                            __proto__: Uint8Array.prototype,
                            foo: function() {
                                return 42;
                            }
                        };
                        return arr.foo() === 42 && typeof arr.subarray === "function" && arr.subarray(1, 1).byteLength === 0;
                    } catch (e) {
                        return false;
                    }
                }
                function kMaxLength() {
                    return Buffer.TYPED_ARRAY_SUPPORT ? 2147483647 : 1073741823;
                }
                function createBuffer(that, length) {
                    if (kMaxLength() < length) {
                        throw new RangeError("Invalid typed array length");
                    }
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        that = new Uint8Array(length);
                        that.__proto__ = Buffer.prototype;
                    } else {
                        if (that === null) {
                            that = new Buffer(length);
                        }
                        that.length = length;
                    }
                    return that;
                }
                function Buffer(arg, encodingOrOffset, length) {
                    if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
                        return new Buffer(arg, encodingOrOffset, length);
                    }
                    if (typeof arg === "number") {
                        if (typeof encodingOrOffset === "string") {
                            throw new Error("If encoding is specified then the first argument must be a string");
                        }
                        return allocUnsafe(this, arg);
                    }
                    return from(this, arg, encodingOrOffset, length);
                }
                Buffer.poolSize = 8192;
                Buffer._augment = function(arr) {
                    arr.__proto__ = Buffer.prototype;
                    return arr;
                };
                function from(that, value, encodingOrOffset, length) {
                    if (typeof value === "number") {
                        throw new TypeError('"value" argument must not be a number');
                    }
                    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
                        return fromArrayBuffer(that, value, encodingOrOffset, length);
                    }
                    if (typeof value === "string") {
                        return fromString(that, value, encodingOrOffset);
                    }
                    return fromObject(that, value);
                }
                Buffer.from = function(value, encodingOrOffset, length) {
                    return from(null, value, encodingOrOffset, length);
                };
                if (Buffer.TYPED_ARRAY_SUPPORT) {
                    Buffer.prototype.__proto__ = Uint8Array.prototype;
                    Buffer.__proto__ = Uint8Array;
                    if (typeof Symbol !== "undefined" && Symbol.species && Buffer[Symbol.species] === Buffer) {
                        Object.defineProperty(Buffer, Symbol.species, {
                            value: null,
                            configurable: true
                        });
                    }
                }
                function assertSize(size) {
                    if (typeof size !== "number") {
                        throw new TypeError('"size" argument must be a number');
                    }
                }
                function alloc(that, size, fill, encoding) {
                    assertSize(size);
                    if (size <= 0) {
                        return createBuffer(that, size);
                    }
                    if (fill !== undefined) {
                        return typeof encoding === "string" ? createBuffer(that, size).fill(fill, encoding) : createBuffer(that, size).fill(fill);
                    }
                    return createBuffer(that, size);
                }
                Buffer.alloc = function(size, fill, encoding) {
                    return alloc(null, size, fill, encoding);
                };
                function allocUnsafe(that, size) {
                    assertSize(size);
                    that = createBuffer(that, size < 0 ? 0 : checked(size) | 0);
                    if (!Buffer.TYPED_ARRAY_SUPPORT) {
                        for (var i = 0; i < size; ++i) {
                            that[i] = 0;
                        }
                    }
                    return that;
                }
                Buffer.allocUnsafe = function(size) {
                    return allocUnsafe(null, size);
                };
                Buffer.allocUnsafeSlow = function(size) {
                    return allocUnsafe(null, size);
                };
                function fromString(that, string, encoding) {
                    if (typeof encoding !== "string" || encoding === "") {
                        encoding = "utf8";
                    }
                    if (!Buffer.isEncoding(encoding)) {
                        throw new TypeError('"encoding" must be a valid string encoding');
                    }
                    var length = byteLength(string, encoding) | 0;
                    that = createBuffer(that, length);
                    that.write(string, encoding);
                    return that;
                }
                function fromArrayLike(that, array) {
                    var length = checked(array.length) | 0;
                    that = createBuffer(that, length);
                    for (var i = 0; i < length; i += 1) {
                        that[i] = array[i] & 255;
                    }
                    return that;
                }
                function fromArrayBuffer(that, array, byteOffset, length) {
                    array.byteLength;
                    if (byteOffset < 0 || array.byteLength < byteOffset) {
                        throw new RangeError("'offset' is out of bounds");
                    }
                    if (array.byteLength < byteOffset + (length || 0)) {
                        throw new RangeError("'length' is out of bounds");
                    }
                    if (length === undefined) {
                        array = new Uint8Array(array, byteOffset);
                    } else {
                        array = new Uint8Array(array, byteOffset, length);
                    }
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        that = array;
                        that.__proto__ = Buffer.prototype;
                    } else {
                        that = fromArrayLike(that, array);
                    }
                    return that;
                }
                function fromObject(that, obj) {
                    if (Buffer.isBuffer(obj)) {
                        var len = checked(obj.length) | 0;
                        that = createBuffer(that, len);
                        if (that.length === 0) {
                            return that;
                        }
                        obj.copy(that, 0, 0, len);
                        return that;
                    }
                    if (obj) {
                        if (typeof ArrayBuffer !== "undefined" && obj.buffer instanceof ArrayBuffer || "length" in obj) {
                            if (typeof obj.length !== "number" || isnan(obj.length)) {
                                return createBuffer(that, 0);
                            }
                            return fromArrayLike(that, obj);
                        }
                        if (obj.type === "Buffer" && isArray(obj.data)) {
                            return fromArrayLike(that, obj.data);
                        }
                    }
                    throw new TypeError("First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.");
                }
                function checked(length) {
                    if (length >= kMaxLength()) {
                        throw new RangeError("Attempt to allocate Buffer larger than maximum " + "size: 0x" + kMaxLength().toString(16) + " bytes");
                    }
                    return length | 0;
                }
                function SlowBuffer(length) {
                    if (+length != length) {
                        length = 0;
                    }
                    return Buffer.alloc(+length);
                }
                Buffer.isBuffer = function isBuffer(b) {
                    return !!(b != null && b._isBuffer);
                };
                Buffer.compare = function compare(a, b) {
                    if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
                        throw new TypeError("Arguments must be Buffers");
                    }
                    if (a === b) return 0;
                    var x = a.length;
                    var y = b.length;
                    for (var i = 0, len = Math.min(x, y); i < len; ++i) {
                        if (a[i] !== b[i]) {
                            x = a[i];
                            y = b[i];
                            break;
                        }
                    }
                    if (x < y) return -1;
                    if (y < x) return 1;
                    return 0;
                };
                Buffer.isEncoding = function isEncoding(encoding) {
                    switch (String(encoding).toLowerCase()) {
                      case "hex":
                      case "utf8":
                      case "utf-8":
                      case "ascii":
                      case "binary":
                      case "base64":
                      case "raw":
                      case "ucs2":
                      case "ucs-2":
                      case "utf16le":
                      case "utf-16le":
                        return true;

                      default:
                        return false;
                    }
                };
                Buffer.concat = function concat(list, length) {
                    if (!isArray(list)) {
                        throw new TypeError('"list" argument must be an Array of Buffers');
                    }
                    if (list.length === 0) {
                        return Buffer.alloc(0);
                    }
                    var i;
                    if (length === undefined) {
                        length = 0;
                        for (i = 0; i < list.length; ++i) {
                            length += list[i].length;
                        }
                    }
                    var buffer = Buffer.allocUnsafe(length);
                    var pos = 0;
                    for (i = 0; i < list.length; ++i) {
                        var buf = list[i];
                        if (!Buffer.isBuffer(buf)) {
                            throw new TypeError('"list" argument must be an Array of Buffers');
                        }
                        buf.copy(buffer, pos);
                        pos += buf.length;
                    }
                    return buffer;
                };
                function byteLength(string, encoding) {
                    if (Buffer.isBuffer(string)) {
                        return string.length;
                    }
                    if (typeof ArrayBuffer !== "undefined" && typeof ArrayBuffer.isView === "function" && (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
                        return string.byteLength;
                    }
                    if (typeof string !== "string") {
                        string = "" + string;
                    }
                    var len = string.length;
                    if (len === 0) return 0;
                    var loweredCase = false;
                    for (;;) {
                        switch (encoding) {
                          case "ascii":
                          case "binary":
                          case "raw":
                          case "raws":
                            return len;

                          case "utf8":
                          case "utf-8":
                          case undefined:
                            return utf8ToBytes(string).length;

                          case "ucs2":
                          case "ucs-2":
                          case "utf16le":
                          case "utf-16le":
                            return len * 2;

                          case "hex":
                            return len >>> 1;

                          case "base64":
                            return base64ToBytes(string).length;

                          default:
                            if (loweredCase) return utf8ToBytes(string).length;
                            encoding = ("" + encoding).toLowerCase();
                            loweredCase = true;
                        }
                    }
                }
                Buffer.byteLength = byteLength;
                function slowToString(encoding, start, end) {
                    var loweredCase = false;
                    if (start === undefined || start < 0) {
                        start = 0;
                    }
                    if (start > this.length) {
                        return "";
                    }
                    if (end === undefined || end > this.length) {
                        end = this.length;
                    }
                    if (end <= 0) {
                        return "";
                    }
                    end >>>= 0;
                    start >>>= 0;
                    if (end <= start) {
                        return "";
                    }
                    if (!encoding) encoding = "utf8";
                    while (true) {
                        switch (encoding) {
                          case "hex":
                            return hexSlice(this, start, end);

                          case "utf8":
                          case "utf-8":
                            return utf8Slice(this, start, end);

                          case "ascii":
                            return asciiSlice(this, start, end);

                          case "binary":
                            return binarySlice(this, start, end);

                          case "base64":
                            return base64Slice(this, start, end);

                          case "ucs2":
                          case "ucs-2":
                          case "utf16le":
                          case "utf-16le":
                            return utf16leSlice(this, start, end);

                          default:
                            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
                            encoding = (encoding + "").toLowerCase();
                            loweredCase = true;
                        }
                    }
                }
                Buffer.prototype._isBuffer = true;
                function swap(b, n, m) {
                    var i = b[n];
                    b[n] = b[m];
                    b[m] = i;
                }
                Buffer.prototype.swap16 = function swap16() {
                    var len = this.length;
                    if (len % 2 !== 0) {
                        throw new RangeError("Buffer size must be a multiple of 16-bits");
                    }
                    for (var i = 0; i < len; i += 2) {
                        swap(this, i, i + 1);
                    }
                    return this;
                };
                Buffer.prototype.swap32 = function swap32() {
                    var len = this.length;
                    if (len % 4 !== 0) {
                        throw new RangeError("Buffer size must be a multiple of 32-bits");
                    }
                    for (var i = 0; i < len; i += 4) {
                        swap(this, i, i + 3);
                        swap(this, i + 1, i + 2);
                    }
                    return this;
                };
                Buffer.prototype.toString = function toString() {
                    var length = this.length | 0;
                    if (length === 0) return "";
                    if (arguments.length === 0) return utf8Slice(this, 0, length);
                    return slowToString.apply(this, arguments);
                };
                Buffer.prototype.equals = function equals(b) {
                    if (!Buffer.isBuffer(b)) throw new TypeError("Argument must be a Buffer");
                    if (this === b) return true;
                    return Buffer.compare(this, b) === 0;
                };
                Buffer.prototype.inspect = function inspect() {
                    var str = "";
                    var max = exports.INSPECT_MAX_BYTES;
                    if (this.length > 0) {
                        str = this.toString("hex", 0, max).match(/.{2}/g).join(" ");
                        if (this.length > max) str += " ... ";
                    }
                    return "<Buffer " + str + ">";
                };
                Buffer.prototype.compare = function compare(target, start, end, thisStart, thisEnd) {
                    if (!Buffer.isBuffer(target)) {
                        throw new TypeError("Argument must be a Buffer");
                    }
                    if (start === undefined) {
                        start = 0;
                    }
                    if (end === undefined) {
                        end = target ? target.length : 0;
                    }
                    if (thisStart === undefined) {
                        thisStart = 0;
                    }
                    if (thisEnd === undefined) {
                        thisEnd = this.length;
                    }
                    if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
                        throw new RangeError("out of range index");
                    }
                    if (thisStart >= thisEnd && start >= end) {
                        return 0;
                    }
                    if (thisStart >= thisEnd) {
                        return -1;
                    }
                    if (start >= end) {
                        return 1;
                    }
                    start >>>= 0;
                    end >>>= 0;
                    thisStart >>>= 0;
                    thisEnd >>>= 0;
                    if (this === target) return 0;
                    var x = thisEnd - thisStart;
                    var y = end - start;
                    var len = Math.min(x, y);
                    var thisCopy = this.slice(thisStart, thisEnd);
                    var targetCopy = target.slice(start, end);
                    for (var i = 0; i < len; ++i) {
                        if (thisCopy[i] !== targetCopy[i]) {
                            x = thisCopy[i];
                            y = targetCopy[i];
                            break;
                        }
                    }
                    if (x < y) return -1;
                    if (y < x) return 1;
                    return 0;
                };
                function arrayIndexOf(arr, val, byteOffset, encoding) {
                    var indexSize = 1;
                    var arrLength = arr.length;
                    var valLength = val.length;
                    if (encoding !== undefined) {
                        encoding = String(encoding).toLowerCase();
                        if (encoding === "ucs2" || encoding === "ucs-2" || encoding === "utf16le" || encoding === "utf-16le") {
                            if (arr.length < 2 || val.length < 2) {
                                return -1;
                            }
                            indexSize = 2;
                            arrLength /= 2;
                            valLength /= 2;
                            byteOffset /= 2;
                        }
                    }
                    function read(buf, i) {
                        if (indexSize === 1) {
                            return buf[i];
                        } else {
                            return buf.readUInt16BE(i * indexSize);
                        }
                    }
                    var foundIndex = -1;
                    for (var i = byteOffset; i < arrLength; ++i) {
                        if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
                            if (foundIndex === -1) foundIndex = i;
                            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize;
                        } else {
                            if (foundIndex !== -1) i -= i - foundIndex;
                            foundIndex = -1;
                        }
                    }
                    return -1;
                }
                Buffer.prototype.indexOf = function indexOf(val, byteOffset, encoding) {
                    if (typeof byteOffset === "string") {
                        encoding = byteOffset;
                        byteOffset = 0;
                    } else if (byteOffset > 2147483647) {
                        byteOffset = 2147483647;
                    } else if (byteOffset < -2147483648) {
                        byteOffset = -2147483648;
                    }
                    byteOffset >>= 0;
                    if (this.length === 0) return -1;
                    if (byteOffset >= this.length) return -1;
                    if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0);
                    if (typeof val === "string") {
                        val = Buffer.from(val, encoding);
                    }
                    if (Buffer.isBuffer(val)) {
                        if (val.length === 0) {
                            return -1;
                        }
                        return arrayIndexOf(this, val, byteOffset, encoding);
                    }
                    if (typeof val === "number") {
                        if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === "function") {
                            return Uint8Array.prototype.indexOf.call(this, val, byteOffset);
                        }
                        return arrayIndexOf(this, [ val ], byteOffset, encoding);
                    }
                    throw new TypeError("val must be string, number or Buffer");
                };
                Buffer.prototype.includes = function includes(val, byteOffset, encoding) {
                    return this.indexOf(val, byteOffset, encoding) !== -1;
                };
                function hexWrite(buf, string, offset, length) {
                    offset = Number(offset) || 0;
                    var remaining = buf.length - offset;
                    if (!length) {
                        length = remaining;
                    } else {
                        length = Number(length);
                        if (length > remaining) {
                            length = remaining;
                        }
                    }
                    var strLen = string.length;
                    if (strLen % 2 !== 0) throw new Error("Invalid hex string");
                    if (length > strLen / 2) {
                        length = strLen / 2;
                    }
                    for (var i = 0; i < length; ++i) {
                        var parsed = parseInt(string.substr(i * 2, 2), 16);
                        if (isNaN(parsed)) return i;
                        buf[offset + i] = parsed;
                    }
                    return i;
                }
                function utf8Write(buf, string, offset, length) {
                    return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length);
                }
                function asciiWrite(buf, string, offset, length) {
                    return blitBuffer(asciiToBytes(string), buf, offset, length);
                }
                function binaryWrite(buf, string, offset, length) {
                    return asciiWrite(buf, string, offset, length);
                }
                function base64Write(buf, string, offset, length) {
                    return blitBuffer(base64ToBytes(string), buf, offset, length);
                }
                function ucs2Write(buf, string, offset, length) {
                    return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length);
                }
                Buffer.prototype.write = function write(string, offset, length, encoding) {
                    if (offset === undefined) {
                        encoding = "utf8";
                        length = this.length;
                        offset = 0;
                    } else if (length === undefined && typeof offset === "string") {
                        encoding = offset;
                        length = this.length;
                        offset = 0;
                    } else if (isFinite(offset)) {
                        offset = offset | 0;
                        if (isFinite(length)) {
                            length = length | 0;
                            if (encoding === undefined) encoding = "utf8";
                        } else {
                            encoding = length;
                            length = undefined;
                        }
                    } else {
                        throw new Error("Buffer.write(string, encoding, offset[, length]) is no longer supported");
                    }
                    var remaining = this.length - offset;
                    if (length === undefined || length > remaining) length = remaining;
                    if (string.length > 0 && (length < 0 || offset < 0) || offset > this.length) {
                        throw new RangeError("Attempt to write outside buffer bounds");
                    }
                    if (!encoding) encoding = "utf8";
                    var loweredCase = false;
                    for (;;) {
                        switch (encoding) {
                          case "hex":
                            return hexWrite(this, string, offset, length);

                          case "utf8":
                          case "utf-8":
                            return utf8Write(this, string, offset, length);

                          case "ascii":
                            return asciiWrite(this, string, offset, length);

                          case "binary":
                            return binaryWrite(this, string, offset, length);

                          case "base64":
                            return base64Write(this, string, offset, length);

                          case "ucs2":
                          case "ucs-2":
                          case "utf16le":
                          case "utf-16le":
                            return ucs2Write(this, string, offset, length);

                          default:
                            if (loweredCase) throw new TypeError("Unknown encoding: " + encoding);
                            encoding = ("" + encoding).toLowerCase();
                            loweredCase = true;
                        }
                    }
                };
                Buffer.prototype.toJSON = function toJSON() {
                    return {
                        type: "Buffer",
                        data: Array.prototype.slice.call(this._arr || this, 0)
                    };
                };
                function base64Slice(buf, start, end) {
                    if (start === 0 && end === buf.length) {
                        return base64.fromByteArray(buf);
                    } else {
                        return base64.fromByteArray(buf.slice(start, end));
                    }
                }
                function utf8Slice(buf, start, end) {
                    end = Math.min(buf.length, end);
                    var res = [];
                    var i = start;
                    while (i < end) {
                        var firstByte = buf[i];
                        var codePoint = null;
                        var bytesPerSequence = firstByte > 239 ? 4 : firstByte > 223 ? 3 : firstByte > 191 ? 2 : 1;
                        if (i + bytesPerSequence <= end) {
                            var secondByte, thirdByte, fourthByte, tempCodePoint;
                            switch (bytesPerSequence) {
                              case 1:
                                if (firstByte < 128) {
                                    codePoint = firstByte;
                                }
                                break;

                              case 2:
                                secondByte = buf[i + 1];
                                if ((secondByte & 192) === 128) {
                                    tempCodePoint = (firstByte & 31) << 6 | secondByte & 63;
                                    if (tempCodePoint > 127) {
                                        codePoint = tempCodePoint;
                                    }
                                }
                                break;

                              case 3:
                                secondByte = buf[i + 1];
                                thirdByte = buf[i + 2];
                                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128) {
                                    tempCodePoint = (firstByte & 15) << 12 | (secondByte & 63) << 6 | thirdByte & 63;
                                    if (tempCodePoint > 2047 && (tempCodePoint < 55296 || tempCodePoint > 57343)) {
                                        codePoint = tempCodePoint;
                                    }
                                }
                                break;

                              case 4:
                                secondByte = buf[i + 1];
                                thirdByte = buf[i + 2];
                                fourthByte = buf[i + 3];
                                if ((secondByte & 192) === 128 && (thirdByte & 192) === 128 && (fourthByte & 192) === 128) {
                                    tempCodePoint = (firstByte & 15) << 18 | (secondByte & 63) << 12 | (thirdByte & 63) << 6 | fourthByte & 63;
                                    if (tempCodePoint > 65535 && tempCodePoint < 1114112) {
                                        codePoint = tempCodePoint;
                                    }
                                }
                            }
                        }
                        if (codePoint === null) {
                            codePoint = 65533;
                            bytesPerSequence = 1;
                        } else if (codePoint > 65535) {
                            codePoint -= 65536;
                            res.push(codePoint >>> 10 & 1023 | 55296);
                            codePoint = 56320 | codePoint & 1023;
                        }
                        res.push(codePoint);
                        i += bytesPerSequence;
                    }
                    return decodeCodePointsArray(res);
                }
                var MAX_ARGUMENTS_LENGTH = 4096;
                function decodeCodePointsArray(codePoints) {
                    var len = codePoints.length;
                    if (len <= MAX_ARGUMENTS_LENGTH) {
                        return String.fromCharCode.apply(String, codePoints);
                    }
                    var res = "";
                    var i = 0;
                    while (i < len) {
                        res += String.fromCharCode.apply(String, codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH));
                    }
                    return res;
                }
                function asciiSlice(buf, start, end) {
                    var ret = "";
                    end = Math.min(buf.length, end);
                    for (var i = start; i < end; ++i) {
                        ret += String.fromCharCode(buf[i] & 127);
                    }
                    return ret;
                }
                function binarySlice(buf, start, end) {
                    var ret = "";
                    end = Math.min(buf.length, end);
                    for (var i = start; i < end; ++i) {
                        ret += String.fromCharCode(buf[i]);
                    }
                    return ret;
                }
                function hexSlice(buf, start, end) {
                    var len = buf.length;
                    if (!start || start < 0) start = 0;
                    if (!end || end < 0 || end > len) end = len;
                    var out = "";
                    for (var i = start; i < end; ++i) {
                        out += toHex(buf[i]);
                    }
                    return out;
                }
                function utf16leSlice(buf, start, end) {
                    var bytes = buf.slice(start, end);
                    var res = "";
                    for (var i = 0; i < bytes.length; i += 2) {
                        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
                    }
                    return res;
                }
                Buffer.prototype.slice = function slice(start, end) {
                    var len = this.length;
                    start = ~~start;
                    end = end === undefined ? len : ~~end;
                    if (start < 0) {
                        start += len;
                        if (start < 0) start = 0;
                    } else if (start > len) {
                        start = len;
                    }
                    if (end < 0) {
                        end += len;
                        if (end < 0) end = 0;
                    } else if (end > len) {
                        end = len;
                    }
                    if (end < start) end = start;
                    var newBuf;
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        newBuf = this.subarray(start, end);
                        newBuf.__proto__ = Buffer.prototype;
                    } else {
                        var sliceLen = end - start;
                        newBuf = new Buffer(sliceLen, undefined);
                        for (var i = 0; i < sliceLen; ++i) {
                            newBuf[i] = this[i + start];
                        }
                    }
                    return newBuf;
                };
                function checkOffset(offset, ext, length) {
                    if (offset % 1 !== 0 || offset < 0) throw new RangeError("offset is not uint");
                    if (offset + ext > length) throw new RangeError("Trying to access beyond buffer length");
                }
                Buffer.prototype.readUIntLE = function readUIntLE(offset, byteLength, noAssert) {
                    offset = offset | 0;
                    byteLength = byteLength | 0;
                    if (!noAssert) checkOffset(offset, byteLength, this.length);
                    var val = this[offset];
                    var mul = 1;
                    var i = 0;
                    while (++i < byteLength && (mul *= 256)) {
                        val += this[offset + i] * mul;
                    }
                    return val;
                };
                Buffer.prototype.readUIntBE = function readUIntBE(offset, byteLength, noAssert) {
                    offset = offset | 0;
                    byteLength = byteLength | 0;
                    if (!noAssert) {
                        checkOffset(offset, byteLength, this.length);
                    }
                    var val = this[offset + --byteLength];
                    var mul = 1;
                    while (byteLength > 0 && (mul *= 256)) {
                        val += this[offset + --byteLength] * mul;
                    }
                    return val;
                };
                Buffer.prototype.readUInt8 = function readUInt8(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 1, this.length);
                    return this[offset];
                };
                Buffer.prototype.readUInt16LE = function readUInt16LE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 2, this.length);
                    return this[offset] | this[offset + 1] << 8;
                };
                Buffer.prototype.readUInt16BE = function readUInt16BE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 2, this.length);
                    return this[offset] << 8 | this[offset + 1];
                };
                Buffer.prototype.readUInt32LE = function readUInt32LE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 4, this.length);
                    return (this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16) + this[offset + 3] * 16777216;
                };
                Buffer.prototype.readUInt32BE = function readUInt32BE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 4, this.length);
                    return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
                };
                Buffer.prototype.readIntLE = function readIntLE(offset, byteLength, noAssert) {
                    offset = offset | 0;
                    byteLength = byteLength | 0;
                    if (!noAssert) checkOffset(offset, byteLength, this.length);
                    var val = this[offset];
                    var mul = 1;
                    var i = 0;
                    while (++i < byteLength && (mul *= 256)) {
                        val += this[offset + i] * mul;
                    }
                    mul *= 128;
                    if (val >= mul) val -= Math.pow(2, 8 * byteLength);
                    return val;
                };
                Buffer.prototype.readIntBE = function readIntBE(offset, byteLength, noAssert) {
                    offset = offset | 0;
                    byteLength = byteLength | 0;
                    if (!noAssert) checkOffset(offset, byteLength, this.length);
                    var i = byteLength;
                    var mul = 1;
                    var val = this[offset + --i];
                    while (i > 0 && (mul *= 256)) {
                        val += this[offset + --i] * mul;
                    }
                    mul *= 128;
                    if (val >= mul) val -= Math.pow(2, 8 * byteLength);
                    return val;
                };
                Buffer.prototype.readInt8 = function readInt8(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 1, this.length);
                    if (!(this[offset] & 128)) return this[offset];
                    return (255 - this[offset] + 1) * -1;
                };
                Buffer.prototype.readInt16LE = function readInt16LE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 2, this.length);
                    var val = this[offset] | this[offset + 1] << 8;
                    return val & 32768 ? val | 4294901760 : val;
                };
                Buffer.prototype.readInt16BE = function readInt16BE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 2, this.length);
                    var val = this[offset + 1] | this[offset] << 8;
                    return val & 32768 ? val | 4294901760 : val;
                };
                Buffer.prototype.readInt32LE = function readInt32LE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 4, this.length);
                    return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
                };
                Buffer.prototype.readInt32BE = function readInt32BE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 4, this.length);
                    return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
                };
                Buffer.prototype.readFloatLE = function readFloatLE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 4, this.length);
                    return ieee754.read(this, offset, true, 23, 4);
                };
                Buffer.prototype.readFloatBE = function readFloatBE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 4, this.length);
                    return ieee754.read(this, offset, false, 23, 4);
                };
                Buffer.prototype.readDoubleLE = function readDoubleLE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 8, this.length);
                    return ieee754.read(this, offset, true, 52, 8);
                };
                Buffer.prototype.readDoubleBE = function readDoubleBE(offset, noAssert) {
                    if (!noAssert) checkOffset(offset, 8, this.length);
                    return ieee754.read(this, offset, false, 52, 8);
                };
                function checkInt(buf, value, offset, ext, max, min) {
                    if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance');
                    if (value > max || value < min) throw new RangeError('"value" argument is out of bounds');
                    if (offset + ext > buf.length) throw new RangeError("Index out of range");
                }
                Buffer.prototype.writeUIntLE = function writeUIntLE(value, offset, byteLength, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    byteLength = byteLength | 0;
                    if (!noAssert) {
                        var maxBytes = Math.pow(2, 8 * byteLength) - 1;
                        checkInt(this, value, offset, byteLength, maxBytes, 0);
                    }
                    var mul = 1;
                    var i = 0;
                    this[offset] = value & 255;
                    while (++i < byteLength && (mul *= 256)) {
                        this[offset + i] = value / mul & 255;
                    }
                    return offset + byteLength;
                };
                Buffer.prototype.writeUIntBE = function writeUIntBE(value, offset, byteLength, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    byteLength = byteLength | 0;
                    if (!noAssert) {
                        var maxBytes = Math.pow(2, 8 * byteLength) - 1;
                        checkInt(this, value, offset, byteLength, maxBytes, 0);
                    }
                    var i = byteLength - 1;
                    var mul = 1;
                    this[offset + i] = value & 255;
                    while (--i >= 0 && (mul *= 256)) {
                        this[offset + i] = value / mul & 255;
                    }
                    return offset + byteLength;
                };
                Buffer.prototype.writeUInt8 = function writeUInt8(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 1, 255, 0);
                    if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
                    this[offset] = value & 255;
                    return offset + 1;
                };
                function objectWriteUInt16(buf, value, offset, littleEndian) {
                    if (value < 0) value = 65535 + value + 1;
                    for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
                        buf[offset + i] = (value & 255 << 8 * (littleEndian ? i : 1 - i)) >>> (littleEndian ? i : 1 - i) * 8;
                    }
                }
                Buffer.prototype.writeUInt16LE = function writeUInt16LE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset] = value & 255;
                        this[offset + 1] = value >>> 8;
                    } else {
                        objectWriteUInt16(this, value, offset, true);
                    }
                    return offset + 2;
                };
                Buffer.prototype.writeUInt16BE = function writeUInt16BE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 2, 65535, 0);
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset] = value >>> 8;
                        this[offset + 1] = value & 255;
                    } else {
                        objectWriteUInt16(this, value, offset, false);
                    }
                    return offset + 2;
                };
                function objectWriteUInt32(buf, value, offset, littleEndian) {
                    if (value < 0) value = 4294967295 + value + 1;
                    for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
                        buf[offset + i] = value >>> (littleEndian ? i : 3 - i) * 8 & 255;
                    }
                }
                Buffer.prototype.writeUInt32LE = function writeUInt32LE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset + 3] = value >>> 24;
                        this[offset + 2] = value >>> 16;
                        this[offset + 1] = value >>> 8;
                        this[offset] = value & 255;
                    } else {
                        objectWriteUInt32(this, value, offset, true);
                    }
                    return offset + 4;
                };
                Buffer.prototype.writeUInt32BE = function writeUInt32BE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 4, 4294967295, 0);
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset] = value >>> 24;
                        this[offset + 1] = value >>> 16;
                        this[offset + 2] = value >>> 8;
                        this[offset + 3] = value & 255;
                    } else {
                        objectWriteUInt32(this, value, offset, false);
                    }
                    return offset + 4;
                };
                Buffer.prototype.writeIntLE = function writeIntLE(value, offset, byteLength, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) {
                        var limit = Math.pow(2, 8 * byteLength - 1);
                        checkInt(this, value, offset, byteLength, limit - 1, -limit);
                    }
                    var i = 0;
                    var mul = 1;
                    var sub = 0;
                    this[offset] = value & 255;
                    while (++i < byteLength && (mul *= 256)) {
                        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
                            sub = 1;
                        }
                        this[offset + i] = (value / mul >> 0) - sub & 255;
                    }
                    return offset + byteLength;
                };
                Buffer.prototype.writeIntBE = function writeIntBE(value, offset, byteLength, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) {
                        var limit = Math.pow(2, 8 * byteLength - 1);
                        checkInt(this, value, offset, byteLength, limit - 1, -limit);
                    }
                    var i = byteLength - 1;
                    var mul = 1;
                    var sub = 0;
                    this[offset + i] = value & 255;
                    while (--i >= 0 && (mul *= 256)) {
                        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
                            sub = 1;
                        }
                        this[offset + i] = (value / mul >> 0) - sub & 255;
                    }
                    return offset + byteLength;
                };
                Buffer.prototype.writeInt8 = function writeInt8(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 1, 127, -128);
                    if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
                    if (value < 0) value = 255 + value + 1;
                    this[offset] = value & 255;
                    return offset + 1;
                };
                Buffer.prototype.writeInt16LE = function writeInt16LE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset] = value & 255;
                        this[offset + 1] = value >>> 8;
                    } else {
                        objectWriteUInt16(this, value, offset, true);
                    }
                    return offset + 2;
                };
                Buffer.prototype.writeInt16BE = function writeInt16BE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 2, 32767, -32768);
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset] = value >>> 8;
                        this[offset + 1] = value & 255;
                    } else {
                        objectWriteUInt16(this, value, offset, false);
                    }
                    return offset + 2;
                };
                Buffer.prototype.writeInt32LE = function writeInt32LE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset] = value & 255;
                        this[offset + 1] = value >>> 8;
                        this[offset + 2] = value >>> 16;
                        this[offset + 3] = value >>> 24;
                    } else {
                        objectWriteUInt32(this, value, offset, true);
                    }
                    return offset + 4;
                };
                Buffer.prototype.writeInt32BE = function writeInt32BE(value, offset, noAssert) {
                    value = +value;
                    offset = offset | 0;
                    if (!noAssert) checkInt(this, value, offset, 4, 2147483647, -2147483648);
                    if (value < 0) value = 4294967295 + value + 1;
                    if (Buffer.TYPED_ARRAY_SUPPORT) {
                        this[offset] = value >>> 24;
                        this[offset + 1] = value >>> 16;
                        this[offset + 2] = value >>> 8;
                        this[offset + 3] = value & 255;
                    } else {
                        objectWriteUInt32(this, value, offset, false);
                    }
                    return offset + 4;
                };
                function checkIEEE754(buf, value, offset, ext, max, min) {
                    if (offset + ext > buf.length) throw new RangeError("Index out of range");
                    if (offset < 0) throw new RangeError("Index out of range");
                }
                function writeFloat(buf, value, offset, littleEndian, noAssert) {
                    if (!noAssert) {
                        checkIEEE754(buf, value, offset, 4, 3.4028234663852886e38, -3.4028234663852886e38);
                    }
                    ieee754.write(buf, value, offset, littleEndian, 23, 4);
                    return offset + 4;
                }
                Buffer.prototype.writeFloatLE = function writeFloatLE(value, offset, noAssert) {
                    return writeFloat(this, value, offset, true, noAssert);
                };
                Buffer.prototype.writeFloatBE = function writeFloatBE(value, offset, noAssert) {
                    return writeFloat(this, value, offset, false, noAssert);
                };
                function writeDouble(buf, value, offset, littleEndian, noAssert) {
                    if (!noAssert) {
                        checkIEEE754(buf, value, offset, 8, 1.7976931348623157e308, -1.7976931348623157e308);
                    }
                    ieee754.write(buf, value, offset, littleEndian, 52, 8);
                    return offset + 8;
                }
                Buffer.prototype.writeDoubleLE = function writeDoubleLE(value, offset, noAssert) {
                    return writeDouble(this, value, offset, true, noAssert);
                };
                Buffer.prototype.writeDoubleBE = function writeDoubleBE(value, offset, noAssert) {
                    return writeDouble(this, value, offset, false, noAssert);
                };
                Buffer.prototype.copy = function copy(target, targetStart, start, end) {
                    if (!start) start = 0;
                    if (!end && end !== 0) end = this.length;
                    if (targetStart >= target.length) targetStart = target.length;
                    if (!targetStart) targetStart = 0;
                    if (end > 0 && end < start) end = start;
                    if (end === start) return 0;
                    if (target.length === 0 || this.length === 0) return 0;
                    if (targetStart < 0) {
                        throw new RangeError("targetStart out of bounds");
                    }
                    if (start < 0 || start >= this.length) throw new RangeError("sourceStart out of bounds");
                    if (end < 0) throw new RangeError("sourceEnd out of bounds");
                    if (end > this.length) end = this.length;
                    if (target.length - targetStart < end - start) {
                        end = target.length - targetStart + start;
                    }
                    var len = end - start;
                    var i;
                    if (this === target && start < targetStart && targetStart < end) {
                        for (i = len - 1; i >= 0; --i) {
                            target[i + targetStart] = this[i + start];
                        }
                    } else if (len < 1e3 || !Buffer.TYPED_ARRAY_SUPPORT) {
                        for (i = 0; i < len; ++i) {
                            target[i + targetStart] = this[i + start];
                        }
                    } else {
                        Uint8Array.prototype.set.call(target, this.subarray(start, start + len), targetStart);
                    }
                    return len;
                };
                Buffer.prototype.fill = function fill(val, start, end, encoding) {
                    if (typeof val === "string") {
                        if (typeof start === "string") {
                            encoding = start;
                            start = 0;
                            end = this.length;
                        } else if (typeof end === "string") {
                            encoding = end;
                            end = this.length;
                        }
                        if (val.length === 1) {
                            var code = val.charCodeAt(0);
                            if (code < 256) {
                                val = code;
                            }
                        }
                        if (encoding !== undefined && typeof encoding !== "string") {
                            throw new TypeError("encoding must be a string");
                        }
                        if (typeof encoding === "string" && !Buffer.isEncoding(encoding)) {
                            throw new TypeError("Unknown encoding: " + encoding);
                        }
                    } else if (typeof val === "number") {
                        val = val & 255;
                    }
                    if (start < 0 || this.length < start || this.length < end) {
                        throw new RangeError("Out of range index");
                    }
                    if (end <= start) {
                        return this;
                    }
                    start = start >>> 0;
                    end = end === undefined ? this.length : end >>> 0;
                    if (!val) val = 0;
                    var i;
                    if (typeof val === "number") {
                        for (i = start; i < end; ++i) {
                            this[i] = val;
                        }
                    } else {
                        var bytes = Buffer.isBuffer(val) ? val : utf8ToBytes(new Buffer(val, encoding).toString());
                        var len = bytes.length;
                        for (i = 0; i < end - start; ++i) {
                            this[i + start] = bytes[i % len];
                        }
                    }
                    return this;
                };
                var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;
                function base64clean(str) {
                    str = stringtrim(str).replace(INVALID_BASE64_RE, "");
                    if (str.length < 2) return "";
                    while (str.length % 4 !== 0) {
                        str = str + "=";
                    }
                    return str;
                }
                function stringtrim(str) {
                    if (str.trim) return str.trim();
                    return str.replace(/^\s+|\s+$/g, "");
                }
                function toHex(n) {
                    if (n < 16) return "0" + n.toString(16);
                    return n.toString(16);
                }
                function utf8ToBytes(string, units) {
                    units = units || Infinity;
                    var codePoint;
                    var length = string.length;
                    var leadSurrogate = null;
                    var bytes = [];
                    for (var i = 0; i < length; ++i) {
                        codePoint = string.charCodeAt(i);
                        if (codePoint > 55295 && codePoint < 57344) {
                            if (!leadSurrogate) {
                                if (codePoint > 56319) {
                                    if ((units -= 3) > -1) bytes.push(239, 191, 189);
                                    continue;
                                } else if (i + 1 === length) {
                                    if ((units -= 3) > -1) bytes.push(239, 191, 189);
                                    continue;
                                }
                                leadSurrogate = codePoint;
                                continue;
                            }
                            if (codePoint < 56320) {
                                if ((units -= 3) > -1) bytes.push(239, 191, 189);
                                leadSurrogate = codePoint;
                                continue;
                            }
                            codePoint = (leadSurrogate - 55296 << 10 | codePoint - 56320) + 65536;
                        } else if (leadSurrogate) {
                            if ((units -= 3) > -1) bytes.push(239, 191, 189);
                        }
                        leadSurrogate = null;
                        if (codePoint < 128) {
                            if ((units -= 1) < 0) break;
                            bytes.push(codePoint);
                        } else if (codePoint < 2048) {
                            if ((units -= 2) < 0) break;
                            bytes.push(codePoint >> 6 | 192, codePoint & 63 | 128);
                        } else if (codePoint < 65536) {
                            if ((units -= 3) < 0) break;
                            bytes.push(codePoint >> 12 | 224, codePoint >> 6 & 63 | 128, codePoint & 63 | 128);
                        } else if (codePoint < 1114112) {
                            if ((units -= 4) < 0) break;
                            bytes.push(codePoint >> 18 | 240, codePoint >> 12 & 63 | 128, codePoint >> 6 & 63 | 128, codePoint & 63 | 128);
                        } else {
                            throw new Error("Invalid code point");
                        }
                    }
                    return bytes;
                }
                function asciiToBytes(str) {
                    var byteArray = [];
                    for (var i = 0; i < str.length; ++i) {
                        byteArray.push(str.charCodeAt(i) & 255);
                    }
                    return byteArray;
                }
                function utf16leToBytes(str, units) {
                    var c, hi, lo;
                    var byteArray = [];
                    for (var i = 0; i < str.length; ++i) {
                        if ((units -= 2) < 0) break;
                        c = str.charCodeAt(i);
                        hi = c >> 8;
                        lo = c % 256;
                        byteArray.push(lo);
                        byteArray.push(hi);
                    }
                    return byteArray;
                }
                function base64ToBytes(str) {
                    return base64.toByteArray(base64clean(str));
                }
                function blitBuffer(src, dst, offset, length) {
                    for (var i = 0; i < length; ++i) {
                        if (i + offset >= dst.length || i >= src.length) break;
                        dst[i + offset] = src[i];
                    }
                    return i;
                }
                function isnan(val) {
                    return val !== val;
                }
            }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {
            "base64-js": 23,
            ieee754: 24,
            isarray: 25
        } ],
        23: [ function(require, module, exports) {
            "use strict";
            exports.toByteArray = toByteArray;
            exports.fromByteArray = fromByteArray;
            var lookup = [];
            var revLookup = [];
            var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
            function init() {
                var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                for (var i = 0, len = code.length; i < len; ++i) {
                    lookup[i] = code[i];
                    revLookup[code.charCodeAt(i)] = i;
                }
                revLookup["-".charCodeAt(0)] = 62;
                revLookup["_".charCodeAt(0)] = 63;
            }
            init();
            function toByteArray(b64) {
                var i, j, l, tmp, placeHolders, arr;
                var len = b64.length;
                if (len % 4 > 0) {
                    throw new Error("Invalid string. Length must be a multiple of 4");
                }
                placeHolders = b64[len - 2] === "=" ? 2 : b64[len - 1] === "=" ? 1 : 0;
                arr = new Arr(len * 3 / 4 - placeHolders);
                l = placeHolders > 0 ? len - 4 : len;
                var L = 0;
                for (i = 0, j = 0; i < l; i += 4, j += 3) {
                    tmp = revLookup[b64.charCodeAt(i)] << 18 | revLookup[b64.charCodeAt(i + 1)] << 12 | revLookup[b64.charCodeAt(i + 2)] << 6 | revLookup[b64.charCodeAt(i + 3)];
                    arr[L++] = tmp >> 16 & 255;
                    arr[L++] = tmp >> 8 & 255;
                    arr[L++] = tmp & 255;
                }
                if (placeHolders === 2) {
                    tmp = revLookup[b64.charCodeAt(i)] << 2 | revLookup[b64.charCodeAt(i + 1)] >> 4;
                    arr[L++] = tmp & 255;
                } else if (placeHolders === 1) {
                    tmp = revLookup[b64.charCodeAt(i)] << 10 | revLookup[b64.charCodeAt(i + 1)] << 4 | revLookup[b64.charCodeAt(i + 2)] >> 2;
                    arr[L++] = tmp >> 8 & 255;
                    arr[L++] = tmp & 255;
                }
                return arr;
            }
            function tripletToBase64(num) {
                return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
            }
            function encodeChunk(uint8, start, end) {
                var tmp;
                var output = [];
                for (var i = start; i < end; i += 3) {
                    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + uint8[i + 2];
                    output.push(tripletToBase64(tmp));
                }
                return output.join("");
            }
            function fromByteArray(uint8) {
                var tmp;
                var len = uint8.length;
                var extraBytes = len % 3;
                var output = "";
                var parts = [];
                var maxChunkLength = 16383;
                for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
                    parts.push(encodeChunk(uint8, i, i + maxChunkLength > len2 ? len2 : i + maxChunkLength));
                }
                if (extraBytes === 1) {
                    tmp = uint8[len - 1];
                    output += lookup[tmp >> 2];
                    output += lookup[tmp << 4 & 63];
                    output += "==";
                } else if (extraBytes === 2) {
                    tmp = (uint8[len - 2] << 8) + uint8[len - 1];
                    output += lookup[tmp >> 10];
                    output += lookup[tmp >> 4 & 63];
                    output += lookup[tmp << 2 & 63];
                    output += "=";
                }
                parts.push(output);
                return parts.join("");
            }
        }, {} ],
        24: [ function(require, module, exports) {
            exports.read = function(buffer, offset, isLE, mLen, nBytes) {
                var e, m;
                var eLen = nBytes * 8 - mLen - 1;
                var eMax = (1 << eLen) - 1;
                var eBias = eMax >> 1;
                var nBits = -7;
                var i = isLE ? nBytes - 1 : 0;
                var d = isLE ? -1 : 1;
                var s = buffer[offset + i];
                i += d;
                e = s & (1 << -nBits) - 1;
                s >>= -nBits;
                nBits += eLen;
                for (;nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}
                m = e & (1 << -nBits) - 1;
                e >>= -nBits;
                nBits += mLen;
                for (;nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}
                if (e === 0) {
                    e = 1 - eBias;
                } else if (e === eMax) {
                    return m ? NaN : (s ? -1 : 1) * Infinity;
                } else {
                    m = m + Math.pow(2, mLen);
                    e = e - eBias;
                }
                return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
            };
            exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
                var e, m, c;
                var eLen = nBytes * 8 - mLen - 1;
                var eMax = (1 << eLen) - 1;
                var eBias = eMax >> 1;
                var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
                var i = isLE ? 0 : nBytes - 1;
                var d = isLE ? 1 : -1;
                var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
                value = Math.abs(value);
                if (isNaN(value) || value === Infinity) {
                    m = isNaN(value) ? 1 : 0;
                    e = eMax;
                } else {
                    e = Math.floor(Math.log(value) / Math.LN2);
                    if (value * (c = Math.pow(2, -e)) < 1) {
                        e--;
                        c *= 2;
                    }
                    if (e + eBias >= 1) {
                        value += rt / c;
                    } else {
                        value += rt * Math.pow(2, 1 - eBias);
                    }
                    if (value * c >= 2) {
                        e++;
                        c /= 2;
                    }
                    if (e + eBias >= eMax) {
                        m = 0;
                        e = eMax;
                    } else if (e + eBias >= 1) {
                        m = (value * c - 1) * Math.pow(2, mLen);
                        e = e + eBias;
                    } else {
                        m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
                        e = 0;
                    }
                }
                for (;mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {}
                e = e << mLen | m;
                eLen += mLen;
                for (;eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {}
                buffer[offset + i - d] |= s * 128;
            };
        }, {} ],
        25: [ function(require, module, exports) {
            var toString = {}.toString;
            module.exports = Array.isArray || function(arr) {
                return toString.call(arr) == "[object Array]";
            };
        }, {} ],
        26: [ function(require, module, exports) {
            function EventEmitter() {
                this._events = this._events || {};
                this._maxListeners = this._maxListeners || undefined;
            }
            module.exports = EventEmitter;
            EventEmitter.EventEmitter = EventEmitter;
            EventEmitter.prototype._events = undefined;
            EventEmitter.prototype._maxListeners = undefined;
            EventEmitter.defaultMaxListeners = 10;
            EventEmitter.prototype.setMaxListeners = function(n) {
                if (!isNumber(n) || n < 0 || isNaN(n)) throw TypeError("n must be a positive number");
                this._maxListeners = n;
                return this;
            };
            EventEmitter.prototype.emit = function(type) {
                var er, handler, len, args, i, listeners;
                if (!this._events) this._events = {};
                if (type === "error") {
                    if (!this._events.error || isObject(this._events.error) && !this._events.error.length) {
                        er = arguments[1];
                        if (er instanceof Error) {
                            throw er;
                        } else {
                            var err = new Error('Uncaught, unspecified "error" event. (' + er + ")");
                            err.context = er;
                            throw err;
                        }
                    }
                }
                handler = this._events[type];
                if (isUndefined(handler)) return false;
                if (isFunction(handler)) {
                    switch (arguments.length) {
                      case 1:
                        handler.call(this);
                        break;

                      case 2:
                        handler.call(this, arguments[1]);
                        break;

                      case 3:
                        handler.call(this, arguments[1], arguments[2]);
                        break;

                      default:
                        args = Array.prototype.slice.call(arguments, 1);
                        handler.apply(this, args);
                    }
                } else if (isObject(handler)) {
                    args = Array.prototype.slice.call(arguments, 1);
                    listeners = handler.slice();
                    len = listeners.length;
                    for (i = 0; i < len; i++) listeners[i].apply(this, args);
                }
                return true;
            };
            EventEmitter.prototype.addListener = function(type, listener) {
                var m;
                if (!isFunction(listener)) throw TypeError("listener must be a function");
                if (!this._events) this._events = {};
                if (this._events.newListener) this.emit("newListener", type, isFunction(listener.listener) ? listener.listener : listener);
                if (!this._events[type]) this._events[type] = listener; else if (isObject(this._events[type])) this._events[type].push(listener); else this._events[type] = [ this._events[type], listener ];
                if (isObject(this._events[type]) && !this._events[type].warned) {
                    if (!isUndefined(this._maxListeners)) {
                        m = this._maxListeners;
                    } else {
                        m = EventEmitter.defaultMaxListeners;
                    }
                    if (m && m > 0 && this._events[type].length > m) {
                        this._events[type].warned = true;
                        console.error("(node) warning: possible EventEmitter memory " + "leak detected. %d listeners added. " + "Use emitter.setMaxListeners() to increase limit.", this._events[type].length);
                        if (typeof console.trace === "function") {
                            console.trace();
                        }
                    }
                }
                return this;
            };
            EventEmitter.prototype.on = EventEmitter.prototype.addListener;
            EventEmitter.prototype.once = function(type, listener) {
                if (!isFunction(listener)) throw TypeError("listener must be a function");
                var fired = false;
                function g() {
                    this.removeListener(type, g);
                    if (!fired) {
                        fired = true;
                        listener.apply(this, arguments);
                    }
                }
                g.listener = listener;
                this.on(type, g);
                return this;
            };
            EventEmitter.prototype.removeListener = function(type, listener) {
                var list, position, length, i;
                if (!isFunction(listener)) throw TypeError("listener must be a function");
                if (!this._events || !this._events[type]) return this;
                list = this._events[type];
                length = list.length;
                position = -1;
                if (list === listener || isFunction(list.listener) && list.listener === listener) {
                    delete this._events[type];
                    if (this._events.removeListener) this.emit("removeListener", type, listener);
                } else if (isObject(list)) {
                    for (i = length; i-- > 0; ) {
                        if (list[i] === listener || list[i].listener && list[i].listener === listener) {
                            position = i;
                            break;
                        }
                    }
                    if (position < 0) return this;
                    if (list.length === 1) {
                        list.length = 0;
                        delete this._events[type];
                    } else {
                        list.splice(position, 1);
                    }
                    if (this._events.removeListener) this.emit("removeListener", type, listener);
                }
                return this;
            };
            EventEmitter.prototype.removeAllListeners = function(type) {
                var key, listeners;
                if (!this._events) return this;
                if (!this._events.removeListener) {
                    if (arguments.length === 0) this._events = {}; else if (this._events[type]) delete this._events[type];
                    return this;
                }
                if (arguments.length === 0) {
                    for (key in this._events) {
                        if (key === "removeListener") continue;
                        this.removeAllListeners(key);
                    }
                    this.removeAllListeners("removeListener");
                    this._events = {};
                    return this;
                }
                listeners = this._events[type];
                if (isFunction(listeners)) {
                    this.removeListener(type, listeners);
                } else if (listeners) {
                    while (listeners.length) this.removeListener(type, listeners[listeners.length - 1]);
                }
                delete this._events[type];
                return this;
            };
            EventEmitter.prototype.listeners = function(type) {
                var ret;
                if (!this._events || !this._events[type]) ret = []; else if (isFunction(this._events[type])) ret = [ this._events[type] ]; else ret = this._events[type].slice();
                return ret;
            };
            EventEmitter.prototype.listenerCount = function(type) {
                if (this._events) {
                    var evlistener = this._events[type];
                    if (isFunction(evlistener)) return 1; else if (evlistener) return evlistener.length;
                }
                return 0;
            };
            EventEmitter.listenerCount = function(emitter, type) {
                return emitter.listenerCount(type);
            };
            function isFunction(arg) {
                return typeof arg === "function";
            }
            function isNumber(arg) {
                return typeof arg === "number";
            }
            function isObject(arg) {
                return typeof arg === "object" && arg !== null;
            }
            function isUndefined(arg) {
                return arg === void 0;
            }
        }, {} ],
        27: [ function(require, module, exports) {
            var http = require("http");
            var https = module.exports;
            for (var key in http) {
                if (http.hasOwnProperty(key)) https[key] = http[key];
            }
            https.request = function(params, cb) {
                if (!params) params = {};
                params.scheme = "https";
                params.protocol = "https:";
                return http.request.call(this, params, cb);
            };
        }, {
            http: 35
        } ],
        28: [ function(require, module, exports) {
            module.exports = function(obj) {
                return !!(obj != null && (obj._isBuffer || obj.constructor && typeof obj.constructor.isBuffer === "function" && obj.constructor.isBuffer(obj)));
            };
        }, {} ],
        29: [ function(require, module, exports) {
            (function(process) {
                function normalizeArray(parts, allowAboveRoot) {
                    var up = 0;
                    for (var i = parts.length - 1; i >= 0; i--) {
                        var last = parts[i];
                        if (last === ".") {
                            parts.splice(i, 1);
                        } else if (last === "..") {
                            parts.splice(i, 1);
                            up++;
                        } else if (up) {
                            parts.splice(i, 1);
                            up--;
                        }
                    }
                    if (allowAboveRoot) {
                        for (;up--; up) {
                            parts.unshift("..");
                        }
                    }
                    return parts;
                }
                var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
                var splitPath = function(filename) {
                    return splitPathRe.exec(filename).slice(1);
                };
                exports.resolve = function() {
                    var resolvedPath = "", resolvedAbsolute = false;
                    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
                        var path = i >= 0 ? arguments[i] : process.cwd();
                        if (typeof path !== "string") {
                            throw new TypeError("Arguments to path.resolve must be strings");
                        } else if (!path) {
                            continue;
                        }
                        resolvedPath = path + "/" + resolvedPath;
                        resolvedAbsolute = path.charAt(0) === "/";
                    }
                    resolvedPath = normalizeArray(filter(resolvedPath.split("/"), function(p) {
                        return !!p;
                    }), !resolvedAbsolute).join("/");
                    return (resolvedAbsolute ? "/" : "") + resolvedPath || ".";
                };
                exports.normalize = function(path) {
                    var isAbsolute = exports.isAbsolute(path), trailingSlash = substr(path, -1) === "/";
                    path = normalizeArray(filter(path.split("/"), function(p) {
                        return !!p;
                    }), !isAbsolute).join("/");
                    if (!path && !isAbsolute) {
                        path = ".";
                    }
                    if (path && trailingSlash) {
                        path += "/";
                    }
                    return (isAbsolute ? "/" : "") + path;
                };
                exports.isAbsolute = function(path) {
                    return path.charAt(0) === "/";
                };
                exports.join = function() {
                    var paths = Array.prototype.slice.call(arguments, 0);
                    return exports.normalize(filter(paths, function(p, index) {
                        if (typeof p !== "string") {
                            throw new TypeError("Arguments to path.join must be strings");
                        }
                        return p;
                    }).join("/"));
                };
                exports.relative = function(from, to) {
                    from = exports.resolve(from).substr(1);
                    to = exports.resolve(to).substr(1);
                    function trim(arr) {
                        var start = 0;
                        for (;start < arr.length; start++) {
                            if (arr[start] !== "") break;
                        }
                        var end = arr.length - 1;
                        for (;end >= 0; end--) {
                            if (arr[end] !== "") break;
                        }
                        if (start > end) return [];
                        return arr.slice(start, end - start + 1);
                    }
                    var fromParts = trim(from.split("/"));
                    var toParts = trim(to.split("/"));
                    var length = Math.min(fromParts.length, toParts.length);
                    var samePartsLength = length;
                    for (var i = 0; i < length; i++) {
                        if (fromParts[i] !== toParts[i]) {
                            samePartsLength = i;
                            break;
                        }
                    }
                    var outputParts = [];
                    for (var i = samePartsLength; i < fromParts.length; i++) {
                        outputParts.push("..");
                    }
                    outputParts = outputParts.concat(toParts.slice(samePartsLength));
                    return outputParts.join("/");
                };
                exports.sep = "/";
                exports.delimiter = ":";
                exports.dirname = function(path) {
                    var result = splitPath(path), root = result[0], dir = result[1];
                    if (!root && !dir) {
                        return ".";
                    }
                    if (dir) {
                        dir = dir.substr(0, dir.length - 1);
                    }
                    return root + dir;
                };
                exports.basename = function(path, ext) {
                    var f = splitPath(path)[2];
                    if (ext && f.substr(-1 * ext.length) === ext) {
                        f = f.substr(0, f.length - ext.length);
                    }
                    return f;
                };
                exports.extname = function(path) {
                    return splitPath(path)[3];
                };
                function filter(xs, f) {
                    if (xs.filter) return xs.filter(f);
                    var res = [];
                    for (var i = 0; i < xs.length; i++) {
                        if (f(xs[i], i, xs)) res.push(xs[i]);
                    }
                    return res;
                }
                var substr = "ab".substr(-1) === "b" ? function(str, start, len) {
                    return str.substr(start, len);
                } : function(str, start, len) {
                    if (start < 0) start = str.length + start;
                    return str.substr(start, len);
                };
            }).call(this, require("_process"));
        }, {
            _process: 30
        } ],
        30: [ function(require, module, exports) {
            var process = module.exports = {};
            var cachedSetTimeout;
            var cachedClearTimeout;
            (function() {
                try {
                    cachedSetTimeout = setTimeout;
                } catch (e) {
                    cachedSetTimeout = function() {
                        throw new Error("setTimeout is not defined");
                    };
                }
                try {
                    cachedClearTimeout = clearTimeout;
                } catch (e) {
                    cachedClearTimeout = function() {
                        throw new Error("clearTimeout is not defined");
                    };
                }
            })();
            var queue = [];
            var draining = false;
            var currentQueue;
            var queueIndex = -1;
            function cleanUpNextTick() {
                if (!draining || !currentQueue) {
                    return;
                }
                draining = false;
                if (currentQueue.length) {
                    queue = currentQueue.concat(queue);
                } else {
                    queueIndex = -1;
                }
                if (queue.length) {
                    drainQueue();
                }
            }
            function drainQueue() {
                if (draining) {
                    return;
                }
                var timeout = cachedSetTimeout(cleanUpNextTick);
                draining = true;
                var len = queue.length;
                while (len) {
                    currentQueue = queue;
                    queue = [];
                    while (++queueIndex < len) {
                        if (currentQueue) {
                            currentQueue[queueIndex].run();
                        }
                    }
                    queueIndex = -1;
                    len = queue.length;
                }
                currentQueue = null;
                draining = false;
                cachedClearTimeout(timeout);
            }
            process.nextTick = function(fun) {
                var args = new Array(arguments.length - 1);
                if (arguments.length > 1) {
                    for (var i = 1; i < arguments.length; i++) {
                        args[i - 1] = arguments[i];
                    }
                }
                queue.push(new Item(fun, args));
                if (queue.length === 1 && !draining) {
                    cachedSetTimeout(drainQueue, 0);
                }
            };
            function Item(fun, array) {
                this.fun = fun;
                this.array = array;
            }
            Item.prototype.run = function() {
                this.fun.apply(null, this.array);
            };
            process.title = "browser";
            process.browser = true;
            process.env = {};
            process.argv = [];
            process.version = "";
            process.versions = {};
            function noop() {}
            process.on = noop;
            process.addListener = noop;
            process.once = noop;
            process.off = noop;
            process.removeListener = noop;
            process.removeAllListeners = noop;
            process.emit = noop;
            process.binding = function(name) {
                throw new Error("process.binding is not supported");
            };
            process.cwd = function() {
                return "/";
            };
            process.chdir = function(dir) {
                throw new Error("process.chdir is not supported");
            };
            process.umask = function() {
                return 0;
            };
        }, {} ],
        31: [ function(require, module, exports) {
            (function(global) {
                (function(root) {
                    var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
                    var freeModule = typeof module == "object" && module && !module.nodeType && module;
                    var freeGlobal = typeof global == "object" && global;
                    if (freeGlobal.global === freeGlobal || freeGlobal.window === freeGlobal || freeGlobal.self === freeGlobal) {
                        root = freeGlobal;
                    }
                    var punycode, maxInt = 2147483647, base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128, delimiter = "-", regexPunycode = /^xn--/, regexNonASCII = /[^\x20-\x7E]/, regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, errors = {
                        overflow: "Overflow: input needs wider integers to process",
                        "not-basic": "Illegal input >= 0x80 (not a basic code point)",
                        "invalid-input": "Invalid input"
                    }, baseMinusTMin = base - tMin, floor = Math.floor, stringFromCharCode = String.fromCharCode, key;
                    function error(type) {
                        throw new RangeError(errors[type]);
                    }
                    function map(array, fn) {
                        var length = array.length;
                        var result = [];
                        while (length--) {
                            result[length] = fn(array[length]);
                        }
                        return result;
                    }
                    function mapDomain(string, fn) {
                        var parts = string.split("@");
                        var result = "";
                        if (parts.length > 1) {
                            result = parts[0] + "@";
                            string = parts[1];
                        }
                        string = string.replace(regexSeparators, ".");
                        var labels = string.split(".");
                        var encoded = map(labels, fn).join(".");
                        return result + encoded;
                    }
                    function ucs2decode(string) {
                        var output = [], counter = 0, length = string.length, value, extra;
                        while (counter < length) {
                            value = string.charCodeAt(counter++);
                            if (value >= 55296 && value <= 56319 && counter < length) {
                                extra = string.charCodeAt(counter++);
                                if ((extra & 64512) == 56320) {
                                    output.push(((value & 1023) << 10) + (extra & 1023) + 65536);
                                } else {
                                    output.push(value);
                                    counter--;
                                }
                            } else {
                                output.push(value);
                            }
                        }
                        return output;
                    }
                    function ucs2encode(array) {
                        return map(array, function(value) {
                            var output = "";
                            if (value > 65535) {
                                value -= 65536;
                                output += stringFromCharCode(value >>> 10 & 1023 | 55296);
                                value = 56320 | value & 1023;
                            }
                            output += stringFromCharCode(value);
                            return output;
                        }).join("");
                    }
                    function basicToDigit(codePoint) {
                        if (codePoint - 48 < 10) {
                            return codePoint - 22;
                        }
                        if (codePoint - 65 < 26) {
                            return codePoint - 65;
                        }
                        if (codePoint - 97 < 26) {
                            return codePoint - 97;
                        }
                        return base;
                    }
                    function digitToBasic(digit, flag) {
                        return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
                    }
                    function adapt(delta, numPoints, firstTime) {
                        var k = 0;
                        delta = firstTime ? floor(delta / damp) : delta >> 1;
                        delta += floor(delta / numPoints);
                        for (;delta > baseMinusTMin * tMax >> 1; k += base) {
                            delta = floor(delta / baseMinusTMin);
                        }
                        return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
                    }
                    function decode(input) {
                        var output = [], inputLength = input.length, out, i = 0, n = initialN, bias = initialBias, basic, j, index, oldi, w, k, digit, t, baseMinusT;
                        basic = input.lastIndexOf(delimiter);
                        if (basic < 0) {
                            basic = 0;
                        }
                        for (j = 0; j < basic; ++j) {
                            if (input.charCodeAt(j) >= 128) {
                                error("not-basic");
                            }
                            output.push(input.charCodeAt(j));
                        }
                        for (index = basic > 0 ? basic + 1 : 0; index < inputLength; ) {
                            for (oldi = i, w = 1, k = base; ;k += base) {
                                if (index >= inputLength) {
                                    error("invalid-input");
                                }
                                digit = basicToDigit(input.charCodeAt(index++));
                                if (digit >= base || digit > floor((maxInt - i) / w)) {
                                    error("overflow");
                                }
                                i += digit * w;
                                t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
                                if (digit < t) {
                                    break;
                                }
                                baseMinusT = base - t;
                                if (w > floor(maxInt / baseMinusT)) {
                                    error("overflow");
                                }
                                w *= baseMinusT;
                            }
                            out = output.length + 1;
                            bias = adapt(i - oldi, out, oldi == 0);
                            if (floor(i / out) > maxInt - n) {
                                error("overflow");
                            }
                            n += floor(i / out);
                            i %= out;
                            output.splice(i++, 0, n);
                        }
                        return ucs2encode(output);
                    }
                    function encode(input) {
                        var n, delta, handledCPCount, basicLength, bias, j, m, q, k, t, currentValue, output = [], inputLength, handledCPCountPlusOne, baseMinusT, qMinusT;
                        input = ucs2decode(input);
                        inputLength = input.length;
                        n = initialN;
                        delta = 0;
                        bias = initialBias;
                        for (j = 0; j < inputLength; ++j) {
                            currentValue = input[j];
                            if (currentValue < 128) {
                                output.push(stringFromCharCode(currentValue));
                            }
                        }
                        handledCPCount = basicLength = output.length;
                        if (basicLength) {
                            output.push(delimiter);
                        }
                        while (handledCPCount < inputLength) {
                            for (m = maxInt, j = 0; j < inputLength; ++j) {
                                currentValue = input[j];
                                if (currentValue >= n && currentValue < m) {
                                    m = currentValue;
                                }
                            }
                            handledCPCountPlusOne = handledCPCount + 1;
                            if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
                                error("overflow");
                            }
                            delta += (m - n) * handledCPCountPlusOne;
                            n = m;
                            for (j = 0; j < inputLength; ++j) {
                                currentValue = input[j];
                                if (currentValue < n && ++delta > maxInt) {
                                    error("overflow");
                                }
                                if (currentValue == n) {
                                    for (q = delta, k = base; ;k += base) {
                                        t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
                                        if (q < t) {
                                            break;
                                        }
                                        qMinusT = q - t;
                                        baseMinusT = base - t;
                                        output.push(stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0)));
                                        q = floor(qMinusT / baseMinusT);
                                    }
                                    output.push(stringFromCharCode(digitToBasic(q, 0)));
                                    bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
                                    delta = 0;
                                    ++handledCPCount;
                                }
                            }
                            ++delta;
                            ++n;
                        }
                        return output.join("");
                    }
                    function toUnicode(input) {
                        return mapDomain(input, function(string) {
                            return regexPunycode.test(string) ? decode(string.slice(4).toLowerCase()) : string;
                        });
                    }
                    function toASCII(input) {
                        return mapDomain(input, function(string) {
                            return regexNonASCII.test(string) ? "xn--" + encode(string) : string;
                        });
                    }
                    punycode = {
                        version: "1.4.1",
                        ucs2: {
                            decode: ucs2decode,
                            encode: ucs2encode
                        },
                        decode: decode,
                        encode: encode,
                        toASCII: toASCII,
                        toUnicode: toUnicode
                    };
                    if (typeof define == "function" && typeof define.amd == "object" && define.amd) {
                        define("punycode", function() {
                            return punycode;
                        });
                    } else if (freeExports && freeModule) {
                        if (module.exports == freeExports) {
                            freeModule.exports = punycode;
                        } else {
                            for (key in punycode) {
                                punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
                            }
                        }
                    } else {
                        root.punycode = punycode;
                    }
                })(this);
            }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {} ],
        32: [ function(require, module, exports) {
            "use strict";
            function hasOwnProperty(obj, prop) {
                return Object.prototype.hasOwnProperty.call(obj, prop);
            }
            module.exports = function(qs, sep, eq, options) {
                sep = sep || "&";
                eq = eq || "=";
                var obj = {};
                if (typeof qs !== "string" || qs.length === 0) {
                    return obj;
                }
                var regexp = /\+/g;
                qs = qs.split(sep);
                var maxKeys = 1e3;
                if (options && typeof options.maxKeys === "number") {
                    maxKeys = options.maxKeys;
                }
                var len = qs.length;
                if (maxKeys > 0 && len > maxKeys) {
                    len = maxKeys;
                }
                for (var i = 0; i < len; ++i) {
                    var x = qs[i].replace(regexp, "%20"), idx = x.indexOf(eq), kstr, vstr, k, v;
                    if (idx >= 0) {
                        kstr = x.substr(0, idx);
                        vstr = x.substr(idx + 1);
                    } else {
                        kstr = x;
                        vstr = "";
                    }
                    k = decodeURIComponent(kstr);
                    v = decodeURIComponent(vstr);
                    if (!hasOwnProperty(obj, k)) {
                        obj[k] = v;
                    } else if (isArray(obj[k])) {
                        obj[k].push(v);
                    } else {
                        obj[k] = [ obj[k], v ];
                    }
                }
                return obj;
            };
            var isArray = Array.isArray || function(xs) {
                return Object.prototype.toString.call(xs) === "[object Array]";
            };
        }, {} ],
        33: [ function(require, module, exports) {
            "use strict";
            var stringifyPrimitive = function(v) {
                switch (typeof v) {
                  case "string":
                    return v;

                  case "boolean":
                    return v ? "true" : "false";

                  case "number":
                    return isFinite(v) ? v : "";

                  default:
                    return "";
                }
            };
            module.exports = function(obj, sep, eq, name) {
                sep = sep || "&";
                eq = eq || "=";
                if (obj === null) {
                    obj = undefined;
                }
                if (typeof obj === "object") {
                    return map(objectKeys(obj), function(k) {
                        var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
                        if (isArray(obj[k])) {
                            return map(obj[k], function(v) {
                                return ks + encodeURIComponent(stringifyPrimitive(v));
                            }).join(sep);
                        } else {
                            return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
                        }
                    }).join(sep);
                }
                if (!name) return "";
                return encodeURIComponent(stringifyPrimitive(name)) + eq + encodeURIComponent(stringifyPrimitive(obj));
            };
            var isArray = Array.isArray || function(xs) {
                return Object.prototype.toString.call(xs) === "[object Array]";
            };
            function map(xs, f) {
                if (xs.map) return xs.map(f);
                var res = [];
                for (var i = 0; i < xs.length; i++) {
                    res.push(f(xs[i], i));
                }
                return res;
            }
            var objectKeys = Object.keys || function(obj) {
                var res = [];
                for (var key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
                }
                return res;
            };
        }, {} ],
        34: [ function(require, module, exports) {
            "use strict";
            exports.decode = exports.parse = require("./decode");
            exports.encode = exports.stringify = require("./encode");
        }, {
            "./decode": 32,
            "./encode": 33
        } ],
        35: [ function(require, module, exports) {
            (function(global) {
                var ClientRequest = require("./lib/request");
                var extend = require("xtend");
                var statusCodes = require("builtin-status-codes");
                var url = require("url");
                var http = exports;
                http.request = function(opts, cb) {
                    if (typeof opts === "string") opts = url.parse(opts); else opts = extend(opts);
                    var defaultProtocol = global.location.protocol.search(/^https?:$/) === -1 ? "http:" : "";
                    var protocol = opts.protocol || defaultProtocol;
                    var host = opts.hostname || opts.host;
                    var port = opts.port;
                    var path = opts.path || "/";
                    if (host && host.indexOf(":") !== -1) host = "[" + host + "]";
                    opts.url = (host ? protocol + "//" + host : "") + (port ? ":" + port : "") + path;
                    opts.method = (opts.method || "GET").toUpperCase();
                    opts.headers = opts.headers || {};
                    var req = new ClientRequest(opts);
                    if (cb) req.on("response", cb);
                    return req;
                };
                http.get = function get(opts, cb) {
                    var req = http.request(opts, cb);
                    req.end();
                    return req;
                };
                http.Agent = function() {};
                http.Agent.defaultMaxSockets = 4;
                http.STATUS_CODES = statusCodes;
                http.METHODS = [ "CHECKOUT", "CONNECT", "COPY", "DELETE", "GET", "HEAD", "LOCK", "M-SEARCH", "MERGE", "MKACTIVITY", "MKCOL", "MOVE", "NOTIFY", "OPTIONS", "PATCH", "POST", "PROPFIND", "PROPPATCH", "PURGE", "PUT", "REPORT", "SEARCH", "SUBSCRIBE", "TRACE", "UNLOCK", "UNSUBSCRIBE" ];
            }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {
            "./lib/request": 37,
            "builtin-status-codes": 39,
            url: 41,
            xtend: 146
        } ],
        36: [ function(require, module, exports) {
            (function(global) {
                exports.fetch = isFunction(global.fetch) && isFunction(global.ReadableByteStream);
                exports.blobConstructor = false;
                try {
                    new Blob([ new ArrayBuffer(1) ]);
                    exports.blobConstructor = true;
                } catch (e) {}
                var xhr = new global.XMLHttpRequest();
                xhr.open("GET", global.location.host ? "/" : "https://example.com");
                function checkTypeSupport(type) {
                    try {
                        xhr.responseType = type;
                        return xhr.responseType === type;
                    } catch (e) {}
                    return false;
                }
                var haveArrayBuffer = typeof global.ArrayBuffer !== "undefined";
                var haveSlice = haveArrayBuffer && isFunction(global.ArrayBuffer.prototype.slice);
                exports.arraybuffer = haveArrayBuffer && checkTypeSupport("arraybuffer");
                exports.msstream = !exports.fetch && haveSlice && checkTypeSupport("ms-stream");
                exports.mozchunkedarraybuffer = !exports.fetch && haveArrayBuffer && checkTypeSupport("moz-chunked-arraybuffer");
                exports.overrideMimeType = isFunction(xhr.overrideMimeType);
                exports.vbArray = isFunction(global.VBArray);
                function isFunction(value) {
                    return typeof value === "function";
                }
                xhr = null;
            }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {} ],
        37: [ function(require, module, exports) {
            (function(process, global, Buffer) {
                var capability = require("./capability");
                var inherits = require("inherits");
                var response = require("./response");
                var stream = require("readable-stream");
                var toArrayBuffer = require("to-arraybuffer");
                var IncomingMessage = response.IncomingMessage;
                var rStates = response.readyStates;
                function decideMode(preferBinary) {
                    if (capability.fetch) {
                        return "fetch";
                    } else if (capability.mozchunkedarraybuffer) {
                        return "moz-chunked-arraybuffer";
                    } else if (capability.msstream) {
                        return "ms-stream";
                    } else if (capability.arraybuffer && preferBinary) {
                        return "arraybuffer";
                    } else if (capability.vbArray && preferBinary) {
                        return "text:vbarray";
                    } else {
                        return "text";
                    }
                }
                var ClientRequest = module.exports = function(opts) {
                    var self = this;
                    stream.Writable.call(self);
                    self._opts = opts;
                    self._body = [];
                    self._headers = {};
                    if (opts.auth) self.setHeader("Authorization", "Basic " + new Buffer(opts.auth).toString("base64"));
                    Object.keys(opts.headers).forEach(function(name) {
                        self.setHeader(name, opts.headers[name]);
                    });
                    var preferBinary;
                    if (opts.mode === "prefer-streaming") {
                        preferBinary = false;
                    } else if (opts.mode === "allow-wrong-content-type") {
                        preferBinary = !capability.overrideMimeType;
                    } else if (!opts.mode || opts.mode === "default" || opts.mode === "prefer-fast") {
                        preferBinary = true;
                    } else {
                        throw new Error("Invalid value for opts.mode");
                    }
                    self._mode = decideMode(preferBinary);
                    self.on("finish", function() {
                        self._onFinish();
                    });
                };
                inherits(ClientRequest, stream.Writable);
                ClientRequest.prototype.setHeader = function(name, value) {
                    var self = this;
                    var lowerName = name.toLowerCase();
                    if (unsafeHeaders.indexOf(lowerName) !== -1) return;
                    self._headers[lowerName] = {
                        name: name,
                        value: value
                    };
                };
                ClientRequest.prototype.getHeader = function(name) {
                    var self = this;
                    return self._headers[name.toLowerCase()].value;
                };
                ClientRequest.prototype.removeHeader = function(name) {
                    var self = this;
                    delete self._headers[name.toLowerCase()];
                };
                ClientRequest.prototype._onFinish = function() {
                    var self = this;
                    if (self._destroyed) return;
                    var opts = self._opts;
                    var headersObj = self._headers;
                    var body;
                    if (opts.method === "POST" || opts.method === "PUT" || opts.method === "PATCH") {
                        if (capability.blobConstructor) {
                            body = new global.Blob(self._body.map(function(buffer) {
                                return toArrayBuffer(buffer);
                            }), {
                                type: (headersObj["content-type"] || {}).value || ""
                            });
                        } else {
                            body = Buffer.concat(self._body).toString();
                        }
                    }
                    if (self._mode === "fetch") {
                        var headers = Object.keys(headersObj).map(function(name) {
                            return [ headersObj[name].name, headersObj[name].value ];
                        });
                        global.fetch(self._opts.url, {
                            method: self._opts.method,
                            headers: headers,
                            body: body,
                            mode: "cors",
                            credentials: opts.withCredentials ? "include" : "same-origin"
                        }).then(function(response) {
                            self._fetchResponse = response;
                            self._connect();
                        }, function(reason) {
                            self.emit("error", reason);
                        });
                    } else {
                        var xhr = self._xhr = new global.XMLHttpRequest();
                        try {
                            xhr.open(self._opts.method, self._opts.url, true);
                        } catch (err) {
                            process.nextTick(function() {
                                self.emit("error", err);
                            });
                            return;
                        }
                        if ("responseType" in xhr) xhr.responseType = self._mode.split(":")[0];
                        if ("withCredentials" in xhr) xhr.withCredentials = !!opts.withCredentials;
                        if (self._mode === "text" && "overrideMimeType" in xhr) xhr.overrideMimeType("text/plain; charset=x-user-defined");
                        Object.keys(headersObj).forEach(function(name) {
                            xhr.setRequestHeader(headersObj[name].name, headersObj[name].value);
                        });
                        self._response = null;
                        xhr.onreadystatechange = function() {
                            switch (xhr.readyState) {
                              case rStates.LOADING:
                              case rStates.DONE:
                                self._onXHRProgress();
                                break;
                            }
                        };
                        if (self._mode === "moz-chunked-arraybuffer") {
                            xhr.onprogress = function() {
                                self._onXHRProgress();
                            };
                        }
                        xhr.onerror = function() {
                            if (self._destroyed) return;
                            self.emit("error", new Error("XHR error"));
                        };
                        try {
                            xhr.send(body);
                        } catch (err) {
                            process.nextTick(function() {
                                self.emit("error", err);
                            });
                            return;
                        }
                    }
                };
                function statusValid(xhr) {
                    try {
                        var status = xhr.status;
                        return status !== null && status !== 0;
                    } catch (e) {
                        return false;
                    }
                }
                ClientRequest.prototype._onXHRProgress = function() {
                    var self = this;
                    if (!statusValid(self._xhr) || self._destroyed) return;
                    if (!self._response) self._connect();
                    self._response._onXHRProgress();
                };
                ClientRequest.prototype._connect = function() {
                    var self = this;
                    if (self._destroyed) return;
                    self._response = new IncomingMessage(self._xhr, self._fetchResponse, self._mode);
                    self.emit("response", self._response);
                };
                ClientRequest.prototype._write = function(chunk, encoding, cb) {
                    var self = this;
                    self._body.push(chunk);
                    cb();
                };
                ClientRequest.prototype.abort = ClientRequest.prototype.destroy = function() {
                    var self = this;
                    self._destroyed = true;
                    if (self._response) self._response._destroyed = true;
                    if (self._xhr) self._xhr.abort();
                };
                ClientRequest.prototype.end = function(data, encoding, cb) {
                    var self = this;
                    if (typeof data === "function") {
                        cb = data;
                        data = undefined;
                    }
                    stream.Writable.prototype.end.call(self, data, encoding, cb);
                };
                ClientRequest.prototype.flushHeaders = function() {};
                ClientRequest.prototype.setTimeout = function() {};
                ClientRequest.prototype.setNoDelay = function() {};
                ClientRequest.prototype.setSocketKeepAlive = function() {};
                var unsafeHeaders = [ "accept-charset", "accept-encoding", "access-control-request-headers", "access-control-request-method", "connection", "content-length", "cookie", "cookie2", "date", "dnt", "expect", "host", "keep-alive", "origin", "referer", "te", "trailer", "transfer-encoding", "upgrade", "user-agent", "via" ];
            }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {}, require("buffer").Buffer);
        }, {
            "./capability": 36,
            "./response": 38,
            _process: 30,
            buffer: 22,
            inherits: 71,
            "readable-stream": 99,
            "to-arraybuffer": 40
        } ],
        38: [ function(require, module, exports) {
            (function(process, global, Buffer) {
                var capability = require("./capability");
                var inherits = require("inherits");
                var stream = require("readable-stream");
                var rStates = exports.readyStates = {
                    UNSENT: 0,
                    OPENED: 1,
                    HEADERS_RECEIVED: 2,
                    LOADING: 3,
                    DONE: 4
                };
                var IncomingMessage = exports.IncomingMessage = function(xhr, response, mode) {
                    var self = this;
                    stream.Readable.call(self);
                    self._mode = mode;
                    self.headers = {};
                    self.rawHeaders = [];
                    self.trailers = {};
                    self.rawTrailers = [];
                    self.on("end", function() {
                        process.nextTick(function() {
                            self.emit("close");
                        });
                    });
                    if (mode === "fetch") {
                        self._fetchResponse = response;
                        self.url = response.url;
                        self.statusCode = response.status;
                        self.statusMessage = response.statusText;
                        for (var header, _i, _it = response.headers[Symbol.iterator](); header = (_i = _it.next()).value, 
                        !_i.done; ) {
                            self.headers[header[0].toLowerCase()] = header[1];
                            self.rawHeaders.push(header[0], header[1]);
                        }
                        var reader = response.body.getReader();
                        function read() {
                            reader.read().then(function(result) {
                                if (self._destroyed) return;
                                if (result.done) {
                                    self.push(null);
                                    return;
                                }
                                self.push(new Buffer(result.value));
                                read();
                            });
                        }
                        read();
                    } else {
                        self._xhr = xhr;
                        self._pos = 0;
                        self.url = xhr.responseURL;
                        self.statusCode = xhr.status;
                        self.statusMessage = xhr.statusText;
                        var headers = xhr.getAllResponseHeaders().split(/\r?\n/);
                        headers.forEach(function(header) {
                            var matches = header.match(/^([^:]+):\s*(.*)/);
                            if (matches) {
                                var key = matches[1].toLowerCase();
                                if (key === "set-cookie") {
                                    if (self.headers[key] === undefined) {
                                        self.headers[key] = [];
                                    }
                                    self.headers[key].push(matches[2]);
                                } else if (self.headers[key] !== undefined) {
                                    self.headers[key] += ", " + matches[2];
                                } else {
                                    self.headers[key] = matches[2];
                                }
                                self.rawHeaders.push(matches[1], matches[2]);
                            }
                        });
                        self._charset = "x-user-defined";
                        if (!capability.overrideMimeType) {
                            var mimeType = self.rawHeaders["mime-type"];
                            if (mimeType) {
                                var charsetMatch = mimeType.match(/;\s*charset=([^;])(;|$)/);
                                if (charsetMatch) {
                                    self._charset = charsetMatch[1].toLowerCase();
                                }
                            }
                            if (!self._charset) self._charset = "utf-8";
                        }
                    }
                };
                inherits(IncomingMessage, stream.Readable);
                IncomingMessage.prototype._read = function() {};
                IncomingMessage.prototype._onXHRProgress = function() {
                    var self = this;
                    var xhr = self._xhr;
                    var response = null;
                    switch (self._mode) {
                      case "text:vbarray":
                        if (xhr.readyState !== rStates.DONE) break;
                        try {
                            response = new global.VBArray(xhr.responseBody).toArray();
                        } catch (e) {}
                        if (response !== null) {
                            self.push(new Buffer(response));
                            break;
                        }

                      case "text":
                        try {
                            response = xhr.responseText;
                        } catch (e) {
                            self._mode = "text:vbarray";
                            break;
                        }
                        if (response.length > self._pos) {
                            var newData = response.substr(self._pos);
                            if (self._charset === "x-user-defined") {
                                var buffer = new Buffer(newData.length);
                                for (var i = 0; i < newData.length; i++) buffer[i] = newData.charCodeAt(i) & 255;
                                self.push(buffer);
                            } else {
                                self.push(newData, self._charset);
                            }
                            self._pos = response.length;
                        }
                        break;

                      case "arraybuffer":
                        if (xhr.readyState !== rStates.DONE) break;
                        response = xhr.response;
                        self.push(new Buffer(new Uint8Array(response)));
                        break;

                      case "moz-chunked-arraybuffer":
                        response = xhr.response;
                        if (xhr.readyState !== rStates.LOADING || !response) break;
                        self.push(new Buffer(new Uint8Array(response)));
                        break;

                      case "ms-stream":
                        response = xhr.response;
                        if (xhr.readyState !== rStates.LOADING) break;
                        var reader = new global.MSStreamReader();
                        reader.onprogress = function() {
                            if (reader.result.byteLength > self._pos) {
                                self.push(new Buffer(new Uint8Array(reader.result.slice(self._pos))));
                                self._pos = reader.result.byteLength;
                            }
                        };
                        reader.onload = function() {
                            self.push(null);
                        };
                        reader.readAsArrayBuffer(response);
                        break;
                    }
                    if (self._xhr.readyState === rStates.DONE && self._mode !== "ms-stream") {
                        self.push(null);
                    }
                };
            }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {}, require("buffer").Buffer);
        }, {
            "./capability": 36,
            _process: 30,
            buffer: 22,
            inherits: 71,
            "readable-stream": 99
        } ],
        39: [ function(require, module, exports) {
            module.exports = {
                "100": "Continue",
                "101": "Switching Protocols",
                "102": "Processing",
                "200": "OK",
                "201": "Created",
                "202": "Accepted",
                "203": "Non-Authoritative Information",
                "204": "No Content",
                "205": "Reset Content",
                "206": "Partial Content",
                "207": "Multi-Status",
                "208": "Already Reported",
                "226": "IM Used",
                "300": "Multiple Choices",
                "301": "Moved Permanently",
                "302": "Found",
                "303": "See Other",
                "304": "Not Modified",
                "305": "Use Proxy",
                "307": "Temporary Redirect",
                "308": "Permanent Redirect",
                "400": "Bad Request",
                "401": "Unauthorized",
                "402": "Payment Required",
                "403": "Forbidden",
                "404": "Not Found",
                "405": "Method Not Allowed",
                "406": "Not Acceptable",
                "407": "Proxy Authentication Required",
                "408": "Request Timeout",
                "409": "Conflict",
                "410": "Gone",
                "411": "Length Required",
                "412": "Precondition Failed",
                "413": "Payload Too Large",
                "414": "URI Too Long",
                "415": "Unsupported Media Type",
                "416": "Range Not Satisfiable",
                "417": "Expectation Failed",
                "418": "I'm a teapot",
                "421": "Misdirected Request",
                "422": "Unprocessable Entity",
                "423": "Locked",
                "424": "Failed Dependency",
                "425": "Unordered Collection",
                "426": "Upgrade Required",
                "428": "Precondition Required",
                "429": "Too Many Requests",
                "431": "Request Header Fields Too Large",
                "500": "Internal Server Error",
                "501": "Not Implemented",
                "502": "Bad Gateway",
                "503": "Service Unavailable",
                "504": "Gateway Timeout",
                "505": "HTTP Version Not Supported",
                "506": "Variant Also Negotiates",
                "507": "Insufficient Storage",
                "508": "Loop Detected",
                "509": "Bandwidth Limit Exceeded",
                "510": "Not Extended",
                "511": "Network Authentication Required"
            };
        }, {} ],
        40: [ function(require, module, exports) {
            var Buffer = require("buffer").Buffer;
            module.exports = function(buf) {
                if (buf instanceof Uint8Array) {
                    if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
                        return buf.buffer;
                    } else if (typeof buf.buffer.slice === "function") {
                        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                    }
                }
                if (Buffer.isBuffer(buf)) {
                    var arrayCopy = new Uint8Array(buf.length);
                    var len = buf.length;
                    for (var i = 0; i < len; i++) {
                        arrayCopy[i] = buf[i];
                    }
                    return arrayCopy.buffer;
                } else {
                    throw new Error("Argument must be a Buffer");
                }
            };
        }, {
            buffer: 22
        } ],
        41: [ function(require, module, exports) {
            "use strict";
            var punycode = require("punycode");
            var util = require("./util");
            exports.parse = urlParse;
            exports.resolve = urlResolve;
            exports.resolveObject = urlResolveObject;
            exports.format = urlFormat;
            exports.Url = Url;
            function Url() {
                this.protocol = null;
                this.slashes = null;
                this.auth = null;
                this.host = null;
                this.port = null;
                this.hostname = null;
                this.hash = null;
                this.search = null;
                this.query = null;
                this.pathname = null;
                this.path = null;
                this.href = null;
            }
            var protocolPattern = /^([a-z0-9.+-]+:)/i, portPattern = /:[0-9]*$/, simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/, delims = [ "<", ">", '"', "`", " ", "\r", "\n", "\t" ], unwise = [ "{", "}", "|", "\\", "^", "`" ].concat(delims), autoEscape = [ "'" ].concat(unwise), nonHostChars = [ "%", "/", "?", ";", "#" ].concat(autoEscape), hostEndingChars = [ "/", "?", "#" ], hostnameMaxLen = 255, hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/, hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/, unsafeProtocol = {
                javascript: true,
                "javascript:": true
            }, hostlessProtocol = {
                javascript: true,
                "javascript:": true
            }, slashedProtocol = {
                http: true,
                https: true,
                ftp: true,
                gopher: true,
                file: true,
                "http:": true,
                "https:": true,
                "ftp:": true,
                "gopher:": true,
                "file:": true
            }, querystring = require("querystring");
            function urlParse(url, parseQueryString, slashesDenoteHost) {
                if (url && util.isObject(url) && url instanceof Url) return url;
                var u = new Url();
                u.parse(url, parseQueryString, slashesDenoteHost);
                return u;
            }
            Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
                if (!util.isString(url)) {
                    throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
                }
                var queryIndex = url.indexOf("?"), splitter = queryIndex !== -1 && queryIndex < url.indexOf("#") ? "?" : "#", uSplit = url.split(splitter), slashRegex = /\\/g;
                uSplit[0] = uSplit[0].replace(slashRegex, "/");
                url = uSplit.join(splitter);
                var rest = url;
                rest = rest.trim();
                if (!slashesDenoteHost && url.split("#").length === 1) {
                    var simplePath = simplePathPattern.exec(rest);
                    if (simplePath) {
                        this.path = rest;
                        this.href = rest;
                        this.pathname = simplePath[1];
                        if (simplePath[2]) {
                            this.search = simplePath[2];
                            if (parseQueryString) {
                                this.query = querystring.parse(this.search.substr(1));
                            } else {
                                this.query = this.search.substr(1);
                            }
                        } else if (parseQueryString) {
                            this.search = "";
                            this.query = {};
                        }
                        return this;
                    }
                }
                var proto = protocolPattern.exec(rest);
                if (proto) {
                    proto = proto[0];
                    var lowerProto = proto.toLowerCase();
                    this.protocol = lowerProto;
                    rest = rest.substr(proto.length);
                }
                if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
                    var slashes = rest.substr(0, 2) === "//";
                    if (slashes && !(proto && hostlessProtocol[proto])) {
                        rest = rest.substr(2);
                        this.slashes = true;
                    }
                }
                if (!hostlessProtocol[proto] && (slashes || proto && !slashedProtocol[proto])) {
                    var hostEnd = -1;
                    for (var i = 0; i < hostEndingChars.length; i++) {
                        var hec = rest.indexOf(hostEndingChars[i]);
                        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) hostEnd = hec;
                    }
                    var auth, atSign;
                    if (hostEnd === -1) {
                        atSign = rest.lastIndexOf("@");
                    } else {
                        atSign = rest.lastIndexOf("@", hostEnd);
                    }
                    if (atSign !== -1) {
                        auth = rest.slice(0, atSign);
                        rest = rest.slice(atSign + 1);
                        this.auth = decodeURIComponent(auth);
                    }
                    hostEnd = -1;
                    for (var i = 0; i < nonHostChars.length; i++) {
                        var hec = rest.indexOf(nonHostChars[i]);
                        if (hec !== -1 && (hostEnd === -1 || hec < hostEnd)) hostEnd = hec;
                    }
                    if (hostEnd === -1) hostEnd = rest.length;
                    this.host = rest.slice(0, hostEnd);
                    rest = rest.slice(hostEnd);
                    this.parseHost();
                    this.hostname = this.hostname || "";
                    var ipv6Hostname = this.hostname[0] === "[" && this.hostname[this.hostname.length - 1] === "]";
                    if (!ipv6Hostname) {
                        var hostparts = this.hostname.split(/\./);
                        for (var i = 0, l = hostparts.length; i < l; i++) {
                            var part = hostparts[i];
                            if (!part) continue;
                            if (!part.match(hostnamePartPattern)) {
                                var newpart = "";
                                for (var j = 0, k = part.length; j < k; j++) {
                                    if (part.charCodeAt(j) > 127) {
                                        newpart += "x";
                                    } else {
                                        newpart += part[j];
                                    }
                                }
                                if (!newpart.match(hostnamePartPattern)) {
                                    var validParts = hostparts.slice(0, i);
                                    var notHost = hostparts.slice(i + 1);
                                    var bit = part.match(hostnamePartStart);
                                    if (bit) {
                                        validParts.push(bit[1]);
                                        notHost.unshift(bit[2]);
                                    }
                                    if (notHost.length) {
                                        rest = "/" + notHost.join(".") + rest;
                                    }
                                    this.hostname = validParts.join(".");
                                    break;
                                }
                            }
                        }
                    }
                    if (this.hostname.length > hostnameMaxLen) {
                        this.hostname = "";
                    } else {
                        this.hostname = this.hostname.toLowerCase();
                    }
                    if (!ipv6Hostname) {
                        this.hostname = punycode.toASCII(this.hostname);
                    }
                    var p = this.port ? ":" + this.port : "";
                    var h = this.hostname || "";
                    this.host = h + p;
                    this.href += this.host;
                    if (ipv6Hostname) {
                        this.hostname = this.hostname.substr(1, this.hostname.length - 2);
                        if (rest[0] !== "/") {
                            rest = "/" + rest;
                        }
                    }
                }
                if (!unsafeProtocol[lowerProto]) {
                    for (var i = 0, l = autoEscape.length; i < l; i++) {
                        var ae = autoEscape[i];
                        if (rest.indexOf(ae) === -1) continue;
                        var esc = encodeURIComponent(ae);
                        if (esc === ae) {
                            esc = escape(ae);
                        }
                        rest = rest.split(ae).join(esc);
                    }
                }
                var hash = rest.indexOf("#");
                if (hash !== -1) {
                    this.hash = rest.substr(hash);
                    rest = rest.slice(0, hash);
                }
                var qm = rest.indexOf("?");
                if (qm !== -1) {
                    this.search = rest.substr(qm);
                    this.query = rest.substr(qm + 1);
                    if (parseQueryString) {
                        this.query = querystring.parse(this.query);
                    }
                    rest = rest.slice(0, qm);
                } else if (parseQueryString) {
                    this.search = "";
                    this.query = {};
                }
                if (rest) this.pathname = rest;
                if (slashedProtocol[lowerProto] && this.hostname && !this.pathname) {
                    this.pathname = "/";
                }
                if (this.pathname || this.search) {
                    var p = this.pathname || "";
                    var s = this.search || "";
                    this.path = p + s;
                }
                this.href = this.format();
                return this;
            };
            function urlFormat(obj) {
                if (util.isString(obj)) obj = urlParse(obj);
                if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
                return obj.format();
            }
            Url.prototype.format = function() {
                var auth = this.auth || "";
                if (auth) {
                    auth = encodeURIComponent(auth);
                    auth = auth.replace(/%3A/i, ":");
                    auth += "@";
                }
                var protocol = this.protocol || "", pathname = this.pathname || "", hash = this.hash || "", host = false, query = "";
                if (this.host) {
                    host = auth + this.host;
                } else if (this.hostname) {
                    host = auth + (this.hostname.indexOf(":") === -1 ? this.hostname : "[" + this.hostname + "]");
                    if (this.port) {
                        host += ":" + this.port;
                    }
                }
                if (this.query && util.isObject(this.query) && Object.keys(this.query).length) {
                    query = querystring.stringify(this.query);
                }
                var search = this.search || query && "?" + query || "";
                if (protocol && protocol.substr(-1) !== ":") protocol += ":";
                if (this.slashes || (!protocol || slashedProtocol[protocol]) && host !== false) {
                    host = "//" + (host || "");
                    if (pathname && pathname.charAt(0) !== "/") pathname = "/" + pathname;
                } else if (!host) {
                    host = "";
                }
                if (hash && hash.charAt(0) !== "#") hash = "#" + hash;
                if (search && search.charAt(0) !== "?") search = "?" + search;
                pathname = pathname.replace(/[?#]/g, function(match) {
                    return encodeURIComponent(match);
                });
                search = search.replace("#", "%23");
                return protocol + host + pathname + search + hash;
            };
            function urlResolve(source, relative) {
                return urlParse(source, false, true).resolve(relative);
            }
            Url.prototype.resolve = function(relative) {
                return this.resolveObject(urlParse(relative, false, true)).format();
            };
            function urlResolveObject(source, relative) {
                if (!source) return relative;
                return urlParse(source, false, true).resolveObject(relative);
            }
            Url.prototype.resolveObject = function(relative) {
                if (util.isString(relative)) {
                    var rel = new Url();
                    rel.parse(relative, false, true);
                    relative = rel;
                }
                var result = new Url();
                var tkeys = Object.keys(this);
                for (var tk = 0; tk < tkeys.length; tk++) {
                    var tkey = tkeys[tk];
                    result[tkey] = this[tkey];
                }
                result.hash = relative.hash;
                if (relative.href === "") {
                    result.href = result.format();
                    return result;
                }
                if (relative.slashes && !relative.protocol) {
                    var rkeys = Object.keys(relative);
                    for (var rk = 0; rk < rkeys.length; rk++) {
                        var rkey = rkeys[rk];
                        if (rkey !== "protocol") result[rkey] = relative[rkey];
                    }
                    if (slashedProtocol[result.protocol] && result.hostname && !result.pathname) {
                        result.path = result.pathname = "/";
                    }
                    result.href = result.format();
                    return result;
                }
                if (relative.protocol && relative.protocol !== result.protocol) {
                    if (!slashedProtocol[relative.protocol]) {
                        var keys = Object.keys(relative);
                        for (var v = 0; v < keys.length; v++) {
                            var k = keys[v];
                            result[k] = relative[k];
                        }
                        result.href = result.format();
                        return result;
                    }
                    result.protocol = relative.protocol;
                    if (!relative.host && !hostlessProtocol[relative.protocol]) {
                        var relPath = (relative.pathname || "").split("/");
                        while (relPath.length && !(relative.host = relPath.shift())) ;
                        if (!relative.host) relative.host = "";
                        if (!relative.hostname) relative.hostname = "";
                        if (relPath[0] !== "") relPath.unshift("");
                        if (relPath.length < 2) relPath.unshift("");
                        result.pathname = relPath.join("/");
                    } else {
                        result.pathname = relative.pathname;
                    }
                    result.search = relative.search;
                    result.query = relative.query;
                    result.host = relative.host || "";
                    result.auth = relative.auth;
                    result.hostname = relative.hostname || relative.host;
                    result.port = relative.port;
                    if (result.pathname || result.search) {
                        var p = result.pathname || "";
                        var s = result.search || "";
                        result.path = p + s;
                    }
                    result.slashes = result.slashes || relative.slashes;
                    result.href = result.format();
                    return result;
                }
                var isSourceAbs = result.pathname && result.pathname.charAt(0) === "/", isRelAbs = relative.host || relative.pathname && relative.pathname.charAt(0) === "/", mustEndAbs = isRelAbs || isSourceAbs || result.host && relative.pathname, removeAllDots = mustEndAbs, srcPath = result.pathname && result.pathname.split("/") || [], relPath = relative.pathname && relative.pathname.split("/") || [], psychotic = result.protocol && !slashedProtocol[result.protocol];
                if (psychotic) {
                    result.hostname = "";
                    result.port = null;
                    if (result.host) {
                        if (srcPath[0] === "") srcPath[0] = result.host; else srcPath.unshift(result.host);
                    }
                    result.host = "";
                    if (relative.protocol) {
                        relative.hostname = null;
                        relative.port = null;
                        if (relative.host) {
                            if (relPath[0] === "") relPath[0] = relative.host; else relPath.unshift(relative.host);
                        }
                        relative.host = null;
                    }
                    mustEndAbs = mustEndAbs && (relPath[0] === "" || srcPath[0] === "");
                }
                if (isRelAbs) {
                    result.host = relative.host || relative.host === "" ? relative.host : result.host;
                    result.hostname = relative.hostname || relative.hostname === "" ? relative.hostname : result.hostname;
                    result.search = relative.search;
                    result.query = relative.query;
                    srcPath = relPath;
                } else if (relPath.length) {
                    if (!srcPath) srcPath = [];
                    srcPath.pop();
                    srcPath = srcPath.concat(relPath);
                    result.search = relative.search;
                    result.query = relative.query;
                } else if (!util.isNullOrUndefined(relative.search)) {
                    if (psychotic) {
                        result.hostname = result.host = srcPath.shift();
                        var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
                        if (authInHost) {
                            result.auth = authInHost.shift();
                            result.host = result.hostname = authInHost.shift();
                        }
                    }
                    result.search = relative.search;
                    result.query = relative.query;
                    if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
                        result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "");
                    }
                    result.href = result.format();
                    return result;
                }
                if (!srcPath.length) {
                    result.pathname = null;
                    if (result.search) {
                        result.path = "/" + result.search;
                    } else {
                        result.path = null;
                    }
                    result.href = result.format();
                    return result;
                }
                var last = srcPath.slice(-1)[0];
                var hasTrailingSlash = (result.host || relative.host || srcPath.length > 1) && (last === "." || last === "..") || last === "";
                var up = 0;
                for (var i = srcPath.length; i >= 0; i--) {
                    last = srcPath[i];
                    if (last === ".") {
                        srcPath.splice(i, 1);
                    } else if (last === "..") {
                        srcPath.splice(i, 1);
                        up++;
                    } else if (up) {
                        srcPath.splice(i, 1);
                        up--;
                    }
                }
                if (!mustEndAbs && !removeAllDots) {
                    for (;up--; up) {
                        srcPath.unshift("..");
                    }
                }
                if (mustEndAbs && srcPath[0] !== "" && (!srcPath[0] || srcPath[0].charAt(0) !== "/")) {
                    srcPath.unshift("");
                }
                if (hasTrailingSlash && srcPath.join("/").substr(-1) !== "/") {
                    srcPath.push("");
                }
                var isAbsolute = srcPath[0] === "" || srcPath[0] && srcPath[0].charAt(0) === "/";
                if (psychotic) {
                    result.hostname = result.host = isAbsolute ? "" : srcPath.length ? srcPath.shift() : "";
                    var authInHost = result.host && result.host.indexOf("@") > 0 ? result.host.split("@") : false;
                    if (authInHost) {
                        result.auth = authInHost.shift();
                        result.host = result.hostname = authInHost.shift();
                    }
                }
                mustEndAbs = mustEndAbs || result.host && srcPath.length;
                if (mustEndAbs && !isAbsolute) {
                    srcPath.unshift("");
                }
                if (!srcPath.length) {
                    result.pathname = null;
                    result.path = null;
                } else {
                    result.pathname = srcPath.join("/");
                }
                if (!util.isNull(result.pathname) || !util.isNull(result.search)) {
                    result.path = (result.pathname ? result.pathname : "") + (result.search ? result.search : "");
                }
                result.auth = relative.auth || result.auth;
                result.slashes = result.slashes || relative.slashes;
                result.href = result.format();
                return result;
            };
            Url.prototype.parseHost = function() {
                var host = this.host;
                var port = portPattern.exec(host);
                if (port) {
                    port = port[0];
                    if (port !== ":") {
                        this.port = port.substr(1);
                    }
                    host = host.substr(0, host.length - port.length);
                }
                if (host) this.hostname = host;
            };
        }, {
            "./util": 42,
            punycode: 31,
            querystring: 34
        } ],
        42: [ function(require, module, exports) {
            "use strict";
            module.exports = {
                isString: function(arg) {
                    return typeof arg === "string";
                },
                isObject: function(arg) {
                    return typeof arg === "object" && arg !== null;
                },
                isNull: function(arg) {
                    return arg === null;
                },
                isNullOrUndefined: function(arg) {
                    return arg == null;
                }
            };
        }, {} ],
        43: [ function(require, module, exports) {
            (function(Buffer) {
                var inherits = require("inherits");
                var Transform = require("readable-stream").Transform;
                var defined = require("defined");
                module.exports = Block;
                inherits(Block, Transform);
                function Block(size, opts) {
                    if (!(this instanceof Block)) return new Block(size, opts);
                    Transform.call(this);
                    if (!opts) opts = {};
                    if (typeof size === "object") {
                        opts = size;
                        size = opts.size;
                    }
                    this.size = size || 512;
                    if (opts.nopad) this._zeroPadding = false; else this._zeroPadding = defined(opts.zeroPadding, true);
                    this._buffered = [];
                    this._bufferedBytes = 0;
                }
                Block.prototype._transform = function(buf, enc, next) {
                    this._bufferedBytes += buf.length;
                    this._buffered.push(buf);
                    while (this._bufferedBytes >= this.size) {
                        var b = Buffer.concat(this._buffered);
                        this._bufferedBytes -= this.size;
                        this.push(b.slice(0, this.size));
                        this._buffered = [ b.slice(this.size, b.length) ];
                    }
                    next();
                };
                Block.prototype._flush = function() {
                    if (this._bufferedBytes && this._zeroPadding) {
                        var zeroes = new Buffer(this.size - this._bufferedBytes);
                        zeroes.fill(0);
                        this._buffered.push(zeroes);
                        this.push(Buffer.concat(this._buffered));
                        this._buffered = null;
                    } else if (this._bufferedBytes) {
                        this.push(Buffer.concat(this._buffered));
                        this._buffered = null;
                    }
                    this.push(null);
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22,
            defined: 44,
            inherits: 71,
            "readable-stream": 99
        } ],
        44: [ function(require, module, exports) {
            module.exports = function() {
                for (var i = 0; i < arguments.length; i++) {
                    if (arguments[i] !== undefined) return arguments[i];
                }
            };
        }, {} ],
        45: [ function(require, module, exports) {
            module.exports = ChunkStoreWriteStream;
            var BlockStream = require("block-stream2");
            var inherits = require("inherits");
            var stream = require("readable-stream");
            inherits(ChunkStoreWriteStream, stream.Writable);
            function ChunkStoreWriteStream(store, chunkLength, opts) {
                var self = this;
                if (!(self instanceof ChunkStoreWriteStream)) {
                    return new ChunkStoreWriteStream(store, chunkLength, opts);
                }
                stream.Writable.call(self, opts);
                if (!opts) opts = {};
                if (!store || !store.put || !store.get) {
                    throw new Error("First argument must be an abstract-chunk-store compliant store");
                }
                chunkLength = Number(chunkLength);
                if (!chunkLength) throw new Error("Second argument must be a chunk length");
                self._blockstream = new BlockStream(chunkLength, {
                    zeroPadding: false
                });
                self._blockstream.on("data", onData).on("error", function(err) {
                    self.destroy(err);
                });
                var index = 0;
                function onData(chunk) {
                    if (self.destroyed) return;
                    store.put(index, chunk);
                    index += 1;
                }
                self.on("finish", function() {
                    this._blockstream.end();
                });
            }
            ChunkStoreWriteStream.prototype._write = function(chunk, encoding, callback) {
                this._blockstream.write(chunk, encoding, callback);
            };
            ChunkStoreWriteStream.prototype.destroy = function(err) {
                if (this.destroyed) return;
                this.destroyed = true;
                if (err) this.emit("error", err);
                this.emit("close");
            };
        }, {
            "block-stream2": 43,
            inherits: 71,
            "readable-stream": 99
        } ],
        46: [ function(require, module, exports) {
            (function(process, global, Buffer) {
                module.exports = createTorrent;
                module.exports.parseInput = parseInput;
                module.exports.announceList = [ [ "udp://tracker.openbittorrent.com:80" ], [ "udp://tracker.internetwarriors.net:1337" ], [ "udp://tracker.leechers-paradise.org:6969" ], [ "udp://tracker.coppersurfer.tk:6969" ], [ "udp://exodus.desync.com:6969" ], [ "wss://tracker.webtorrent.io" ], [ "wss://tracker.btorrent.xyz" ], [ "wss://tracker.openwebtorrent.com" ], [ "wss://tracker.fastcast.nz" ] ];
                var bencode = require("bencode");
                var BlockStream = require("block-stream2");
                var calcPieceLength = require("piece-length");
                var corePath = require("path");
                var extend = require("xtend");
                var FileReadStream = require("filestream/read");
                var flatten = require("flatten");
                var fs = require("fs");
                var isFile = require("is-file");
                var junk = require("junk");
                var MultiStream = require("multistream");
                var once = require("once");
                var parallel = require("run-parallel");
                var sha1 = require("simple-sha1");
                var stream = require("readable-stream");
                function createTorrent(input, opts, cb) {
                    if (typeof opts === "function") return createTorrent(input, null, opts);
                    opts = opts ? extend(opts) : {};
                    _parseInput(input, opts, function(err, files, singleFileTorrent) {
                        if (err) return cb(err);
                        opts.singleFileTorrent = singleFileTorrent;
                        onFiles(files, opts, cb);
                    });
                }
                function parseInput(input, opts, cb) {
                    if (typeof opts === "function") return parseInput(input, null, opts);
                    opts = opts ? extend(opts) : {};
                    _parseInput(input, opts, cb);
                }
                function _parseInput(input, opts, cb) {
                    if (Array.isArray(input) && input.length === 0) throw new Error("invalid input type");
                    if (isFileList(input)) input = Array.prototype.slice.call(input);
                    if (!Array.isArray(input)) input = [ input ];
                    input = input.map(function(item) {
                        if (isBlob(item) && typeof item.path === "string") return item.path;
                        return item;
                    });
                    if (input.length === 1 && typeof input[0] !== "string" && !input[0].name) input[0].name = opts.name;
                    var commonPrefix = null;
                    input.forEach(function(item, i) {
                        if (typeof item === "string") {
                            return;
                        }
                        var path = item.fullPath || item.name;
                        if (!path) {
                            path = "Unknown File " + (i + 1);
                            item.unknownName = true;
                        }
                        item.path = path.split("/");
                        if (!item.path[0]) {
                            item.path.shift();
                        }
                        if (item.path.length < 2) {
                            commonPrefix = null;
                        } else if (i === 0 && input.length > 1) {
                            commonPrefix = item.path[0];
                        } else if (item.path[0] !== commonPrefix) {
                            commonPrefix = null;
                        }
                    });
                    input = input.filter(function(item) {
                        if (typeof item === "string") {
                            return true;
                        }
                        var filename = item.path[item.path.length - 1];
                        return notHidden(filename) && junk.not(filename);
                    });
                    if (commonPrefix) {
                        input.forEach(function(item) {
                            var pathless = (Buffer.isBuffer(item) || isReadable(item)) && !item.path;
                            if (typeof item === "string" || pathless) return;
                            item.path.shift();
                        });
                    }
                    if (!opts.name && commonPrefix) {
                        opts.name = commonPrefix;
                    }
                    if (!opts.name) {
                        input.some(function(item) {
                            if (typeof item === "string") {
                                opts.name = corePath.basename(item);
                                return true;
                            } else if (!item.unknownName) {
                                opts.name = item.path[item.path.length - 1];
                                return true;
                            }
                        });
                    }
                    if (!opts.name) {
                        opts.name = "Unnamed Torrent " + Date.now();
                    }
                    var numPaths = input.reduce(function(sum, item) {
                        return sum + Number(typeof item === "string");
                    }, 0);
                    var isSingleFileTorrent = input.length === 1;
                    if (input.length === 1 && typeof input[0] === "string") {
                        if (typeof fs.stat !== "function") {
                            throw new Error("filesystem paths do not work in the browser");
                        }
                        isFile(input[0], function(err, pathIsFile) {
                            if (err) return cb(err);
                            isSingleFileTorrent = pathIsFile;
                            processInput();
                        });
                    } else {
                        process.nextTick(function() {
                            processInput();
                        });
                    }
                    function processInput() {
                        parallel(input.map(function(item) {
                            return function(cb) {
                                var file = {};
                                if (isBlob(item)) {
                                    file.getStream = getBlobStream(item);
                                    file.length = item.size;
                                } else if (Buffer.isBuffer(item)) {
                                    file.getStream = getBufferStream(item);
                                    file.length = item.length;
                                } else if (isReadable(item)) {
                                    file.getStream = getStreamStream(item, file);
                                    file.length = 0;
                                } else if (typeof item === "string") {
                                    if (typeof fs.stat !== "function") {
                                        throw new Error("filesystem paths do not work in the browser");
                                    }
                                    var keepRoot = numPaths > 1 || isSingleFileTorrent;
                                    getFiles(item, keepRoot, cb);
                                    return;
                                } else {
                                    throw new Error("invalid input type");
                                }
                                file.path = item.path;
                                cb(null, file);
                            };
                        }), function(err, files) {
                            if (err) return cb(err);
                            files = flatten(files);
                            cb(null, files, isSingleFileTorrent);
                        });
                    }
                }
                function getFiles(path, keepRoot, cb) {
                    traversePath(path, getFileInfo, function(err, files) {
                        if (err) return cb(err);
                        if (Array.isArray(files)) files = flatten(files); else files = [ files ];
                        path = corePath.normalize(path);
                        if (keepRoot) {
                            path = path.slice(0, path.lastIndexOf(corePath.sep) + 1);
                        }
                        if (path[path.length - 1] !== corePath.sep) path += corePath.sep;
                        files.forEach(function(file) {
                            file.getStream = getFilePathStream(file.path);
                            file.path = file.path.replace(path, "").split(corePath.sep);
                        });
                        cb(null, files);
                    });
                }
                function getFileInfo(path, cb) {
                    cb = once(cb);
                    fs.stat(path, function(err, stat) {
                        if (err) return cb(err);
                        var info = {
                            length: stat.size,
                            path: path
                        };
                        cb(null, info);
                    });
                }
                function traversePath(path, fn, cb) {
                    fs.readdir(path, function(err, entries) {
                        if (err && err.code === "ENOTDIR") {
                            fn(path, cb);
                        } else if (err) {
                            cb(err);
                        } else {
                            parallel(entries.filter(notHidden).filter(junk.not).map(function(entry) {
                                return function(cb) {
                                    traversePath(corePath.join(path, entry), fn, cb);
                                };
                            }), cb);
                        }
                    });
                }
                function notHidden(file) {
                    return file[0] !== ".";
                }
                function getPieceList(files, pieceLength, cb) {
                    cb = once(cb);
                    var pieces = [];
                    var length = 0;
                    var streams = files.map(function(file) {
                        return file.getStream;
                    });
                    var remainingHashes = 0;
                    var pieceNum = 0;
                    var ended = false;
                    var multistream = new MultiStream(streams);
                    var blockstream = new BlockStream(pieceLength, {
                        zeroPadding: false
                    });
                    multistream.on("error", onError);
                    multistream.pipe(blockstream).on("data", onData).on("end", onEnd).on("error", onError);
                    function onData(chunk) {
                        length += chunk.length;
                        var i = pieceNum;
                        sha1(chunk, function(hash) {
                            pieces[i] = hash;
                            remainingHashes -= 1;
                            maybeDone();
                        });
                        remainingHashes += 1;
                        pieceNum += 1;
                    }
                    function onEnd() {
                        ended = true;
                        maybeDone();
                    }
                    function onError(err) {
                        cleanup();
                        cb(err);
                    }
                    function cleanup() {
                        multistream.removeListener("error", onError);
                        blockstream.removeListener("data", onData);
                        blockstream.removeListener("end", onEnd);
                        blockstream.removeListener("error", onError);
                    }
                    function maybeDone() {
                        if (ended && remainingHashes === 0) {
                            cleanup();
                            cb(null, new Buffer(pieces.join(""), "hex"), length);
                        }
                    }
                }
                function onFiles(files, opts, cb) {
                    var announceList = opts.announceList;
                    if (!announceList) {
                        if (typeof opts.announce === "string") announceList = [ [ opts.announce ] ]; else if (Array.isArray(opts.announce)) {
                            announceList = opts.announce.map(function(u) {
                                return [ u ];
                            });
                        }
                    }
                    if (!announceList) announceList = [];
                    if (global.WEBTORRENT_ANNOUNCE) {
                        if (typeof global.WEBTORRENT_ANNOUNCE === "string") {
                            announceList.push([ [ global.WEBTORRENT_ANNOUNCE ] ]);
                        } else if (Array.isArray(global.WEBTORRENT_ANNOUNCE)) {
                            announceList = announceList.concat(global.WEBTORRENT_ANNOUNCE.map(function(u) {
                                return [ u ];
                            }));
                        }
                    }
                    if (opts.announce === undefined && opts.announceList === undefined) {
                        announceList = announceList.concat(module.exports.announceList);
                    }
                    if (typeof opts.urlList === "string") opts.urlList = [ opts.urlList ];
                    var torrent = {
                        info: {
                            name: opts.name
                        },
                        "creation date": Math.ceil((Number(opts.creationDate) || Date.now()) / 1e3),
                        encoding: "UTF-8"
                    };
                    if (announceList.length !== 0) {
                        torrent.announce = announceList[0][0];
                        torrent["announce-list"] = announceList;
                    }
                    if (opts.comment !== undefined) torrent.comment = opts.comment;
                    if (opts.createdBy !== undefined) torrent["created by"] = opts.createdBy;
                    if (opts.private !== undefined) torrent.info.private = Number(opts.private);
                    if (opts.sslCert !== undefined) torrent.info["ssl-cert"] = opts.sslCert;
                    if (opts.urlList !== undefined) torrent["url-list"] = opts.urlList;
                    var pieceLength = opts.pieceLength || calcPieceLength(files.reduce(sumLength, 0));
                    torrent.info["piece length"] = pieceLength;
                    getPieceList(files, pieceLength, function(err, pieces, torrentLength) {
                        if (err) return cb(err);
                        torrent.info.pieces = pieces;
                        files.forEach(function(file) {
                            delete file.getStream;
                        });
                        if (opts.singleFileTorrent) {
                            torrent.info.length = torrentLength;
                        } else {
                            torrent.info.files = files;
                        }
                        cb(null, bencode.encode(torrent));
                    });
                }
                function sumLength(sum, file) {
                    return sum + file.length;
                }
                function isBlob(obj) {
                    return typeof Blob !== "undefined" && obj instanceof Blob;
                }
                function isFileList(obj) {
                    return typeof FileList === "function" && obj instanceof FileList;
                }
                function isReadable(obj) {
                    return typeof obj === "object" && obj != null && typeof obj.pipe === "function";
                }
                function getBlobStream(file) {
                    return function() {
                        return new FileReadStream(file);
                    };
                }
                function getBufferStream(buffer) {
                    return function() {
                        var s = new stream.PassThrough();
                        s.end(buffer);
                        return s;
                    };
                }
                function getFilePathStream(path) {
                    return function() {
                        return fs.createReadStream(path);
                    };
                }
                function getStreamStream(readable, file) {
                    return function() {
                        var counter = new stream.Transform();
                        counter._transform = function(buf, enc, done) {
                            file.length += buf.length;
                            this.push(buf);
                            done();
                        };
                        readable.pipe(counter);
                        return counter;
                    };
                }
            }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {}, require("buffer").Buffer);
        }, {
            _process: 30,
            bencode: 47,
            "block-stream2": 51,
            buffer: 22,
            "filestream/read": 55,
            flatten: 56,
            fs: 20,
            "is-file": 57,
            junk: 58,
            multistream: 73,
            once: 60,
            path: 29,
            "piece-length": 61,
            "readable-stream": 99,
            "run-parallel": 118,
            "simple-sha1": 128,
            xtend: 146
        } ],
        47: [ function(require, module, exports) {
            var bencode = module.exports;
            bencode.encode = require("./lib/encode");
            bencode.decode = require("./lib/decode");
            bencode.byteLength = bencode.encodingLength = function(value) {
                return bencode.encode(value).length;
            };
        }, {
            "./lib/decode": 48,
            "./lib/encode": 50
        } ],
        48: [ function(require, module, exports) {
            (function(Buffer) {
                var Dict = require("./dict");
                function decode(data, start, end, encoding) {
                    if (typeof start !== "number" && encoding == null) {
                        encoding = start;
                        start = undefined;
                    }
                    if (typeof end !== "number" && encoding == null) {
                        encoding = end;
                        end = undefined;
                    }
                    decode.position = 0;
                    decode.encoding = encoding || null;
                    decode.data = !Buffer.isBuffer(data) ? new Buffer(data) : data.slice(start, end);
                    decode.bytes = decode.data.length;
                    return decode.next();
                }
                decode.bytes = 0;
                decode.position = 0;
                decode.data = null;
                decode.encoding = null;
                decode.next = function() {
                    switch (decode.data[decode.position]) {
                      case 100:
                        return decode.dictionary();
                        break;

                      case 108:
                        return decode.list();
                        break;

                      case 105:
                        return decode.integer();
                        break;

                      default:
                        return decode.buffer();
                        break;
                    }
                };
                decode.find = function(chr) {
                    var i = decode.position;
                    var c = decode.data.length;
                    var d = decode.data;
                    while (i < c) {
                        if (d[i] === chr) return i;
                        i++;
                    }
                    throw new Error('Invalid data: Missing delimiter "' + String.fromCharCode(chr) + '" [0x' + chr.toString(16) + "]");
                };
                decode.dictionary = function() {
                    decode.position++;
                    var dict = new Dict();
                    while (decode.data[decode.position] !== 101) {
                        dict.binarySet(decode.buffer(), decode.next());
                    }
                    decode.position++;
                    return dict;
                };
                decode.list = function() {
                    decode.position++;
                    var lst = [];
                    while (decode.data[decode.position] !== 101) {
                        lst.push(decode.next());
                    }
                    decode.position++;
                    return lst;
                };
                decode.integer = function() {
                    var end = decode.find(101);
                    var number = decode.data.toString("ascii", decode.position + 1, end);
                    decode.position += end + 1 - decode.position;
                    return parseInt(number, 10);
                };
                decode.buffer = function() {
                    var sep = decode.find(58);
                    var length = parseInt(decode.data.toString("ascii", decode.position, sep), 10);
                    var end = ++sep + length;
                    decode.position = end;
                    return decode.encoding ? decode.data.toString(decode.encoding, sep, end) : decode.data.slice(sep, end);
                };
                module.exports = decode;
            }).call(this, require("buffer").Buffer);
        }, {
            "./dict": 49,
            buffer: 22
        } ],
        49: [ function(require, module, exports) {
            var Dict = module.exports = function Dict() {
                Object.defineProperty(this, "_keys", {
                    enumerable: false,
                    value: []
                });
            };
            Dict.prototype.binaryKeys = function binaryKeys() {
                return this._keys.slice();
            };
            Dict.prototype.binarySet = function binarySet(key, value) {
                this._keys.push(key);
                this[key] = value;
            };
        }, {} ],
        50: [ function(require, module, exports) {
            (function(Buffer) {
                function encode(data, buffer, offset) {
                    var buffers = [];
                    var result = null;
                    encode._encode(buffers, data);
                    result = Buffer.concat(buffers);
                    encode.bytes = result.length;
                    if (Buffer.isBuffer(buffer)) {
                        result.copy(buffer, offset);
                        return buffer;
                    }
                    return result;
                }
                encode.bytes = -1;
                encode._floatConversionDetected = false;
                encode._encode = function(buffers, data) {
                    if (Buffer.isBuffer(data)) {
                        buffers.push(new Buffer(data.length + ":"));
                        buffers.push(data);
                        return;
                    }
                    switch (typeof data) {
                      case "string":
                        encode.buffer(buffers, data);
                        break;

                      case "number":
                        encode.number(buffers, data);
                        break;

                      case "object":
                        data.constructor === Array ? encode.list(buffers, data) : encode.dict(buffers, data);
                        break;

                      case "boolean":
                        encode.number(buffers, data ? 1 : 0);
                        break;
                    }
                };
                var buff_e = new Buffer("e"), buff_d = new Buffer("d"), buff_l = new Buffer("l");
                encode.buffer = function(buffers, data) {
                    buffers.push(new Buffer(Buffer.byteLength(data) + ":" + data));
                };
                encode.number = function(buffers, data) {
                    var maxLo = 2147483648;
                    var hi = data / maxLo << 0;
                    var lo = data % maxLo << 0;
                    var val = hi * maxLo + lo;
                    buffers.push(new Buffer("i" + val + "e"));
                    if (val !== data && !encode._floatConversionDetected) {
                        encode._floatConversionDetected = true;
                        console.warn('WARNING: Possible data corruption detected with value "' + data + '":', 'Bencoding only defines support for integers, value was converted to "' + val + '"');
                        console.trace();
                    }
                };
                encode.dict = function(buffers, data) {
                    buffers.push(buff_d);
                    var j = 0;
                    var k;
                    var keys = Object.keys(data).sort();
                    var kl = keys.length;
                    for (;j < kl; j++) {
                        k = keys[j];
                        encode.buffer(buffers, k);
                        encode._encode(buffers, data[k]);
                    }
                    buffers.push(buff_e);
                };
                encode.list = function(buffers, data) {
                    var i = 0, j = 1;
                    var c = data.length;
                    buffers.push(buff_l);
                    for (;i < c; i++) {
                        encode._encode(buffers, data[i]);
                    }
                    buffers.push(buff_e);
                };
                module.exports = encode;
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        51: [ function(require, module, exports) {
            arguments[4][43][0].apply(exports, arguments);
        }, {
            buffer: 22,
            defined: 52,
            dup: 43,
            inherits: 71,
            "readable-stream": 99
        } ],
        52: [ function(require, module, exports) {
            arguments[4][44][0].apply(exports, arguments);
        }, {
            dup: 44
        } ],
        53: [ function(require, module, exports) {
            (function(Buffer) {
                var isTypedArray = require("is-typedarray").strict;
                module.exports = function typedarrayToBuffer(arr) {
                    if (isTypedArray(arr)) {
                        var buf = new Buffer(arr.buffer);
                        if (arr.byteLength !== arr.buffer.byteLength) {
                            buf = buf.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
                        }
                        return buf;
                    } else {
                        return new Buffer(arr);
                    }
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22,
            "is-typedarray": 54
        } ],
        54: [ function(require, module, exports) {
            module.exports = isTypedArray;
            isTypedArray.strict = isStrictTypedArray;
            isTypedArray.loose = isLooseTypedArray;
            var toString = Object.prototype.toString;
            var names = {
                "[object Int8Array]": true,
                "[object Int16Array]": true,
                "[object Int32Array]": true,
                "[object Uint8Array]": true,
                "[object Uint8ClampedArray]": true,
                "[object Uint16Array]": true,
                "[object Uint32Array]": true,
                "[object Float32Array]": true,
                "[object Float64Array]": true
            };
            function isTypedArray(arr) {
                return isStrictTypedArray(arr) || isLooseTypedArray(arr);
            }
            function isStrictTypedArray(arr) {
                return arr instanceof Int8Array || arr instanceof Int16Array || arr instanceof Int32Array || arr instanceof Uint8Array || arr instanceof Uint8ClampedArray || arr instanceof Uint16Array || arr instanceof Uint32Array || arr instanceof Float32Array || arr instanceof Float64Array;
            }
            function isLooseTypedArray(arr) {
                return names[toString.call(arr)];
            }
        }, {} ],
        55: [ function(require, module, exports) {
            var Readable = require("readable-stream").Readable;
            var inherits = require("inherits");
            var reExtension = /^.*\.(\w+)$/;
            var toBuffer = require("typedarray-to-buffer");
            function FileReadStream(file, opts) {
                var readStream = this;
                if (!(this instanceof FileReadStream)) {
                    return new FileReadStream(file, opts);
                }
                opts = opts || {};
                Readable.call(this, opts);
                this._offset = 0;
                this._ready = false;
                this._file = file;
                this._size = file.size;
                this._chunkSize = opts.chunkSize || Math.max(this._size / 1e3, 200 * 1024);
                this.reader = new FileReader();
                this._generateHeaderBlocks(file, opts, function(err, blocks) {
                    if (err) {
                        return readStream.emit("error", err);
                    }
                    if (Array.isArray(blocks)) {
                        blocks.forEach(function(block) {
                            readStream.push(block);
                        });
                    }
                    readStream._ready = true;
                    readStream.emit("_ready");
                });
            }
            inherits(FileReadStream, Readable);
            module.exports = FileReadStream;
            FileReadStream.prototype._generateHeaderBlocks = function(file, opts, callback) {
                callback(null, []);
            };
            FileReadStream.prototype._read = function() {
                if (!this._ready) {
                    this.once("_ready", this._read.bind(this));
                    return;
                }
                var readStream = this;
                var reader = this.reader;
                var startOffset = this._offset;
                var endOffset = this._offset + this._chunkSize;
                if (endOffset > this._size) endOffset = this._size;
                if (startOffset === this._size) {
                    this.destroy();
                    this.push(null);
                    return;
                }
                reader.onload = function() {
                    readStream._offset = endOffset;
                    readStream.push(toBuffer(reader.result));
                };
                reader.onerror = function() {
                    readStream.emit("error", reader.error);
                };
                reader.readAsArrayBuffer(this._file.slice(startOffset, endOffset));
            };
            FileReadStream.prototype.destroy = function() {
                this._file = null;
                if (this.reader) {
                    this.reader.onload = null;
                    this.reader.onerror = null;
                    try {
                        this.reader.abort();
                    } catch (e) {}
                }
                this.reader = null;
            };
        }, {
            inherits: 71,
            "readable-stream": 99,
            "typedarray-to-buffer": 53
        } ],
        56: [ function(require, module, exports) {
            module.exports = function flatten(list, depth) {
                depth = typeof depth == "number" ? depth : Infinity;
                if (!depth) {
                    if (Array.isArray(list)) {
                        return list.map(function(i) {
                            return i;
                        });
                    }
                    return list;
                }
                return _flatten(list, 1);
                function _flatten(list, d) {
                    return list.reduce(function(acc, item) {
                        if (Array.isArray(item) && d < depth) {
                            return acc.concat(_flatten(item, d + 1));
                        } else {
                            return acc.concat(item);
                        }
                    }, []);
                }
            };
        }, {} ],
        57: [ function(require, module, exports) {
            "use strict";
            var fs = require("fs");
            module.exports = function isFile(path, cb) {
                if (!cb) return isFileSync(path);
                fs.stat(path, function(err, stats) {
                    if (err) return cb(err);
                    return cb(null, stats.isFile());
                });
            };
            module.exports.sync = isFileSync;
            function isFileSync(path) {
                return fs.existsSync(path) && fs.statSync(path).isFile();
            }
        }, {
            fs: 20
        } ],
        58: [ function(require, module, exports) {
            "use strict";
            exports.re = /^npm-debug\.log$|^\..*\.swp$|^\.DS_Store$|^\.AppleDouble$|^\.LSOverride$|^Icon\r$|^\._.*|^\.Spotlight-V100$|\.Trashes|^__MACOSX$|~$|^Thumbs\.db$|^ehthumbs\.db$|^Desktop\.ini$/;
            exports.is = function(filename) {
                return exports.re.test(filename);
            };
            exports.not = exports.isnt = function(filename) {
                return !exports.is(filename);
            };
        }, {} ],
        59: [ function(require, module, exports) {
            arguments[4][17][0].apply(exports, arguments);
        }, {
            dup: 17
        } ],
        60: [ function(require, module, exports) {
            arguments[4][18][0].apply(exports, arguments);
        }, {
            dup: 18,
            wrappy: 59
        } ],
        61: [ function(require, module, exports) {
            var closest = require("closest-to");
            var sizes = [];
            for (var i = 14; i <= 22; i++) {
                sizes.push(Math.pow(2, i));
            }
            module.exports = function(size) {
                return closest(size / Math.pow(2, 10), sizes);
            };
        }, {
            "closest-to": 62
        } ],
        62: [ function(require, module, exports) {
            module.exports = function(target, numbers) {
                var closest = Infinity;
                var difference = 0;
                var winner = null;
                numbers.sort(function(a, b) {
                    return a - b;
                });
                for (var i = 0, l = numbers.length; i < l; i++) {
                    difference = Math.abs(target - numbers[i]);
                    if (difference >= closest) {
                        break;
                    }
                    closest = difference;
                    winner = numbers[i];
                }
                return winner;
            };
        }, {} ],
        63: [ function(require, module, exports) {
            exports = module.exports = require("./debug");
            exports.log = log;
            exports.formatArgs = formatArgs;
            exports.save = save;
            exports.load = load;
            exports.useColors = useColors;
            exports.storage = "undefined" != typeof chrome && "undefined" != typeof chrome.storage ? chrome.storage.local : localstorage();
            exports.colors = [ "lightseagreen", "forestgreen", "goldenrod", "dodgerblue", "darkorchid", "crimson" ];
            function useColors() {
                return "WebkitAppearance" in document.documentElement.style || window.console && (console.firebug || console.exception && console.table) || navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31;
            }
            exports.formatters.j = function(v) {
                return JSON.stringify(v);
            };
            function formatArgs() {
                var args = arguments;
                var useColors = this.useColors;
                args[0] = (useColors ? "%c" : "") + this.namespace + (useColors ? " %c" : " ") + args[0] + (useColors ? "%c " : " ") + "+" + exports.humanize(this.diff);
                if (!useColors) return args;
                var c = "color: " + this.color;
                args = [ args[0], c, "color: inherit" ].concat(Array.prototype.slice.call(args, 1));
                var index = 0;
                var lastC = 0;
                args[0].replace(/%[a-z%]/g, function(match) {
                    if ("%%" === match) return;
                    index++;
                    if ("%c" === match) {
                        lastC = index;
                    }
                });
                args.splice(lastC, 0, c);
                return args;
            }
            function log() {
                return "object" === typeof console && console.log && Function.prototype.apply.call(console.log, console, arguments);
            }
            function save(namespaces) {
                try {
                    if (null == namespaces) {
                        exports.storage.removeItem("debug");
                    } else {
                        exports.storage.debug = namespaces;
                    }
                } catch (e) {}
            }
            function load() {
                var r;
                try {
                    r = exports.storage.debug;
                } catch (e) {}
                return r;
            }
            exports.enable(load());
            function localstorage() {
                try {
                    return window.localStorage;
                } catch (e) {}
            }
        }, {
            "./debug": 64
        } ],
        64: [ function(require, module, exports) {
            exports = module.exports = debug;
            exports.coerce = coerce;
            exports.disable = disable;
            exports.enable = enable;
            exports.enabled = enabled;
            exports.humanize = require("ms");
            exports.names = [];
            exports.skips = [];
            exports.formatters = {};
            var prevColor = 0;
            var prevTime;
            function selectColor() {
                return exports.colors[prevColor++ % exports.colors.length];
            }
            function debug(namespace) {
                function disabled() {}
                disabled.enabled = false;
                function enabled() {
                    var self = enabled;
                    var curr = +new Date();
                    var ms = curr - (prevTime || curr);
                    self.diff = ms;
                    self.prev = prevTime;
                    self.curr = curr;
                    prevTime = curr;
                    if (null == self.useColors) self.useColors = exports.useColors();
                    if (null == self.color && self.useColors) self.color = selectColor();
                    var args = Array.prototype.slice.call(arguments);
                    args[0] = exports.coerce(args[0]);
                    if ("string" !== typeof args[0]) {
                        args = [ "%o" ].concat(args);
                    }
                    var index = 0;
                    args[0] = args[0].replace(/%([a-z%])/g, function(match, format) {
                        if (match === "%%") return match;
                        index++;
                        var formatter = exports.formatters[format];
                        if ("function" === typeof formatter) {
                            var val = args[index];
                            match = formatter.call(self, val);
                            args.splice(index, 1);
                            index--;
                        }
                        return match;
                    });
                    if ("function" === typeof exports.formatArgs) {
                        args = exports.formatArgs.apply(self, args);
                    }
                    var logFn = enabled.log || exports.log || console.log.bind(console);
                    logFn.apply(self, args);
                }
                enabled.enabled = true;
                var fn = exports.enabled(namespace) ? enabled : disabled;
                fn.namespace = namespace;
                return fn;
            }
            function enable(namespaces) {
                exports.save(namespaces);
                var split = (namespaces || "").split(/[\s,]+/);
                var len = split.length;
                for (var i = 0; i < len; i++) {
                    if (!split[i]) continue;
                    namespaces = split[i].replace(/\*/g, ".*?");
                    if (namespaces[0] === "-") {
                        exports.skips.push(new RegExp("^" + namespaces.substr(1) + "$"));
                    } else {
                        exports.names.push(new RegExp("^" + namespaces + "$"));
                    }
                }
            }
            function disable() {
                exports.enable("");
            }
            function enabled(name) {
                var i, len;
                for (i = 0, len = exports.skips.length; i < len; i++) {
                    if (exports.skips[i].test(name)) {
                        return false;
                    }
                }
                for (i = 0, len = exports.names.length; i < len; i++) {
                    if (exports.names[i].test(name)) {
                        return true;
                    }
                }
                return false;
            }
            function coerce(val) {
                if (val instanceof Error) return val.stack || val.message;
                return val;
            }
        }, {
            ms: 65
        } ],
        65: [ function(require, module, exports) {
            var s = 1e3;
            var m = s * 60;
            var h = m * 60;
            var d = h * 24;
            var y = d * 365.25;
            module.exports = function(val, options) {
                options = options || {};
                if ("string" == typeof val) return parse(val);
                return options.long ? long(val) : short(val);
            };
            function parse(str) {
                str = "" + str;
                if (str.length > 1e4) return;
                var match = /^((?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|years?|yrs?|y)?$/i.exec(str);
                if (!match) return;
                var n = parseFloat(match[1]);
                var type = (match[2] || "ms").toLowerCase();
                switch (type) {
                  case "years":
                  case "year":
                  case "yrs":
                  case "yr":
                  case "y":
                    return n * y;

                  case "days":
                  case "day":
                  case "d":
                    return n * d;

                  case "hours":
                  case "hour":
                  case "hrs":
                  case "hr":
                  case "h":
                    return n * h;

                  case "minutes":
                  case "minute":
                  case "mins":
                  case "min":
                  case "m":
                    return n * m;

                  case "seconds":
                  case "second":
                  case "secs":
                  case "sec":
                  case "s":
                    return n * s;

                  case "milliseconds":
                  case "millisecond":
                  case "msecs":
                  case "msec":
                  case "ms":
                    return n;
                }
            }
            function short(ms) {
                if (ms >= d) return Math.round(ms / d) + "d";
                if (ms >= h) return Math.round(ms / h) + "h";
                if (ms >= m) return Math.round(ms / m) + "m";
                if (ms >= s) return Math.round(ms / s) + "s";
                return ms + "ms";
            }
            function long(ms) {
                return plural(ms, d, "day") || plural(ms, h, "hour") || plural(ms, m, "minute") || plural(ms, s, "second") || ms + " ms";
            }
            function plural(ms, n, name) {
                if (ms < n) return;
                if (ms < n * 1.5) return Math.floor(ms / n) + " " + name;
                return Math.ceil(ms / n) + " " + name + "s";
            }
        }, {} ],
        66: [ function(require, module, exports) {
            var once = require("once");
            var noop = function() {};
            var isRequest = function(stream) {
                return stream.setHeader && typeof stream.abort === "function";
            };
            var isChildProcess = function(stream) {
                return stream.stdio && Array.isArray(stream.stdio) && stream.stdio.length === 3;
            };
            var eos = function(stream, opts, callback) {
                if (typeof opts === "function") return eos(stream, null, opts);
                if (!opts) opts = {};
                callback = once(callback || noop);
                var ws = stream._writableState;
                var rs = stream._readableState;
                var readable = opts.readable || opts.readable !== false && stream.readable;
                var writable = opts.writable || opts.writable !== false && stream.writable;
                var onlegacyfinish = function() {
                    if (!stream.writable) onfinish();
                };
                var onfinish = function() {
                    writable = false;
                    if (!readable) callback();
                };
                var onend = function() {
                    readable = false;
                    if (!writable) callback();
                };
                var onexit = function(exitCode) {
                    callback(exitCode ? new Error("exited with error code: " + exitCode) : null);
                };
                var onclose = function() {
                    if (readable && !(rs && rs.ended)) return callback(new Error("premature close"));
                    if (writable && !(ws && ws.ended)) return callback(new Error("premature close"));
                };
                var onrequest = function() {
                    stream.req.on("finish", onfinish);
                };
                if (isRequest(stream)) {
                    stream.on("complete", onfinish);
                    stream.on("abort", onclose);
                    if (stream.req) onrequest(); else stream.on("request", onrequest);
                } else if (writable && !ws) {
                    stream.on("end", onlegacyfinish);
                    stream.on("close", onlegacyfinish);
                }
                if (isChildProcess(stream)) stream.on("exit", onexit);
                stream.on("end", onend);
                stream.on("finish", onfinish);
                if (opts.error !== false) stream.on("error", callback);
                stream.on("close", onclose);
                return function() {
                    stream.removeListener("complete", onfinish);
                    stream.removeListener("abort", onclose);
                    stream.removeListener("request", onrequest);
                    if (stream.req) stream.req.removeListener("finish", onfinish);
                    stream.removeListener("end", onlegacyfinish);
                    stream.removeListener("close", onlegacyfinish);
                    stream.removeListener("finish", onfinish);
                    stream.removeListener("exit", onexit);
                    stream.removeListener("end", onend);
                    stream.removeListener("error", callback);
                    stream.removeListener("close", onclose);
                };
            };
            module.exports = eos;
        }, {
            once: 68
        } ],
        67: [ function(require, module, exports) {
            arguments[4][17][0].apply(exports, arguments);
        }, {
            dup: 17
        } ],
        68: [ function(require, module, exports) {
            arguments[4][18][0].apply(exports, arguments);
        }, {
            dup: 18,
            wrappy: 67
        } ],
        69: [ function(require, module, exports) {
            var hat = module.exports = function(bits, base) {
                if (!base) base = 16;
                if (bits === undefined) bits = 128;
                if (bits <= 0) return "0";
                var digits = Math.log(Math.pow(2, bits)) / Math.log(base);
                for (var i = 2; digits === Infinity; i *= 2) {
                    digits = Math.log(Math.pow(2, bits / i)) / Math.log(base) * i;
                }
                var rem = digits - Math.floor(digits);
                var res = "";
                for (var i = 0; i < Math.floor(digits); i++) {
                    var x = Math.floor(Math.random() * base).toString(base);
                    res = x + res;
                }
                if (rem) {
                    var b = Math.pow(base, rem);
                    var x = Math.floor(Math.random() * b).toString(base);
                    res = x + res;
                }
                var parsed = parseInt(res, base);
                if (parsed !== Infinity && parsed >= Math.pow(2, bits)) {
                    return hat(bits, base);
                } else return res;
            };
            hat.rack = function(bits, base, expandBy) {
                var fn = function(data) {
                    var iters = 0;
                    do {
                        if (iters++ > 10) {
                            if (expandBy) bits += expandBy; else throw new Error("too many ID collisions, use more bits");
                        }
                        var id = hat(bits, base);
                    } while (Object.hasOwnProperty.call(hats, id));
                    hats[id] = data;
                    return id;
                };
                var hats = fn.hats = {};
                fn.get = function(id) {
                    return fn.hats[id];
                };
                fn.set = function(id, value) {
                    fn.hats[id] = value;
                    return fn;
                };
                fn.bits = bits || 128;
                fn.base = base || 16;
                return fn;
            };
        }, {} ],
        70: [ function(require, module, exports) {
            (function(process) {
                module.exports = ImmediateStore;
                function ImmediateStore(store) {
                    if (!(this instanceof ImmediateStore)) return new ImmediateStore(store);
                    this.store = store;
                    this.chunkLength = store.chunkLength;
                    if (!this.store || !this.store.get || !this.store.put) {
                        throw new Error("First argument must be abstract-chunk-store compliant");
                    }
                    this.mem = [];
                }
                ImmediateStore.prototype.put = function(index, buf, cb) {
                    var self = this;
                    self.mem[index] = buf;
                    self.store.put(index, buf, function(err) {
                        self.mem[index] = null;
                        if (cb) cb(err);
                    });
                };
                ImmediateStore.prototype.get = function(index, opts, cb) {
                    if (typeof opts === "function") return this.get(index, null, opts);
                    var start = opts && opts.offset || 0;
                    var end = opts && opts.length && start + opts.length;
                    var buf = this.mem[index];
                    if (buf) return nextTick(cb, null, opts ? buf.slice(start, end) : buf);
                    this.store.get(index, opts, cb);
                };
                ImmediateStore.prototype.close = function(cb) {
                    this.store.close(cb);
                };
                ImmediateStore.prototype.destroy = function(cb) {
                    this.store.destroy(cb);
                };
                function nextTick(cb, err, val) {
                    process.nextTick(function() {
                        if (cb) cb(err, val);
                    });
                }
            }).call(this, require("_process"));
        }, {
            _process: 30
        } ],
        71: [ function(require, module, exports) {
            if (typeof Object.create === "function") {
                module.exports = function inherits(ctor, superCtor) {
                    ctor.super_ = superCtor;
                    ctor.prototype = Object.create(superCtor.prototype, {
                        constructor: {
                            value: ctor,
                            enumerable: false,
                            writable: true,
                            configurable: true
                        }
                    });
                };
            } else {
                module.exports = function inherits(ctor, superCtor) {
                    ctor.super_ = superCtor;
                    var TempCtor = function() {};
                    TempCtor.prototype = superCtor.prototype;
                    ctor.prototype = new TempCtor();
                    ctor.prototype.constructor = ctor;
                };
            }
        }, {} ],
        72: [ function(require, module, exports) {
            (function(process) {
                module.exports = Storage;
                function Storage(chunkLength, opts) {
                    if (!(this instanceof Storage)) return new Storage(chunkLength, opts);
                    if (!opts) opts = {};
                    this.chunkLength = Number(chunkLength);
                    if (!this.chunkLength) throw new Error("First argument must be a chunk length");
                    this.chunks = [];
                    this.closed = false;
                    this.length = Number(opts.length) || Infinity;
                    if (this.length !== Infinity) {
                        this.lastChunkLength = this.length % this.chunkLength || this.chunkLength;
                        this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1;
                    }
                }
                Storage.prototype.put = function(index, buf, cb) {
                    if (this.closed) return nextTick(cb, new Error("Storage is closed"));
                    var isLastChunk = index === this.lastChunkIndex;
                    if (isLastChunk && buf.length !== this.lastChunkLength) {
                        return nextTick(cb, new Error("Last chunk length must be " + this.lastChunkLength));
                    }
                    if (!isLastChunk && buf.length !== this.chunkLength) {
                        return nextTick(cb, new Error("Chunk length must be " + this.chunkLength));
                    }
                    this.chunks[index] = buf;
                    nextTick(cb, null);
                };
                Storage.prototype.get = function(index, opts, cb) {
                    if (typeof opts === "function") return this.get(index, null, opts);
                    if (this.closed) return nextTick(cb, new Error("Storage is closed"));
                    var buf = this.chunks[index];
                    if (!buf) return nextTick(cb, new Error("Chunk not found"));
                    if (!opts) return nextTick(cb, null, buf);
                    var offset = opts.offset || 0;
                    var len = opts.length || buf.length - offset;
                    nextTick(cb, null, buf.slice(offset, len + offset));
                };
                Storage.prototype.close = Storage.prototype.destroy = function(cb) {
                    if (this.closed) return nextTick(cb, new Error("Storage is closed"));
                    this.closed = true;
                    this.chunks = null;
                    nextTick(cb, null);
                };
                function nextTick(cb, err, val) {
                    process.nextTick(function() {
                        if (cb) cb(err, val);
                    });
                }
            }).call(this, require("_process"));
        }, {
            _process: 30
        } ],
        73: [ function(require, module, exports) {
            module.exports = MultiStream;
            var inherits = require("inherits");
            var stream = require("readable-stream");
            inherits(MultiStream, stream.Readable);
            function MultiStream(streams, opts) {
                if (!(this instanceof MultiStream)) return new MultiStream(streams, opts);
                stream.Readable.call(this, opts);
                this.destroyed = false;
                this._drained = false;
                this._forwarding = false;
                this._current = null;
                this._queue = typeof streams === "function" ? streams : streams.map(toStreams2);
                this._next();
            }
            MultiStream.obj = function(streams) {
                return new MultiStream(streams, {
                    objectMode: true,
                    highWaterMark: 16
                });
            };
            MultiStream.prototype._read = function() {
                this._drained = true;
                this._forward();
            };
            MultiStream.prototype._forward = function() {
                if (this._forwarding || !this._drained || !this._current) return;
                this._forwarding = true;
                var chunk;
                while ((chunk = this._current.read()) !== null) {
                    this._drained = this.push(chunk);
                }
                this._forwarding = false;
            };
            MultiStream.prototype.destroy = function(err) {
                if (this.destroyed) return;
                this.destroyed = true;
                if (this._current && this._current.destroy) this._current.destroy();
                if (typeof this._queue !== "function") {
                    this._queue.forEach(function(stream) {
                        if (stream.destroy) stream.destroy();
                    });
                }
                if (err) this.emit("error", err);
                this.emit("close");
            };
            MultiStream.prototype._next = function() {
                var self = this;
                self._current = null;
                if (typeof self._queue === "function") {
                    self._queue(function(err, stream) {
                        if (err) return self.destroy(err);
                        self._gotNextStream(toStreams2(stream));
                    });
                } else {
                    var stream = self._queue.shift();
                    if (typeof stream === "function") stream = toStreams2(stream());
                    self._gotNextStream(stream);
                }
            };
            MultiStream.prototype._gotNextStream = function(stream) {
                var self = this;
                if (!stream) {
                    self.push(null);
                    self.destroy();
                    return;
                }
                self._current = stream;
                self._forward();
                stream.on("readable", onReadable);
                stream.on("end", onEnd);
                stream.on("error", onError);
                stream.on("close", onClose);
                function onReadable() {
                    self._forward();
                }
                function onClose() {
                    if (!stream._readableState.ended) {
                        self.destroy();
                    }
                }
                function onEnd() {
                    self._current = null;
                    stream.removeListener("readable", onReadable);
                    stream.removeListener("end", onEnd);
                    stream.removeListener("error", onError);
                    stream.removeListener("close", onClose);
                    self._next();
                }
                function onError(err) {
                    self.destroy(err);
                }
            };
            function toStreams2(s) {
                if (!s || typeof s === "function" || s._readableState) return s;
                var wrap = new stream.Readable().wrap(s);
                if (s.destroy) {
                    wrap.destroy = s.destroy.bind(s);
                }
                return wrap;
            }
        }, {
            inherits: 71,
            "readable-stream": 99
        } ],
        74: [ function(require, module, exports) {
            (function(process, Buffer) {
                module.exports = parseTorrent;
                module.exports.remote = parseTorrentRemote;
                var blobToBuffer = require("blob-to-buffer");
                var fs = require("fs");
                var get = require("simple-get");
                var magnet = require("magnet-uri");
                var parseTorrentFile = require("parse-torrent-file");
                module.exports.toMagnetURI = magnet.encode;
                module.exports.toTorrentFile = parseTorrentFile.encode;
                function parseTorrent(torrentId) {
                    if (typeof torrentId === "string" && /^(stream-)?magnet:/.test(torrentId)) {
                        return magnet(torrentId);
                    } else if (typeof torrentId === "string" && (/^[a-f0-9]{40}$/i.test(torrentId) || /^[a-z2-7]{32}$/i.test(torrentId))) {
                        return magnet("magnet:?xt=urn:btih:" + torrentId);
                    } else if (Buffer.isBuffer(torrentId) && torrentId.length === 20) {
                        return magnet("magnet:?xt=urn:btih:" + torrentId.toString("hex"));
                    } else if (Buffer.isBuffer(torrentId)) {
                        return parseTorrentFile(torrentId);
                    } else if (torrentId && torrentId.infoHash) {
                        if (!torrentId.announce) torrentId.announce = [];
                        if (typeof torrentId.announce === "string") {
                            torrentId.announce = [ torrentId.announce ];
                        }
                        if (!torrentId.urlList) torrentId.urlList = [];
                        return torrentId;
                    } else {
                        throw new Error("Invalid torrent identifier");
                    }
                }
                function parseTorrentRemote(torrentId, cb) {
                    var parsedTorrent;
                    if (typeof cb !== "function") throw new Error("second argument must be a Function");
                    try {
                        parsedTorrent = parseTorrent(torrentId);
                    } catch (err) {}
                    if (parsedTorrent && parsedTorrent.infoHash) {
                        process.nextTick(function() {
                            cb(null, parsedTorrent);
                        });
                    } else if (isBlob(torrentId)) {
                        blobToBuffer(torrentId, function(err, torrentBuf) {
                            if (err) return cb(new Error("Error converting Blob: " + err.message));
                            parseOrThrow(torrentBuf);
                        });
                    } else if (typeof get === "function" && /^https?:/.test(torrentId)) {
                        get.concat({
                            url: torrentId,
                            headers: {
                                "user-agent": "WebTorrent (http://webtorrent.io)"
                            }
                        }, function(err, res, torrentBuf) {
                            if (err) return cb(new Error("Error downloading torrent: " + err.message));
                            parseOrThrow(torrentBuf);
                        });
                    } else if (typeof fs.readFile === "function" && typeof torrentId === "string") {
                        fs.readFile(torrentId, function(err, torrentBuf) {
                            if (err) return cb(new Error("Invalid torrent identifier"));
                            parseOrThrow(torrentBuf);
                        });
                    } else {
                        process.nextTick(function() {
                            cb(new Error("Invalid torrent identifier"));
                        });
                    }
                    function parseOrThrow(torrentBuf) {
                        try {
                            parsedTorrent = parseTorrent(torrentBuf);
                        } catch (err) {
                            return cb(err);
                        }
                        if (parsedTorrent && parsedTorrent.infoHash) cb(null, parsedTorrent); else cb(new Error("Invalid torrent identifier"));
                    }
                }
                function isBlob(obj) {
                    return typeof Blob !== "undefined" && obj instanceof Blob;
                }
                (function() {
                    Buffer(0);
                })();
            }).call(this, require("_process"), require("buffer").Buffer);
        }, {
            _process: 30,
            "blob-to-buffer": 75,
            buffer: 22,
            fs: 20,
            "magnet-uri": 76,
            "parse-torrent-file": 79,
            "simple-get": 121
        } ],
        75: [ function(require, module, exports) {
            (function(Buffer) {
                module.exports = function blobToBuffer(blob, cb) {
                    if (typeof Blob === "undefined" || !(blob instanceof Blob)) {
                        throw new Error("first argument must be a Blob");
                    }
                    if (typeof cb !== "function") {
                        throw new Error("second argument must be a function");
                    }
                    var reader = new FileReader();
                    function onLoadEnd(e) {
                        reader.removeEventListener("loadend", onLoadEnd, false);
                        if (e.error) cb(e.error); else cb(null, new Buffer(reader.result));
                    }
                    reader.addEventListener("loadend", onLoadEnd, false);
                    reader.readAsArrayBuffer(blob);
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        76: [ function(require, module, exports) {
            (function(Buffer) {
                module.exports = magnetURIDecode;
                module.exports.decode = magnetURIDecode;
                module.exports.encode = magnetURIEncode;
                var base32 = require("thirty-two");
                var extend = require("xtend");
                var uniq = require("uniq");
                function magnetURIDecode(uri) {
                    var result = {};
                    var data = uri.split("magnet:?")[1];
                    var params = data && data.length >= 0 ? data.split("&") : [];
                    params.forEach(function(param) {
                        var keyval = param.split("=");
                        if (keyval.length !== 2) return;
                        var key = keyval[0];
                        var val = keyval[1];
                        if (key === "dn") val = decodeURIComponent(val).replace(/\+/g, " ");
                        if (key === "tr" || key === "xs" || key === "as" || key === "ws") {
                            val = decodeURIComponent(val);
                        }
                        if (key === "kt") val = decodeURIComponent(val).split("+");
                        if (result[key]) {
                            if (Array.isArray(result[key])) {
                                result[key].push(val);
                            } else {
                                var old = result[key];
                                result[key] = [ old, val ];
                            }
                        } else {
                            result[key] = val;
                        }
                    });
                    var m;
                    if (result.xt) {
                        var xts = Array.isArray(result.xt) ? result.xt : [ result.xt ];
                        xts.forEach(function(xt) {
                            if (m = xt.match(/^urn:btih:(.{40})/)) {
                                result.infoHash = m[1].toLowerCase();
                            } else if (m = xt.match(/^urn:btih:(.{32})/)) {
                                var decodedStr = base32.decode(m[1]);
                                result.infoHash = new Buffer(decodedStr, "binary").toString("hex");
                            }
                        });
                    }
                    if (result.infoHash) result.infoHashBuffer = new Buffer(result.infoHash, "hex");
                    if (result.dn) result.name = result.dn;
                    if (result.kt) result.keywords = result.kt;
                    if (typeof result.tr === "string") result.announce = [ result.tr ]; else if (Array.isArray(result.tr)) result.announce = result.tr; else result.announce = [];
                    result.urlList = [];
                    if (typeof result.as === "string" || Array.isArray(result.as)) {
                        result.urlList = result.urlList.concat(result.as);
                    }
                    if (typeof result.ws === "string" || Array.isArray(result.ws)) {
                        result.urlList = result.urlList.concat(result.ws);
                    }
                    uniq(result.announce);
                    uniq(result.urlList);
                    return result;
                }
                function magnetURIEncode(obj) {
                    obj = extend(obj);
                    if (obj.infoHashBuffer) obj.xt = "urn:btih:" + obj.infoHashBuffer.toString("hex");
                    if (obj.infoHash) obj.xt = "urn:btih:" + obj.infoHash;
                    if (obj.name) obj.dn = obj.name;
                    if (obj.keywords) obj.kt = obj.keywords;
                    if (obj.announce) obj.tr = obj.announce;
                    if (obj.urlList) {
                        obj.ws = obj.urlList;
                        delete obj.as;
                    }
                    var result = "magnet:?";
                    Object.keys(obj).filter(function(key) {
                        return key.length === 2;
                    }).forEach(function(key, i) {
                        var values = Array.isArray(obj[key]) ? obj[key] : [ obj[key] ];
                        values.forEach(function(val, j) {
                            if ((i > 0 || j > 0) && (key !== "kt" || j === 0)) result += "&";
                            if (key === "dn") val = encodeURIComponent(val).replace(/%20/g, "+");
                            if (key === "tr" || key === "xs" || key === "as" || key === "ws") {
                                val = encodeURIComponent(val);
                            }
                            if (key === "kt") val = encodeURIComponent(val);
                            if (key === "kt" && j > 0) result += "+" + val; else result += key + "=" + val;
                        });
                    });
                    return result;
                }
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22,
            "thirty-two": 77,
            uniq: 140,
            xtend: 146
        } ],
        77: [ function(require, module, exports) {
            var base32 = require("./thirty-two");
            exports.encode = base32.encode;
            exports.decode = base32.decode;
        }, {
            "./thirty-two": 78
        } ],
        78: [ function(require, module, exports) {
            (function(Buffer) {
                var charTable = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
                var byteTable = [ 255, 255, 26, 27, 28, 29, 30, 31, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255 ];
                function quintetCount(buff) {
                    var quintets = Math.floor(buff.length / 5);
                    return buff.length % 5 == 0 ? quintets : quintets + 1;
                }
                exports.encode = function(plain) {
                    if (!Buffer.isBuffer(plain)) {
                        plain = new Buffer(plain);
                    }
                    var i = 0;
                    var j = 0;
                    var shiftIndex = 0;
                    var digit = 0;
                    var encoded = new Buffer(quintetCount(plain) * 8);
                    while (i < plain.length) {
                        var current = plain[i];
                        if (shiftIndex > 3) {
                            digit = current & 255 >> shiftIndex;
                            shiftIndex = (shiftIndex + 5) % 8;
                            digit = digit << shiftIndex | (i + 1 < plain.length ? plain[i + 1] : 0) >> 8 - shiftIndex;
                            i++;
                        } else {
                            digit = current >> 8 - (shiftIndex + 5) & 31;
                            shiftIndex = (shiftIndex + 5) % 8;
                            if (shiftIndex == 0) i++;
                        }
                        encoded[j] = charTable.charCodeAt(digit);
                        j++;
                    }
                    for (i = j; i < encoded.length; i++) encoded[i] = 61;
                    return encoded;
                };
                exports.decode = function(encoded) {
                    var shiftIndex = 0;
                    var plainDigit = 0;
                    var plainChar;
                    var plainPos = 0;
                    if (!Buffer.isBuffer(encoded)) {
                        encoded = new Buffer(encoded);
                    }
                    var decoded = new Buffer(Math.ceil(encoded.length * 5 / 8));
                    for (var i = 0; i < encoded.length; i++) {
                        if (encoded[i] == 61) {
                            break;
                        }
                        var encodedByte = encoded[i] - 48;
                        if (encodedByte < byteTable.length) {
                            plainDigit = byteTable[encodedByte];
                            if (shiftIndex <= 3) {
                                shiftIndex = (shiftIndex + 5) % 8;
                                if (shiftIndex == 0) {
                                    plainChar |= plainDigit;
                                    decoded[plainPos] = plainChar;
                                    plainPos++;
                                    plainChar = 0;
                                } else {
                                    plainChar |= 255 & plainDigit << 8 - shiftIndex;
                                }
                            } else {
                                shiftIndex = (shiftIndex + 5) % 8;
                                plainChar |= 255 & plainDigit >>> shiftIndex;
                                decoded[plainPos] = plainChar;
                                plainPos++;
                                plainChar = 255 & plainDigit << 8 - shiftIndex;
                            }
                        } else {
                            throw new Error("Invalid input - it is not base32 encoded string");
                        }
                    }
                    return decoded.slice(0, plainPos);
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        79: [ function(require, module, exports) {
            (function(Buffer) {
                module.exports = decodeTorrentFile;
                module.exports.decode = decodeTorrentFile;
                module.exports.encode = encodeTorrentFile;
                var bencode = require("bencode");
                var path = require("path");
                var sha1 = require("simple-sha1");
                var uniq = require("uniq");
                function decodeTorrentFile(torrent) {
                    if (Buffer.isBuffer(torrent)) {
                        torrent = bencode.decode(torrent);
                    }
                    ensure(torrent.info, "info");
                    ensure(torrent.info["name.utf-8"] || torrent.info.name, "info.name");
                    ensure(torrent.info["piece length"], "info['piece length']");
                    ensure(torrent.info.pieces, "info.pieces");
                    if (torrent.info.files) {
                        torrent.info.files.forEach(function(file) {
                            ensure(typeof file.length === "number", "info.files[0].length");
                            ensure(file["path.utf-8"] || file.path, "info.files[0].path");
                        });
                    } else {
                        ensure(typeof torrent.info.length === "number", "info.length");
                    }
                    var result = {};
                    result.info = torrent.info;
                    result.infoBuffer = bencode.encode(torrent.info);
                    result.infoHash = sha1.sync(result.infoBuffer);
                    result.infoHashBuffer = new Buffer(result.infoHash, "hex");
                    result.name = (torrent.info["name.utf-8"] || torrent.info.name).toString();
                    if (torrent.info.private !== undefined) result.private = !!torrent.info.private;
                    if (torrent["creation date"]) result.created = new Date(torrent["creation date"] * 1e3);
                    if (torrent["created by"]) result.createdBy = torrent["created by"].toString();
                    if (Buffer.isBuffer(torrent.comment)) result.comment = torrent.comment.toString();
                    result.announce = [];
                    if (torrent["announce-list"] && torrent["announce-list"].length) {
                        torrent["announce-list"].forEach(function(urls) {
                            urls.forEach(function(url) {
                                result.announce.push(url.toString());
                            });
                        });
                    } else if (torrent.announce) {
                        result.announce.push(torrent.announce.toString());
                    }
                    if (Buffer.isBuffer(torrent["url-list"])) {
                        torrent["url-list"] = torrent["url-list"].length > 0 ? [ torrent["url-list"] ] : [];
                    }
                    result.urlList = (torrent["url-list"] || []).map(function(url) {
                        return url.toString();
                    });
                    uniq(result.announce);
                    uniq(result.urlList);
                    var files = torrent.info.files || [ torrent.info ];
                    result.files = files.map(function(file, i) {
                        var parts = [].concat(result.name, file["path.utf-8"] || file.path || []).map(function(p) {
                            return p.toString();
                        });
                        return {
                            path: path.join.apply(null, [ path.sep ].concat(parts)).slice(1),
                            name: parts[parts.length - 1],
                            length: file.length,
                            offset: files.slice(0, i).reduce(sumLength, 0)
                        };
                    });
                    result.length = files.reduce(sumLength, 0);
                    var lastFile = result.files[result.files.length - 1];
                    result.pieceLength = torrent.info["piece length"];
                    result.lastPieceLength = (lastFile.offset + lastFile.length) % result.pieceLength || result.pieceLength;
                    result.pieces = splitPieces(torrent.info.pieces);
                    return result;
                }
                function encodeTorrentFile(parsed) {
                    var torrent = {
                        info: parsed.info
                    };
                    torrent["announce-list"] = (parsed.announce || []).map(function(url) {
                        if (!torrent.announce) torrent.announce = url;
                        url = new Buffer(url, "utf8");
                        return [ url ];
                    });
                    torrent["url-list"] = parsed.urlList || [];
                    if (parsed.created) {
                        torrent["creation date"] = parsed.created.getTime() / 1e3 | 0;
                    }
                    if (parsed.createdBy) {
                        torrent["created by"] = parsed.createdBy;
                    }
                    if (parsed.comment) {
                        torrent.comment = parsed.comment;
                    }
                    return bencode.encode(torrent);
                }
                function sumLength(sum, file) {
                    return sum + file.length;
                }
                function splitPieces(buf) {
                    var pieces = [];
                    for (var i = 0; i < buf.length; i += 20) {
                        pieces.push(buf.slice(i, i + 20).toString("hex"));
                    }
                    return pieces;
                }
                function ensure(bool, fieldName) {
                    if (!bool) throw new Error("Torrent is missing required field: " + fieldName);
                }
            }).call(this, require("buffer").Buffer);
        }, {
            bencode: 80,
            buffer: 22,
            path: 29,
            "simple-sha1": 128,
            uniq: 140
        } ],
        80: [ function(require, module, exports) {
            arguments[4][47][0].apply(exports, arguments);
        }, {
            "./lib/decode": 81,
            "./lib/encode": 83,
            dup: 47
        } ],
        81: [ function(require, module, exports) {
            arguments[4][48][0].apply(exports, arguments);
        }, {
            "./dict": 82,
            buffer: 22,
            dup: 48
        } ],
        82: [ function(require, module, exports) {
            arguments[4][49][0].apply(exports, arguments);
        }, {
            dup: 49
        } ],
        83: [ function(require, module, exports) {
            arguments[4][50][0].apply(exports, arguments);
        }, {
            buffer: 22,
            dup: 50
        } ],
        84: [ function(require, module, exports) {
            var once = require("once");
            var eos = require("end-of-stream");
            var fs = require("fs");
            var noop = function() {};
            var isFn = function(fn) {
                return typeof fn === "function";
            };
            var isFS = function(stream) {
                return (stream instanceof (fs.ReadStream || noop) || stream instanceof (fs.WriteStream || noop)) && isFn(stream.close);
            };
            var isRequest = function(stream) {
                return stream.setHeader && isFn(stream.abort);
            };
            var destroyer = function(stream, reading, writing, callback) {
                callback = once(callback);
                var closed = false;
                stream.on("close", function() {
                    closed = true;
                });
                eos(stream, {
                    readable: reading,
                    writable: writing
                }, function(err) {
                    if (err) return callback(err);
                    closed = true;
                    callback();
                });
                var destroyed = false;
                return function(err) {
                    if (closed) return;
                    if (destroyed) return;
                    destroyed = true;
                    if (isFS(stream)) return stream.close();
                    if (isRequest(stream)) return stream.abort();
                    if (isFn(stream.destroy)) return stream.destroy();
                    callback(err || new Error("stream was destroyed"));
                };
            };
            var call = function(fn) {
                fn();
            };
            var pipe = function(from, to) {
                return from.pipe(to);
            };
            var pump = function() {
                var streams = Array.prototype.slice.call(arguments);
                var callback = isFn(streams[streams.length - 1] || noop) && streams.pop() || noop;
                if (Array.isArray(streams[0])) streams = streams[0];
                if (streams.length < 2) throw new Error("pump requires two streams per minimum");
                var error;
                var destroys = streams.map(function(stream, i) {
                    var reading = i < streams.length - 1;
                    var writing = i > 0;
                    return destroyer(stream, reading, writing, function(err) {
                        if (!error) error = err;
                        if (err) destroys.forEach(call);
                        if (reading) return;
                        destroys.forEach(call);
                        callback(error);
                    });
                });
                return streams.reduce(pipe);
            };
            module.exports = pump;
        }, {
            "end-of-stream": 66,
            fs: 20,
            once: 86
        } ],
        85: [ function(require, module, exports) {
            arguments[4][17][0].apply(exports, arguments);
        }, {
            dup: 17
        } ],
        86: [ function(require, module, exports) {
            arguments[4][18][0].apply(exports, arguments);
        }, {
            dup: 18,
            wrappy: 85
        } ],
        87: [ function(require, module, exports) {
            var iterate = function(list) {
                var offset = 0;
                return function() {
                    if (offset === list.length) return null;
                    var len = list.length - offset;
                    var i = Math.random() * len | 0;
                    var el = list[offset + i];
                    var tmp = list[offset];
                    list[offset] = el;
                    list[offset + i] = tmp;
                    offset++;
                    return el;
                };
            };
            module.exports = iterate;
        }, {} ],
        88: [ function(require, module, exports) {
            "use strict";
            var objectKeys = Object.keys || function(obj) {
                var keys = [];
                for (var key in obj) {
                    keys.push(key);
                }
                return keys;
            };
            module.exports = Duplex;
            var processNextTick = require("process-nextick-args");
            var util = require("core-util-is");
            util.inherits = require("inherits");
            var Readable = require("./_stream_readable");
            var Writable = require("./_stream_writable");
            util.inherits(Duplex, Readable);
            var keys = objectKeys(Writable.prototype);
            for (var v = 0; v < keys.length; v++) {
                var method = keys[v];
                if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
            }
            function Duplex(options) {
                if (!(this instanceof Duplex)) return new Duplex(options);
                Readable.call(this, options);
                Writable.call(this, options);
                if (options && options.readable === false) this.readable = false;
                if (options && options.writable === false) this.writable = false;
                this.allowHalfOpen = true;
                if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;
                this.once("end", onend);
            }
            function onend() {
                if (this.allowHalfOpen || this._writableState.ended) return;
                processNextTick(onEndNT, this);
            }
            function onEndNT(self) {
                self.end();
            }
            function forEach(xs, f) {
                for (var i = 0, l = xs.length; i < l; i++) {
                    f(xs[i], i);
                }
            }
        }, {
            "./_stream_readable": 90,
            "./_stream_writable": 92,
            "core-util-is": 94,
            inherits: 71,
            "process-nextick-args": 96
        } ],
        89: [ function(require, module, exports) {
            "use strict";
            module.exports = PassThrough;
            var Transform = require("./_stream_transform");
            var util = require("core-util-is");
            util.inherits = require("inherits");
            util.inherits(PassThrough, Transform);
            function PassThrough(options) {
                if (!(this instanceof PassThrough)) return new PassThrough(options);
                Transform.call(this, options);
            }
            PassThrough.prototype._transform = function(chunk, encoding, cb) {
                cb(null, chunk);
            };
        }, {
            "./_stream_transform": 91,
            "core-util-is": 94,
            inherits: 71
        } ],
        90: [ function(require, module, exports) {
            (function(process) {
                "use strict";
                module.exports = Readable;
                var processNextTick = require("process-nextick-args");
                var isArray = require("isarray");
                Readable.ReadableState = ReadableState;
                var EE = require("events").EventEmitter;
                var EElistenerCount = function(emitter, type) {
                    return emitter.listeners(type).length;
                };
                var Stream;
                (function() {
                    try {
                        Stream = require("st" + "ream");
                    } catch (_) {} finally {
                        if (!Stream) Stream = require("events").EventEmitter;
                    }
                })();
                var Buffer = require("buffer").Buffer;
                var bufferShim = require("buffer-shims");
                var util = require("core-util-is");
                util.inherits = require("inherits");
                var debugUtil = require("util");
                var debug = void 0;
                if (debugUtil && debugUtil.debuglog) {
                    debug = debugUtil.debuglog("stream");
                } else {
                    debug = function() {};
                }
                var StringDecoder;
                util.inherits(Readable, Stream);
                var hasPrependListener = typeof EE.prototype.prependListener === "function";
                function prependListener(emitter, event, fn) {
                    if (hasPrependListener) return emitter.prependListener(event, fn);
                    if (!emitter._events || !emitter._events[event]) emitter.on(event, fn); else if (isArray(emitter._events[event])) emitter._events[event].unshift(fn); else emitter._events[event] = [ fn, emitter._events[event] ];
                }
                var Duplex;
                function ReadableState(options, stream) {
                    Duplex = Duplex || require("./_stream_duplex");
                    options = options || {};
                    this.objectMode = !!options.objectMode;
                    if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.readableObjectMode;
                    var hwm = options.highWaterMark;
                    var defaultHwm = this.objectMode ? 16 : 16 * 1024;
                    this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;
                    this.highWaterMark = ~~this.highWaterMark;
                    this.buffer = [];
                    this.length = 0;
                    this.pipes = null;
                    this.pipesCount = 0;
                    this.flowing = null;
                    this.ended = false;
                    this.endEmitted = false;
                    this.reading = false;
                    this.sync = true;
                    this.needReadable = false;
                    this.emittedReadable = false;
                    this.readableListening = false;
                    this.resumeScheduled = false;
                    this.defaultEncoding = options.defaultEncoding || "utf8";
                    this.ranOut = false;
                    this.awaitDrain = 0;
                    this.readingMore = false;
                    this.decoder = null;
                    this.encoding = null;
                    if (options.encoding) {
                        if (!StringDecoder) StringDecoder = require("string_decoder/").StringDecoder;
                        this.decoder = new StringDecoder(options.encoding);
                        this.encoding = options.encoding;
                    }
                }
                var Duplex;
                function Readable(options) {
                    Duplex = Duplex || require("./_stream_duplex");
                    if (!(this instanceof Readable)) return new Readable(options);
                    this._readableState = new ReadableState(options, this);
                    this.readable = true;
                    if (options && typeof options.read === "function") this._read = options.read;
                    Stream.call(this);
                }
                Readable.prototype.push = function(chunk, encoding) {
                    var state = this._readableState;
                    if (!state.objectMode && typeof chunk === "string") {
                        encoding = encoding || state.defaultEncoding;
                        if (encoding !== state.encoding) {
                            chunk = bufferShim.from(chunk, encoding);
                            encoding = "";
                        }
                    }
                    return readableAddChunk(this, state, chunk, encoding, false);
                };
                Readable.prototype.unshift = function(chunk) {
                    var state = this._readableState;
                    return readableAddChunk(this, state, chunk, "", true);
                };
                Readable.prototype.isPaused = function() {
                    return this._readableState.flowing === false;
                };
                function readableAddChunk(stream, state, chunk, encoding, addToFront) {
                    var er = chunkInvalid(state, chunk);
                    if (er) {
                        stream.emit("error", er);
                    } else if (chunk === null) {
                        state.reading = false;
                        onEofChunk(stream, state);
                    } else if (state.objectMode || chunk && chunk.length > 0) {
                        if (state.ended && !addToFront) {
                            var e = new Error("stream.push() after EOF");
                            stream.emit("error", e);
                        } else if (state.endEmitted && addToFront) {
                            var _e = new Error("stream.unshift() after end event");
                            stream.emit("error", _e);
                        } else {
                            var skipAdd;
                            if (state.decoder && !addToFront && !encoding) {
                                chunk = state.decoder.write(chunk);
                                skipAdd = !state.objectMode && chunk.length === 0;
                            }
                            if (!addToFront) state.reading = false;
                            if (!skipAdd) {
                                if (state.flowing && state.length === 0 && !state.sync) {
                                    stream.emit("data", chunk);
                                    stream.read(0);
                                } else {
                                    state.length += state.objectMode ? 1 : chunk.length;
                                    if (addToFront) state.buffer.unshift(chunk); else state.buffer.push(chunk);
                                    if (state.needReadable) emitReadable(stream);
                                }
                            }
                            maybeReadMore(stream, state);
                        }
                    } else if (!addToFront) {
                        state.reading = false;
                    }
                    return needMoreData(state);
                }
                function needMoreData(state) {
                    return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
                }
                Readable.prototype.setEncoding = function(enc) {
                    if (!StringDecoder) StringDecoder = require("string_decoder/").StringDecoder;
                    this._readableState.decoder = new StringDecoder(enc);
                    this._readableState.encoding = enc;
                    return this;
                };
                var MAX_HWM = 8388608;
                function computeNewHighWaterMark(n) {
                    if (n >= MAX_HWM) {
                        n = MAX_HWM;
                    } else {
                        n--;
                        n |= n >>> 1;
                        n |= n >>> 2;
                        n |= n >>> 4;
                        n |= n >>> 8;
                        n |= n >>> 16;
                        n++;
                    }
                    return n;
                }
                function howMuchToRead(n, state) {
                    if (state.length === 0 && state.ended) return 0;
                    if (state.objectMode) return n === 0 ? 0 : 1;
                    if (n === null || isNaN(n)) {
                        if (state.flowing && state.buffer.length) return state.buffer[0].length; else return state.length;
                    }
                    if (n <= 0) return 0;
                    if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
                    if (n > state.length) {
                        if (!state.ended) {
                            state.needReadable = true;
                            return 0;
                        } else {
                            return state.length;
                        }
                    }
                    return n;
                }
                Readable.prototype.read = function(n) {
                    debug("read", n);
                    var state = this._readableState;
                    var nOrig = n;
                    if (typeof n !== "number" || n > 0) state.emittedReadable = false;
                    if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
                        debug("read: emitReadable", state.length, state.ended);
                        if (state.length === 0 && state.ended) endReadable(this); else emitReadable(this);
                        return null;
                    }
                    n = howMuchToRead(n, state);
                    if (n === 0 && state.ended) {
                        if (state.length === 0) endReadable(this);
                        return null;
                    }
                    var doRead = state.needReadable;
                    debug("need readable", doRead);
                    if (state.length === 0 || state.length - n < state.highWaterMark) {
                        doRead = true;
                        debug("length less than watermark", doRead);
                    }
                    if (state.ended || state.reading) {
                        doRead = false;
                        debug("reading or ended", doRead);
                    }
                    if (doRead) {
                        debug("do read");
                        state.reading = true;
                        state.sync = true;
                        if (state.length === 0) state.needReadable = true;
                        this._read(state.highWaterMark);
                        state.sync = false;
                    }
                    if (doRead && !state.reading) n = howMuchToRead(nOrig, state);
                    var ret;
                    if (n > 0) ret = fromList(n, state); else ret = null;
                    if (ret === null) {
                        state.needReadable = true;
                        n = 0;
                    }
                    state.length -= n;
                    if (state.length === 0 && !state.ended) state.needReadable = true;
                    if (nOrig !== n && state.ended && state.length === 0) endReadable(this);
                    if (ret !== null) this.emit("data", ret);
                    return ret;
                };
                function chunkInvalid(state, chunk) {
                    var er = null;
                    if (!Buffer.isBuffer(chunk) && typeof chunk !== "string" && chunk !== null && chunk !== undefined && !state.objectMode) {
                        er = new TypeError("Invalid non-string/buffer chunk");
                    }
                    return er;
                }
                function onEofChunk(stream, state) {
                    if (state.ended) return;
                    if (state.decoder) {
                        var chunk = state.decoder.end();
                        if (chunk && chunk.length) {
                            state.buffer.push(chunk);
                            state.length += state.objectMode ? 1 : chunk.length;
                        }
                    }
                    state.ended = true;
                    emitReadable(stream);
                }
                function emitReadable(stream) {
                    var state = stream._readableState;
                    state.needReadable = false;
                    if (!state.emittedReadable) {
                        debug("emitReadable", state.flowing);
                        state.emittedReadable = true;
                        if (state.sync) processNextTick(emitReadable_, stream); else emitReadable_(stream);
                    }
                }
                function emitReadable_(stream) {
                    debug("emit readable");
                    stream.emit("readable");
                    flow(stream);
                }
                function maybeReadMore(stream, state) {
                    if (!state.readingMore) {
                        state.readingMore = true;
                        processNextTick(maybeReadMore_, stream, state);
                    }
                }
                function maybeReadMore_(stream, state) {
                    var len = state.length;
                    while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
                        debug("maybeReadMore read 0");
                        stream.read(0);
                        if (len === state.length) break; else len = state.length;
                    }
                    state.readingMore = false;
                }
                Readable.prototype._read = function(n) {
                    this.emit("error", new Error("not implemented"));
                };
                Readable.prototype.pipe = function(dest, pipeOpts) {
                    var src = this;
                    var state = this._readableState;
                    switch (state.pipesCount) {
                      case 0:
                        state.pipes = dest;
                        break;

                      case 1:
                        state.pipes = [ state.pipes, dest ];
                        break;

                      default:
                        state.pipes.push(dest);
                        break;
                    }
                    state.pipesCount += 1;
                    debug("pipe count=%d opts=%j", state.pipesCount, pipeOpts);
                    var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
                    var endFn = doEnd ? onend : cleanup;
                    if (state.endEmitted) processNextTick(endFn); else src.once("end", endFn);
                    dest.on("unpipe", onunpipe);
                    function onunpipe(readable) {
                        debug("onunpipe");
                        if (readable === src) {
                            cleanup();
                        }
                    }
                    function onend() {
                        debug("onend");
                        dest.end();
                    }
                    var ondrain = pipeOnDrain(src);
                    dest.on("drain", ondrain);
                    var cleanedUp = false;
                    function cleanup() {
                        debug("cleanup");
                        dest.removeListener("close", onclose);
                        dest.removeListener("finish", onfinish);
                        dest.removeListener("drain", ondrain);
                        dest.removeListener("error", onerror);
                        dest.removeListener("unpipe", onunpipe);
                        src.removeListener("end", onend);
                        src.removeListener("end", cleanup);
                        src.removeListener("data", ondata);
                        cleanedUp = true;
                        if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
                    }
                    src.on("data", ondata);
                    function ondata(chunk) {
                        debug("ondata");
                        var ret = dest.write(chunk);
                        if (false === ret) {
                            if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
                                debug("false write response, pause", src._readableState.awaitDrain);
                                src._readableState.awaitDrain++;
                            }
                            src.pause();
                        }
                    }
                    function onerror(er) {
                        debug("onerror", er);
                        unpipe();
                        dest.removeListener("error", onerror);
                        if (EElistenerCount(dest, "error") === 0) dest.emit("error", er);
                    }
                    prependListener(dest, "error", onerror);
                    function onclose() {
                        dest.removeListener("finish", onfinish);
                        unpipe();
                    }
                    dest.once("close", onclose);
                    function onfinish() {
                        debug("onfinish");
                        dest.removeListener("close", onclose);
                        unpipe();
                    }
                    dest.once("finish", onfinish);
                    function unpipe() {
                        debug("unpipe");
                        src.unpipe(dest);
                    }
                    dest.emit("pipe", src);
                    if (!state.flowing) {
                        debug("pipe resume");
                        src.resume();
                    }
                    return dest;
                };
                function pipeOnDrain(src) {
                    return function() {
                        var state = src._readableState;
                        debug("pipeOnDrain", state.awaitDrain);
                        if (state.awaitDrain) state.awaitDrain--;
                        if (state.awaitDrain === 0 && EElistenerCount(src, "data")) {
                            state.flowing = true;
                            flow(src);
                        }
                    };
                }
                Readable.prototype.unpipe = function(dest) {
                    var state = this._readableState;
                    if (state.pipesCount === 0) return this;
                    if (state.pipesCount === 1) {
                        if (dest && dest !== state.pipes) return this;
                        if (!dest) dest = state.pipes;
                        state.pipes = null;
                        state.pipesCount = 0;
                        state.flowing = false;
                        if (dest) dest.emit("unpipe", this);
                        return this;
                    }
                    if (!dest) {
                        var dests = state.pipes;
                        var len = state.pipesCount;
                        state.pipes = null;
                        state.pipesCount = 0;
                        state.flowing = false;
                        for (var _i = 0; _i < len; _i++) {
                            dests[_i].emit("unpipe", this);
                        }
                        return this;
                    }
                    var i = indexOf(state.pipes, dest);
                    if (i === -1) return this;
                    state.pipes.splice(i, 1);
                    state.pipesCount -= 1;
                    if (state.pipesCount === 1) state.pipes = state.pipes[0];
                    dest.emit("unpipe", this);
                    return this;
                };
                Readable.prototype.on = function(ev, fn) {
                    var res = Stream.prototype.on.call(this, ev, fn);
                    if (ev === "data" && false !== this._readableState.flowing) {
                        this.resume();
                    }
                    if (ev === "readable" && !this._readableState.endEmitted) {
                        var state = this._readableState;
                        if (!state.readableListening) {
                            state.readableListening = true;
                            state.emittedReadable = false;
                            state.needReadable = true;
                            if (!state.reading) {
                                processNextTick(nReadingNextTick, this);
                            } else if (state.length) {
                                emitReadable(this, state);
                            }
                        }
                    }
                    return res;
                };
                Readable.prototype.addListener = Readable.prototype.on;
                function nReadingNextTick(self) {
                    debug("readable nexttick read 0");
                    self.read(0);
                }
                Readable.prototype.resume = function() {
                    var state = this._readableState;
                    if (!state.flowing) {
                        debug("resume");
                        state.flowing = true;
                        resume(this, state);
                    }
                    return this;
                };
                function resume(stream, state) {
                    if (!state.resumeScheduled) {
                        state.resumeScheduled = true;
                        processNextTick(resume_, stream, state);
                    }
                }
                function resume_(stream, state) {
                    if (!state.reading) {
                        debug("resume read 0");
                        stream.read(0);
                    }
                    state.resumeScheduled = false;
                    stream.emit("resume");
                    flow(stream);
                    if (state.flowing && !state.reading) stream.read(0);
                }
                Readable.prototype.pause = function() {
                    debug("call pause flowing=%j", this._readableState.flowing);
                    if (false !== this._readableState.flowing) {
                        debug("pause");
                        this._readableState.flowing = false;
                        this.emit("pause");
                    }
                    return this;
                };
                function flow(stream) {
                    var state = stream._readableState;
                    debug("flow", state.flowing);
                    if (state.flowing) {
                        do {
                            var chunk = stream.read();
                        } while (null !== chunk && state.flowing);
                    }
                }
                Readable.prototype.wrap = function(stream) {
                    var state = this._readableState;
                    var paused = false;
                    var self = this;
                    stream.on("end", function() {
                        debug("wrapped end");
                        if (state.decoder && !state.ended) {
                            var chunk = state.decoder.end();
                            if (chunk && chunk.length) self.push(chunk);
                        }
                        self.push(null);
                    });
                    stream.on("data", function(chunk) {
                        debug("wrapped data");
                        if (state.decoder) chunk = state.decoder.write(chunk);
                        if (state.objectMode && (chunk === null || chunk === undefined)) return; else if (!state.objectMode && (!chunk || !chunk.length)) return;
                        var ret = self.push(chunk);
                        if (!ret) {
                            paused = true;
                            stream.pause();
                        }
                    });
                    for (var i in stream) {
                        if (this[i] === undefined && typeof stream[i] === "function") {
                            this[i] = function(method) {
                                return function() {
                                    return stream[method].apply(stream, arguments);
                                };
                            }(i);
                        }
                    }
                    var events = [ "error", "close", "destroy", "pause", "resume" ];
                    forEach(events, function(ev) {
                        stream.on(ev, self.emit.bind(self, ev));
                    });
                    self._read = function(n) {
                        debug("wrapped _read", n);
                        if (paused) {
                            paused = false;
                            stream.resume();
                        }
                    };
                    return self;
                };
                Readable._fromList = fromList;
                function fromList(n, state) {
                    var list = state.buffer;
                    var length = state.length;
                    var stringMode = !!state.decoder;
                    var objectMode = !!state.objectMode;
                    var ret;
                    if (list.length === 0) return null;
                    if (length === 0) ret = null; else if (objectMode) ret = list.shift(); else if (!n || n >= length) {
                        if (stringMode) ret = list.join(""); else if (list.length === 1) ret = list[0]; else ret = Buffer.concat(list, length);
                        list.length = 0;
                    } else {
                        if (n < list[0].length) {
                            var buf = list[0];
                            ret = buf.slice(0, n);
                            list[0] = buf.slice(n);
                        } else if (n === list[0].length) {
                            ret = list.shift();
                        } else {
                            if (stringMode) ret = ""; else ret = bufferShim.allocUnsafe(n);
                            var c = 0;
                            for (var i = 0, l = list.length; i < l && c < n; i++) {
                                var _buf = list[0];
                                var cpy = Math.min(n - c, _buf.length);
                                if (stringMode) ret += _buf.slice(0, cpy); else _buf.copy(ret, c, 0, cpy);
                                if (cpy < _buf.length) list[0] = _buf.slice(cpy); else list.shift();
                                c += cpy;
                            }
                        }
                    }
                    return ret;
                }
                function endReadable(stream) {
                    var state = stream._readableState;
                    if (state.length > 0) throw new Error('"endReadable()" called on non-empty stream');
                    if (!state.endEmitted) {
                        state.ended = true;
                        processNextTick(endReadableNT, state, stream);
                    }
                }
                function endReadableNT(state, stream) {
                    if (!state.endEmitted && state.length === 0) {
                        state.endEmitted = true;
                        stream.readable = false;
                        stream.emit("end");
                    }
                }
                function forEach(xs, f) {
                    for (var i = 0, l = xs.length; i < l; i++) {
                        f(xs[i], i);
                    }
                }
                function indexOf(xs, x) {
                    for (var i = 0, l = xs.length; i < l; i++) {
                        if (xs[i] === x) return i;
                    }
                    return -1;
                }
            }).call(this, require("_process"));
        }, {
            "./_stream_duplex": 88,
            _process: 30,
            buffer: 22,
            "buffer-shims": 93,
            "core-util-is": 94,
            events: 26,
            inherits: 71,
            isarray: 95,
            "process-nextick-args": 96,
            "string_decoder/": 97,
            util: 21
        } ],
        91: [ function(require, module, exports) {
            "use strict";
            module.exports = Transform;
            var Duplex = require("./_stream_duplex");
            var util = require("core-util-is");
            util.inherits = require("inherits");
            util.inherits(Transform, Duplex);
            function TransformState(stream) {
                this.afterTransform = function(er, data) {
                    return afterTransform(stream, er, data);
                };
                this.needTransform = false;
                this.transforming = false;
                this.writecb = null;
                this.writechunk = null;
                this.writeencoding = null;
            }
            function afterTransform(stream, er, data) {
                var ts = stream._transformState;
                ts.transforming = false;
                var cb = ts.writecb;
                if (!cb) return stream.emit("error", new Error("no writecb in Transform class"));
                ts.writechunk = null;
                ts.writecb = null;
                if (data !== null && data !== undefined) stream.push(data);
                cb(er);
                var rs = stream._readableState;
                rs.reading = false;
                if (rs.needReadable || rs.length < rs.highWaterMark) {
                    stream._read(rs.highWaterMark);
                }
            }
            function Transform(options) {
                if (!(this instanceof Transform)) return new Transform(options);
                Duplex.call(this, options);
                this._transformState = new TransformState(this);
                var stream = this;
                this._readableState.needReadable = true;
                this._readableState.sync = false;
                if (options) {
                    if (typeof options.transform === "function") this._transform = options.transform;
                    if (typeof options.flush === "function") this._flush = options.flush;
                }
                this.once("prefinish", function() {
                    if (typeof this._flush === "function") this._flush(function(er) {
                        done(stream, er);
                    }); else done(stream);
                });
            }
            Transform.prototype.push = function(chunk, encoding) {
                this._transformState.needTransform = false;
                return Duplex.prototype.push.call(this, chunk, encoding);
            };
            Transform.prototype._transform = function(chunk, encoding, cb) {
                throw new Error("Not implemented");
            };
            Transform.prototype._write = function(chunk, encoding, cb) {
                var ts = this._transformState;
                ts.writecb = cb;
                ts.writechunk = chunk;
                ts.writeencoding = encoding;
                if (!ts.transforming) {
                    var rs = this._readableState;
                    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
                }
            };
            Transform.prototype._read = function(n) {
                var ts = this._transformState;
                if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
                    ts.transforming = true;
                    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
                } else {
                    ts.needTransform = true;
                }
            };
            function done(stream, er) {
                if (er) return stream.emit("error", er);
                var ws = stream._writableState;
                var ts = stream._transformState;
                if (ws.length) throw new Error("Calling transform done when ws.length != 0");
                if (ts.transforming) throw new Error("Calling transform done when still transforming");
                return stream.push(null);
            }
        }, {
            "./_stream_duplex": 88,
            "core-util-is": 94,
            inherits: 71
        } ],
        92: [ function(require, module, exports) {
            (function(process) {
                "use strict";
                module.exports = Writable;
                var processNextTick = require("process-nextick-args");
                var asyncWrite = !process.browser && [ "v0.10", "v0.9." ].indexOf(process.version.slice(0, 5)) > -1 ? setImmediate : processNextTick;
                Writable.WritableState = WritableState;
                var util = require("core-util-is");
                util.inherits = require("inherits");
                var internalUtil = {
                    deprecate: require("util-deprecate")
                };
                var Stream;
                (function() {
                    try {
                        Stream = require("st" + "ream");
                    } catch (_) {} finally {
                        if (!Stream) Stream = require("events").EventEmitter;
                    }
                })();
                var Buffer = require("buffer").Buffer;
                var bufferShim = require("buffer-shims");
                util.inherits(Writable, Stream);
                function nop() {}
                function WriteReq(chunk, encoding, cb) {
                    this.chunk = chunk;
                    this.encoding = encoding;
                    this.callback = cb;
                    this.next = null;
                }
                var Duplex;
                function WritableState(options, stream) {
                    Duplex = Duplex || require("./_stream_duplex");
                    options = options || {};
                    this.objectMode = !!options.objectMode;
                    if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.writableObjectMode;
                    var hwm = options.highWaterMark;
                    var defaultHwm = this.objectMode ? 16 : 16 * 1024;
                    this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;
                    this.highWaterMark = ~~this.highWaterMark;
                    this.needDrain = false;
                    this.ending = false;
                    this.ended = false;
                    this.finished = false;
                    var noDecode = options.decodeStrings === false;
                    this.decodeStrings = !noDecode;
                    this.defaultEncoding = options.defaultEncoding || "utf8";
                    this.length = 0;
                    this.writing = false;
                    this.corked = 0;
                    this.sync = true;
                    this.bufferProcessing = false;
                    this.onwrite = function(er) {
                        onwrite(stream, er);
                    };
                    this.writecb = null;
                    this.writelen = 0;
                    this.bufferedRequest = null;
                    this.lastBufferedRequest = null;
                    this.pendingcb = 0;
                    this.prefinished = false;
                    this.errorEmitted = false;
                    this.bufferedRequestCount = 0;
                    this.corkedRequestsFree = new CorkedRequest(this);
                }
                WritableState.prototype.getBuffer = function writableStateGetBuffer() {
                    var current = this.bufferedRequest;
                    var out = [];
                    while (current) {
                        out.push(current);
                        current = current.next;
                    }
                    return out;
                };
                (function() {
                    try {
                        Object.defineProperty(WritableState.prototype, "buffer", {
                            get: internalUtil.deprecate(function() {
                                return this.getBuffer();
                            }, "_writableState.buffer is deprecated. Use _writableState.getBuffer " + "instead.")
                        });
                    } catch (_) {}
                })();
                var Duplex;
                function Writable(options) {
                    Duplex = Duplex || require("./_stream_duplex");
                    if (!(this instanceof Writable) && !(this instanceof Duplex)) return new Writable(options);
                    this._writableState = new WritableState(options, this);
                    this.writable = true;
                    if (options) {
                        if (typeof options.write === "function") this._write = options.write;
                        if (typeof options.writev === "function") this._writev = options.writev;
                    }
                    Stream.call(this);
                }
                Writable.prototype.pipe = function() {
                    this.emit("error", new Error("Cannot pipe, not readable"));
                };
                function writeAfterEnd(stream, cb) {
                    var er = new Error("write after end");
                    stream.emit("error", er);
                    processNextTick(cb, er);
                }
                function validChunk(stream, state, chunk, cb) {
                    var valid = true;
                    var er = false;
                    if (chunk === null) {
                        er = new TypeError("May not write null values to stream");
                    } else if (!Buffer.isBuffer(chunk) && typeof chunk !== "string" && chunk !== undefined && !state.objectMode) {
                        er = new TypeError("Invalid non-string/buffer chunk");
                    }
                    if (er) {
                        stream.emit("error", er);
                        processNextTick(cb, er);
                        valid = false;
                    }
                    return valid;
                }
                Writable.prototype.write = function(chunk, encoding, cb) {
                    var state = this._writableState;
                    var ret = false;
                    if (typeof encoding === "function") {
                        cb = encoding;
                        encoding = null;
                    }
                    if (Buffer.isBuffer(chunk)) encoding = "buffer"; else if (!encoding) encoding = state.defaultEncoding;
                    if (typeof cb !== "function") cb = nop;
                    if (state.ended) writeAfterEnd(this, cb); else if (validChunk(this, state, chunk, cb)) {
                        state.pendingcb++;
                        ret = writeOrBuffer(this, state, chunk, encoding, cb);
                    }
                    return ret;
                };
                Writable.prototype.cork = function() {
                    var state = this._writableState;
                    state.corked++;
                };
                Writable.prototype.uncork = function() {
                    var state = this._writableState;
                    if (state.corked) {
                        state.corked--;
                        if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
                    }
                };
                Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
                    if (typeof encoding === "string") encoding = encoding.toLowerCase();
                    if (!([ "hex", "utf8", "utf-8", "ascii", "binary", "base64", "ucs2", "ucs-2", "utf16le", "utf-16le", "raw" ].indexOf((encoding + "").toLowerCase()) > -1)) throw new TypeError("Unknown encoding: " + encoding);
                    this._writableState.defaultEncoding = encoding;
                    return this;
                };
                function decodeChunk(state, chunk, encoding) {
                    if (!state.objectMode && state.decodeStrings !== false && typeof chunk === "string") {
                        chunk = bufferShim.from(chunk, encoding);
                    }
                    return chunk;
                }
                function writeOrBuffer(stream, state, chunk, encoding, cb) {
                    chunk = decodeChunk(state, chunk, encoding);
                    if (Buffer.isBuffer(chunk)) encoding = "buffer";
                    var len = state.objectMode ? 1 : chunk.length;
                    state.length += len;
                    var ret = state.length < state.highWaterMark;
                    if (!ret) state.needDrain = true;
                    if (state.writing || state.corked) {
                        var last = state.lastBufferedRequest;
                        state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
                        if (last) {
                            last.next = state.lastBufferedRequest;
                        } else {
                            state.bufferedRequest = state.lastBufferedRequest;
                        }
                        state.bufferedRequestCount += 1;
                    } else {
                        doWrite(stream, state, false, len, chunk, encoding, cb);
                    }
                    return ret;
                }
                function doWrite(stream, state, writev, len, chunk, encoding, cb) {
                    state.writelen = len;
                    state.writecb = cb;
                    state.writing = true;
                    state.sync = true;
                    if (writev) stream._writev(chunk, state.onwrite); else stream._write(chunk, encoding, state.onwrite);
                    state.sync = false;
                }
                function onwriteError(stream, state, sync, er, cb) {
                    --state.pendingcb;
                    if (sync) processNextTick(cb, er); else cb(er);
                    stream._writableState.errorEmitted = true;
                    stream.emit("error", er);
                }
                function onwriteStateUpdate(state) {
                    state.writing = false;
                    state.writecb = null;
                    state.length -= state.writelen;
                    state.writelen = 0;
                }
                function onwrite(stream, er) {
                    var state = stream._writableState;
                    var sync = state.sync;
                    var cb = state.writecb;
                    onwriteStateUpdate(state);
                    if (er) onwriteError(stream, state, sync, er, cb); else {
                        var finished = needFinish(state);
                        if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
                            clearBuffer(stream, state);
                        }
                        if (sync) {
                            asyncWrite(afterWrite, stream, state, finished, cb);
                        } else {
                            afterWrite(stream, state, finished, cb);
                        }
                    }
                }
                function afterWrite(stream, state, finished, cb) {
                    if (!finished) onwriteDrain(stream, state);
                    state.pendingcb--;
                    cb();
                    finishMaybe(stream, state);
                }
                function onwriteDrain(stream, state) {
                    if (state.length === 0 && state.needDrain) {
                        state.needDrain = false;
                        stream.emit("drain");
                    }
                }
                function clearBuffer(stream, state) {
                    state.bufferProcessing = true;
                    var entry = state.bufferedRequest;
                    if (stream._writev && entry && entry.next) {
                        var l = state.bufferedRequestCount;
                        var buffer = new Array(l);
                        var holder = state.corkedRequestsFree;
                        holder.entry = entry;
                        var count = 0;
                        while (entry) {
                            buffer[count] = entry;
                            entry = entry.next;
                            count += 1;
                        }
                        doWrite(stream, state, true, state.length, buffer, "", holder.finish);
                        state.pendingcb++;
                        state.lastBufferedRequest = null;
                        if (holder.next) {
                            state.corkedRequestsFree = holder.next;
                            holder.next = null;
                        } else {
                            state.corkedRequestsFree = new CorkedRequest(state);
                        }
                    } else {
                        while (entry) {
                            var chunk = entry.chunk;
                            var encoding = entry.encoding;
                            var cb = entry.callback;
                            var len = state.objectMode ? 1 : chunk.length;
                            doWrite(stream, state, false, len, chunk, encoding, cb);
                            entry = entry.next;
                            if (state.writing) {
                                break;
                            }
                        }
                        if (entry === null) state.lastBufferedRequest = null;
                    }
                    state.bufferedRequestCount = 0;
                    state.bufferedRequest = entry;
                    state.bufferProcessing = false;
                }
                Writable.prototype._write = function(chunk, encoding, cb) {
                    cb(new Error("not implemented"));
                };
                Writable.prototype._writev = null;
                Writable.prototype.end = function(chunk, encoding, cb) {
                    var state = this._writableState;
                    if (typeof chunk === "function") {
                        cb = chunk;
                        chunk = null;
                        encoding = null;
                    } else if (typeof encoding === "function") {
                        cb = encoding;
                        encoding = null;
                    }
                    if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);
                    if (state.corked) {
                        state.corked = 1;
                        this.uncork();
                    }
                    if (!state.ending && !state.finished) endWritable(this, state, cb);
                };
                function needFinish(state) {
                    return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
                }
                function prefinish(stream, state) {
                    if (!state.prefinished) {
                        state.prefinished = true;
                        stream.emit("prefinish");
                    }
                }
                function finishMaybe(stream, state) {
                    var need = needFinish(state);
                    if (need) {
                        if (state.pendingcb === 0) {
                            prefinish(stream, state);
                            state.finished = true;
                            stream.emit("finish");
                        } else {
                            prefinish(stream, state);
                        }
                    }
                    return need;
                }
                function endWritable(stream, state, cb) {
                    state.ending = true;
                    finishMaybe(stream, state);
                    if (cb) {
                        if (state.finished) processNextTick(cb); else stream.once("finish", cb);
                    }
                    state.ended = true;
                    stream.writable = false;
                }
                function CorkedRequest(state) {
                    var _this = this;
                    this.next = null;
                    this.entry = null;
                    this.finish = function(err) {
                        var entry = _this.entry;
                        _this.entry = null;
                        while (entry) {
                            var cb = entry.callback;
                            state.pendingcb--;
                            cb(err);
                            entry = entry.next;
                        }
                        if (state.corkedRequestsFree) {
                            state.corkedRequestsFree.next = _this;
                        } else {
                            state.corkedRequestsFree = _this;
                        }
                    };
                }
            }).call(this, require("_process"));
        }, {
            "./_stream_duplex": 88,
            _process: 30,
            buffer: 22,
            "buffer-shims": 93,
            "core-util-is": 94,
            events: 26,
            inherits: 71,
            "process-nextick-args": 96,
            "util-deprecate": 98
        } ],
        93: [ function(require, module, exports) {
            (function(global) {
                "use strict";
                var buffer = require("buffer");
                var Buffer = buffer.Buffer;
                var SlowBuffer = buffer.SlowBuffer;
                var MAX_LEN = buffer.kMaxLength || 2147483647;
                exports.alloc = function alloc(size, fill, encoding) {
                    if (typeof Buffer.alloc === "function") {
                        return Buffer.alloc(size, fill, encoding);
                    }
                    if (typeof encoding === "number") {
                        throw new TypeError("encoding must not be number");
                    }
                    if (typeof size !== "number") {
                        throw new TypeError("size must be a number");
                    }
                    if (size > MAX_LEN) {
                        throw new RangeError("size is too large");
                    }
                    var enc = encoding;
                    var _fill = fill;
                    if (_fill === undefined) {
                        enc = undefined;
                        _fill = 0;
                    }
                    var buf = new Buffer(size);
                    if (typeof _fill === "string") {
                        var fillBuf = new Buffer(_fill, enc);
                        var flen = fillBuf.length;
                        var i = -1;
                        while (++i < size) {
                            buf[i] = fillBuf[i % flen];
                        }
                    } else {
                        buf.fill(_fill);
                    }
                    return buf;
                };
                exports.allocUnsafe = function allocUnsafe(size) {
                    if (typeof Buffer.allocUnsafe === "function") {
                        return Buffer.allocUnsafe(size);
                    }
                    if (typeof size !== "number") {
                        throw new TypeError("size must be a number");
                    }
                    if (size > MAX_LEN) {
                        throw new RangeError("size is too large");
                    }
                    return new Buffer(size);
                };
                exports.from = function from(value, encodingOrOffset, length) {
                    if (typeof Buffer.from === "function" && (!global.Uint8Array || Uint8Array.from !== Buffer.from)) {
                        return Buffer.from(value, encodingOrOffset, length);
                    }
                    if (typeof value === "number") {
                        throw new TypeError('"value" argument must not be a number');
                    }
                    if (typeof value === "string") {
                        return new Buffer(value, encodingOrOffset);
                    }
                    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
                        var offset = encodingOrOffset;
                        if (arguments.length === 1) {
                            return new Buffer(value);
                        }
                        if (typeof offset === "undefined") {
                            offset = 0;
                        }
                        var len = length;
                        if (typeof len === "undefined") {
                            len = value.byteLength - offset;
                        }
                        if (offset >= value.byteLength) {
                            throw new RangeError("'offset' is out of bounds");
                        }
                        if (len > value.byteLength - offset) {
                            throw new RangeError("'length' is out of bounds");
                        }
                        return new Buffer(value.slice(offset, offset + len));
                    }
                    if (Buffer.isBuffer(value)) {
                        var out = new Buffer(value.length);
                        value.copy(out, 0, 0, value.length);
                        return out;
                    }
                    if (value) {
                        if (Array.isArray(value) || typeof ArrayBuffer !== "undefined" && value.buffer instanceof ArrayBuffer || "length" in value) {
                            return new Buffer(value);
                        }
                        if (value.type === "Buffer" && Array.isArray(value.data)) {
                            return new Buffer(value.data);
                        }
                    }
                    throw new TypeError("First argument must be a string, Buffer, " + "ArrayBuffer, Array, or array-like object.");
                };
                exports.allocUnsafeSlow = function allocUnsafeSlow(size) {
                    if (typeof Buffer.allocUnsafeSlow === "function") {
                        return Buffer.allocUnsafeSlow(size);
                    }
                    if (typeof size !== "number") {
                        throw new TypeError("size must be a number");
                    }
                    if (size >= MAX_LEN) {
                        throw new RangeError("size is too large");
                    }
                    return new SlowBuffer(size);
                };
            }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {
            buffer: 22
        } ],
        94: [ function(require, module, exports) {
            (function(Buffer) {
                function isArray(arg) {
                    if (Array.isArray) {
                        return Array.isArray(arg);
                    }
                    return objectToString(arg) === "[object Array]";
                }
                exports.isArray = isArray;
                function isBoolean(arg) {
                    return typeof arg === "boolean";
                }
                exports.isBoolean = isBoolean;
                function isNull(arg) {
                    return arg === null;
                }
                exports.isNull = isNull;
                function isNullOrUndefined(arg) {
                    return arg == null;
                }
                exports.isNullOrUndefined = isNullOrUndefined;
                function isNumber(arg) {
                    return typeof arg === "number";
                }
                exports.isNumber = isNumber;
                function isString(arg) {
                    return typeof arg === "string";
                }
                exports.isString = isString;
                function isSymbol(arg) {
                    return typeof arg === "symbol";
                }
                exports.isSymbol = isSymbol;
                function isUndefined(arg) {
                    return arg === void 0;
                }
                exports.isUndefined = isUndefined;
                function isRegExp(re) {
                    return objectToString(re) === "[object RegExp]";
                }
                exports.isRegExp = isRegExp;
                function isObject(arg) {
                    return typeof arg === "object" && arg !== null;
                }
                exports.isObject = isObject;
                function isDate(d) {
                    return objectToString(d) === "[object Date]";
                }
                exports.isDate = isDate;
                function isError(e) {
                    return objectToString(e) === "[object Error]" || e instanceof Error;
                }
                exports.isError = isError;
                function isFunction(arg) {
                    return typeof arg === "function";
                }
                exports.isFunction = isFunction;
                function isPrimitive(arg) {
                    return arg === null || typeof arg === "boolean" || typeof arg === "number" || typeof arg === "string" || typeof arg === "symbol" || typeof arg === "undefined";
                }
                exports.isPrimitive = isPrimitive;
                exports.isBuffer = Buffer.isBuffer;
                function objectToString(o) {
                    return Object.prototype.toString.call(o);
                }
            }).call(this, {
                isBuffer: require("../../../../browserify/node_modules/insert-module-globals/node_modules/is-buffer/index.js")
            });
        }, {
            "../../../../browserify/node_modules/insert-module-globals/node_modules/is-buffer/index.js": 28
        } ],
        95: [ function(require, module, exports) {
            arguments[4][25][0].apply(exports, arguments);
        }, {
            dup: 25
        } ],
        96: [ function(require, module, exports) {
            (function(process) {
                "use strict";
                if (!process.version || process.version.indexOf("v0.") === 0 || process.version.indexOf("v1.") === 0 && process.version.indexOf("v1.8.") !== 0) {
                    module.exports = nextTick;
                } else {
                    module.exports = process.nextTick;
                }
                function nextTick(fn, arg1, arg2, arg3) {
                    if (typeof fn !== "function") {
                        throw new TypeError('"callback" argument must be a function');
                    }
                    var len = arguments.length;
                    var args, i;
                    switch (len) {
                      case 0:
                      case 1:
                        return process.nextTick(fn);

                      case 2:
                        return process.nextTick(function afterTickOne() {
                            fn.call(null, arg1);
                        });

                      case 3:
                        return process.nextTick(function afterTickTwo() {
                            fn.call(null, arg1, arg2);
                        });

                      case 4:
                        return process.nextTick(function afterTickThree() {
                            fn.call(null, arg1, arg2, arg3);
                        });

                      default:
                        args = new Array(len - 1);
                        i = 0;
                        while (i < args.length) {
                            args[i++] = arguments[i];
                        }
                        return process.nextTick(function afterTick() {
                            fn.apply(null, args);
                        });
                    }
                }
            }).call(this, require("_process"));
        }, {
            _process: 30
        } ],
        97: [ function(require, module, exports) {
            var Buffer = require("buffer").Buffer;
            var isBufferEncoding = Buffer.isEncoding || function(encoding) {
                switch (encoding && encoding.toLowerCase()) {
                  case "hex":
                  case "utf8":
                  case "utf-8":
                  case "ascii":
                  case "binary":
                  case "base64":
                  case "ucs2":
                  case "ucs-2":
                  case "utf16le":
                  case "utf-16le":
                  case "raw":
                    return true;

                  default:
                    return false;
                }
            };
            function assertEncoding(encoding) {
                if (encoding && !isBufferEncoding(encoding)) {
                    throw new Error("Unknown encoding: " + encoding);
                }
            }
            var StringDecoder = exports.StringDecoder = function(encoding) {
                this.encoding = (encoding || "utf8").toLowerCase().replace(/[-_]/, "");
                assertEncoding(encoding);
                switch (this.encoding) {
                  case "utf8":
                    this.surrogateSize = 3;
                    break;

                  case "ucs2":
                  case "utf16le":
                    this.surrogateSize = 2;
                    this.detectIncompleteChar = utf16DetectIncompleteChar;
                    break;

                  case "base64":
                    this.surrogateSize = 3;
                    this.detectIncompleteChar = base64DetectIncompleteChar;
                    break;

                  default:
                    this.write = passThroughWrite;
                    return;
                }
                this.charBuffer = new Buffer(6);
                this.charReceived = 0;
                this.charLength = 0;
            };
            StringDecoder.prototype.write = function(buffer) {
                var charStr = "";
                while (this.charLength) {
                    var available = buffer.length >= this.charLength - this.charReceived ? this.charLength - this.charReceived : buffer.length;
                    buffer.copy(this.charBuffer, this.charReceived, 0, available);
                    this.charReceived += available;
                    if (this.charReceived < this.charLength) {
                        return "";
                    }
                    buffer = buffer.slice(available, buffer.length);
                    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);
                    var charCode = charStr.charCodeAt(charStr.length - 1);
                    if (charCode >= 55296 && charCode <= 56319) {
                        this.charLength += this.surrogateSize;
                        charStr = "";
                        continue;
                    }
                    this.charReceived = this.charLength = 0;
                    if (buffer.length === 0) {
                        return charStr;
                    }
                    break;
                }
                this.detectIncompleteChar(buffer);
                var end = buffer.length;
                if (this.charLength) {
                    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
                    end -= this.charReceived;
                }
                charStr += buffer.toString(this.encoding, 0, end);
                var end = charStr.length - 1;
                var charCode = charStr.charCodeAt(end);
                if (charCode >= 55296 && charCode <= 56319) {
                    var size = this.surrogateSize;
                    this.charLength += size;
                    this.charReceived += size;
                    this.charBuffer.copy(this.charBuffer, size, 0, size);
                    buffer.copy(this.charBuffer, 0, 0, size);
                    return charStr.substring(0, end);
                }
                return charStr;
            };
            StringDecoder.prototype.detectIncompleteChar = function(buffer) {
                var i = buffer.length >= 3 ? 3 : buffer.length;
                for (;i > 0; i--) {
                    var c = buffer[buffer.length - i];
                    if (i == 1 && c >> 5 == 6) {
                        this.charLength = 2;
                        break;
                    }
                    if (i <= 2 && c >> 4 == 14) {
                        this.charLength = 3;
                        break;
                    }
                    if (i <= 3 && c >> 3 == 30) {
                        this.charLength = 4;
                        break;
                    }
                }
                this.charReceived = i;
            };
            StringDecoder.prototype.end = function(buffer) {
                var res = "";
                if (buffer && buffer.length) res = this.write(buffer);
                if (this.charReceived) {
                    var cr = this.charReceived;
                    var buf = this.charBuffer;
                    var enc = this.encoding;
                    res += buf.slice(0, cr).toString(enc);
                }
                return res;
            };
            function passThroughWrite(buffer) {
                return buffer.toString(this.encoding);
            }
            function utf16DetectIncompleteChar(buffer) {
                this.charReceived = buffer.length % 2;
                this.charLength = this.charReceived ? 2 : 0;
            }
            function base64DetectIncompleteChar(buffer) {
                this.charReceived = buffer.length % 3;
                this.charLength = this.charReceived ? 3 : 0;
            }
        }, {
            buffer: 22
        } ],
        98: [ function(require, module, exports) {
            (function(global) {
                module.exports = deprecate;
                function deprecate(fn, msg) {
                    if (config("noDeprecation")) {
                        return fn;
                    }
                    var warned = false;
                    function deprecated() {
                        if (!warned) {
                            if (config("throwDeprecation")) {
                                throw new Error(msg);
                            } else if (config("traceDeprecation")) {
                                console.trace(msg);
                            } else {
                                console.warn(msg);
                            }
                            warned = true;
                        }
                        return fn.apply(this, arguments);
                    }
                    return deprecated;
                }
                function config(name) {
                    try {
                        if (!global.localStorage) return false;
                    } catch (_) {
                        return false;
                    }
                    var val = global.localStorage[name];
                    if (null == val) return false;
                    return String(val).toLowerCase() === "true";
                }
            }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {} ],
        99: [ function(require, module, exports) {
            (function(process) {
                var Stream = function() {
                    try {
                        return require("st" + "ream");
                    } catch (_) {}
                }();
                exports = module.exports = require("./lib/_stream_readable.js");
                exports.Stream = Stream || exports;
                exports.Readable = exports;
                exports.Writable = require("./lib/_stream_writable.js");
                exports.Duplex = require("./lib/_stream_duplex.js");
                exports.Transform = require("./lib/_stream_transform.js");
                exports.PassThrough = require("./lib/_stream_passthrough.js");
                if (!process.browser && process.env.READABLE_STREAM === "disable" && Stream) {
                    module.exports = Stream;
                }
            }).call(this, require("_process"));
        }, {
            "./lib/_stream_duplex.js": 88,
            "./lib/_stream_passthrough.js": 89,
            "./lib/_stream_readable.js": 90,
            "./lib/_stream_transform.js": 91,
            "./lib/_stream_writable.js": 92,
            _process: 30
        } ],
        100: [ function(require, module, exports) {
            exports.render = render;
            exports.append = append;
            var mime = exports.mime = require("./lib/mime.json");
            var debug = require("debug")("render-media");
            var isAscii = require("is-ascii");
            var MediaElementWrapper = require("mediasource");
            var path = require("path");
            var streamToBlobURL = require("stream-to-blob-url");
            var videostream = require("videostream");
            var VIDEOSTREAM_EXTS = [ ".mp4", ".m4v", ".m4a" ];
            var MEDIASOURCE_VIDEO_EXTS = [ ".mp4", ".m4v", ".webm", ".mkv" ];
            var MEDIASOURCE_AUDIO_EXTS = [ ".m4a", ".mp3" ];
            var MEDIASOURCE_EXTS = MEDIASOURCE_VIDEO_EXTS.concat(MEDIASOURCE_AUDIO_EXTS);
            var AUDIO_EXTS = [ ".wav", ".aac", ".ogg", ".oga" ];
            var IMAGE_EXTS = [ ".jpg", ".jpeg", ".png", ".gif", ".bmp" ];
            var IFRAME_EXTS = [ ".css", ".html", ".js", ".md", ".pdf", ".txt" ];
            var MediaSource = typeof window !== "undefined" && window.MediaSource;
            function render(file, elem, cb) {
                validateFile(file);
                if (typeof elem === "string") elem = document.querySelector(elem);
                renderMedia(file, function(tagName) {
                    if (elem.nodeName !== tagName.toUpperCase()) {
                        var extname = path.extname(file.name).toLowerCase();
                        throw new Error('Cannot render "' + extname + '" inside a "' + elem.nodeName.toLowerCase() + '" element, expected "' + tagName + '"');
                    }
                    return elem;
                }, cb);
            }
            function append(file, rootElem, cb) {
                if (!cb) cb = function() {};
                validateFile(file);
                if (typeof rootElem === "string") rootElem = document.querySelector(rootElem);
                if (rootElem && (rootElem.nodeName === "VIDEO" || rootElem.nodeName === "AUDIO")) {
                    throw new Error("Invalid video/audio node argument. Argument must be root element that " + "video/audio tag will be appended to.");
                }
                renderMedia(file, function(tagName) {
                    if (tagName === "video" || tagName === "audio") return createMedia(tagName); else return createElem(tagName);
                }, function(err, elem) {
                    if (err && elem) elem.remove();
                    cb(err, elem);
                });
                function createMedia(tagName) {
                    var elem = createElem(tagName);
                    elem.controls = true;
                    elem.autoplay = true;
                    rootElem.appendChild(elem);
                    return elem;
                }
                function createElem(tagName) {
                    var elem = document.createElement(tagName);
                    rootElem.appendChild(elem);
                    return elem;
                }
            }
            function renderMedia(file, getElem, cb) {
                if (!cb) cb = function() {};
                var extname = path.extname(file.name).toLowerCase();
                var currentTime = 0;
                var elem;
                if (MEDIASOURCE_EXTS.indexOf(extname) >= 0) {
                    renderMediaSource();
                } else if (AUDIO_EXTS.indexOf(extname) >= 0) {
                    renderAudio();
                } else if (IMAGE_EXTS.indexOf(extname) >= 0) {
                    renderImage();
                } else if (IFRAME_EXTS.indexOf(extname) >= 0) {
                    renderIframe();
                } else {
                    tryRenderIframe();
                }
                function renderMediaSource() {
                    var tagName = MEDIASOURCE_VIDEO_EXTS.indexOf(extname) >= 0 ? "video" : "audio";
                    if (MediaSource) {
                        if (VIDEOSTREAM_EXTS.indexOf(extname) >= 0) {
                            useVideostream();
                        } else {
                            useMediaSource();
                        }
                    } else {
                        useBlobURL();
                    }
                    function useVideostream() {
                        debug("Use `videostream` package for " + file.name);
                        prepareElem();
                        elem.addEventListener("error", fallbackToMediaSource);
                        elem.addEventListener("loadstart", onLoadStart);
                        elem.addEventListener("canplay", onCanPlay);
                        videostream(file, elem);
                    }
                    function useMediaSource() {
                        debug("Use MediaSource API for " + file.name);
                        prepareElem();
                        elem.addEventListener("error", fallbackToBlobURL);
                        elem.addEventListener("loadstart", onLoadStart);
                        elem.addEventListener("canplay", onCanPlay);
                        var wrapper = new MediaElementWrapper(elem);
                        var writable = wrapper.createWriteStream(getCodec(file.name));
                        file.createReadStream().pipe(writable);
                        if (currentTime) elem.currentTime = currentTime;
                    }
                    function useBlobURL() {
                        debug("Use Blob URL for " + file.name);
                        prepareElem();
                        elem.addEventListener("error", fatalError);
                        elem.addEventListener("loadstart", onLoadStart);
                        elem.addEventListener("canplay", onCanPlay);
                        getBlobURL(file, function(err, url) {
                            if (err) return fatalError(err);
                            elem.src = url;
                            if (currentTime) elem.currentTime = currentTime;
                        });
                    }
                    function fallbackToMediaSource(err) {
                        debug("videostream error: fallback to MediaSource API: %o", err.message || err);
                        elem.removeEventListener("error", fallbackToMediaSource);
                        elem.removeEventListener("canplay", onCanPlay);
                        useMediaSource();
                    }
                    function fallbackToBlobURL(err) {
                        debug("MediaSource API error: fallback to Blob URL: %o", err.message || err);
                        elem.removeEventListener("error", fallbackToBlobURL);
                        elem.removeEventListener("canplay", onCanPlay);
                        useBlobURL();
                    }
                    function prepareElem() {
                        if (!elem) {
                            elem = getElem(tagName);
                            elem.addEventListener("progress", function() {
                                currentTime = elem.currentTime;
                            });
                        }
                    }
                }
                function renderAudio() {
                    elem = getElem("audio");
                    getBlobURL(file, function(err, url) {
                        if (err) return fatalError(err);
                        elem.addEventListener("error", fatalError);
                        elem.addEventListener("loadstart", onLoadStart);
                        elem.addEventListener("canplay", onCanPlay);
                        elem.src = url;
                    });
                }
                function onLoadStart() {
                    elem.removeEventListener("loadstart", onLoadStart);
                    elem.play();
                }
                function onCanPlay() {
                    elem.removeEventListener("canplay", onCanPlay);
                    cb(null, elem);
                }
                function renderImage() {
                    elem = getElem("img");
                    getBlobURL(file, function(err, url) {
                        if (err) return fatalError(err);
                        elem.src = url;
                        elem.alt = file.name;
                        cb(null, elem);
                    });
                }
                function renderIframe() {
                    elem = getElem("iframe");
                    getBlobURL(file, function(err, url) {
                        if (err) return fatalError(err);
                        elem.src = url;
                        if (extname !== ".pdf") elem.sandbox = "allow-forms allow-scripts";
                        cb(null, elem);
                    });
                }
                function tryRenderIframe() {
                    debug('Unknown file extension "%s" - will attempt to render into iframe', extname);
                    var str = "";
                    file.createReadStream({
                        start: 0,
                        end: 1e3
                    }).setEncoding("utf8").on("data", function(chunk) {
                        str += chunk;
                    }).on("end", done).on("error", cb);
                    function done() {
                        if (isAscii(str)) {
                            debug('File extension "%s" appears ascii, so will render.', extname);
                            renderIframe();
                        } else {
                            debug('File extension "%s" appears non-ascii, will not render.', extname);
                            cb(new Error('Unsupported file type "' + extname + '": Cannot append to DOM'));
                        }
                    }
                }
                function fatalError(err) {
                    err.message = 'Error rendering file "' + file.name + '": ' + err.message;
                    debug(err.message);
                    cb(err);
                }
            }
            function getBlobURL(file, cb) {
                var extname = path.extname(file.name).toLowerCase();
                streamToBlobURL(file.createReadStream(), mime[extname], cb);
            }
            function validateFile(file) {
                if (file == null) {
                    throw new Error("file cannot be null or undefined");
                }
                if (typeof file.name !== "string") {
                    throw new Error("missing or invalid file.name property");
                }
                if (typeof file.createReadStream !== "function") {
                    throw new Error("missing or invalid file.createReadStream property");
                }
            }
            function getCodec(name) {
                var extname = path.extname(name).toLowerCase();
                return {
                    ".m4a": 'audio/mp4; codecs="mp4a.40.5"',
                    ".m4v": 'video/mp4; codecs="avc1.640029, mp4a.40.5"',
                    ".mkv": 'video/webm; codecs="avc1.640029, mp4a.40.5"',
                    ".mp3": "audio/mpeg",
                    ".mp4": 'video/mp4; codecs="avc1.640029, mp4a.40.5"',
                    ".webm": 'video/webm; codecs="vorbis, vp8"'
                }[extname];
            }
        }, {
            "./lib/mime.json": 101,
            debug: 63,
            "is-ascii": 102,
            mediasource: 103,
            path: 29,
            "stream-to-blob-url": 131,
            videostream: 116
        } ],
        101: [ function(require, module, exports) {
            module.exports = {
                ".3gp": "video/3gpp",
                ".aac": "audio/aac",
                ".aif": "audio/x-aiff",
                ".aiff": "audio/x-aiff",
                ".atom": "application/atom+xml",
                ".avi": "video/x-msvideo",
                ".bmp": "image/bmp",
                ".bz2": "application/x-bzip2",
                ".conf": "text/plain",
                ".css": "text/css",
                ".csv": "text/csv",
                ".diff": "text/x-diff",
                ".doc": "application/msword",
                ".flv": "video/x-flv",
                ".gif": "image/gif",
                ".gz": "application/x-gzip",
                ".htm": "text/html",
                ".html": "text/html",
                ".ico": "image/vnd.microsoft.icon",
                ".ics": "text/calendar",
                ".iso": "application/octet-stream",
                ".jar": "application/java-archive",
                ".jpeg": "image/jpeg",
                ".jpg": "image/jpeg",
                ".js": "application/javascript",
                ".json": "application/json",
                ".less": "text/css",
                ".log": "text/plain",
                ".m3u": "audio/x-mpegurl",
                ".m4a": "audio/mp4",
                ".m4v": "video/mp4",
                ".manifest": "text/cache-manifest",
                ".markdown": "text/x-markdown",
                ".mathml": "application/mathml+xml",
                ".md": "text/x-markdown",
                ".mid": "audio/midi",
                ".midi": "audio/midi",
                ".mov": "video/quicktime",
                ".mp3": "audio/mpeg",
                ".mp4": "video/mp4",
                ".mp4v": "video/mp4",
                ".mpeg": "video/mpeg",
                ".mpg": "video/mpeg",
                ".odp": "application/vnd.oasis.opendocument.presentation",
                ".ods": "application/vnd.oasis.opendocument.spreadsheet",
                ".odt": "application/vnd.oasis.opendocument.text",
                ".oga": "audio/ogg",
                ".ogg": "application/ogg",
                ".pdf": "application/pdf",
                ".png": "image/png",
                ".pps": "application/vnd.ms-powerpoint",
                ".ppt": "application/vnd.ms-powerpoint",
                ".ps": "application/postscript",
                ".psd": "image/vnd.adobe.photoshop",
                ".qt": "video/quicktime",
                ".rar": "application/x-rar-compressed",
                ".rdf": "application/rdf+xml",
                ".rss": "application/rss+xml",
                ".rtf": "application/rtf",
                ".svg": "image/svg+xml",
                ".svgz": "image/svg+xml",
                ".swf": "application/x-shockwave-flash",
                ".tar": "application/x-tar",
                ".tbz": "application/x-bzip-compressed-tar",
                ".text": "text/plain",
                ".tif": "image/tiff",
                ".tiff": "image/tiff",
                ".torrent": "application/x-bittorrent",
                ".ttf": "application/x-font-ttf",
                ".txt": "text/plain",
                ".wav": "audio/wav",
                ".webm": "video/webm",
                ".wma": "audio/x-ms-wma",
                ".wmv": "video/x-ms-wmv",
                ".xls": "application/vnd.ms-excel",
                ".xml": "application/xml",
                ".yaml": "text/yaml",
                ".yml": "text/yaml",
                ".zip": "application/zip"
            };
        }, {} ],
        102: [ function(require, module, exports) {
            var MAX_ASCII_CHAR_CODE = 127;
            module.exports = function isAscii(str) {
                for (var i = 0, strLen = str.length; i < strLen; ++i) {
                    if (str.charCodeAt(i) > MAX_ASCII_CHAR_CODE) return false;
                }
                return true;
            };
        }, {} ],
        103: [ function(require, module, exports) {
            module.exports = MediaElementWrapper;
            var inherits = require("inherits");
            var stream = require("readable-stream");
            var toArrayBuffer = require("to-arraybuffer");
            var MediaSource = typeof window !== "undefined" && window.MediaSource;
            var DEFAULT_BUFFER_DURATION = 60;
            function MediaElementWrapper(elem, opts) {
                var self = this;
                if (!(self instanceof MediaElementWrapper)) return new MediaElementWrapper(elem, opts);
                if (!MediaSource) throw new Error("web browser lacks MediaSource support");
                if (!opts) opts = {};
                self._bufferDuration = opts.bufferDuration || DEFAULT_BUFFER_DURATION;
                self._elem = elem;
                self._mediaSource = new MediaSource();
                self._streams = [];
                self.detailedError = null;
                self._errorHandler = function() {
                    self._elem.removeEventListener("error", self._errorHandler);
                    var streams = self._streams.slice();
                    streams.forEach(function(stream) {
                        stream.destroy(self._elem.error);
                    });
                };
                self._elem.addEventListener("error", self._errorHandler);
                self._elem.src = window.URL.createObjectURL(self._mediaSource);
            }
            MediaElementWrapper.prototype.createWriteStream = function(obj) {
                var self = this;
                return new MediaSourceStream(self, obj);
            };
            MediaElementWrapper.prototype.error = function(err) {
                var self = this;
                if (!self.detailedError) {
                    self.detailedError = err;
                }
                try {
                    self._mediaSource.endOfStream("decode");
                } catch (err) {}
            };
            inherits(MediaSourceStream, stream.Writable);
            function MediaSourceStream(wrapper, obj) {
                var self = this;
                stream.Writable.call(self);
                self._wrapper = wrapper;
                self._elem = wrapper._elem;
                self._mediaSource = wrapper._mediaSource;
                self._allStreams = wrapper._streams;
                self._allStreams.push(self);
                self._bufferDuration = wrapper._bufferDuration;
                self._sourceBuffer = null;
                self._openHandler = function() {
                    self._onSourceOpen();
                };
                self._flowHandler = function() {
                    self._flow();
                };
                if (typeof obj === "string") {
                    self._type = obj;
                    if (self._mediaSource.readyState === "open") {
                        self._createSourceBuffer();
                    } else {
                        self._mediaSource.addEventListener("sourceopen", self._openHandler);
                    }
                } else if (obj._sourceBuffer === null) {
                    obj.destroy();
                    self._type = obj._type;
                    self._mediaSource.addEventListener("sourceopen", self._openHandler);
                } else if (obj._sourceBuffer) {
                    obj.destroy();
                    self._type = obj._type;
                    self._sourceBuffer = obj._sourceBuffer;
                    self._sourceBuffer.addEventListener("updateend", self._flowHandler);
                } else {
                    throw new Error("The argument to MediaElementWrapper.createWriteStream must be a string or a previous stream returned from that function");
                }
                self._elem.addEventListener("timeupdate", self._flowHandler);
                self.on("error", function(err) {
                    self._wrapper.error(err);
                });
                self.on("finish", function() {
                    if (self.destroyed) return;
                    self._finished = true;
                    if (self._allStreams.every(function(other) {
                        return other._finished;
                    })) {
                        try {
                            self._mediaSource.endOfStream();
                        } catch (err) {}
                    }
                });
            }
            MediaSourceStream.prototype._onSourceOpen = function() {
                var self = this;
                if (self.destroyed) return;
                self._mediaSource.removeEventListener("sourceopen", self._openHandler);
                self._createSourceBuffer();
            };
            MediaSourceStream.prototype.destroy = function(err) {
                var self = this;
                if (self.destroyed) return;
                self.destroyed = true;
                self._allStreams.splice(self._allStreams.indexOf(self), 1);
                self._mediaSource.removeEventListener("sourceopen", self._openHandler);
                self._elem.removeEventListener("timeupdate", self._flowHandler);
                if (self._sourceBuffer) {
                    self._sourceBuffer.removeEventListener("updateend", self._flowHandler);
                    if (self._mediaSource.readyState === "open") {
                        self._sourceBuffer.abort();
                    }
                }
                if (err) self.emit("error", err);
                self.emit("close");
            };
            MediaSourceStream.prototype._createSourceBuffer = function() {
                var self = this;
                if (self.destroyed) return;
                if (MediaSource.isTypeSupported(self._type)) {
                    self._sourceBuffer = self._mediaSource.addSourceBuffer(self._type);
                    self._sourceBuffer.addEventListener("updateend", self._flowHandler);
                    if (self._cb) {
                        var cb = self._cb;
                        self._cb = null;
                        cb();
                    }
                } else {
                    self.destroy(new Error("The provided type is not supported"));
                }
            };
            MediaSourceStream.prototype._write = function(chunk, encoding, cb) {
                var self = this;
                if (self.destroyed) return;
                if (!self._sourceBuffer) {
                    self._cb = function(err) {
                        if (err) return cb(err);
                        self._write(chunk, encoding, cb);
                    };
                    return;
                }
                if (self._sourceBuffer.updating) {
                    return cb(new Error("Cannot append buffer while source buffer updating"));
                }
                try {
                    self._sourceBuffer.appendBuffer(toArrayBuffer(chunk));
                } catch (err) {
                    self.destroy(err);
                    return;
                }
                self._cb = cb;
            };
            MediaSourceStream.prototype._flow = function() {
                var self = this;
                if (self.destroyed || !self._sourceBuffer || self._sourceBuffer.updating) {
                    return;
                }
                if (self._mediaSource.readyState === "open") {
                    if (self._getBufferDuration() > self._bufferDuration) {
                        return;
                    }
                }
                if (self._cb) {
                    var cb = self._cb;
                    self._cb = null;
                    cb();
                }
            };
            var EPSILON = 0;
            MediaSourceStream.prototype._getBufferDuration = function() {
                var self = this;
                var buffered = self._sourceBuffer.buffered;
                var currentTime = self._elem.currentTime;
                var bufferEnd = -1;
                for (var i = 0; i < buffered.length; i++) {
                    var start = buffered.start(i);
                    var end = buffered.end(i) + EPSILON;
                    if (start > currentTime) {
                        break;
                    } else if (bufferEnd >= 0 || currentTime <= end) {
                        bufferEnd = end;
                    }
                }
                var bufferedTime = bufferEnd - currentTime;
                if (bufferedTime < 0) {
                    bufferedTime = 0;
                }
                return bufferedTime;
            };
        }, {
            inherits: 71,
            "readable-stream": 99,
            "to-arraybuffer": 104
        } ],
        104: [ function(require, module, exports) {
            arguments[4][40][0].apply(exports, arguments);
        }, {
            buffer: 22,
            dup: 40
        } ],
        105: [ function(require, module, exports) {
            (function(Buffer) {
                var bs = require("binary-search");
                var EventEmitter = require("events").EventEmitter;
                var inherits = require("inherits");
                var mp4 = require("mp4-stream");
                var Box = require("mp4-box-encoding");
                var RangeSliceStream = require("range-slice-stream");
                module.exports = MP4Remuxer;
                function MP4Remuxer(file) {
                    var self = this;
                    EventEmitter.call(self);
                    self._tracks = [];
                    self._fragmentSequence = 1;
                    self._file = file;
                    self._decoder = null;
                    self._findMoov(0);
                }
                inherits(MP4Remuxer, EventEmitter);
                MP4Remuxer.prototype._findMoov = function(offset) {
                    var self = this;
                    if (self._decoder) {
                        self._decoder.destroy();
                    }
                    self._decoder = mp4.decode();
                    var fileStream = self._file.createReadStream({
                        start: offset
                    });
                    fileStream.pipe(self._decoder);
                    self._decoder.once("box", function(headers) {
                        if (headers.type === "moov") {
                            self._decoder.decode(function(moov) {
                                fileStream.destroy();
                                try {
                                    self._processMoov(moov);
                                } catch (err) {
                                    err.message = "Cannot parse mp4 file: " + err.message;
                                    self.emit("error", err);
                                }
                            });
                        } else {
                            fileStream.destroy();
                            self._findMoov(offset + headers.length);
                        }
                    });
                };
                function RunLengthIndex(entries, countName) {
                    var self = this;
                    self._entries = entries;
                    self._countName = countName || "count";
                    self._index = 0;
                    self._offset = 0;
                    self.value = self._entries[0];
                }
                RunLengthIndex.prototype.inc = function() {
                    var self = this;
                    self._offset++;
                    if (self._offset >= self._entries[self._index][self._countName]) {
                        self._index++;
                        self._offset = 0;
                    }
                    self.value = self._entries[self._index];
                };
                MP4Remuxer.prototype._processMoov = function(moov) {
                    var self = this;
                    var traks = moov.traks;
                    self._tracks = [];
                    self._hasVideo = false;
                    self._hasAudio = false;
                    for (var i = 0; i < traks.length; i++) {
                        var trak = traks[i];
                        var stbl = trak.mdia.minf.stbl;
                        var stsdEntry = stbl.stsd.entries[0];
                        var handlerType = trak.mdia.hdlr.handlerType;
                        var codec;
                        var mime;
                        if (handlerType === "vide" && stsdEntry.type === "avc1") {
                            if (self._hasVideo) {
                                continue;
                            }
                            self._hasVideo = true;
                            codec = "avc1";
                            if (stsdEntry.avcC) {
                                codec += "." + stsdEntry.avcC.mimeCodec;
                            }
                            mime = 'video/mp4; codecs="' + codec + '"';
                        } else if (handlerType === "soun" && stsdEntry.type === "mp4a") {
                            if (self._hasAudio) {
                                continue;
                            }
                            self._hasAudio = true;
                            codec = "mp4a";
                            if (stsdEntry.esds && stsdEntry.esds.mimeCodec) {
                                codec += "." + stsdEntry.esds.mimeCodec;
                            }
                            mime = 'audio/mp4; codecs="' + codec + '"';
                        } else {
                            continue;
                        }
                        var samples = [];
                        var sample = 0;
                        var sampleInChunk = 0;
                        var chunk = 0;
                        var offsetInChunk = 0;
                        var sampleToChunkIndex = 0;
                        var dts = 0;
                        var decodingTimeEntry = new RunLengthIndex(stbl.stts.entries);
                        var presentationOffsetEntry = null;
                        if (stbl.ctts) {
                            presentationOffsetEntry = new RunLengthIndex(stbl.ctts.entries);
                        }
                        var syncSampleIndex = 0;
                        while (true) {
                            var currChunkEntry = stbl.stsc.entries[sampleToChunkIndex];
                            var size = stbl.stsz.entries[sample];
                            var duration = decodingTimeEntry.value.duration;
                            var presentationOffset = presentationOffsetEntry ? presentationOffsetEntry.value.compositionOffset : 0;
                            var sync = true;
                            if (stbl.stss) {
                                sync = stbl.stss.entries[syncSampleIndex] === sample + 1;
                            }
                            samples.push({
                                size: size,
                                duration: duration,
                                dts: dts,
                                presentationOffset: presentationOffset,
                                sync: sync,
                                offset: offsetInChunk + stbl.stco.entries[chunk]
                            });
                            sample++;
                            if (sample >= stbl.stsz.entries.length) {
                                break;
                            }
                            sampleInChunk++;
                            offsetInChunk += size;
                            if (sampleInChunk >= currChunkEntry.samplesPerChunk) {
                                sampleInChunk = 0;
                                offsetInChunk = 0;
                                chunk++;
                                var nextChunkEntry = stbl.stsc.entries[sampleToChunkIndex + 1];
                                if (nextChunkEntry && chunk + 1 >= nextChunkEntry.firstChunk) {
                                    sampleToChunkIndex++;
                                }
                            }
                            dts += duration;
                            decodingTimeEntry.inc();
                            presentationOffsetEntry && presentationOffsetEntry.inc();
                            if (sync) {
                                syncSampleIndex++;
                            }
                        }
                        trak.mdia.mdhd.duration = 0;
                        trak.tkhd.duration = 0;
                        var defaultSampleDescriptionIndex = currChunkEntry.sampleDescriptionId;
                        var trackMoov = {
                            type: "moov",
                            mvhd: moov.mvhd,
                            traks: [ {
                                tkhd: trak.tkhd,
                                mdia: {
                                    mdhd: trak.mdia.mdhd,
                                    hdlr: trak.mdia.hdlr,
                                    elng: trak.mdia.elng,
                                    minf: {
                                        vmhd: trak.mdia.minf.vmhd,
                                        smhd: trak.mdia.minf.smhd,
                                        dinf: trak.mdia.minf.dinf,
                                        stbl: {
                                            stsd: stbl.stsd,
                                            stts: empty(),
                                            ctts: empty(),
                                            stsc: empty(),
                                            stsz: empty(),
                                            stco: empty(),
                                            stss: empty()
                                        }
                                    }
                                }
                            } ],
                            mvex: {
                                mehd: {
                                    fragmentDuration: moov.mvhd.duration
                                },
                                trexs: [ {
                                    trackId: trak.tkhd.trackId,
                                    defaultSampleDescriptionIndex: defaultSampleDescriptionIndex,
                                    defaultSampleDuration: 0,
                                    defaultSampleSize: 0,
                                    defaultSampleFlags: 0
                                } ]
                            }
                        };
                        self._tracks.push({
                            trackId: trak.tkhd.trackId,
                            timeScale: trak.mdia.mdhd.timeScale,
                            samples: samples,
                            currSample: null,
                            currTime: null,
                            moov: trackMoov,
                            mime: mime
                        });
                    }
                    if (self._tracks.length === 0) {
                        self.emit("error", new Error("no playable tracks"));
                        return;
                    }
                    moov.mvhd.duration = 0;
                    self._ftyp = {
                        type: "ftyp",
                        brand: "iso5",
                        brandVersion: 0,
                        compatibleBrands: [ "iso5" ]
                    };
                    var ftypBuf = Box.encode(self._ftyp);
                    var data = self._tracks.map(function(track) {
                        var moovBuf = Box.encode(track.moov);
                        return {
                            mime: track.mime,
                            init: Buffer.concat([ ftypBuf, moovBuf ])
                        };
                    });
                    self.emit("ready", data);
                };
                function empty() {
                    return {
                        version: 0,
                        flags: 0,
                        entries: []
                    };
                }
                MP4Remuxer.prototype.seek = function(time) {
                    var self = this;
                    if (!self._tracks) {
                        throw new Error("Not ready yet; wait for 'ready' event");
                    }
                    if (self._fileStream) {
                        self._fileStream.destroy();
                        self._fileStream = null;
                    }
                    var startOffset = -1;
                    self._tracks.map(function(track, i) {
                        if (track.outStream) {
                            track.outStream.destroy();
                        }
                        if (track.inStream) {
                            track.inStream.destroy();
                            track.inStream = null;
                        }
                        var outStream = track.outStream = mp4.encode();
                        var fragment = self._generateFragment(i, time);
                        if (!fragment) {
                            return outStream.finalize();
                        }
                        if (startOffset === -1 || fragment.ranges[0].start < startOffset) {
                            startOffset = fragment.ranges[0].start;
                        }
                        writeFragment(fragment);
                        function writeFragment(frag) {
                            if (outStream.destroyed) return;
                            outStream.box(frag.moof, function(err) {
                                if (err) return self.emit("error", err);
                                if (outStream.destroyed) return;
                                var slicedStream = track.inStream.slice(frag.ranges);
                                slicedStream.pipe(outStream.mediaData(frag.length, function(err) {
                                    if (err) return self.emit("error", err);
                                    if (outStream.destroyed) return;
                                    var nextFrag = self._generateFragment(i);
                                    if (!nextFrag) {
                                        return outStream.finalize();
                                    }
                                    writeFragment(nextFrag);
                                }));
                            });
                        }
                    });
                    if (startOffset >= 0) {
                        var fileStream = self._fileStream = self._file.createReadStream({
                            start: startOffset
                        });
                        self._tracks.forEach(function(track) {
                            track.inStream = new RangeSliceStream(startOffset);
                            fileStream.pipe(track.inStream);
                        });
                    }
                    return self._tracks.map(function(track) {
                        return track.outStream;
                    });
                };
                MP4Remuxer.prototype._findSampleBefore = function(trackInd, time) {
                    var self = this;
                    var track = self._tracks[trackInd];
                    var scaledTime = Math.floor(track.timeScale * time);
                    var sample = bs(track.samples, scaledTime, function(sample, t) {
                        var pts = sample.dts + sample.presentationOffset;
                        return pts - t;
                    });
                    if (sample === -1) {
                        sample = 0;
                    } else if (sample < 0) {
                        sample = -sample - 2;
                    }
                    while (!track.samples[sample].sync) {
                        sample--;
                    }
                    return sample;
                };
                var MIN_FRAGMENT_DURATION = 1;
                MP4Remuxer.prototype._generateFragment = function(track, time) {
                    var self = this;
                    var currTrack = self._tracks[track];
                    var firstSample;
                    if (time !== undefined) {
                        firstSample = self._findSampleBefore(track, time);
                    } else {
                        firstSample = currTrack.currSample;
                    }
                    if (firstSample >= currTrack.samples.length) return null;
                    var startDts = currTrack.samples[firstSample].dts;
                    var totalLen = 0;
                    var ranges = [];
                    for (var currSample = firstSample; currSample < currTrack.samples.length; currSample++) {
                        var sample = currTrack.samples[currSample];
                        if (sample.sync && sample.dts - startDts >= currTrack.timeScale * MIN_FRAGMENT_DURATION) {
                            break;
                        }
                        totalLen += sample.size;
                        var currRange = ranges.length - 1;
                        if (currRange < 0 || ranges[currRange].end !== sample.offset) {
                            ranges.push({
                                start: sample.offset,
                                end: sample.offset + sample.size
                            });
                        } else {
                            ranges[currRange].end += sample.size;
                        }
                    }
                    currTrack.currSample = currSample;
                    return {
                        moof: self._generateMoof(track, firstSample, currSample),
                        ranges: ranges,
                        length: totalLen
                    };
                };
                MP4Remuxer.prototype._generateMoof = function(track, firstSample, lastSample) {
                    var self = this;
                    var currTrack = self._tracks[track];
                    var entries = [];
                    for (var j = firstSample; j < lastSample; j++) {
                        var currSample = currTrack.samples[j];
                        entries.push({
                            sampleDuration: currSample.duration,
                            sampleSize: currSample.size,
                            sampleFlags: currSample.sync ? 33554432 : 16842752,
                            sampleCompositionTimeOffset: currSample.presentationOffset
                        });
                    }
                    var moof = {
                        type: "moof",
                        mfhd: {
                            sequenceNumber: self._fragmentSequence++
                        },
                        trafs: [ {
                            tfhd: {
                                flags: 131072,
                                trackId: currTrack.trackId
                            },
                            tfdt: {
                                baseMediaDecodeTime: currTrack.samples[firstSample].dts
                            },
                            trun: {
                                flags: 3841,
                                dataOffset: 8,
                                entries: entries
                            }
                        } ]
                    };
                    moof.trafs[0].trun.dataOffset += Box.encodingLength(moof);
                    return moof;
                };
            }).call(this, require("buffer").Buffer);
        }, {
            "binary-search": 106,
            buffer: 22,
            events: 26,
            inherits: 71,
            "mp4-box-encoding": 109,
            "mp4-stream": 113,
            "range-slice-stream": 115
        } ],
        106: [ function(require, module, exports) {
            module.exports = function(haystack, needle, comparator, low, high) {
                var mid, cmp;
                if (low === undefined) low = 0; else {
                    low = low | 0;
                    if (low < 0 || low >= haystack.length) throw new RangeError("invalid lower bound");
                }
                if (high === undefined) high = haystack.length - 1; else {
                    high = high | 0;
                    if (high < low || high >= haystack.length) throw new RangeError("invalid upper bound");
                }
                while (low <= high) {
                    mid = low + (high - low >> 1);
                    cmp = +comparator(haystack[mid], needle, mid, haystack);
                    if (cmp < 0) low = mid + 1; else if (cmp > 0) high = mid - 1; else return mid;
                }
                return ~low;
            };
        }, {} ],
        107: [ function(require, module, exports) {
            (function(Buffer) {
                var Box = require("./index");
                var Descriptor = require("./descriptor");
                var TIME_OFFSET = 20828448e5;
                exports.fullBoxes = {};
                var fullBoxes = [ "mvhd", "tkhd", "mdhd", "vmhd", "smhd", "stsd", "esds", "stsz", "stco", "stss", "stts", "ctts", "stsc", "dref", "elst", "hdlr", "mehd", "trex", "mfhd", "tfhd", "tfdt", "trun" ];
                fullBoxes.forEach(function(type) {
                    exports.fullBoxes[type] = true;
                });
                exports.ftyp = {};
                exports.ftyp.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(exports.ftyp.encodingLength(box));
                    var brands = box.compatibleBrands || [];
                    buf.write(box.brand, 0, 4, "ascii");
                    buf.writeUInt32BE(box.brandVersion, 4);
                    for (var i = 0; i < brands.length; i++) buf.write(brands[i], 8 + i * 4, 4, "ascii");
                    exports.ftyp.encode.bytes = 8 + brands.length * 4;
                    return buf;
                };
                exports.ftyp.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var brand = buf.toString("ascii", 0, 4);
                    var version = buf.readUInt32BE(4);
                    var compatibleBrands = [];
                    for (var i = 8; i < buf.length; i += 4) compatibleBrands.push(buf.toString("ascii", i, i + 4));
                    return {
                        brand: brand,
                        brandVersion: version,
                        compatibleBrands: compatibleBrands
                    };
                };
                exports.ftyp.encodingLength = function(box) {
                    return 8 + (box.compatibleBrands || []).length * 4;
                };
                exports.mvhd = {};
                exports.mvhd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(96);
                    writeDate(box.ctime || new Date(), buf, 0);
                    writeDate(box.mtime || new Date(), buf, 4);
                    buf.writeUInt32BE(box.timeScale || 0, 8);
                    buf.writeUInt32BE(box.duration || 0, 12);
                    writeFixed32(box.preferredRate || 0, buf, 16);
                    writeFixed16(box.preferredVolume || 0, buf, 20);
                    writeReserved(buf, 22, 32);
                    writeMatrix(box.matrix, buf, 32);
                    buf.writeUInt32BE(box.previewTime || 0, 68);
                    buf.writeUInt32BE(box.previewDuration || 0, 72);
                    buf.writeUInt32BE(box.posterTime || 0, 76);
                    buf.writeUInt32BE(box.selectionTime || 0, 80);
                    buf.writeUInt32BE(box.selectionDuration || 0, 84);
                    buf.writeUInt32BE(box.currentTime || 0, 88);
                    buf.writeUInt32BE(box.nextTrackId || 0, 92);
                    exports.mvhd.encode.bytes = 96;
                    return buf;
                };
                exports.mvhd.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    return {
                        ctime: readDate(buf, 0),
                        mtime: readDate(buf, 4),
                        timeScale: buf.readUInt32BE(8),
                        duration: buf.readUInt32BE(12),
                        preferredRate: readFixed32(buf, 16),
                        preferredVolume: readFixed16(buf, 20),
                        matrix: readMatrix(buf.slice(32, 68)),
                        previewTime: buf.readUInt32BE(68),
                        previewDuration: buf.readUInt32BE(72),
                        posterTime: buf.readUInt32BE(76),
                        selectionTime: buf.readUInt32BE(80),
                        selectionDuration: buf.readUInt32BE(84),
                        currentTime: buf.readUInt32BE(88),
                        nextTrackId: buf.readUInt32BE(92)
                    };
                };
                exports.mvhd.encodingLength = function(box) {
                    return 96;
                };
                exports.tkhd = {};
                exports.tkhd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(80);
                    writeDate(box.ctime || new Date(), buf, 0);
                    writeDate(box.mtime || new Date(), buf, 4);
                    buf.writeUInt32BE(box.trackId || 0, 8);
                    writeReserved(buf, 12, 16);
                    buf.writeUInt32BE(box.duration || 0, 16);
                    writeReserved(buf, 20, 28);
                    buf.writeUInt16BE(box.layer || 0, 28);
                    buf.writeUInt16BE(box.alternateGroup || 0, 30);
                    buf.writeUInt16BE(box.volume || 0, 32);
                    writeMatrix(box.matrix, buf, 36);
                    buf.writeUInt32BE(box.trackWidth || 0, 72);
                    buf.writeUInt32BE(box.trackHeight || 0, 76);
                    exports.tkhd.encode.bytes = 80;
                    return buf;
                };
                exports.tkhd.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    return {
                        ctime: readDate(buf, 0),
                        mtime: readDate(buf, 4),
                        trackId: buf.readUInt32BE(8),
                        duration: buf.readUInt32BE(16),
                        layer: buf.readUInt16BE(28),
                        alternateGroup: buf.readUInt16BE(30),
                        volume: buf.readUInt16BE(32),
                        matrix: readMatrix(buf.slice(36, 72)),
                        trackWidth: buf.readUInt32BE(72),
                        trackHeight: buf.readUInt32BE(76)
                    };
                };
                exports.tkhd.encodingLength = function(box) {
                    return 80;
                };
                exports.mdhd = {};
                exports.mdhd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(20);
                    writeDate(box.ctime || new Date(), buf, 0);
                    writeDate(box.mtime || new Date(), buf, 4);
                    buf.writeUInt32BE(box.timeScale || 0, 8);
                    buf.writeUInt32BE(box.duration || 0, 12);
                    buf.writeUInt16BE(box.language || 0, 16);
                    buf.writeUInt16BE(box.quality || 0, 18);
                    exports.mdhd.encode.bytes = 20;
                    return buf;
                };
                exports.mdhd.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    return {
                        ctime: readDate(buf, 0),
                        mtime: readDate(buf, 4),
                        timeScale: buf.readUInt32BE(8),
                        duration: buf.readUInt32BE(12),
                        language: buf.readUInt16BE(16),
                        quality: buf.readUInt16BE(18)
                    };
                };
                exports.mdhd.encodingLength = function(box) {
                    return 20;
                };
                exports.vmhd = {};
                exports.vmhd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(8);
                    buf.writeUInt16BE(box.graphicsMode || 0, 0);
                    var opcolor = box.opcolor || [ 0, 0, 0 ];
                    buf.writeUInt16BE(opcolor[0], 2);
                    buf.writeUInt16BE(opcolor[1], 4);
                    buf.writeUInt16BE(opcolor[2], 6);
                    exports.vmhd.encode.bytes = 8;
                    return buf;
                };
                exports.vmhd.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    return {
                        graphicsMode: buf.readUInt16BE(0),
                        opcolor: [ buf.readUInt16BE(2), buf.readUInt16BE(4), buf.readUInt16BE(6) ]
                    };
                };
                exports.vmhd.encodingLength = function(box) {
                    return 8;
                };
                exports.smhd = {};
                exports.smhd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(4);
                    buf.writeUInt16BE(box.balance || 0, 0);
                    writeReserved(buf, 2, 4);
                    exports.smhd.encode.bytes = 4;
                    return buf;
                };
                exports.smhd.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    return {
                        balance: buf.readUInt16BE(0)
                    };
                };
                exports.smhd.encodingLength = function(box) {
                    return 4;
                };
                exports.stsd = {};
                exports.stsd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(exports.stsd.encodingLength(box));
                    var entries = box.entries || [];
                    buf.writeUInt32BE(entries.length, 0);
                    var ptr = 4;
                    for (var i = 0; i < entries.length; i++) {
                        var entry = entries[i];
                        Box.encode(entry, buf, ptr);
                        ptr += Box.encode.bytes;
                    }
                    exports.stsd.encode.bytes = ptr;
                    return buf;
                };
                exports.stsd.decode = function(buf, offset, end) {
                    buf = buf.slice(offset);
                    var num = buf.readUInt32BE(0);
                    var entries = new Array(num);
                    var ptr = 4;
                    for (var i = 0; i < num; i++) {
                        var entry = Box.decode(buf, ptr, end);
                        entries[i] = entry;
                        ptr += entry.length;
                    }
                    return {
                        entries: entries
                    };
                };
                exports.stsd.encodingLength = function(box) {
                    var totalSize = 4;
                    if (!box.entries) return totalSize;
                    for (var i = 0; i < box.entries.length; i++) {
                        totalSize += Box.encodingLength(box.entries[i]);
                    }
                    return totalSize;
                };
                exports.avc1 = exports.VisualSampleEntry = {};
                exports.VisualSampleEntry.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(exports.VisualSampleEntry.encodingLength(box));
                    writeReserved(buf, 0, 6);
                    buf.writeUInt16BE(box.dataReferenceIndex || 0, 6);
                    writeReserved(buf, 8, 24);
                    buf.writeUInt16BE(box.width || 0, 24);
                    buf.writeUInt16BE(box.height || 0, 26);
                    buf.writeUInt32BE(box.hResolution || 4718592, 28);
                    buf.writeUInt32BE(box.vResolution || 4718592, 32);
                    writeReserved(buf, 36, 40);
                    buf.writeUInt16BE(box.frameCount || 1, 40);
                    var compressorName = box.compressorName || "";
                    var nameLen = Math.min(compressorName.length, 31);
                    buf.writeUInt8(nameLen, 42);
                    buf.write(compressorName, 43, nameLen, "utf8");
                    buf.writeUInt16BE(box.depth || 24, 74);
                    buf.writeInt16BE(-1, 76);
                    var ptr = 78;
                    var children = box.children || [];
                    children.forEach(function(child) {
                        Box.encode(child, buf, ptr);
                        ptr += Box.encode.bytes;
                    });
                    exports.VisualSampleEntry.encode.bytes = ptr;
                };
                exports.VisualSampleEntry.decode = function(buf, offset, end) {
                    buf = buf.slice(offset);
                    var length = end - offset;
                    var nameLen = Math.min(buf.readUInt8(42), 31);
                    var box = {
                        dataReferenceIndex: buf.readUInt16BE(6),
                        width: buf.readUInt16BE(24),
                        height: buf.readUInt16BE(26),
                        hResolution: buf.readUInt32BE(28),
                        vResolution: buf.readUInt32BE(32),
                        frameCount: buf.readUInt16BE(40),
                        compressorName: buf.toString("utf8", 43, 43 + nameLen),
                        depth: buf.readUInt16BE(74),
                        children: []
                    };
                    var ptr = 78;
                    while (length - ptr >= 8) {
                        var child = Box.decode(buf, ptr, length);
                        box.children.push(child);
                        box[child.type] = child;
                        ptr += child.length;
                    }
                    return box;
                };
                exports.VisualSampleEntry.encodingLength = function(box) {
                    var len = 78;
                    var children = box.children || [];
                    children.forEach(function(child) {
                        len += Box.encodingLength(child);
                    });
                    return len;
                };
                exports.avcC = {};
                exports.avcC.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : Buffer(box.buffer.length);
                    box.buffer.copy(buf);
                    exports.avcC.encode.bytes = box.buffer.length;
                };
                exports.avcC.decode = function(buf, offset, end) {
                    buf = buf.slice(offset, end);
                    return {
                        mimeCodec: buf.toString("hex", 1, 4),
                        buffer: new Buffer(buf)
                    };
                };
                exports.avcC.encodingLength = function(box) {
                    return box.buffer.length;
                };
                exports.mp4a = exports.AudioSampleEntry = {};
                exports.AudioSampleEntry.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(exports.AudioSampleEntry.encodingLength(box));
                    writeReserved(buf, 0, 6);
                    buf.writeUInt16BE(box.dataReferenceIndex || 0, 6);
                    writeReserved(buf, 8, 16);
                    buf.writeUInt16BE(box.channelCount || 2, 16);
                    buf.writeUInt16BE(box.sampleSize || 16, 18);
                    writeReserved(buf, 20, 24);
                    buf.writeUInt32BE(box.sampleRate || 0, 24);
                    var ptr = 28;
                    var children = box.children || [];
                    children.forEach(function(child) {
                        Box.encode(child, buf, ptr);
                        ptr += Box.encode.bytes;
                    });
                    exports.AudioSampleEntry.encode.bytes = ptr;
                };
                exports.AudioSampleEntry.decode = function(buf, offset, end) {
                    buf = buf.slice(offset, end);
                    var length = end - offset;
                    var box = {
                        dataReferenceIndex: buf.readUInt16BE(6),
                        channelCount: buf.readUInt16BE(16),
                        sampleSize: buf.readUInt16BE(18),
                        sampleRate: buf.readUInt32BE(24),
                        children: []
                    };
                    var ptr = 28;
                    while (length - ptr >= 8) {
                        var child = Box.decode(buf, ptr, length);
                        box.children.push(child);
                        box[child.type] = child;
                        ptr += child.length;
                    }
                    return box;
                };
                exports.AudioSampleEntry.encodingLength = function(box) {
                    var len = 28;
                    var children = box.children || [];
                    children.forEach(function(child) {
                        len += Box.encodingLength(child);
                    });
                    return len;
                };
                exports.esds = {};
                exports.esds.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : Buffer(box.buffer.length);
                    box.buffer.copy(buf, 0);
                    exports.esds.encode.bytes = box.buffer.length;
                };
                exports.esds.decode = function(buf, offset, end) {
                    buf = buf.slice(offset, end);
                    var desc = Descriptor.Descriptor.decode(buf, 0, buf.length);
                    var esd = desc.tagName === "ESDescriptor" ? desc : {};
                    var dcd = esd.DecoderConfigDescriptor || {};
                    var oti = dcd.oti || 0;
                    var dsi = dcd.DecoderSpecificInfo;
                    var audioConfig = dsi ? (dsi.buffer.readUInt8(0) & 248) >> 3 : 0;
                    var mimeCodec = null;
                    if (oti) {
                        mimeCodec = oti.toString(16);
                        if (audioConfig) {
                            mimeCodec += "." + audioConfig;
                        }
                    }
                    return {
                        mimeCodec: mimeCodec,
                        buffer: new Buffer(buf.slice(0))
                    };
                };
                exports.esds.encodingLength = function(box) {
                    return box.buffer.length;
                };
                exports.stsz = {};
                exports.stsz.encode = function(box, buf, offset) {
                    var entries = box.entries || [];
                    buf = buf ? buf.slice(offset) : Buffer(exports.stsz.encodingLength(box));
                    buf.writeUInt32BE(0, 0);
                    buf.writeUInt32BE(entries.length, 4);
                    for (var i = 0; i < entries.length; i++) {
                        buf.writeUInt32BE(entries[i], i * 4 + 8);
                    }
                    exports.stsz.encode.bytes = 8 + entries.length * 4;
                    return buf;
                };
                exports.stsz.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var size = buf.readUInt32BE(0);
                    var num = buf.readUInt32BE(4);
                    var entries = new Array(num);
                    for (var i = 0; i < num; i++) {
                        if (size === 0) {
                            entries[i] = buf.readUInt32BE(i * 4 + 8);
                        } else {
                            entries[i] = size;
                        }
                    }
                    return {
                        entries: entries
                    };
                };
                exports.stsz.encodingLength = function(box) {
                    return 8 + box.entries.length * 4;
                };
                exports.stss = exports.stco = {};
                exports.stco.encode = function(box, buf, offset) {
                    var entries = box.entries || [];
                    buf = buf ? buf.slice(offset) : new Buffer(exports.stco.encodingLength(box));
                    buf.writeUInt32BE(entries.length, 0);
                    for (var i = 0; i < entries.length; i++) {
                        buf.writeUInt32BE(entries[i], i * 4 + 4);
                    }
                    exports.stco.encode.bytes = 4 + entries.length * 4;
                    return buf;
                };
                exports.stco.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var num = buf.readUInt32BE(0);
                    var entries = new Array(num);
                    for (var i = 0; i < num; i++) {
                        entries[i] = buf.readUInt32BE(i * 4 + 4);
                    }
                    return {
                        entries: entries
                    };
                };
                exports.stco.encodingLength = function(box) {
                    return 4 + box.entries.length * 4;
                };
                exports.stts = {};
                exports.stts.encode = function(box, buf, offset) {
                    var entries = box.entries || [];
                    buf = buf ? buf.slice(offset) : new Buffer(exports.stts.encodingLength(box));
                    buf.writeUInt32BE(entries.length, 0);
                    for (var i = 0; i < entries.length; i++) {
                        var ptr = i * 8 + 4;
                        buf.writeUInt32BE(entries[i].count || 0, ptr);
                        buf.writeUInt32BE(entries[i].duration || 0, ptr + 4);
                    }
                    exports.stts.encode.bytes = 4 + box.entries.length * 8;
                    return buf;
                };
                exports.stts.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var num = buf.readUInt32BE(0);
                    var entries = new Array(num);
                    for (var i = 0; i < num; i++) {
                        var ptr = i * 8 + 4;
                        entries[i] = {
                            count: buf.readUInt32BE(ptr),
                            duration: buf.readUInt32BE(ptr + 4)
                        };
                    }
                    return {
                        entries: entries
                    };
                };
                exports.stts.encodingLength = function(box) {
                    return 4 + box.entries.length * 8;
                };
                exports.ctts = {};
                exports.ctts.encode = function(box, buf, offset) {
                    var entries = box.entries || [];
                    buf = buf ? buf.slice(offset) : new Buffer(exports.ctts.encodingLength(box));
                    buf.writeUInt32BE(entries.length, 0);
                    for (var i = 0; i < entries.length; i++) {
                        var ptr = i * 8 + 4;
                        buf.writeUInt32BE(entries[i].count || 0, ptr);
                        buf.writeUInt32BE(entries[i].compositionOffset || 0, ptr + 4);
                    }
                    exports.ctts.encode.bytes = 4 + entries.length * 8;
                    return buf;
                };
                exports.ctts.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var num = buf.readUInt32BE(0);
                    var entries = new Array(num);
                    for (var i = 0; i < num; i++) {
                        var ptr = i * 8 + 4;
                        entries[i] = {
                            count: buf.readUInt32BE(ptr),
                            compositionOffset: buf.readInt32BE(ptr + 4)
                        };
                    }
                    return {
                        entries: entries
                    };
                };
                exports.ctts.encodingLength = function(box) {
                    return 4 + box.entries.length * 8;
                };
                exports.stsc = {};
                exports.stsc.encode = function(box, buf, offset) {
                    var entries = box.entries || [];
                    buf = buf ? buf.slice(offset) : new Buffer(exports.stsc.encodingLength(box));
                    buf.writeUInt32BE(entries.length, 0);
                    for (var i = 0; i < entries.length; i++) {
                        var ptr = i * 12 + 4;
                        buf.writeUInt32BE(entries[i].firstChunk || 0, ptr);
                        buf.writeUInt32BE(entries[i].samplesPerChunk || 0, ptr + 4);
                        buf.writeUInt32BE(entries[i].sampleDescriptionId || 0, ptr + 8);
                    }
                    exports.stsc.encode.bytes = 4 + entries.length * 12;
                    return buf;
                };
                exports.stsc.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var num = buf.readUInt32BE(0);
                    var entries = new Array(num);
                    for (var i = 0; i < num; i++) {
                        var ptr = i * 12 + 4;
                        entries[i] = {
                            firstChunk: buf.readUInt32BE(ptr),
                            samplesPerChunk: buf.readUInt32BE(ptr + 4),
                            sampleDescriptionId: buf.readUInt32BE(ptr + 8)
                        };
                    }
                    return {
                        entries: entries
                    };
                };
                exports.stsc.encodingLength = function(box) {
                    return 4 + box.entries.length * 12;
                };
                exports.dref = {};
                exports.dref.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(exports.dref.encodingLength(box));
                    var entries = box.entries || [];
                    buf.writeUInt32BE(entries.length, 0);
                    var ptr = 4;
                    for (var i = 0; i < entries.length; i++) {
                        var entry = entries[i];
                        var size = (entry.buf ? entry.buf.length : 0) + 4 + 4;
                        buf.writeUInt32BE(size, ptr);
                        ptr += 4;
                        buf.write(entry.type, ptr, 4, "ascii");
                        ptr += 4;
                        if (entry.buf) {
                            entry.buf.copy(buf, ptr);
                            ptr += entry.buf.length;
                        }
                    }
                    exports.dref.encode.bytes = ptr;
                    return buf;
                };
                exports.dref.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var num = buf.readUInt32BE(0);
                    var entries = new Array(num);
                    var ptr = 4;
                    for (var i = 0; i < num; i++) {
                        var size = buf.readUInt32BE(ptr);
                        var type = buf.toString("ascii", ptr + 4, ptr + 8);
                        var tmp = buf.slice(ptr + 8, ptr + size);
                        ptr += size;
                        entries[i] = {
                            type: type,
                            buf: tmp
                        };
                    }
                    return {
                        entries: entries
                    };
                };
                exports.dref.encodingLength = function(box) {
                    var totalSize = 4;
                    if (!box.entries) return totalSize;
                    for (var i = 0; i < box.entries.length; i++) {
                        var buf = box.entries[i].buf;
                        totalSize += (buf ? buf.length : 0) + 4 + 4;
                    }
                    return totalSize;
                };
                exports.elst = {};
                exports.elst.encode = function(box, buf, offset) {
                    var entries = box.entries || [];
                    buf = buf ? buf.slice(offset) : new Buffer(exports.elst.encodingLength(box));
                    buf.writeUInt32BE(entries.length, 0);
                    for (var i = 0; i < entries.length; i++) {
                        var ptr = i * 12 + 4;
                        buf.writeUInt32BE(entries[i].trackDuration || 0, ptr);
                        buf.writeUInt32BE(entries[i].mediaTime || 0, ptr + 4);
                        writeFixed32(entries[i].mediaRate || 0, buf, ptr + 8);
                    }
                    exports.elst.encode.bytes = 4 + entries.length * 12;
                    return buf;
                };
                exports.elst.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    var num = buf.readUInt32BE(0);
                    var entries = new Array(num);
                    for (var i = 0; i < num; i++) {
                        var ptr = i * 12 + 4;
                        entries[i] = {
                            trackDuration: buf.readUInt32BE(ptr),
                            mediaTime: buf.readInt32BE(ptr + 4),
                            mediaRate: readFixed32(buf, ptr + 8)
                        };
                    }
                    return {
                        entries: entries
                    };
                };
                exports.elst.encodingLength = function(box) {
                    return 4 + box.entries.length * 12;
                };
                exports.hdlr = {};
                exports.hdlr.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(exports.hdlr.encodingLength(box));
                    var len = 21 + (box.name || "").length;
                    buf.fill(0, 0, len);
                    buf.write(box.handlerType || "", 4, 4, "ascii");
                    writeString(box.name || "", buf, 20);
                    exports.hdlr.encode.bytes = len;
                    return buf;
                };
                exports.hdlr.decode = function(buf, offset, end) {
                    buf = buf.slice(offset);
                    return {
                        handlerType: buf.toString("ascii", 4, 8),
                        name: readString(buf, 20, end)
                    };
                };
                exports.hdlr.encodingLength = function(box) {
                    return 21 + (box.name || "").length;
                };
                exports.mehd = {};
                exports.mehd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(4);
                    buf.writeUInt32BE(box.fragmentDuration || 0, 0);
                    exports.mehd.encode.bytes = 4;
                    return buf;
                };
                exports.mehd.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    return {
                        fragmentDuration: buf.readUInt32BE(0)
                    };
                };
                exports.mehd.encodingLength = function(box) {
                    return 4;
                };
                exports.trex = {};
                exports.trex.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(20);
                    buf.writeUInt32BE(box.trackId || 0, 0);
                    buf.writeUInt32BE(box.defaultSampleDescriptionIndex || 0, 4);
                    buf.writeUInt32BE(box.defaultSampleDuration || 0, 8);
                    buf.writeUInt32BE(box.defaultSampleSize || 0, 12);
                    buf.writeUInt32BE(box.defaultSampleFlags || 0, 16);
                    exports.trex.encode.bytes = 20;
                    return buf;
                };
                exports.trex.decode = function(buf, offset) {
                    buf = buf.slice(offset);
                    return {
                        trackId: buf.readUInt32BE(0),
                        defaultSampleDescriptionIndex: buf.readUInt32BE(4),
                        defaultSampleDuration: buf.readUInt32BE(8),
                        defaultSampleSize: buf.readUInt32BE(12),
                        defaultSampleFlags: buf.readUInt32BE(16)
                    };
                };
                exports.trex.encodingLength = function(box) {
                    return 20;
                };
                exports.mfhd = {};
                exports.mfhd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(4);
                    buf.writeUInt32BE(box.sequenceNumber || 0, 0);
                    exports.mfhd.encode.bytes = 4;
                    return buf;
                };
                exports.mfhd.decode = function(buf, offset) {
                    return {
                        sequenceNumber: buf.readUint32BE(0)
                    };
                };
                exports.mfhd.encodingLength = function(box) {
                    return 4;
                };
                exports.tfhd = {};
                exports.tfhd.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(4);
                    buf.writeUInt32BE(box.trackId, 0);
                    exports.tfhd.encode.bytes = 4;
                    return buf;
                };
                exports.tfhd.decode = function(buf, offset) {};
                exports.tfhd.encodingLength = function(box) {
                    return 4;
                };
                exports.tfdt = {};
                exports.tfdt.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(4);
                    buf.writeUInt32BE(box.baseMediaDecodeTime || 0, 0);
                    exports.tfdt.encode.bytes = 4;
                    return buf;
                };
                exports.tfdt.decode = function(buf, offset) {};
                exports.tfdt.encodingLength = function(box) {
                    return 4;
                };
                exports.trun = {};
                exports.trun.encode = function(box, buf, offset) {
                    buf = buf ? buf.slice(offset) : new Buffer(8 + box.entries.length * 16);
                    buf.writeUInt32BE(box.entries.length, 0);
                    buf.writeInt32BE(box.dataOffset, 4);
                    var ptr = 8;
                    for (var i = 0; i < box.entries.length; i++) {
                        var entry = box.entries[i];
                        buf.writeUInt32BE(entry.sampleDuration, ptr);
                        ptr += 4;
                        buf.writeUInt32BE(entry.sampleSize, ptr);
                        ptr += 4;
                        buf.writeUInt32BE(entry.sampleFlags, ptr);
                        ptr += 4;
                        buf.writeUInt32BE(entry.sampleCompositionTimeOffset, ptr);
                        ptr += 4;
                    }
                    exports.trun.encode.bytes = ptr;
                };
                exports.trun.decode = function(buf, offset) {};
                exports.trun.encodingLength = function(box) {
                    return 8 + box.entries.length * 16;
                };
                exports.mdat = {};
                exports.mdat.encode = function(box, buf, offset) {
                    if (box.buffer) {
                        box.buffer.copy(buf, offset);
                        exports.mdat.encode.bytes = box.buffer.length;
                    } else {
                        exports.mdat.encode.bytes = exports.mdat.encodingLength(box);
                    }
                };
                exports.mdat.decode = function(buf, start, end) {
                    return {
                        buffer: new Buffer(buf.slice(start, end))
                    };
                };
                exports.mdat.encodingLength = function(box) {
                    return box.buffer ? box.buffer.length : box.contentLength;
                };
                function writeReserved(buf, offset, end) {
                    for (var i = offset; i < end; i++) buf[i] = 0;
                }
                function writeDate(date, buf, offset) {
                    buf.writeUInt32BE(Math.floor((date.getTime() + TIME_OFFSET) / 1e3), offset);
                }
                function writeFixed32(num, buf, offset) {
                    buf.writeUInt16BE(Math.floor(num) % (256 * 256), offset);
                    buf.writeUInt16BE(Math.floor(num * 256 * 256) % (256 * 256), offset + 2);
                }
                function writeFixed16(num, buf, offset) {
                    buf[offset] = Math.floor(num) % 256;
                    buf[offset + 1] = Math.floor(num * 256) % 256;
                }
                function writeMatrix(list, buf, offset) {
                    if (!list) list = [ 0, 0, 0, 0, 0, 0, 0, 0, 0 ];
                    for (var i = 0; i < list.length; i++) {
                        writeFixed32(list[i], buf, offset + i * 4);
                    }
                }
                function writeString(str, buf, offset) {
                    var strBuffer = new Buffer(str, "utf8");
                    strBuffer.copy(buf, offset);
                    buf[offset + strBuffer.length] = 0;
                }
                function readMatrix(buf) {
                    var list = new Array(buf.length / 4);
                    for (var i = 0; i < list.length; i++) list[i] = readFixed32(buf, i * 4);
                    return list;
                }
                function readDate(buf, offset) {
                    return new Date(buf.readUInt32BE(offset) * 1e3 - TIME_OFFSET);
                }
                function readFixed32(buf, offset) {
                    return buf.readUInt16BE(offset) + buf.readUInt16BE(offset + 2) / (256 * 256);
                }
                function readFixed16(buf, offset) {
                    return buf[offset] + buf[offset + 1] / 256;
                }
                function readString(buf, offset, length) {
                    var i;
                    for (i = 0; i < length; i++) {
                        if (buf[offset + i] === 0) {
                            break;
                        }
                    }
                    return buf.toString("utf8", offset, offset + i);
                }
            }).call(this, require("buffer").Buffer);
        }, {
            "./descriptor": 108,
            "./index": 109,
            buffer: 22
        } ],
        108: [ function(require, module, exports) {
            (function(Buffer) {
                var tagToName = {
                    3: "ESDescriptor",
                    4: "DecoderConfigDescriptor",
                    5: "DecoderSpecificInfo",
                    6: "SLConfigDescriptor"
                };
                exports.Descriptor = {};
                exports.Descriptor.decode = function(buf, start, end) {
                    var tag = buf.readUInt8(start);
                    var ptr = start + 1;
                    var lenByte;
                    var len = 0;
                    do {
                        lenByte = buf.readUInt8(ptr++);
                        len = len << 7 | lenByte & 127;
                    } while (lenByte & 128);
                    var obj;
                    var tagName = tagToName[tag];
                    if (exports[tagName]) {
                        obj = exports[tagName].decode(buf, ptr, end);
                    } else {
                        obj = {
                            buffer: new Buffer(buf.slice(ptr, ptr + len))
                        };
                    }
                    obj.tag = tag;
                    obj.tagName = tagName;
                    obj.length = ptr - start + len;
                    obj.contentsLen = len;
                    return obj;
                };
                exports.DescriptorArray = {};
                exports.DescriptorArray.decode = function(buf, start, end) {
                    var ptr = start;
                    var obj = {};
                    while (ptr + 2 <= end) {
                        var descriptor = exports.Descriptor.decode(buf, ptr, end);
                        ptr += descriptor.length;
                        var tagName = tagToName[descriptor.tag] || "Descriptor" + descriptor.tag;
                        obj[tagName] = descriptor;
                    }
                    return obj;
                };
                exports.ESDescriptor = {};
                exports.ESDescriptor.decode = function(buf, start, end) {
                    var flags = buf.readUInt8(start + 2);
                    var ptr = start + 3;
                    if (flags & 128) {
                        ptr += 2;
                    }
                    if (flags & 64) {
                        var len = buf.readUInt8(ptr);
                        ptr += len + 1;
                    }
                    if (flags & 32) {
                        ptr += 2;
                    }
                    return exports.DescriptorArray.decode(buf, ptr, end);
                };
                exports.DecoderConfigDescriptor = {};
                exports.DecoderConfigDescriptor.decode = function(buf, start, end) {
                    var oti = buf.readUInt8(start);
                    var obj = exports.DescriptorArray.decode(buf, start + 13, end);
                    obj.oti = oti;
                    return obj;
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        109: [ function(require, module, exports) {
            (function(Buffer) {
                var uint64be = require("uint64be");
                var boxes = require("./boxes");
                var UINT32_MAX = 4294967295;
                var Box = exports;
                var containers = exports.containers = {
                    moov: [ "mvhd", "meta", "traks", "mvex" ],
                    trak: [ "tkhd", "tref", "trgr", "edts", "meta", "mdia", "udta" ],
                    edts: [ "elst" ],
                    mdia: [ "mdhd", "hdlr", "elng", "minf" ],
                    minf: [ "vmhd", "smhd", "hmhd", "sthd", "nmhd", "dinf", "stbl" ],
                    dinf: [ "dref" ],
                    stbl: [ "stsd", "stts", "ctts", "cslg", "stsc", "stsz", "stz2", "stco", "co64", "stss", "stsh", "padb", "stdp", "sdtp", "sbgps", "sgpds", "subss", "saizs", "saios" ],
                    mvex: [ "mehd", "trexs", "leva" ],
                    moof: [ "mfhd", "meta", "trafs" ],
                    traf: [ "tfhd", "trun", "sbgps", "sgpds", "subss", "saizs", "saios", "tfdt", "meta" ]
                };
                Box.encode = function(obj, buffer, offset) {
                    Box.encodingLength(obj);
                    offset = offset || 0;
                    buffer = buffer || new Buffer(obj.length);
                    return Box._encode(obj, buffer, offset);
                };
                Box._encode = function(obj, buffer, offset) {
                    var type = obj.type;
                    var len = obj.length;
                    if (len > UINT32_MAX) {
                        len = 1;
                    }
                    buffer.writeUInt32BE(len, offset);
                    buffer.write(obj.type, offset + 4, 4, "ascii");
                    var ptr = offset + 8;
                    if (len === 1) {
                        uint64be.encode(obj.length, buffer, ptr);
                        ptr += 8;
                    }
                    if (boxes.fullBoxes[type]) {
                        buffer.writeUInt32BE(obj.flags || 0, ptr);
                        buffer.writeUInt8(obj.version || 0, ptr);
                        ptr += 4;
                    }
                    if (containers[type]) {
                        var contents = containers[type];
                        contents.forEach(function(childType) {
                            if (childType.length === 5) {
                                var entry = obj[childType] || [];
                                childType = childType.substr(0, 4);
                                entry.forEach(function(child) {
                                    Box._encode(child, buffer, ptr);
                                    ptr += Box.encode.bytes;
                                });
                            } else if (obj[childType]) {
                                Box._encode(obj[childType], buffer, ptr);
                                ptr += Box.encode.bytes;
                            }
                        });
                        if (obj.otherBoxes) {
                            obj.otherBoxes.forEach(function(child) {
                                Box._encode(child, buffer, ptr);
                                ptr += Box.encode.bytes;
                            });
                        }
                    } else if (boxes[type]) {
                        var encode = boxes[type].encode;
                        encode(obj, buffer, ptr);
                        ptr += encode.bytes;
                    } else if (obj.buffer) {
                        var buf = obj.buffer;
                        buf.copy(buffer, ptr);
                        ptr += obj.buffer.length;
                    } else {
                        throw new Error("Either `type` must be set to a known type (not'" + type + "') or `buffer` must be set");
                    }
                    Box.encode.bytes = ptr - offset;
                    return buffer;
                };
                Box.readHeaders = function(buffer, start, end) {
                    start = start || 0;
                    end = end || buffer.length;
                    if (end - start < 8) {
                        return 8;
                    }
                    var len = buffer.readUInt32BE(start);
                    var type = buffer.toString("ascii", start + 4, start + 8);
                    var ptr = start + 8;
                    if (len === 1) {
                        if (end - start < 16) {
                            return 16;
                        }
                        len = uint64be.decode(buffer, ptr);
                        ptr += 8;
                    }
                    var version;
                    var flags;
                    if (boxes.fullBoxes[type]) {
                        version = buffer.readUInt8(ptr);
                        flags = buffer.readUInt32BE(ptr) & 16777215;
                        ptr += 4;
                    }
                    return {
                        length: len,
                        headersLen: ptr - start,
                        contentLen: len - (ptr - start),
                        type: type,
                        version: version,
                        flags: flags
                    };
                };
                Box.decode = function(buffer, start, end) {
                    start = start || 0;
                    end = end || buffer.length;
                    var headers = Box.readHeaders(buffer, start, end);
                    if (!headers || headers.length > end - start) {
                        throw new Error("Data too short");
                    }
                    return Box.decodeWithoutHeaders(headers, buffer, start + headers.headersLen, start + headers.length);
                };
                Box.decodeWithoutHeaders = function(headers, buffer, start, end) {
                    start = start || 0;
                    end = end || buffer.length;
                    var type = headers.type;
                    var obj = {};
                    if (containers[type]) {
                        obj.otherBoxes = [];
                        var contents = containers[type];
                        var ptr = start;
                        while (end - ptr >= 8) {
                            var child = Box.decode(buffer, ptr, end);
                            ptr += child.length;
                            if (contents.indexOf(child.type) >= 0) {
                                obj[child.type] = child;
                            } else if (contents.indexOf(child.type + "s") >= 0) {
                                var childType = child.type + "s";
                                var entry = obj[childType] = obj[childType] || [];
                                entry.push(child);
                            } else {
                                obj.otherBoxes.push(child);
                            }
                        }
                    } else if (boxes[type]) {
                        var decode = boxes[type].decode;
                        obj = decode(buffer, start, end);
                    } else {
                        obj.buffer = new Buffer(buffer.slice(start, end));
                    }
                    obj.length = headers.length;
                    obj.contentLen = headers.contentLen;
                    obj.type = headers.type;
                    obj.version = headers.version;
                    obj.flags = headers.flags;
                    return obj;
                };
                Box.encodingLength = function(obj) {
                    var type = obj.type;
                    var len = 8;
                    if (boxes.fullBoxes[type]) {
                        len += 4;
                    }
                    if (containers[type]) {
                        var contents = containers[type];
                        contents.forEach(function(childType) {
                            if (childType.length === 5) {
                                var entry = obj[childType] || [];
                                childType = childType.substr(0, 4);
                                entry.forEach(function(child) {
                                    child.type = childType;
                                    len += Box.encodingLength(child);
                                });
                            } else if (obj[childType]) {
                                var child = obj[childType];
                                child.type = childType;
                                len += Box.encodingLength(child);
                            }
                        });
                        if (obj.otherBoxes) {
                            obj.otherBoxes.forEach(function(child) {
                                len += Box.encodingLength(child);
                            });
                        }
                    } else if (boxes[type]) {
                        len += boxes[type].encodingLength(obj);
                    } else if (obj.buffer) {
                        len += obj.buffer.length;
                    } else {
                        throw new Error("Either `type` must be set to a known type (not'" + type + "') or `buffer` must be set");
                    }
                    if (len > UINT32_MAX) {
                        len += 8;
                    }
                    obj.length = len;
                    return len;
                };
            }).call(this, require("buffer").Buffer);
        }, {
            "./boxes": 107,
            buffer: 22,
            uint64be: 110
        } ],
        110: [ function(require, module, exports) {
            (function(Buffer) {
                var UINT_32_MAX = 4294967295;
                exports.encodingLength = function() {
                    return 8;
                };
                exports.encode = function(num, buf, offset) {
                    if (!buf) buf = new Buffer(8);
                    if (!offset) offset = 0;
                    var top = Math.floor(num / UINT_32_MAX);
                    var rem = num - top * UINT_32_MAX;
                    buf.writeUInt32BE(top, offset);
                    buf.writeUInt32BE(rem, offset + 4);
                    return buf;
                };
                exports.decode = function(buf, offset) {
                    if (!offset) offset = 0;
                    if (!buf) buf = new Buffer(4);
                    if (!offset) offset = 0;
                    var top = buf.readUInt32BE(offset);
                    var rem = buf.readUInt32BE(offset + 4);
                    return top * UINT_32_MAX + rem;
                };
                exports.encode.bytes = 8;
                exports.decode.bytes = 8;
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        111: [ function(require, module, exports) {
            (function(Buffer) {
                var stream = require("readable-stream");
                var inherits = require("inherits");
                var nextEvent = require("next-event");
                var Box = require("mp4-box-encoding");
                var EMPTY = new Buffer(0);
                module.exports = Decoder;
                function Decoder() {
                    if (!(this instanceof Decoder)) return new Decoder();
                    stream.Writable.call(this);
                    this.destroyed = false;
                    this._pending = 0;
                    this._missing = 0;
                    this._buf = null;
                    this._str = null;
                    this._cb = null;
                    this._ondrain = null;
                    this._writeBuffer = null;
                    this._writeCb = null;
                    this._ondrain = null;
                    this._kick();
                }
                inherits(Decoder, stream.Writable);
                Decoder.prototype.destroy = function(err) {
                    if (this.destroyed) return;
                    this.destroyed = true;
                    if (err) this.emit("error", err);
                    this.emit("close");
                };
                Decoder.prototype._write = function(data, enc, next) {
                    if (this.destroyed) return;
                    var drained = !this._str || !this._str._writableState.needDrain;
                    while (data.length && !this.destroyed) {
                        if (!this._missing) {
                            this._writeBuffer = data;
                            this._writeCb = next;
                            return;
                        }
                        var consumed = data.length < this._missing ? data.length : this._missing;
                        if (this._buf) data.copy(this._buf, this._buf.length - this._missing); else if (this._str) drained = this._str.write(consumed === data.length ? data : data.slice(0, consumed));
                        this._missing -= consumed;
                        if (!this._missing) {
                            var buf = this._buf;
                            var cb = this._cb;
                            var stream = this._str;
                            this._buf = this._cb = this._str = this._ondrain = null;
                            drained = true;
                            if (stream) stream.end();
                            if (cb) cb(buf);
                        }
                        data = consumed === data.length ? EMPTY : data.slice(consumed);
                    }
                    if (this._pending && !this._missing) {
                        this._writeBuffer = data;
                        this._writeCb = next;
                        return;
                    }
                    if (drained) next(); else this._ondrain(next);
                };
                Decoder.prototype._buffer = function(size, cb) {
                    this._missing = size;
                    this._buf = new Buffer(size);
                    this._cb = cb;
                };
                Decoder.prototype._stream = function(size, cb) {
                    var self = this;
                    this._missing = size;
                    this._str = new MediaData(this);
                    this._ondrain = nextEvent(this._str, "drain");
                    this._pending++;
                    this._str.on("end", function() {
                        self._pending--;
                        self._kick();
                    });
                    this._cb = cb;
                    return this._str;
                };
                Decoder.prototype._readBox = function() {
                    var self = this;
                    bufferHeaders(8);
                    function bufferHeaders(len, buf) {
                        self._buffer(len, function(additionalBuf) {
                            if (buf) {
                                buf = Buffer.concat(buf, additionalBuf);
                            } else {
                                buf = additionalBuf;
                            }
                            var headers = Box.readHeaders(buf);
                            if (typeof headers === "number") {
                                bufferHeaders(headers - buf.length, buf);
                            } else {
                                self._pending++;
                                self._headers = headers;
                                self.emit("box", headers);
                            }
                        });
                    }
                };
                Decoder.prototype.stream = function() {
                    var self = this;
                    if (!self._headers) throw new Error("this function can only be called once after 'box' is emitted");
                    var headers = self._headers;
                    self._headers = null;
                    return self._stream(headers.contentLen, null);
                };
                Decoder.prototype.decode = function(cb) {
                    var self = this;
                    if (!self._headers) throw new Error("this function can only be called once after 'box' is emitted");
                    var headers = self._headers;
                    self._headers = null;
                    self._buffer(headers.contentLen, function(buf) {
                        var box = Box.decodeWithoutHeaders(headers, buf);
                        cb(box);
                        self._pending--;
                        self._kick();
                    });
                };
                Decoder.prototype.ignore = function() {
                    var self = this;
                    if (!self._headers) throw new Error("this function can only be called once after 'box' is emitted");
                    var headers = self._headers;
                    self._headers = null;
                    this._missing = headers.contentLen;
                    this._cb = function() {
                        self._pending--;
                        self._kick();
                    };
                };
                Decoder.prototype._kick = function() {
                    if (this._pending) return;
                    if (!this._buf && !this._str) this._readBox();
                    if (this._writeBuffer) {
                        var next = this._writeCb;
                        var buffer = this._writeBuffer;
                        this._writeBuffer = null;
                        this._writeCb = null;
                        this._write(buffer, null, next);
                    }
                };
                function MediaData(parent) {
                    this._parent = parent;
                    this.destroyed = false;
                    stream.PassThrough.call(this);
                }
                inherits(MediaData, stream.PassThrough);
                MediaData.prototype.destroy = function(err) {
                    if (this.destroyed) return;
                    this.destroyed = true;
                    this._parent.destroy(err);
                    if (err) this.emit("error", err);
                    this.emit("close");
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22,
            inherits: 71,
            "mp4-box-encoding": 109,
            "next-event": 114,
            "readable-stream": 99
        } ],
        112: [ function(require, module, exports) {
            (function(process, Buffer) {
                var stream = require("readable-stream");
                var inherits = require("inherits");
                var Box = require("mp4-box-encoding");
                module.exports = Encoder;
                function noop() {}
                function Encoder() {
                    if (!(this instanceof Encoder)) return new Encoder();
                    stream.Readable.call(this);
                    this.destroyed = false;
                    this._reading = false;
                    this._stream = null;
                    this._drain = null;
                    this._want = false;
                    this._onreadable = onreadable;
                    this._onend = onend;
                    var self = this;
                    function onreadable() {
                        if (!self._want) return;
                        self._want = false;
                        self._read();
                    }
                    function onend() {
                        self._stream = null;
                    }
                }
                inherits(Encoder, stream.Readable);
                Encoder.prototype.mediaData = Encoder.prototype.mdat = function(size, cb) {
                    var stream = new MediaData(this);
                    this.box({
                        type: "mdat",
                        contentLength: size,
                        encodeBufferLen: 8,
                        stream: stream
                    }, cb);
                    return stream;
                };
                Encoder.prototype.box = function(box, cb) {
                    if (!cb) cb = noop;
                    if (this.destroyed) return cb(new Error("Encoder is destroyed"));
                    var buf;
                    if (box.encodeBufferLen) {
                        buf = new Buffer(box.encodeBufferLen);
                    }
                    if (box.stream) {
                        box.buffer = null;
                        buf = Box.encode(box, buf);
                        this.push(buf);
                        this._stream = box.stream;
                        this._stream.on("readable", this._onreadable);
                        this._stream.on("end", this._onend);
                        this._stream.on("end", cb);
                        this._forward();
                    } else {
                        buf = Box.encode(box, buf);
                        var drained = this.push(buf);
                        if (drained) return process.nextTick(cb);
                        this._drain = cb;
                    }
                };
                Encoder.prototype.destroy = function(err) {
                    if (this.destroyed) return;
                    this.destroyed = true;
                    if (this._stream && this._stream.destroy) this._stream.destroy();
                    this._stream = null;
                    if (this._drain) {
                        var cb = this._drain;
                        this._drain = null;
                        cb(err);
                    }
                    if (err) this.emit("error", err);
                    this.emit("close");
                };
                Encoder.prototype.finalize = function() {
                    this.push(null);
                };
                Encoder.prototype._forward = function() {
                    if (!this._stream) return;
                    while (!this.destroyed) {
                        var buf = this._stream.read();
                        if (!buf) {
                            this._want = !!this._stream;
                            return;
                        }
                        if (!this.push(buf)) return;
                    }
                };
                Encoder.prototype._read = function() {
                    if (this._reading || this.destroyed) return;
                    this._reading = true;
                    if (this._stream) this._forward();
                    if (this._drain) {
                        var drain = this._drain;
                        this._drain = null;
                        drain();
                    }
                    this._reading = false;
                };
                function MediaData(parent) {
                    this._parent = parent;
                    this.destroyed = false;
                    stream.PassThrough.call(this);
                }
                inherits(MediaData, stream.PassThrough);
                MediaData.prototype.destroy = function(err) {
                    if (this.destroyed) return;
                    this.destroyed = true;
                    this._parent.destroy(err);
                    if (err) this.emit("error", err);
                    this.emit("close");
                };
            }).call(this, require("_process"), require("buffer").Buffer);
        }, {
            _process: 30,
            buffer: 22,
            inherits: 71,
            "mp4-box-encoding": 109,
            "readable-stream": 99
        } ],
        113: [ function(require, module, exports) {
            exports.decode = require("./decode");
            exports.encode = require("./encode");
        }, {
            "./decode": 111,
            "./encode": 112
        } ],
        114: [ function(require, module, exports) {
            module.exports = nextEvent;
            function nextEvent(emitter, name) {
                var next = null;
                emitter.on(name, function(data) {
                    if (!next) return;
                    var fn = next;
                    next = null;
                    fn(data);
                });
                return function(once) {
                    next = once;
                };
            }
        }, {} ],
        115: [ function(require, module, exports) {
            var inherits = require("inherits");
            var stream = require("readable-stream");
            module.exports = RangeSliceStream;
            inherits(RangeSliceStream, stream.Writable);
            function RangeSliceStream(offset) {
                var self = this;
                if (!(self instanceof RangeSliceStream)) return new RangeSliceStream(offset);
                stream.Writable.call(self);
                self.destroyed = false;
                self._queue = [];
                self._position = offset || 0;
                self._cb = null;
                self._buffer = null;
                self._out = null;
            }
            RangeSliceStream.prototype._write = function(chunk, encoding, cb) {
                var self = this;
                var drained = true;
                while (true) {
                    if (self.destroyed) {
                        return;
                    }
                    if (self._queue.length === 0) {
                        self._buffer = chunk;
                        self._cb = cb;
                        return;
                    }
                    self._buffer = null;
                    var currRange = self._queue[0];
                    var writeStart = Math.max(currRange.start - self._position, 0);
                    var writeEnd = currRange.end - self._position;
                    if (writeStart >= chunk.length) {
                        self._position += chunk.length;
                        return cb(null);
                    }
                    var toWrite;
                    if (writeEnd > chunk.length) {
                        self._position += chunk.length;
                        if (writeStart === 0) {
                            toWrite = chunk;
                        } else {
                            toWrite = chunk.slice(writeStart);
                        }
                        drained = currRange.stream.write(toWrite) && drained;
                        break;
                    }
                    self._position += writeEnd;
                    if (writeStart === 0 && writeEnd === chunk.length) {
                        toWrite = chunk;
                    } else {
                        toWrite = chunk.slice(writeStart, writeEnd);
                    }
                    drained = currRange.stream.write(toWrite) && drained;
                    if (currRange.last) {
                        currRange.stream.end();
                    }
                    chunk = chunk.slice(writeEnd);
                    self._queue.shift();
                }
                if (drained) {
                    cb(null);
                } else {
                    currRange.stream.once("drain", cb.bind(null, null));
                }
            };
            RangeSliceStream.prototype.slice = function(ranges) {
                var self = this;
                if (self.destroyed) return null;
                if (!(ranges instanceof Array)) {
                    ranges = [ ranges ];
                }
                var str = new stream.PassThrough();
                ranges.forEach(function(range, i) {
                    self._queue.push({
                        start: range.start,
                        end: range.end,
                        stream: str,
                        last: i === ranges.length - 1
                    });
                });
                if (self._buffer) {
                    self._write(self._buffer, null, self._cb);
                }
                return str;
            };
            RangeSliceStream.prototype.destroy = function(err) {
                var self = this;
                if (self.destroyed) return;
                self.destroyed = true;
                if (err) self.emit("error", err);
            };
        }, {
            inherits: 71,
            "readable-stream": 99
        } ],
        116: [ function(require, module, exports) {
            var MediaElementWrapper = require("mediasource");
            var pump = require("pump");
            var MP4Remuxer = require("./mp4-remuxer");
            module.exports = VideoStream;
            function VideoStream(file, mediaElem, opts) {
                var self = this;
                if (!(this instanceof VideoStream)) return new VideoStream(file, mediaElem, opts);
                opts = opts || {};
                self._elem = mediaElem;
                self._elemWrapper = new MediaElementWrapper(mediaElem);
                self._waitingFired = false;
                self._trackMeta = null;
                self._file = file;
                self._tracks = null;
                if (self._elem.preload !== "none") {
                    self._createMuxer();
                }
                self._onError = function(err) {
                    self.destroy();
                };
                self._onWaiting = function() {
                    self._waitingFired = true;
                    if (!self._muxer) {
                        self._createMuxer();
                    } else if (self._tracks) {
                        self._pump();
                    }
                };
                self._elem.addEventListener("waiting", self._onWaiting);
                self._elem.addEventListener("error", self._onError);
            }
            VideoStream.prototype._createMuxer = function() {
                var self = this;
                self._muxer = new MP4Remuxer(self._file);
                self._muxer.on("ready", function(data) {
                    self._tracks = data.map(function(trackData) {
                        var mediaSource = self._elemWrapper.createWriteStream(trackData.mime);
                        mediaSource.on("error", function(err) {
                            self._elemWrapper.error(err);
                        });
                        mediaSource.write(trackData.init);
                        return {
                            muxed: null,
                            mediaSource: mediaSource
                        };
                    });
                    if (self._waitingFired || self._elem.preload === "auto") {
                        self._pump();
                    }
                });
                self._muxer.on("error", function(err) {
                    self._elemWrapper.error(err);
                });
            };
            VideoStream.prototype._pump = function() {
                var self = this;
                var muxed = self._muxer.seek(self._elem.currentTime, !self._tracks);
                self._tracks.forEach(function(track, i) {
                    if (track.muxed) {
                        track.muxed.destroy();
                        track.mediaSource = self._elemWrapper.createWriteStream(track.mediaSource);
                        track.mediaSource.on("error", function(err) {
                            self._elemWrapper.error(err);
                        });
                    }
                    track.muxed = muxed[i];
                    pump(track.muxed, track.mediaSource);
                });
            };
            VideoStream.prototype.destroy = function() {
                var self = this;
                if (self.destroyed) {
                    return;
                }
                self.destroyed = true;
                self._elem.removeEventListener("waiting", self._onWaiting);
                self._elem.removeEventListener("error", self._onError);
                if (self._tracks) {
                    self._tracks.forEach(function(track) {
                        track.muxed.destroy();
                    });
                }
                self._elem.src = "";
            };
        }, {
            "./mp4-remuxer": 105,
            mediasource: 103,
            pump: 84
        } ],
        117: [ function(require, module, exports) {
            (function(process) {
                module.exports = function(tasks, limit, cb) {
                    if (typeof limit !== "number") throw new Error("second argument must be a Number");
                    var results, len, pending, keys, isErrored;
                    var isSync = true;
                    if (Array.isArray(tasks)) {
                        results = [];
                        pending = len = tasks.length;
                    } else {
                        keys = Object.keys(tasks);
                        results = {};
                        pending = len = keys.length;
                    }
                    function done(err) {
                        function end() {
                            if (cb) cb(err, results);
                            cb = null;
                        }
                        if (isSync) process.nextTick(end); else end();
                    }
                    function each(i, err, result) {
                        results[i] = result;
                        if (err) isErrored = true;
                        if (--pending === 0 || err) {
                            done(err);
                        } else if (!isErrored && next < len) {
                            var key;
                            if (keys) {
                                key = keys[next];
                                next += 1;
                                tasks[key](function(err, result) {
                                    each(key, err, result);
                                });
                            } else {
                                key = next;
                                next += 1;
                                tasks[key](function(err, result) {
                                    each(key, err, result);
                                });
                            }
                        }
                    }
                    var next = limit;
                    if (!pending) {
                        done(null);
                    } else if (keys) {
                        keys.some(function(key, i) {
                            tasks[key](function(err, result) {
                                each(key, err, result);
                            });
                            if (i === limit - 1) return true;
                        });
                    } else {
                        tasks.some(function(task, i) {
                            task(function(err, result) {
                                each(i, err, result);
                            });
                            if (i === limit - 1) return true;
                        });
                    }
                    isSync = false;
                };
            }).call(this, require("_process"));
        }, {
            _process: 30
        } ],
        118: [ function(require, module, exports) {
            (function(process) {
                module.exports = function(tasks, cb) {
                    var results, pending, keys;
                    var isSync = true;
                    if (Array.isArray(tasks)) {
                        results = [];
                        pending = tasks.length;
                    } else {
                        keys = Object.keys(tasks);
                        results = {};
                        pending = keys.length;
                    }
                    function done(err) {
                        function end() {
                            if (cb) cb(err, results);
                            cb = null;
                        }
                        if (isSync) process.nextTick(end); else end();
                    }
                    function each(i, err, result) {
                        results[i] = result;
                        if (--pending === 0 || err) {
                            done(err);
                        }
                    }
                    if (!pending) {
                        done(null);
                    } else if (keys) {
                        keys.forEach(function(key) {
                            tasks[key](function(err, result) {
                                each(key, err, result);
                            });
                        });
                    } else {
                        tasks.forEach(function(task, i) {
                            task(function(err, result) {
                                each(i, err, result);
                            });
                        });
                    }
                    isSync = false;
                };
            }).call(this, require("_process"));
        }, {
            _process: 30
        } ],
        119: [ function(require, module, exports) {
            module.exports = require("buffer");
        }, {
            buffer: 22
        } ],
        120: [ function(require, module, exports) {
            (function(Buffer) {
                module.exports = function(stream, cb) {
                    var chunks = [];
                    stream.on("data", function(chunk) {
                        chunks.push(chunk);
                    });
                    stream.once("end", function() {
                        if (cb) cb(null, Buffer.concat(chunks));
                        cb = null;
                    });
                    stream.once("error", function(err) {
                        if (cb) cb(err);
                        cb = null;
                    });
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        121: [ function(require, module, exports) {
            (function(Buffer) {
                module.exports = simpleGet;
                var extend = require("xtend");
                var http = require("http");
                var https = require("https");
                var once = require("once");
                var unzipResponse = require("unzip-response");
                var url = require("url");
                function simpleGet(opts, cb) {
                    opts = typeof opts === "string" ? {
                        url: opts
                    } : extend(opts);
                    cb = once(cb);
                    if (opts.url) parseOptsUrl(opts);
                    if (opts.headers == null) opts.headers = {};
                    if (opts.maxRedirects == null) opts.maxRedirects = 10;
                    var body = opts.json ? JSON.stringify(opts.body) : opts.body;
                    opts.body = undefined;
                    if (body && !opts.method) opts.method = "POST";
                    if (opts.json) opts.headers.accept = "application/json";
                    if (opts.json && body) opts.headers["content-type"] = "application/json";
                    var customAcceptEncoding = Object.keys(opts.headers).some(function(h) {
                        return h.toLowerCase() === "accept-encoding";
                    });
                    if (!customAcceptEncoding) opts.headers["accept-encoding"] = "gzip, deflate";
                    var protocol = opts.protocol === "https:" ? https : http;
                    var req = protocol.request(opts, function(res) {
                        if (res.statusCode >= 300 && res.statusCode < 400 && "location" in res.headers) {
                            opts.url = res.headers.location;
                            parseOptsUrl(opts);
                            res.resume();
                            opts.maxRedirects -= 1;
                            if (opts.maxRedirects > 0) simpleGet(opts, cb); else cb(new Error("too many redirects"));
                            return;
                        }
                        cb(null, typeof unzipResponse === "function" ? unzipResponse(res) : res);
                    });
                    req.on("error", cb);
                    req.end(body);
                    return req;
                }
                module.exports.concat = function(opts, cb) {
                    return simpleGet(opts, function(err, res) {
                        if (err) return cb(err);
                        var chunks = [];
                        res.on("data", function(chunk) {
                            chunks.push(chunk);
                        });
                        res.on("end", function() {
                            var data = Buffer.concat(chunks);
                            if (opts.json) {
                                try {
                                    data = JSON.parse(data.toString());
                                } catch (err) {
                                    return cb(err, res, data);
                                }
                            }
                            cb(null, res, data);
                        });
                    });
                };
                [ "get", "post", "put", "patch", "head", "delete" ].forEach(function(method) {
                    module.exports[method] = function(opts, cb) {
                        if (typeof opts === "string") opts = {
                            url: opts
                        };
                        opts.method = method.toUpperCase();
                        return simpleGet(opts, cb);
                    };
                });
                function parseOptsUrl(opts) {
                    var loc = url.parse(opts.url);
                    if (loc.hostname) opts.hostname = loc.hostname;
                    if (loc.port) opts.port = loc.port;
                    if (loc.protocol) opts.protocol = loc.protocol;
                    if (loc.auth) opts.auth = loc.auth;
                    opts.path = loc.path;
                    delete opts.url;
                }
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22,
            http: 35,
            https: 27,
            once: 123,
            "unzip-response": 21,
            url: 41,
            xtend: 146
        } ],
        122: [ function(require, module, exports) {
            arguments[4][17][0].apply(exports, arguments);
        }, {
            dup: 17
        } ],
        123: [ function(require, module, exports) {
            arguments[4][18][0].apply(exports, arguments);
        }, {
            dup: 18,
            wrappy: 122
        } ],
        124: [ function(require, module, exports) {
            (function(Buffer) {
                module.exports = Peer;
                var debug = require("debug")("simple-peer");
                var getBrowserRTC = require("get-browser-rtc");
                var hat = require("hat");
                var inherits = require("inherits");
                var once = require("once");
                var stream = require("readable-stream");
                inherits(Peer, stream.Duplex);
                function Peer(opts) {
                    var self = this;
                    if (!(self instanceof Peer)) return new Peer(opts);
                    self._debug("new peer %o", opts);
                    if (!opts) opts = {};
                    opts.allowHalfOpen = false;
                    if (opts.highWaterMark == null) opts.highWaterMark = 1024 * 1024;
                    stream.Duplex.call(self, opts);
                    self.initiator = opts.initiator || false;
                    self.channelConfig = opts.channelConfig || Peer.channelConfig;
                    self.channelName = opts.initiator ? opts.channelName || hat(160) : null;
                    self.config = opts.config || Peer.config;
                    self.constraints = opts.constraints || Peer.constraints;
                    self.offerConstraints = opts.offerConstraints;
                    self.answerConstraints = opts.answerConstraints;
                    self.reconnectTimer = opts.reconnectTimer || false;
                    self.sdpTransform = opts.sdpTransform || function(sdp) {
                        return sdp;
                    };
                    self.stream = opts.stream || false;
                    self.trickle = opts.trickle !== undefined ? opts.trickle : true;
                    self.destroyed = false;
                    self.connected = false;
                    self.remoteAddress = undefined;
                    self.remoteFamily = undefined;
                    self.remotePort = undefined;
                    self.localAddress = undefined;
                    self.localPort = undefined;
                    self._isWrtc = !!opts.wrtc;
                    self._wrtc = opts.wrtc && typeof opts.wrtc === "object" ? opts.wrtc : getBrowserRTC();
                    if (!self._wrtc) {
                        if (typeof window === "undefined") {
                            throw new Error("No WebRTC support: Specify `opts.wrtc` option in this environment");
                        } else {
                            throw new Error("No WebRTC support: Not a supported browser");
                        }
                    }
                    self._maxBufferedAmount = opts.highWaterMark;
                    self._pcReady = false;
                    self._channelReady = false;
                    self._iceComplete = false;
                    self._channel = null;
                    self._pendingCandidates = [];
                    self._chunk = null;
                    self._cb = null;
                    self._interval = null;
                    self._reconnectTimeout = null;
                    self._pc = new self._wrtc.RTCPeerConnection(self.config, self.constraints);
                    self._pc.oniceconnectionstatechange = function() {
                        self._onIceConnectionStateChange();
                    };
                    self._pc.onsignalingstatechange = function() {
                        self._onSignalingStateChange();
                    };
                    self._pc.onicecandidate = function(event) {
                        self._onIceCandidate(event);
                    };
                    if (self.stream) self._pc.addStream(self.stream);
                    self._pc.onaddstream = function(event) {
                        self._onAddStream(event);
                    };
                    if (self.initiator) {
                        self._setupData({
                            channel: self._pc.createDataChannel(self.channelName, self.channelConfig)
                        });
                        self._pc.onnegotiationneeded = once(function() {
                            self._createOffer();
                        });
                        if (typeof window === "undefined" || !window.webkitRTCPeerConnection) {
                            self._pc.onnegotiationneeded();
                        }
                    } else {
                        self._pc.ondatachannel = function(event) {
                            self._setupData(event);
                        };
                    }
                    self.on("finish", function() {
                        if (self.connected) {
                            setTimeout(function() {
                                self._destroy();
                            }, 100);
                        } else {
                            self.once("connect", function() {
                                setTimeout(function() {
                                    self._destroy();
                                }, 100);
                            });
                        }
                    });
                }
                Peer.WEBRTC_SUPPORT = !!getBrowserRTC();
                Peer.config = {
                    iceServers: [ {
                        url: "stun:23.21.150.121",
                        urls: "stun:23.21.150.121"
                    } ]
                };
                Peer.constraints = {};
                Peer.channelConfig = {};
                Object.defineProperty(Peer.prototype, "bufferSize", {
                    get: function() {
                        var self = this;
                        return self._channel && self._channel.bufferedAmount || 0;
                    }
                });
                Peer.prototype.address = function() {
                    var self = this;
                    return {
                        port: self.localPort,
                        family: "IPv4",
                        address: self.localAddress
                    };
                };
                Peer.prototype.signal = function(data) {
                    var self = this;
                    if (self.destroyed) throw new Error("cannot signal after peer is destroyed");
                    if (typeof data === "string") {
                        try {
                            data = JSON.parse(data);
                        } catch (err) {
                            data = {};
                        }
                    }
                    self._debug("signal()");
                    function addIceCandidate(candidate) {
                        try {
                            self._pc.addIceCandidate(new self._wrtc.RTCIceCandidate(candidate), noop, function(err) {
                                self._onError(err);
                            });
                        } catch (err) {
                            self._destroy(new Error("error adding candidate: " + err.message));
                        }
                    }
                    if (data.sdp) {
                        self._pc.setRemoteDescription(new self._wrtc.RTCSessionDescription(data), function() {
                            if (self.destroyed) return;
                            if (self._pc.remoteDescription.type === "offer") self._createAnswer();
                            self._pendingCandidates.forEach(addIceCandidate);
                            self._pendingCandidates = [];
                        }, function(err) {
                            self._onError(err);
                        });
                    }
                    if (data.candidate) {
                        if (self._pc.remoteDescription) addIceCandidate(data.candidate); else self._pendingCandidates.push(data.candidate);
                    }
                    if (!data.sdp && !data.candidate) {
                        self._destroy(new Error("signal() called with invalid signal data"));
                    }
                };
                Peer.prototype.send = function(chunk) {
                    var self = this;
                    if (Buffer.isBuffer(chunk) && self._isWrtc) {
                        chunk = new Uint8Array(chunk);
                    }
                    var len = chunk.length || chunk.byteLength || chunk.size;
                    self._channel.send(chunk);
                    self._debug("write: %d bytes", len);
                };
                Peer.prototype.destroy = function(onclose) {
                    var self = this;
                    self._destroy(null, onclose);
                };
                Peer.prototype._destroy = function(err, onclose) {
                    var self = this;
                    if (self.destroyed) return;
                    if (onclose) self.once("close", onclose);
                    self._debug("destroy (error: %s)", err && err.message);
                    self.readable = self.writable = false;
                    if (!self._readableState.ended) self.push(null);
                    if (!self._writableState.finished) self.end();
                    self.destroyed = true;
                    self.connected = false;
                    self._pcReady = false;
                    self._channelReady = false;
                    self._chunk = null;
                    self._cb = null;
                    clearInterval(self._interval);
                    clearTimeout(self._reconnectTimeout);
                    if (self._pc) {
                        try {
                            self._pc.close();
                        } catch (err) {}
                        self._pc.oniceconnectionstatechange = null;
                        self._pc.onsignalingstatechange = null;
                        self._pc.onicecandidate = null;
                        self._pc.onaddstream = null;
                        self._pc.onnegotiationneeded = null;
                        self._pc.ondatachannel = null;
                    }
                    if (self._channel) {
                        try {
                            self._channel.close();
                        } catch (err) {}
                        self._channel.onmessage = null;
                        self._channel.onopen = null;
                        self._channel.onclose = null;
                    }
                    self._pc = null;
                    self._channel = null;
                    if (err) self.emit("error", err);
                    self.emit("close");
                };
                Peer.prototype._setupData = function(event) {
                    var self = this;
                    self._channel = event.channel;
                    self.channelName = self._channel.label;
                    self._channel.binaryType = "arraybuffer";
                    self._channel.onmessage = function(event) {
                        self._onChannelMessage(event);
                    };
                    self._channel.onopen = function() {
                        self._onChannelOpen();
                    };
                    self._channel.onclose = function() {
                        self._onChannelClose();
                    };
                };
                Peer.prototype._read = function() {};
                Peer.prototype._write = function(chunk, encoding, cb) {
                    var self = this;
                    if (self.destroyed) return cb(new Error("cannot write after peer is destroyed"));
                    if (self.connected) {
                        try {
                            self.send(chunk);
                        } catch (err) {
                            return self._onError(err);
                        }
                        if (self._channel.bufferedAmount > self._maxBufferedAmount) {
                            self._debug("start backpressure: bufferedAmount %d", self._channel.bufferedAmount);
                            self._cb = cb;
                        } else {
                            cb(null);
                        }
                    } else {
                        self._debug("write before connect");
                        self._chunk = chunk;
                        self._cb = cb;
                    }
                };
                Peer.prototype._createOffer = function() {
                    var self = this;
                    if (self.destroyed) return;
                    self._pc.createOffer(function(offer) {
                        if (self.destroyed) return;
                        offer.sdp = self.sdpTransform(offer.sdp);
                        self._pc.setLocalDescription(offer, noop, function(err) {
                            self._onError(err);
                        });
                        var sendOffer = function() {
                            var signal = self._pc.localDescription || offer;
                            self._debug("signal");
                            self.emit("signal", {
                                type: signal.type,
                                sdp: signal.sdp
                            });
                        };
                        if (self.trickle || self._iceComplete) sendOffer(); else self.once("_iceComplete", sendOffer);
                    }, function(err) {
                        self._onError(err);
                    }, self.offerConstraints);
                };
                Peer.prototype._createAnswer = function() {
                    var self = this;
                    if (self.destroyed) return;
                    self._pc.createAnswer(function(answer) {
                        if (self.destroyed) return;
                        answer.sdp = self.sdpTransform(answer.sdp);
                        self._pc.setLocalDescription(answer, noop, function(err) {
                            self._onError(err);
                        });
                        var sendAnswer = function() {
                            var signal = self._pc.localDescription || answer;
                            self._debug("signal");
                            self.emit("signal", {
                                type: signal.type,
                                sdp: signal.sdp
                            });
                        };
                        if (self.trickle || self._iceComplete) sendAnswer(); else self.once("_iceComplete", sendAnswer);
                    }, function(err) {
                        self._onError(err);
                    }, self.answerConstraints);
                };
                Peer.prototype._onIceConnectionStateChange = function() {
                    var self = this;
                    if (self.destroyed) return;
                    var iceGatheringState = self._pc.iceGatheringState;
                    var iceConnectionState = self._pc.iceConnectionState;
                    self._debug("iceConnectionStateChange %s %s", iceGatheringState, iceConnectionState);
                    self.emit("iceConnectionStateChange", iceGatheringState, iceConnectionState);
                    if (iceConnectionState === "connected" || iceConnectionState === "completed") {
                        clearTimeout(self._reconnectTimeout);
                        self._pcReady = true;
                        self._maybeReady();
                    }
                    if (iceConnectionState === "disconnected") {
                        if (self.reconnectTimer) {
                            clearTimeout(self._reconnectTimeout);
                            self._reconnectTimeout = setTimeout(function() {
                                self._destroy();
                            }, self.reconnectTimer);
                        } else {
                            self._destroy();
                        }
                    }
                    if (iceConnectionState === "failed") {
                        self._destroy();
                    }
                    if (iceConnectionState === "closed") {
                        self._destroy();
                    }
                };
                Peer.prototype.getStats = function(cb) {
                    var self = this;
                    if (!self._pc.getStats) {
                        cb([]);
                    } else if (typeof window !== "undefined" && !!window.mozRTCPeerConnection) {
                        self._pc.getStats(null, function(res) {
                            var items = [];
                            res.forEach(function(item) {
                                items.push(item);
                            });
                            cb(items);
                        }, function(err) {
                            self._onError(err);
                        });
                    } else {
                        self._pc.getStats(function(res) {
                            var items = [];
                            res.result().forEach(function(result) {
                                var item = {};
                                result.names().forEach(function(name) {
                                    item[name] = result.stat(name);
                                });
                                item.id = result.id;
                                item.type = result.type;
                                item.timestamp = result.timestamp;
                                items.push(item);
                            });
                            cb(items);
                        });
                    }
                };
                Peer.prototype._maybeReady = function() {
                    var self = this;
                    self._debug("maybeReady pc %s channel %s", self._pcReady, self._channelReady);
                    if (self.connected || self._connecting || !self._pcReady || !self._channelReady) return;
                    self._connecting = true;
                    self.getStats(function(items) {
                        self._connecting = false;
                        self.connected = true;
                        var remoteCandidates = {};
                        var localCandidates = {};
                        function setActiveCandidates(item) {
                            var local = localCandidates[item.localCandidateId];
                            var remote = remoteCandidates[item.remoteCandidateId];
                            if (local) {
                                self.localAddress = local.ipAddress;
                                self.localPort = Number(local.portNumber);
                            } else if (typeof item.googLocalAddress === "string") {
                                local = item.googLocalAddress.split(":");
                                self.localAddress = local[0];
                                self.localPort = Number(local[1]);
                            }
                            self._debug("connect local: %s:%s", self.localAddress, self.localPort);
                            if (remote) {
                                self.remoteAddress = remote.ipAddress;
                                self.remotePort = Number(remote.portNumber);
                                self.remoteFamily = "IPv4";
                            } else if (typeof item.googRemoteAddress === "string") {
                                remote = item.googRemoteAddress.split(":");
                                self.remoteAddress = remote[0];
                                self.remotePort = Number(remote[1]);
                                self.remoteFamily = "IPv4";
                            }
                            self._debug("connect remote: %s:%s", self.remoteAddress, self.remotePort);
                        }
                        items.forEach(function(item) {
                            if (item.type === "remotecandidate") remoteCandidates[item.id] = item;
                            if (item.type === "localcandidate") localCandidates[item.id] = item;
                        });
                        items.forEach(function(item) {
                            var isCandidatePair = item.type === "googCandidatePair" && item.googActiveConnection === "true" || item.type === "candidatepair" && item.selected;
                            if (isCandidatePair) setActiveCandidates(item);
                        });
                        if (self._chunk) {
                            try {
                                self.send(self._chunk);
                            } catch (err) {
                                return self._onError(err);
                            }
                            self._chunk = null;
                            self._debug('sent chunk from "write before connect"');
                            var cb = self._cb;
                            self._cb = null;
                            cb(null);
                        }
                        self._interval = setInterval(function() {
                            if (!self._cb || !self._channel || self._channel.bufferedAmount > self._maxBufferedAmount) return;
                            self._debug("ending backpressure: bufferedAmount %d", self._channel.bufferedAmount);
                            var cb = self._cb;
                            self._cb = null;
                            cb(null);
                        }, 150);
                        if (self._interval.unref) self._interval.unref();
                        self._debug("connect");
                        self.emit("connect");
                    });
                };
                Peer.prototype._onSignalingStateChange = function() {
                    var self = this;
                    if (self.destroyed) return;
                    self._debug("signalingStateChange %s", self._pc.signalingState);
                    self.emit("signalingStateChange", self._pc.signalingState);
                };
                Peer.prototype._onIceCandidate = function(event) {
                    var self = this;
                    if (self.destroyed) return;
                    if (event.candidate && self.trickle) {
                        self.emit("signal", {
                            candidate: {
                                candidate: event.candidate.candidate,
                                sdpMLineIndex: event.candidate.sdpMLineIndex,
                                sdpMid: event.candidate.sdpMid
                            }
                        });
                    } else if (!event.candidate) {
                        self._iceComplete = true;
                        self.emit("_iceComplete");
                    }
                };
                Peer.prototype._onChannelMessage = function(event) {
                    var self = this;
                    if (self.destroyed) return;
                    var data = event.data;
                    self._debug("read: %d bytes", data.byteLength || data.length);
                    if (data instanceof ArrayBuffer) data = new Buffer(data);
                    self.push(data);
                };
                Peer.prototype._onChannelOpen = function() {
                    var self = this;
                    if (self.connected || self.destroyed) return;
                    self._debug("on channel open");
                    self._channelReady = true;
                    self._maybeReady();
                };
                Peer.prototype._onChannelClose = function() {
                    var self = this;
                    if (self.destroyed) return;
                    self._debug("on channel close");
                    self._destroy();
                };
                Peer.prototype._onAddStream = function(event) {
                    var self = this;
                    if (self.destroyed) return;
                    self._debug("on add stream");
                    self.emit("stream", event.stream);
                };
                Peer.prototype._onError = function(err) {
                    var self = this;
                    if (self.destroyed) return;
                    self._debug("error %s", err.message || err);
                    self._destroy(err);
                };
                Peer.prototype._debug = function() {
                    var self = this;
                    var args = [].slice.call(arguments);
                    var id = self.channelName && self.channelName.substring(0, 7);
                    args[0] = "[" + id + "] " + args[0];
                    debug.apply(null, args);
                };
                function noop() {}
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22,
            debug: 63,
            "get-browser-rtc": 125,
            hat: 69,
            inherits: 71,
            once: 127,
            "readable-stream": 99
        } ],
        125: [ function(require, module, exports) {
            module.exports = function getBrowserRTC() {
                if (typeof window === "undefined") return null;
                var wrtc = {
                    RTCPeerConnection: window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection,
                    RTCSessionDescription: window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription,
                    RTCIceCandidate: window.RTCIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate
                };
                if (!wrtc.RTCPeerConnection) return null;
                return wrtc;
            };
        }, {} ],
        126: [ function(require, module, exports) {
            arguments[4][17][0].apply(exports, arguments);
        }, {
            dup: 17
        } ],
        127: [ function(require, module, exports) {
            arguments[4][18][0].apply(exports, arguments);
        }, {
            dup: 18,
            wrappy: 126
        } ],
        128: [ function(require, module, exports) {
            var Rusha = require("rusha");
            var rusha = new Rusha();
            var crypto = window.crypto || window.msCrypto || {};
            var subtle = crypto.subtle || crypto.webkitSubtle;
            function sha1sync(buf) {
                return rusha.digest(buf);
            }
            try {
                subtle.digest({
                    name: "sha-1"
                }, new Uint8Array()).catch(function() {
                    subtle = false;
                });
            } catch (err) {
                subtle = false;
            }
            function sha1(buf, cb) {
                if (!subtle) {
                    setTimeout(cb, 0, sha1sync(buf));
                    return;
                }
                if (typeof buf === "string") {
                    buf = uint8array(buf);
                }
                subtle.digest({
                    name: "sha-1"
                }, buf).then(function succeed(result) {
                    cb(hex(new Uint8Array(result)));
                }, function fail(error) {
                    cb(sha1sync(buf));
                });
            }
            function uint8array(s) {
                var l = s.length;
                var array = new Uint8Array(l);
                for (var i = 0; i < l; i++) {
                    array[i] = s.charCodeAt(i);
                }
                return array;
            }
            function hex(buf) {
                var l = buf.length;
                var chars = [];
                for (var i = 0; i < l; i++) {
                    var bite = buf[i];
                    chars.push((bite >>> 4).toString(16));
                    chars.push((bite & 15).toString(16));
                }
                return chars.join("");
            }
            module.exports = sha1;
            module.exports.sync = sha1sync;
        }, {
            rusha: 129
        } ],
        129: [ function(require, module, exports) {
            (function(global) {
                (function() {
                    var util = {
                        getDataType: function(data) {
                            if (typeof data === "string") {
                                return "string";
                            }
                            if (data instanceof Array) {
                                return "array";
                            }
                            if (typeof global !== "undefined" && global.Buffer && global.Buffer.isBuffer(data)) {
                                return "buffer";
                            }
                            if (data instanceof ArrayBuffer) {
                                return "arraybuffer";
                            }
                            if (data.buffer instanceof ArrayBuffer) {
                                return "view";
                            }
                            if (data instanceof Blob) {
                                return "blob";
                            }
                            throw new Error("Unsupported data type.");
                        }
                    };
                    function Rusha(chunkSize) {
                        "use strict";
                        var self$2 = {
                            fill: 0
                        };
                        var padlen = function(len) {
                            for (len += 9; len % 64 > 0; len += 1) ;
                            return len;
                        };
                        var padZeroes = function(bin, len) {
                            for (var i = len >> 2; i < bin.length; i++) bin[i] = 0;
                        };
                        var padData = function(bin, chunkLen, msgLen) {
                            bin[chunkLen >> 2] |= 128 << 24 - (chunkLen % 4 << 3);
                            bin[((chunkLen >> 2) + 2 & ~15) + 14] = msgLen >> 29;
                            bin[((chunkLen >> 2) + 2 & ~15) + 15] = msgLen << 3;
                        };
                        var convStr = function(H8, H32, start, len, off) {
                            var str = this, i, om = off % 4, lm = len % 4, j = len - lm;
                            if (j > 0) {
                                switch (om) {
                                  case 0:
                                    H8[off + 3 | 0] = str.charCodeAt(start);

                                  case 1:
                                    H8[off + 2 | 0] = str.charCodeAt(start + 1);

                                  case 2:
                                    H8[off + 1 | 0] = str.charCodeAt(start + 2);

                                  case 3:
                                    H8[off | 0] = str.charCodeAt(start + 3);
                                }
                            }
                            for (i = om; i < j; i = i + 4 | 0) {
                                H32[off + i >> 2] = str.charCodeAt(start + i) << 24 | str.charCodeAt(start + i + 1) << 16 | str.charCodeAt(start + i + 2) << 8 | str.charCodeAt(start + i + 3);
                            }
                            switch (lm) {
                              case 3:
                                H8[off + j + 1 | 0] = str.charCodeAt(start + j + 2);

                              case 2:
                                H8[off + j + 2 | 0] = str.charCodeAt(start + j + 1);

                              case 1:
                                H8[off + j + 3 | 0] = str.charCodeAt(start + j);
                            }
                        };
                        var convBuf = function(H8, H32, start, len, off) {
                            var buf = this, i, om = off % 4, lm = len % 4, j = len - lm;
                            if (j > 0) {
                                switch (om) {
                                  case 0:
                                    H8[off + 3 | 0] = buf[start];

                                  case 1:
                                    H8[off + 2 | 0] = buf[start + 1];

                                  case 2:
                                    H8[off + 1 | 0] = buf[start + 2];

                                  case 3:
                                    H8[off | 0] = buf[start + 3];
                                }
                            }
                            for (i = 4 - om; i < j; i = i += 4 | 0) {
                                H32[off + i >> 2] = buf[start + i] << 24 | buf[start + i + 1] << 16 | buf[start + i + 2] << 8 | buf[start + i + 3];
                            }
                            switch (lm) {
                              case 3:
                                H8[off + j + 1 | 0] = buf[start + j + 2];

                              case 2:
                                H8[off + j + 2 | 0] = buf[start + j + 1];

                              case 1:
                                H8[off + j + 3 | 0] = buf[start + j];
                            }
                        };
                        var convBlob = function(H8, H32, start, len, off) {
                            var blob = this, i, om = off % 4, lm = len % 4, j = len - lm;
                            var buf = new Uint8Array(reader.readAsArrayBuffer(blob.slice(start, start + len)));
                            if (j > 0) {
                                switch (om) {
                                  case 0:
                                    H8[off + 3 | 0] = buf[0];

                                  case 1:
                                    H8[off + 2 | 0] = buf[1];

                                  case 2:
                                    H8[off + 1 | 0] = buf[2];

                                  case 3:
                                    H8[off | 0] = buf[3];
                                }
                            }
                            for (i = 4 - om; i < j; i = i += 4 | 0) {
                                H32[off + i >> 2] = buf[i] << 24 | buf[i + 1] << 16 | buf[i + 2] << 8 | buf[i + 3];
                            }
                            switch (lm) {
                              case 3:
                                H8[off + j + 1 | 0] = buf[j + 2];

                              case 2:
                                H8[off + j + 2 | 0] = buf[j + 1];

                              case 1:
                                H8[off + j + 3 | 0] = buf[j];
                            }
                        };
                        var convFn = function(data) {
                            switch (util.getDataType(data)) {
                              case "string":
                                return convStr.bind(data);

                              case "array":
                                return convBuf.bind(data);

                              case "buffer":
                                return convBuf.bind(data);

                              case "arraybuffer":
                                return convBuf.bind(new Uint8Array(data));

                              case "view":
                                return convBuf.bind(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

                              case "blob":
                                return convBlob.bind(data);
                            }
                        };
                        var slice = function(data, offset) {
                            switch (util.getDataType(data)) {
                              case "string":
                                return data.slice(offset);

                              case "array":
                                return data.slice(offset);

                              case "buffer":
                                return data.slice(offset);

                              case "arraybuffer":
                                return data.slice(offset);

                              case "view":
                                return data.buffer.slice(offset);
                            }
                        };
                        var hex = function(arrayBuffer) {
                            var i, x, hex_tab = "0123456789abcdef", res = [], binarray = new Uint8Array(arrayBuffer);
                            for (i = 0; i < binarray.length; i++) {
                                x = binarray[i];
                                res[i] = hex_tab.charAt(x >> 4 & 15) + hex_tab.charAt(x >> 0 & 15);
                            }
                            return res.join("");
                        };
                        var ceilHeapSize = function(v) {
                            var p;
                            if (v <= 65536) return 65536;
                            if (v < 16777216) {
                                for (p = 1; p < v; p = p << 1) ;
                            } else {
                                for (p = 16777216; p < v; p += 16777216) ;
                            }
                            return p;
                        };
                        var init = function(size) {
                            if (size % 64 > 0) {
                                throw new Error("Chunk size must be a multiple of 128 bit");
                            }
                            self$2.maxChunkLen = size;
                            self$2.padMaxChunkLen = padlen(size);
                            self$2.heap = new ArrayBuffer(ceilHeapSize(self$2.padMaxChunkLen + 320 + 20));
                            self$2.h32 = new Int32Array(self$2.heap);
                            self$2.h8 = new Int8Array(self$2.heap);
                            self$2.core = new Rusha._core({
                                Int32Array: Int32Array,
                                DataView: DataView
                            }, {}, self$2.heap);
                            self$2.buffer = null;
                        };
                        init(chunkSize || 64 * 1024);
                        var initState = function(heap, padMsgLen) {
                            var io = new Int32Array(heap, padMsgLen + 320, 5);
                            io[0] = 1732584193;
                            io[1] = -271733879;
                            io[2] = -1732584194;
                            io[3] = 271733878;
                            io[4] = -1009589776;
                        };
                        var padChunk = function(chunkLen, msgLen) {
                            var padChunkLen = padlen(chunkLen);
                            var view = new Int32Array(self$2.heap, 0, padChunkLen >> 2);
                            padZeroes(view, chunkLen);
                            padData(view, chunkLen, msgLen);
                            return padChunkLen;
                        };
                        var write = function(data, chunkOffset, chunkLen) {
                            convFn(data)(self$2.h8, self$2.h32, chunkOffset, chunkLen, 0);
                        };
                        var coreCall = function(data, chunkOffset, chunkLen, msgLen, finalize) {
                            var padChunkLen = chunkLen;
                            if (finalize) {
                                padChunkLen = padChunk(chunkLen, msgLen);
                            }
                            write(data, chunkOffset, chunkLen);
                            self$2.core.hash(padChunkLen, self$2.padMaxChunkLen);
                        };
                        var getRawDigest = function(heap, padMaxChunkLen) {
                            var io = new Int32Array(heap, padMaxChunkLen + 320, 5);
                            var out = new Int32Array(5);
                            var arr = new DataView(out.buffer);
                            arr.setInt32(0, io[0], false);
                            arr.setInt32(4, io[1], false);
                            arr.setInt32(8, io[2], false);
                            arr.setInt32(12, io[3], false);
                            arr.setInt32(16, io[4], false);
                            return out;
                        };
                        var rawDigest = this.rawDigest = function(str) {
                            var msgLen = str.byteLength || str.length || str.size || 0;
                            initState(self$2.heap, self$2.padMaxChunkLen);
                            var chunkOffset = 0, chunkLen = self$2.maxChunkLen, last;
                            for (chunkOffset = 0; msgLen > chunkOffset + chunkLen; chunkOffset += chunkLen) {
                                coreCall(str, chunkOffset, chunkLen, msgLen, false);
                            }
                            coreCall(str, chunkOffset, msgLen - chunkOffset, msgLen, true);
                            return getRawDigest(self$2.heap, self$2.padMaxChunkLen);
                        };
                        this.digest = this.digestFromString = this.digestFromBuffer = this.digestFromArrayBuffer = function(str) {
                            return hex(rawDigest(str).buffer);
                        };
                    }
                    Rusha._core = function RushaCore(stdlib, foreign, heap) {
                        "use asm";
                        var H = new stdlib.Int32Array(heap);
                        function hash(k, x) {
                            k = k | 0;
                            x = x | 0;
                            var i = 0, j = 0, y0 = 0, z0 = 0, y1 = 0, z1 = 0, y2 = 0, z2 = 0, y3 = 0, z3 = 0, y4 = 0, z4 = 0, t0 = 0, t1 = 0;
                            y0 = H[x + 320 >> 2] | 0;
                            y1 = H[x + 324 >> 2] | 0;
                            y2 = H[x + 328 >> 2] | 0;
                            y3 = H[x + 332 >> 2] | 0;
                            y4 = H[x + 336 >> 2] | 0;
                            for (i = 0; (i | 0) < (k | 0); i = i + 64 | 0) {
                                z0 = y0;
                                z1 = y1;
                                z2 = y2;
                                z3 = y3;
                                z4 = y4;
                                for (j = 0; (j | 0) < 64; j = j + 4 | 0) {
                                    t1 = H[i + j >> 2] | 0;
                                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 & y2 | ~y1 & y3) | 0) + ((t1 + y4 | 0) + 1518500249 | 0) | 0;
                                    y4 = y3;
                                    y3 = y2;
                                    y2 = y1 << 30 | y1 >>> 2;
                                    y1 = y0;
                                    y0 = t0;
                                    H[k + j >> 2] = t1;
                                }
                                for (j = k + 64 | 0; (j | 0) < (k + 80 | 0); j = j + 4 | 0) {
                                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 & y2 | ~y1 & y3) | 0) + ((t1 + y4 | 0) + 1518500249 | 0) | 0;
                                    y4 = y3;
                                    y3 = y2;
                                    y2 = y1 << 30 | y1 >>> 2;
                                    y1 = y0;
                                    y0 = t0;
                                    H[j >> 2] = t1;
                                }
                                for (j = k + 80 | 0; (j | 0) < (k + 160 | 0); j = j + 4 | 0) {
                                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 ^ y2 ^ y3) | 0) + ((t1 + y4 | 0) + 1859775393 | 0) | 0;
                                    y4 = y3;
                                    y3 = y2;
                                    y2 = y1 << 30 | y1 >>> 2;
                                    y1 = y0;
                                    y0 = t0;
                                    H[j >> 2] = t1;
                                }
                                for (j = k + 160 | 0; (j | 0) < (k + 240 | 0); j = j + 4 | 0) {
                                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 & y2 | y1 & y3 | y2 & y3) | 0) + ((t1 + y4 | 0) - 1894007588 | 0) | 0;
                                    y4 = y3;
                                    y3 = y2;
                                    y2 = y1 << 30 | y1 >>> 2;
                                    y1 = y0;
                                    y0 = t0;
                                    H[j >> 2] = t1;
                                }
                                for (j = k + 240 | 0; (j | 0) < (k + 320 | 0); j = j + 4 | 0) {
                                    t1 = (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) << 1 | (H[j - 12 >> 2] ^ H[j - 32 >> 2] ^ H[j - 56 >> 2] ^ H[j - 64 >> 2]) >>> 31;
                                    t0 = ((y0 << 5 | y0 >>> 27) + (y1 ^ y2 ^ y3) | 0) + ((t1 + y4 | 0) - 899497514 | 0) | 0;
                                    y4 = y3;
                                    y3 = y2;
                                    y2 = y1 << 30 | y1 >>> 2;
                                    y1 = y0;
                                    y0 = t0;
                                    H[j >> 2] = t1;
                                }
                                y0 = y0 + z0 | 0;
                                y1 = y1 + z1 | 0;
                                y2 = y2 + z2 | 0;
                                y3 = y3 + z3 | 0;
                                y4 = y4 + z4 | 0;
                            }
                            H[x + 320 >> 2] = y0;
                            H[x + 324 >> 2] = y1;
                            H[x + 328 >> 2] = y2;
                            H[x + 332 >> 2] = y3;
                            H[x + 336 >> 2] = y4;
                        }
                        return {
                            hash: hash
                        };
                    };
                    if (typeof module !== "undefined") {
                        module.exports = Rusha;
                    } else if (typeof window !== "undefined") {
                        window.Rusha = Rusha;
                    }
                    if (typeof FileReaderSync !== "undefined") {
                        var reader = new FileReaderSync(), hasher = new Rusha(4 * 1024 * 1024);
                        self.onmessage = function onMessage(event) {
                            var hash, data = event.data.data;
                            try {
                                hash = hasher.digest(data);
                                self.postMessage({
                                    id: event.data.id,
                                    hash: hash
                                });
                            } catch (e) {
                                self.postMessage({
                                    id: event.data.id,
                                    error: e.name
                                });
                            }
                        };
                    }
                })();
            }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {} ],
        130: [ function(require, module, exports) {
            var tick = 1;
            var maxTick = 65535;
            var resolution = 4;
            var inc = function() {
                tick = tick + 1 & maxTick;
            };
            var timer = setInterval(inc, 1e3 / resolution | 0);
            if (timer.unref) timer.unref();
            module.exports = function(seconds) {
                var size = resolution * (seconds || 5);
                var buffer = [ 0 ];
                var pointer = 1;
                var last = tick - 1 & maxTick;
                return function(delta) {
                    var dist = tick - last & maxTick;
                    if (dist > size) dist = size;
                    last = tick;
                    while (dist--) {
                        if (pointer === size) pointer = 0;
                        buffer[pointer] = buffer[pointer === 0 ? size - 1 : pointer - 1];
                        pointer++;
                    }
                    if (delta) buffer[pointer - 1] += delta;
                    var top = buffer[pointer - 1];
                    var btm = buffer.length < size ? 0 : buffer[pointer === size ? 0 : pointer];
                    return buffer.length < resolution ? top : (top - btm) * resolution / buffer.length;
                };
            };
        }, {} ],
        131: [ function(require, module, exports) {
            var getBlob = require("stream-to-blob");
            module.exports = function getBlobURL(stream, mimeType, cb) {
                if (typeof mimeType === "function") return getBlobURL(stream, null, mimeType);
                getBlob(stream, mimeType, function(err, blob) {
                    if (err) return cb(err);
                    var url = URL.createObjectURL(blob);
                    cb(null, url);
                });
            };
        }, {
            "stream-to-blob": 132
        } ],
        132: [ function(require, module, exports) {
            var once = require("once");
            module.exports = function getBlob(stream, mimeType, cb) {
                if (typeof mimeType === "function") return getBlob(stream, null, mimeType);
                cb = once(cb);
                var chunks = [];
                stream.on("data", function(chunk) {
                    chunks.push(chunk);
                }).on("end", function() {
                    var blob = mimeType ? new Blob(chunks, {
                        type: mimeType
                    }) : new Blob(chunks);
                    cb(null, blob);
                }).on("error", cb);
            };
        }, {
            once: 134
        } ],
        133: [ function(require, module, exports) {
            arguments[4][17][0].apply(exports, arguments);
        }, {
            dup: 17
        } ],
        134: [ function(require, module, exports) {
            arguments[4][18][0].apply(exports, arguments);
        }, {
            dup: 18,
            wrappy: 133
        } ],
        135: [ function(require, module, exports) {
            (function(Buffer) {
                var once = require("once");
                module.exports = function getBuffer(stream, length, cb) {
                    cb = once(cb);
                    var buf = new Buffer(length);
                    var offset = 0;
                    stream.on("data", function(chunk) {
                        chunk.copy(buf, offset);
                        offset += chunk.length;
                    }).on("end", function() {
                        cb(null, buf);
                    }).on("error", cb);
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22,
            once: 137
        } ],
        136: [ function(require, module, exports) {
            arguments[4][17][0].apply(exports, arguments);
        }, {
            dup: 17
        } ],
        137: [ function(require, module, exports) {
            arguments[4][18][0].apply(exports, arguments);
        }, {
            dup: 18,
            wrappy: 136
        } ],
        138: [ function(require, module, exports) {
            (function(process) {
                module.exports = Discovery;
                var debug = require("debug")("torrent-discovery");
                var DHT = require("bittorrent-dht/client");
                var EventEmitter = require("events").EventEmitter;
                var extend = require("xtend");
                var inherits = require("inherits");
                var parallel = require("run-parallel");
                var Tracker = require("bittorrent-tracker/client");
                inherits(Discovery, EventEmitter);
                function Discovery(opts) {
                    var self = this;
                    if (!(self instanceof Discovery)) return new Discovery(opts);
                    EventEmitter.call(self);
                    if (!opts.peerId) throw new Error("Option `peerId` is required");
                    if (!opts.infoHash) throw new Error("Option `infoHash` is required");
                    if (!process.browser && !opts.port) throw new Error("Option `port` is required");
                    self.peerId = typeof opts.peerId === "string" ? opts.peerId : opts.peerId.toString("hex");
                    self.infoHash = typeof opts.infoHash === "string" ? opts.infoHash : opts.infoHash.toString("hex");
                    self._port = opts.port;
                    self.destroyed = false;
                    self._announce = opts.announce || [];
                    self._intervalMs = opts.intervalMs || 15 * 60 * 1e3;
                    self._trackerOpts = null;
                    self._dhtAnnouncing = false;
                    self._dhtTimeout = false;
                    self._internalDHT = false;
                    self._onWarning = function(err) {
                        self.emit("warning", err);
                    };
                    self._onError = function(err) {
                        self.emit("error", err);
                    };
                    self._onDHTPeer = function(peer, infoHash) {
                        if (infoHash.toString("hex") !== self.infoHash) return;
                        self.emit("peer", peer.host + ":" + peer.port);
                    };
                    self._onTrackerPeer = function(peer) {
                        self.emit("peer", peer);
                    };
                    self._onTrackerAnnounce = function() {
                        self.emit("trackerAnnounce");
                    };
                    if (opts.tracker === false) {
                        self.tracker = null;
                    } else if (opts.tracker && typeof opts.tracker === "object") {
                        self._trackerOpts = extend(opts.tracker);
                        self.tracker = self._createTracker();
                    } else {
                        self.tracker = self._createTracker();
                    }
                    if (opts.dht === false || typeof DHT !== "function") {
                        self.dht = null;
                    } else if (opts.dht && typeof opts.dht.addNode === "function") {
                        self.dht = opts.dht;
                    } else if (opts.dht && typeof opts.dht === "object") {
                        self.dht = createDHT(opts.dhtPort, opts.dht);
                    } else {
                        self.dht = createDHT(opts.dhtPort);
                    }
                    if (self.dht) {
                        self.dht.on("peer", self._onDHTPeer);
                        self._dhtAnnounce();
                    }
                    function createDHT(port, opts) {
                        var dht = new DHT(opts);
                        dht.on("warning", self._onWarning);
                        dht.on("error", self._onError);
                        dht.listen(port);
                        self._internalDHT = true;
                        return dht;
                    }
                }
                Discovery.prototype.updatePort = function(port) {
                    var self = this;
                    if (port === self._port) return;
                    self._port = port;
                    if (self.dht) self._dhtAnnounce();
                    if (self.tracker) {
                        self.tracker.stop();
                        self.tracker.destroy(function() {
                            self.tracker = self._createTracker();
                        });
                    }
                };
                Discovery.prototype.destroy = function(cb) {
                    var self = this;
                    if (self.destroyed) return;
                    self.destroyed = true;
                    clearTimeout(self._dhtTimeout);
                    var tasks = [];
                    if (self.tracker) {
                        self.tracker.stop();
                        self.tracker.removeListener("warning", self._onWarning);
                        self.tracker.removeListener("error", self._onError);
                        self.tracker.removeListener("peer", self._onTrackerPeer);
                        self.tracker.removeListener("update", self._onTrackerAnnounce);
                        tasks.push(function(cb) {
                            self.tracker.destroy(cb);
                        });
                    }
                    if (self.dht) {
                        self.dht.removeListener("peer", self._onDHTPeer);
                    }
                    if (self._internalDHT) {
                        self.dht.removeListener("warning", self._onWarning);
                        self.dht.removeListener("error", self._onError);
                        tasks.push(function(cb) {
                            self.dht.destroy(cb);
                        });
                    }
                    parallel(tasks, cb);
                    self.dht = null;
                    self.tracker = null;
                    self._announce = null;
                };
                Discovery.prototype._createTracker = function() {
                    var self = this;
                    var opts = extend(self._trackerOpts, {
                        infoHash: self.infoHash,
                        announce: self._announce,
                        peerId: self.peerId,
                        port: self._port
                    });
                    var tracker = new Tracker(opts);
                    tracker.on("warning", self._onWarning);
                    tracker.on("error", self._onError);
                    tracker.on("peer", self._onTrackerPeer);
                    tracker.on("update", self._onTrackerAnnounce);
                    tracker.setInterval(self._intervalMs);
                    tracker.start();
                    return tracker;
                };
                Discovery.prototype._dhtAnnounce = function() {
                    var self = this;
                    if (self._dhtAnnouncing) return;
                    debug("dht announce");
                    self._dhtAnnouncing = true;
                    clearTimeout(self._dhtTimeout);
                    self.dht.announce(self.infoHash, self._port, function(err) {
                        self._dhtAnnouncing = false;
                        debug("dht announce complete");
                        if (err) self.emit("warning", err);
                        self.emit("dhtAnnounce");
                        if (!self.destroyed) {
                            self._dhtTimeout = setTimeout(function() {
                                self._dhtAnnounce();
                            }, getRandomTimeout());
                            if (self._dhtTimeout.unref) self._dhtTimeout.unref();
                        }
                    });
                    function getRandomTimeout() {
                        return self._intervalMs + Math.floor(Math.random() * self._intervalMs / 5);
                    }
                };
            }).call(this, require("_process"));
        }, {
            _process: 30,
            "bittorrent-dht/client": 21,
            "bittorrent-tracker/client": 13,
            debug: 63,
            events: 26,
            inherits: 71,
            "run-parallel": 118,
            xtend: 146
        } ],
        139: [ function(require, module, exports) {
            (function(Buffer) {
                module.exports = Piece;
                var BLOCK_LENGTH = 1 << 14;
                function Piece(length) {
                    if (!(this instanceof Piece)) return new Piece(length);
                    this.length = length;
                    this.missing = length;
                    this.sources = null;
                    this._chunks = Math.ceil(length / BLOCK_LENGTH);
                    this._remainder = length % BLOCK_LENGTH || BLOCK_LENGTH;
                    this._buffered = 0;
                    this._buffer = null;
                    this._cancellations = null;
                    this._reservations = 0;
                    this._flushed = false;
                }
                Piece.BLOCK_LENGTH = BLOCK_LENGTH;
                Piece.prototype.chunkLength = function(i) {
                    return i === this._chunks - 1 ? this._remainder : BLOCK_LENGTH;
                };
                Piece.prototype.chunkLengthRemaining = function(i) {
                    return this.length - i * BLOCK_LENGTH;
                };
                Piece.prototype.chunkOffset = function(i) {
                    return i * BLOCK_LENGTH;
                };
                Piece.prototype.reserve = function() {
                    if (!this.init()) return -1;
                    if (this._cancellations.length) return this._cancellations.pop();
                    if (this._reservations < this._chunks) return this._reservations++;
                    return -1;
                };
                Piece.prototype.reserveRemaining = function() {
                    if (!this.init()) return -1;
                    if (this._reservations < this._chunks) {
                        var min = this._reservations;
                        this._reservations = this._chunks;
                        return min;
                    }
                    return -1;
                };
                Piece.prototype.cancel = function(i) {
                    if (!this.init()) return;
                    this._cancellations.push(i);
                };
                Piece.prototype.cancelRemaining = function(i) {
                    if (!this.init()) return;
                    this._reservations = i;
                };
                Piece.prototype.get = function(i) {
                    if (!this.init()) return null;
                    return this._buffer[i];
                };
                Piece.prototype.set = function(i, data, source) {
                    if (!this.init()) return false;
                    var len = data.length;
                    var blocks = Math.ceil(len / BLOCK_LENGTH);
                    for (var j = 0; j < blocks; j++) {
                        if (!this._buffer[i + j]) {
                            var offset = j * BLOCK_LENGTH;
                            var splitData = data.slice(offset, offset + BLOCK_LENGTH);
                            this._buffered++;
                            this._buffer[i + j] = splitData;
                            this.missing -= splitData.length;
                            if (this.sources.indexOf(source) === -1) {
                                this.sources.push(source);
                            }
                        }
                    }
                    return this._buffered === this._chunks;
                };
                Piece.prototype.flush = function() {
                    if (!this._buffer || this._chunks !== this._buffered) return null;
                    var buffer = Buffer.concat(this._buffer, this.length);
                    this._buffer = null;
                    this._cancellations = null;
                    this.sources = null;
                    this._flushed = true;
                    return buffer;
                };
                Piece.prototype.init = function() {
                    if (this._flushed) return false;
                    if (this._buffer) return true;
                    this._buffer = new Array(this._chunks);
                    this._cancellations = [];
                    this.sources = [];
                    return true;
                };
            }).call(this, require("buffer").Buffer);
        }, {
            buffer: 22
        } ],
        140: [ function(require, module, exports) {
            "use strict";
            function unique_pred(list, compare) {
                var ptr = 1, len = list.length, a = list[0], b = list[0];
                for (var i = 1; i < len; ++i) {
                    b = a;
                    a = list[i];
                    if (compare(a, b)) {
                        if (i === ptr) {
                            ptr++;
                            continue;
                        }
                        list[ptr++] = a;
                    }
                }
                list.length = ptr;
                return list;
            }
            function unique_eq(list) {
                var ptr = 1, len = list.length, a = list[0], b = list[0];
                for (var i = 1; i < len; ++i, b = a) {
                    b = a;
                    a = list[i];
                    if (a !== b) {
                        if (i === ptr) {
                            ptr++;
                            continue;
                        }
                        list[ptr++] = a;
                    }
                }
                list.length = ptr;
                return list;
            }
            function unique(list, compare, sorted) {
                if (list.length === 0) {
                    return list;
                }
                if (compare) {
                    if (!sorted) {
                        list.sort(compare);
                    }
                    return unique_pred(list, compare);
                }
                if (!sorted) {
                    list.sort();
                }
                return unique_eq(list);
            }
            module.exports = unique;
        }, {} ],
        141: [ function(require, module, exports) {
            module.exports = remove;
            function remove(arr, i) {
                if (i >= arr.length || i < 0) return;
                var last = arr.pop();
                if (i < arr.length) {
                    var tmp = arr[i];
                    arr[i] = last;
                    return tmp;
                }
                return last;
            }
        }, {} ],
        142: [ function(require, module, exports) {
            var bencode = require("bencode");
            var BitField = require("bitfield");
            var Buffer = require("safe-buffer").Buffer;
            var debug = require("debug")("ut_metadata");
            var EventEmitter = require("events").EventEmitter;
            var inherits = require("inherits");
            var sha1 = require("simple-sha1");
            var MAX_METADATA_SIZE = 1e7;
            var BITFIELD_GROW = 1e3;
            var PIECE_LENGTH = 16 * 1024;
            module.exports = function(metadata) {
                inherits(utMetadata, EventEmitter);
                function utMetadata(wire) {
                    EventEmitter.call(this);
                    this._wire = wire;
                    this._metadataComplete = false;
                    this._metadataSize = null;
                    this._remainingRejects = null;
                    this._fetching = false;
                    this._bitfield = new BitField(0, {
                        grow: BITFIELD_GROW
                    });
                    if (Buffer.isBuffer(metadata)) {
                        this.setMetadata(metadata);
                    }
                }
                utMetadata.prototype.name = "ut_metadata";
                utMetadata.prototype.onHandshake = function(infoHash, peerId, extensions) {
                    this._infoHash = infoHash;
                };
                utMetadata.prototype.onExtendedHandshake = function(handshake) {
                    if (!handshake.m || !handshake.m.ut_metadata) {
                        return this.emit("warning", new Error("Peer does not support ut_metadata"));
                    }
                    if (!handshake.metadata_size) {
                        return this.emit("warning", new Error("Peer does not have metadata"));
                    }
                    if (typeof handshake.metadata_size !== "number" || MAX_METADATA_SIZE < handshake.metadata_size || handshake.metadata_size <= 0) {
                        return this.emit("warning", new Error("Peer gave invalid metadata size"));
                    }
                    this._metadataSize = handshake.metadata_size;
                    this._numPieces = Math.ceil(this._metadataSize / PIECE_LENGTH);
                    this._remainingRejects = this._numPieces * 2;
                    if (this._fetching) {
                        this._requestPieces();
                    }
                };
                utMetadata.prototype.onMessage = function(buf) {
                    var dict, trailer;
                    try {
                        var str = buf.toString();
                        var trailerIndex = str.indexOf("ee") + 2;
                        dict = bencode.decode(str.substring(0, trailerIndex));
                        trailer = buf.slice(trailerIndex);
                    } catch (err) {
                        return;
                    }
                    switch (dict.msg_type) {
                      case 0:
                        this._onRequest(dict.piece);
                        break;

                      case 1:
                        this._onData(dict.piece, trailer, dict.total_size);
                        break;

                      case 2:
                        this._onReject(dict.piece);
                        break;
                    }
                };
                utMetadata.prototype.fetch = function() {
                    if (this._metadataComplete) {
                        return;
                    }
                    this._fetching = true;
                    if (this._metadataSize) {
                        this._requestPieces();
                    }
                };
                utMetadata.prototype.cancel = function() {
                    this._fetching = false;
                };
                utMetadata.prototype.setMetadata = function(metadata) {
                    if (this._metadataComplete) return true;
                    debug("set metadata");
                    try {
                        var info = bencode.decode(metadata).info;
                        if (info) {
                            metadata = bencode.encode(info);
                        }
                    } catch (err) {}
                    if (this._infoHash && this._infoHash !== sha1.sync(metadata)) {
                        return false;
                    }
                    this.cancel();
                    this.metadata = metadata;
                    this._metadataComplete = true;
                    this._metadataSize = this.metadata.length;
                    this._wire.extendedHandshake.metadata_size = this._metadataSize;
                    this.emit("metadata", bencode.encode({
                        info: bencode.decode(this.metadata)
                    }));
                    return true;
                };
                utMetadata.prototype._send = function(dict, trailer) {
                    var buf = bencode.encode(dict);
                    if (Buffer.isBuffer(trailer)) {
                        buf = Buffer.concat([ buf, trailer ]);
                    }
                    this._wire.extended("ut_metadata", buf);
                };
                utMetadata.prototype._request = function(piece) {
                    this._send({
                        msg_type: 0,
                        piece: piece
                    });
                };
                utMetadata.prototype._data = function(piece, buf, totalSize) {
                    var msg = {
                        msg_type: 1,
                        piece: piece
                    };
                    if (typeof totalSize === "number") {
                        msg.total_size = totalSize;
                    }
                    this._send(msg, buf);
                };
                utMetadata.prototype._reject = function(piece) {
                    this._send({
                        msg_type: 2,
                        piece: piece
                    });
                };
                utMetadata.prototype._onRequest = function(piece) {
                    if (!this._metadataComplete) {
                        this._reject(piece);
                        return;
                    }
                    var start = piece * PIECE_LENGTH;
                    var end = start + PIECE_LENGTH;
                    if (end > this._metadataSize) {
                        end = this._metadataSize;
                    }
                    var buf = this.metadata.slice(start, end);
                    this._data(piece, buf, this._metadataSize);
                };
                utMetadata.prototype._onData = function(piece, buf, totalSize) {
                    if (buf.length > PIECE_LENGTH) {
                        return;
                    }
                    buf.copy(this.metadata, piece * PIECE_LENGTH);
                    this._bitfield.set(piece);
                    this._checkDone();
                };
                utMetadata.prototype._onReject = function(piece) {
                    if (this._remainingRejects > 0 && this._fetching) {
                        this._request(piece);
                        this._remainingRejects -= 1;
                    } else {
                        this.emit("warning", new Error('Peer sent "reject" too much'));
                    }
                };
                utMetadata.prototype._requestPieces = function() {
                    this.metadata = Buffer.alloc(this._metadataSize);
                    for (var piece = 0; piece < this._numPieces; piece++) {
                        this._request(piece);
                    }
                };
                utMetadata.prototype._checkDone = function() {
                    var done = true;
                    for (var piece = 0; piece < this._numPieces; piece++) {
                        if (!this._bitfield.get(piece)) {
                            done = false;
                            break;
                        }
                    }
                    if (!done) return;
                    var success = this.setMetadata(this.metadata);
                    if (!success) {
                        this._failedMetadata();
                    }
                };
                utMetadata.prototype._failedMetadata = function() {
                    this._bitfield = new BitField(0, {
                        grow: BITFIELD_GROW
                    });
                    this._remainingRejects -= this._numPieces;
                    if (this._remainingRejects > 0) {
                        this._requestPieces();
                    } else {
                        this.emit("warning", new Error("Peer sent invalid metadata"));
                    }
                };
                return utMetadata;
            };
        }, {
            bencode: 145,
            bitfield: 8,
            debug: 63,
            events: 26,
            inherits: 71,
            "safe-buffer": 119,
            "simple-sha1": 128
        } ],
        143: [ function(require, module, exports) {
            arguments[4][10][0].apply(exports, arguments);
        }, {
            buffer: 22,
            dup: 10
        } ],
        144: [ function(require, module, exports) {
            arguments[4][11][0].apply(exports, arguments);
        }, {
            buffer: 22,
            dup: 11
        } ],
        145: [ function(require, module, exports) {
            arguments[4][12][0].apply(exports, arguments);
        }, {
            "./decode": 143,
            "./encode": 144,
            dup: 12
        } ],
        146: [ function(require, module, exports) {
            module.exports = extend;
            var hasOwnProperty = Object.prototype.hasOwnProperty;
            function extend() {
                var target = {};
                for (var i = 0; i < arguments.length; i++) {
                    var source = arguments[i];
                    for (var key in source) {
                        if (hasOwnProperty.call(source, key)) {
                            target[key] = source[key];
                        }
                    }
                }
                return target;
            }
        }, {} ],
        147: [ function(require, module, exports) {
            module.exports = extend;
            var hasOwnProperty = Object.prototype.hasOwnProperty;
            function extend(target) {
                for (var i = 1; i < arguments.length; i++) {
                    var source = arguments[i];
                    for (var key in source) {
                        if (hasOwnProperty.call(source, key)) {
                            target[key] = source[key];
                        }
                    }
                }
                return target;
            }
        }, {} ],
        148: [ function(require, module, exports) {
            module.exports = function zeroFill(width, number, pad) {
                if (number === undefined) {
                    return function(number, pad) {
                        return zeroFill(width, number, pad);
                    };
                }
                if (pad === undefined) pad = "0";
                width -= number.toString().length;
                if (width > 0) return new Array(width + (/\./.test(number) ? 2 : 1)).join(pad) + number;
                return number + "";
            };
        }, {} ],
        149: [ function(require, module, exports) {
            module.exports = {
                version: "0.95.2"
            };
        }, {} ],
        150: [ function(require, module, exports) {
            (function(process, global) {
                module.exports = WebTorrent;
                var Buffer = require("safe-buffer").Buffer;
                var concat = require("simple-concat");
                var createTorrent = require("create-torrent");
                var debug = require("debug")("webtorrent");
                var DHT = require("bittorrent-dht/client");
                var EventEmitter = require("events").EventEmitter;
                var extend = require("xtend");
                var hat = require("hat");
                var inherits = require("inherits");
                var loadIPSet = require("load-ip-set");
                var parallel = require("run-parallel");
                var parseTorrent = require("parse-torrent");
                var path = require("path");
                var Peer = require("simple-peer");
                var speedometer = require("speedometer");
                var zeroFill = require("zero-fill");
                var TCPPool = require("./lib/tcp-pool");
                var Torrent = require("./lib/torrent");
                var VERSION = require("./package.json").version;
                var VERSION_STR = VERSION.match(/([0-9]+)/g).slice(0, 2).map(zeroFill(2)).join("");
                var VERSION_PREFIX = "-WW" + VERSION_STR + "-";
                inherits(WebTorrent, EventEmitter);
                function WebTorrent(opts) {
                    var self = this;
                    if (!(self instanceof WebTorrent)) return new WebTorrent(opts);
                    EventEmitter.call(self);
                    if (!opts) opts = {};
                    if (typeof opts.peerId === "string") {
                        self.peerId = opts.peerId;
                    } else if (Buffer.isBuffer(opts.peerId)) {
                        self.peerId = opts.peerId.toString("hex");
                    } else {
                        self.peerId = Buffer.from(VERSION_PREFIX + hat(48));
                    }
                    self.peerIdBuffer = Buffer.from(self.peerId, "hex");
                    if (typeof opts.nodeId === "string") {
                        self.nodeId = opts.nodeId;
                    } else if (Buffer.isBuffer(opts.nodeId)) {
                        self.nodeId = opts.nodeId.toString("hex");
                    } else {
                        self.nodeId = hat(160);
                    }
                    self.nodeIdBuffer = Buffer.from(self.nodeId, "hex");
                    self.destroyed = false;
                    self.listening = false;
                    self.torrentPort = opts.torrentPort || 0;
                    self.dhtPort = opts.dhtPort || 0;
                    self.tracker = opts.tracker !== undefined ? opts.tracker : {};
                    self.torrents = [];
                    self.maxConns = Number(opts.maxConns) || 55;
                    if (self.tracker) {
                        if (typeof self.tracker !== "object") self.tracker = {};
                        if (opts.rtcConfig) {
                            console.warn("WebTorrent: opts.rtcConfig is deprecated. Use opts.tracker.rtcConfig instead");
                            self.tracker.rtcConfig = opts.rtcConfig;
                        }
                        if (opts.wrtc) {
                            console.warn("WebTorrent: opts.wrtc is deprecated. Use opts.tracker.wrtc instead");
                            self.tracker.wrtc = opts.wrtc;
                        }
                        if (global.WRTC && !self.tracker.wrtc) self.tracker.wrtc = global.WRTC;
                    }
                    if (typeof TCPPool === "function") {
                        self._tcpPool = new TCPPool(self);
                    } else {
                        process.nextTick(function() {
                            self._onListening();
                        });
                    }
                    self._downloadSpeed = speedometer();
                    self._uploadSpeed = speedometer();
                    if (opts.dht !== false && typeof DHT === "function") {
                        self.dht = new DHT(extend({
                            nodeId: self.nodeId
                        }, opts.dht));
                        self.dht.once("error", function(err) {
                            self._destroy(err);
                        });
                        self.dht.once("listening", function() {
                            var address = self.dht.address();
                            if (address) self.dhtPort = address.port;
                        });
                        self.dht.setMaxListeners(0);
                        self.dht.listen(self.dhtPort);
                    } else {
                        self.dht = false;
                    }
                    debug("new webtorrent (peerId %s, nodeId %s)", self.peerId, self.nodeId);
                    if (typeof loadIPSet === "function") {
                        loadIPSet(opts.blocklist, {
                            headers: {
                                "user-agent": "WebTorrent/" + VERSION + " (https://webtorrent.io)"
                            }
                        }, function(err, ipSet) {
                            if (err) return self.error("Failed to load blocklist: " + err.message);
                            self.blocked = ipSet;
                            ready();
                        });
                    } else process.nextTick(ready);
                    function ready() {
                        if (self.destroyed) return;
                        self.ready = true;
                        self.emit("ready");
                    }
                }
                WebTorrent.WEBRTC_SUPPORT = Peer.WEBRTC_SUPPORT;
                Object.defineProperty(WebTorrent.prototype, "downloadSpeed", {
                    get: function() {
                        return this._downloadSpeed();
                    }
                });
                Object.defineProperty(WebTorrent.prototype, "uploadSpeed", {
                    get: function() {
                        return this._uploadSpeed();
                    }
                });
                Object.defineProperty(WebTorrent.prototype, "progress", {
                    get: function() {
                        var torrents = this.torrents.filter(function(torrent) {
                            return torrent.progress !== 1;
                        });
                        var downloaded = torrents.reduce(function(total, torrent) {
                            return total + torrent.downloaded;
                        }, 0);
                        var length = torrents.reduce(function(total, torrent) {
                            return total + (torrent.length || 0);
                        }, 0) || 1;
                        return downloaded / length;
                    }
                });
                Object.defineProperty(WebTorrent.prototype, "ratio", {
                    get: function() {
                        var uploaded = this.torrents.reduce(function(total, torrent) {
                            return total + torrent.uploaded;
                        }, 0);
                        var received = this.torrents.reduce(function(total, torrent) {
                            return total + torrent.received;
                        }, 0) || 1;
                        return uploaded / received;
                    }
                });
                WebTorrent.prototype.get = function(torrentId) {
                    var self = this;
                    var i, torrent;
                    var len = self.torrents.length;
                    if (torrentId instanceof Torrent) {
                        for (i = 0; i < len; i++) {
                            torrent = self.torrents[i];
                            if (torrent === torrentId) return torrent;
                        }
                    } else {
                        var parsed;
                        try {
                            parsed = parseTorrent(torrentId);
                        } catch (err) {}
                        if (!parsed) return null;
                        if (!parsed.infoHash) throw new Error("Invalid torrent identifier");
                        for (i = 0; i < len; i++) {
                            torrent = self.torrents[i];
                            if (torrent.infoHash === parsed.infoHash) return torrent;
                        }
                    }
                    return null;
                };
                WebTorrent.prototype.download = function(torrentId, opts, ontorrent) {
                    console.warn("WebTorrent: client.download() is deprecated. Use client.add() instead");
                    return this.add(torrentId, opts, ontorrent);
                };
                WebTorrent.prototype.add = function(torrentId, opts, ontorrent) {
                    var self = this;
                    if (self.destroyed) throw new Error("client is destroyed");
                    if (typeof opts === "function") return self.add(torrentId, null, opts);
                    debug("add");
                    opts = opts ? extend(opts) : {};
                    var torrent = new Torrent(torrentId, self, opts);
                    self.torrents.push(torrent);
                    torrent.once("_infoHash", onInfoHash);
                    torrent.once("ready", onReady);
                    torrent.once("close", onClose);
                    function onInfoHash() {
                        if (self.destroyed) return;
                        for (var i = 0, len = self.torrents.length; i < len; i++) {
                            var t = self.torrents[i];
                            if (t.infoHash === torrent.infoHash && t !== torrent) {
                                torrent._destroy(new Error("Cannot add duplicate torrent " + torrent.infoHash));
                                return;
                            }
                        }
                    }
                    function onReady() {
                        if (self.destroyed) return;
                        if (typeof ontorrent === "function") ontorrent(torrent);
                        self.emit("torrent", torrent);
                    }
                    function onClose() {
                        torrent.removeListener("_infoHash", onInfoHash);
                        torrent.removeListener("ready", onReady);
                        torrent.removeListener("close", onClose);
                    }
                    return torrent;
                };
                WebTorrent.prototype.seed = function(input, opts, onseed) {
                    var self = this;
                    if (self.destroyed) throw new Error("client is destroyed");
                    if (typeof opts === "function") return self.seed(input, null, opts);
                    debug("seed");
                    opts = opts ? extend(opts) : {};
                    if (typeof input === "string") opts.path = path.dirname(input);
                    if (!opts.createdBy) opts.createdBy = "WebTorrent/" + VERSION_STR;
                    if (!self.tracker) opts.announce = [];
                    var torrent = self.add(null, opts, onTorrent);
                    var streams;
                    if (!Array.isArray(input)) input = [ input ];
                    parallel(input.map(function(item) {
                        return function(cb) {
                            if (isReadable(item)) concat(item, cb); else cb(null, item);
                        };
                    }), function(err, input) {
                        if (self.destroyed) return;
                        if (err) return torrent._destroy(err);
                        createTorrent.parseInput(input, opts, function(err, files) {
                            if (self.destroyed) return;
                            if (err) return torrent._destroy(err);
                            streams = files.map(function(file) {
                                return file.getStream;
                            });
                            createTorrent(input, opts, function(err, torrentBuf) {
                                if (self.destroyed) return;
                                if (err) return torrent._destroy(err);
                                var existingTorrent = self.get(torrentBuf);
                                if (existingTorrent) {
                                    torrent._destroy(new Error("Cannot add duplicate torrent " + existingTorrent.infoHash));
                                } else {
                                    torrent._onTorrentId(torrentBuf);
                                }
                            });
                        });
                    });
                    function onTorrent(torrent) {
                        var tasks = [ function(cb) {
                            torrent.load(streams, cb);
                        } ];
                        if (self.dht) {
                            tasks.push(function(cb) {
                                torrent.once("dhtAnnounce", cb);
                            });
                        }
                        parallel(tasks, function(err) {
                            if (self.destroyed) return;
                            if (err) return torrent._destroy(err);
                            _onseed(torrent);
                        });
                    }
                    function _onseed(torrent) {
                        debug("on seed");
                        if (typeof onseed === "function") onseed(torrent);
                        torrent.emit("seed");
                        self.emit("seed", torrent);
                    }
                    return torrent;
                };
                WebTorrent.prototype.remove = function(torrentId, cb) {
                    debug("remove");
                    var torrent = this.get(torrentId);
                    if (!torrent) throw new Error("No torrent with id " + torrentId);
                    this._remove(torrentId, cb);
                };
                WebTorrent.prototype._remove = function(torrentId, cb) {
                    var torrent = this.get(torrentId);
                    if (!torrent) return;
                    this.torrents.splice(this.torrents.indexOf(torrent), 1);
                    torrent.destroy(cb);
                };
                WebTorrent.prototype.address = function() {
                    if (!this.listening) return null;
                    return this._tcpPool ? this._tcpPool.server.address() : {
                        address: "0.0.0.0",
                        family: "IPv4",
                        port: 0
                    };
                };
                WebTorrent.prototype.destroy = function(cb) {
                    if (this.destroyed) throw new Error("client already destroyed");
                    this._destroy(null, cb);
                };
                WebTorrent.prototype._destroy = function(err, cb) {
                    var self = this;
                    debug("client destroy");
                    self.destroyed = true;
                    var tasks = self.torrents.map(function(torrent) {
                        return function(cb) {
                            torrent.destroy(cb);
                        };
                    });
                    if (self._tcpPool) {
                        tasks.push(function(cb) {
                            self._tcpPool.destroy(cb);
                        });
                    }
                    if (self.dht) {
                        tasks.push(function(cb) {
                            self.dht.destroy(cb);
                        });
                    }
                    parallel(tasks, cb);
                    if (err) self.emit("error", err);
                    self.torrents = [];
                    self._tcpPool = null;
                    self.dht = null;
                };
                WebTorrent.prototype._onListening = function() {
                    this.listening = true;
                    if (this._tcpPool) {
                        var address = this._tcpPool.server.address();
                        if (address) this.torrentPort = address.port;
                    }
                    this.emit("listening");
                };
                function isReadable(obj) {
                    return typeof obj === "object" && obj != null && typeof obj.pipe === "function";
                }
            }).call(this, require("_process"), typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
        }, {
            "./lib/tcp-pool": 21,
            "./lib/torrent": 5,
            "./package.json": 149,
            _process: 30,
            "bittorrent-dht/client": 21,
            "create-torrent": 46,
            debug: 63,
            events: 26,
            hat: 69,
            inherits: 71,
            "load-ip-set": 21,
            "parse-torrent": 74,
            path: 29,
            "run-parallel": 118,
            "safe-buffer": 119,
            "simple-concat": 120,
            "simple-peer": 124,
            speedometer: 130,
            xtend: 146,
            "zero-fill": 148
        } ]
    }, {}, [ 150 ])(150);
});
