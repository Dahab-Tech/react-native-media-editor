import AVFoundation
import ExpoModulesCore

/// Timeline preview: AVPlayer over the same compiled composition the export uses,
/// so preview and export match by construction.
final class TimelinePlayerView: ExpoView {
  private let playerLayer = AVPlayerLayer()
  private var player = AVPlayer()
  private var timeObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var itemStatusObservation: NSKeyValueObservation?
  private var timeControlObservation: NSKeyValueObservation?
  private var index: TimelineIndex?
  private var lastClipIndex = -1
  // Guards against a stale async compile landing after props changed again mid-flight.
  private var buildGeneration = 0

  // MARK: Swap bridge — replaceCurrentItem flushes the layer, so the outgoing frame is frozen
  // as a snapshot until the new item's first frame is ready for display.

  private var swapSnapshot: UIView?
  private var readyObservation: NSKeyValueObservation?
  private var swapSnapshotTimeout: DispatchWorkItem?

  let onReady = EventDispatcher()
  let onTimeUpdate = EventDispatcher()
  let onClipChanged = EventDispatcher()
  let onPlayEnd = EventDispatcher()
  let onPlayerError = EventDispatcher()

  // MARK: Props — mutated individually by the module DSL, committed as a batch in commitProps().

  var projectJson: String? { didSet { if projectJson != oldValue { needsRebuild = true } } }
  var paused: Bool = false
  var loop: Bool = false
  var volume: Double = 1
  var timeUpdateIntervalMs: Double = 250 {
    didSet { if timeUpdateIntervalMs != oldValue { needsObserverReinstall = true } }
  }
  // UI-thread scrub channel: Reanimated animated props write this per scroll frame, so scrub
  // seeks never cross the JS thread. Sentinel -1 = inactive. Seeks immediately (not batched
  // via commitProps) through the same latest-wins chain as seekTo.
  var scrubPositionMs: Double = -1 {
    didSet {
      if scrubPositionMs >= 0, scrubPositionMs != oldValue { seekTo(ms: scrubPositionMs) }
    }
  }

  private var needsRebuild = false
  private var needsObserverReinstall = false

  // MARK: Scrubbing — exact-tolerance seeks, coalesced so a drag never queues stale frames.

  private var scrubbing = false
  private var seekInFlight = false
  private var pendingSeekMs: Double?
  // Resume truth for rebuilds: while paused, sampled currentTime lags an in-flight seek by up to
  // a frame/throttle interval — the last requested target is the position the user chose, and
  // resuming anywhere else shows up as a small timeline nudge after every recompile.
  private var lastSeekTargetMs: Double?
  // Mid-swap `player.currentTime()` reports 0/stale until the new item syncs; all ticks are
  // gated until the swap settles, then one authoritative tick confirms the landed position.
  private var swapSettling = false
  // High-water mark for emitted ticks; reset on every explicit discontinuity (seek, rebuild).
  private var lastEmittedMs: Double = -1

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    configurePlayer()
    playerLayer.videoGravity = .resizeAspect
    layer.addSublayer(playerLayer)
    NotificationCenter.default.addObserver(
      self, selector: #selector(handleMediaServicesReset),
      name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
  }

  private func configurePlayer() {
    // Platform play-when-ready (same semantics as ExoPlayer's playWhenReady on Android): play()
    // starts only once the pipeline can sustain playback. Starting blind ran the timebase ahead
    // of the compositor and AVPlayer stepped it backwards to resync — the timeline-bar twitch.
    player.automaticallyWaitsToMinimizeStalling = true
    playerLayer.player = player
    // Transport edges tick immediately with the real rate; JS shows motion only while the
    // player itself reports playing.
    timeControlObservation = player.observe(\.timeControlStatus) { [weak self] _, _ in
      DispatchQueue.main.async {
        guard let self else { return }
        if self.player.timeControlStatus == .playing { self.lastSeekTargetMs = nil }
        if self.seekInFlight || self.pendingSeekMs != nil || self.swapSettling { return }
        self.emitTick(rate: self.player.timeControlStatus == .playing ? 1 : 0)
      }
    }
  }

  /// Media services death orphans every AVPlayer instance; only a fresh player + recompile recovers.
  @objc private func handleMediaServicesReset() {
    if let timeObserver {
      player.removeTimeObserver(timeObserver)
      self.timeObserver = nil
    }
    player = AVPlayer()
    configurePlayer()
    seekInFlight = false
    pendingSeekMs = nil
    swapSettling = false
    lastSeekTargetMs = nil
    rebuild()
  }

  deinit {
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = bounds
    CATransaction.commit()
  }

  func commitProps() {
    if needsRebuild {
      needsRebuild = false
      rebuild()
    }
    if needsObserverReinstall {
      needsObserverReinstall = false
      installTimeObserver()
    }
    applyPlayback()
  }

  func seekTo(ms: Double) {
    lastSeekTargetMs = max(0, ms)
    if seekInFlight {
      pendingSeekMs = ms
      return
    }
    issueSeek(ms: ms)
  }

  func setScrubbing(_ active: Bool) {
    scrubbing = active
    if active { player.pause() } else { applyPlayback() }
  }

  private func issueSeek(ms: Double) {
    guard player.currentItem != nil else { return }
    seekInFlight = true
    lastEmittedMs = -1
    let target = CMTime(value: CMTimeValue(max(0, ms)), timescale: 1000)
    // Always frame-exact, scrubbing included. Tolerant scrub seeks snap to keyframes (1-2s GOP
    // in camera footage), so the preview only changed once per keyframe while dragging. The
    // latest-wins chain above already bounds the cost: one decode in flight, stale targets
    // collapse into pendingSeekMs — matching Media3's scrubbing mode, which is also exact.
    player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self else { return }
        self.seekInFlight = false
        if let next = self.pendingSeekMs {
          self.pendingSeekMs = nil
          self.issueSeek(ms: next)
        } else {
          // Resume only once the chain drains — playing between queued seeks replays fragments.
          self.applyPlayback()
          self.prerollIfIdle()
          self.dismissSwapSnapshotWhenSettled()
          self.settleAfterSwap()
        }
      }
    }
  }

  private func applyPlayback() {
    player.volume = Float(volume)
    if paused || scrubbing {
      player.pause()
    } else if player.timeControlStatus == .paused && !seekInFlight {
      player.play()
    }
  }

  private func rebuild() {
    buildGeneration += 1
    let generation = buildGeneration
    guard let projectJson else {
      dismissSwapSnapshot()
      itemStatusObservation = nil
      player.replaceCurrentItem(with: nil)
      index = nil
      lastClipIndex = -1
      swapSettling = false
      return
    }
    // The current item stays on screen while the replacement compiles — a nil gap reads as a black flash.
    let resumeMs: Double? = player.currentItem != nil
      ? (player.timeControlStatus == .playing
        ? player.currentTime().seconds * 1000
        : lastSeekTargetMs ?? player.currentTime().seconds * 1000)
      : nil

    Task { [weak self] in
      do {
        let project = try ProjectRecords.parse(projectJson)
        let compiled = try await TimelineCompiler.compile(project)
        await MainActor.run {
          guard let self, self.buildGeneration == generation else { return }
          let item = AVPlayerItem(asset: compiled.composition)
          item.videoComposition = compiled.videoComposition
          let swap = { [weak self] in
            guard let self, self.buildGeneration == generation else { return }
            self.swapSettling = true
            self.presentSwapSnapshot()
            // Force rate to 0 so applyPlayback below owns the resume decision — reading the
            // rate mid-swap was a race that randomly left the player paused or playing.
            self.player.pause()
            let liveMs = self.player.currentItem != nil
              ? self.player.currentTime().seconds * 1000 : nil
            self.index = compiled.index
            self.lastClipIndex = -1
            self.player.replaceCurrentItem(with: item)
            self.observeItemStatus(item)
            self.observeReadyForDisplay()
            self.installTimeObserver()
            self.installEndObserver(for: item)
            // Playback drifted past the pre-seeked frame while the compile ran; refine before
            // resuming or every edit replays a compile-duration fragment.
            if let liveMs, let resumeMs, liveMs - resumeMs > 40 {
              self.seekTo(ms: min(liveMs, compiled.totalDurationMs))
            }
            self.applyPlayback()
            self.onReady([
              "durationMs": compiled.totalDurationMs,
              "clipDurationsMs": project.clips.map { TimelineIndex.clipOutputDurationMs($0) },
            ])
            // The pre-seeked item can already be ready, in which case no status KVO will fire.
            self.settleAfterSwap()
          }
          if let resumeMs, resumeMs > 0 {
            // Pre-seek the detached item so the swap lands on the playhead frame, not frame zero.
            let target = CMTime(
              value: CMTimeValue(min(resumeMs, compiled.totalDurationMs)), timescale: 1000)
            item.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
              DispatchQueue.main.async(execute: swap)
            }
          } else {
            swap()
          }
        }
      } catch {
        await MainActor.run {
          guard let self, self.buildGeneration == generation else { return }
          self.onPlayerError(["message": error.localizedDescription])
        }
      }
    }
  }

  private func observeItemStatus(_ item: AVPlayerItem) {
    // Decode/render failures (e.g. under memory pressure) otherwise die silently as a stuck black view.
    itemStatusObservation = item.observe(\.status) { [weak self] item, _ in
      DispatchQueue.main.async {
        guard let self else { return }
        switch item.status {
        case .readyToPlay:
          self.prerollIfIdle()
          self.settleAfterSwap()
        case .failed:
          self.onPlayerError(["message": item.error?.localizedDescription ?? "Playback failed"])
        default:
          break
        }
      }
    }
  }

  /// Every seek and item swap flushes the render pipeline. play() into a cold pipeline starts the
  /// timebase immediately anyway — automaticallyWaitsToMinimizeStalling gates on media DATA, which
  /// is instant for local files, not on the custom compositor — so the clock runs ahead of the
  /// first composited frames and steps backwards to resync: the move-freeze-move stutter on every
  /// play start. preroll(atRate:) is the platform API that decodes and primes the render queues
  /// while paused, so the pipeline is warm before the user ever hits play. Only meaningful at
  /// rest; a play() issued mid-preroll simply cancels it and starts normally.
  /// One authoritative tick once the swapped item is ready and the seek chain has drained —
  /// JS holds its parked clock through the rebuild and trusts this position.
  private func settleAfterSwap() {
    guard swapSettling, !seekInFlight, pendingSeekMs == nil,
          let item = player.currentItem, item.status == .readyToPlay else { return }
    swapSettling = false
    lastEmittedMs = -1
    emitTick(rate: player.timeControlStatus == .playing ? 1 : 0)
  }

  private func prerollIfIdle() {
    guard let item = player.currentItem, item.status == .readyToPlay else { return }
    guard player.timeControlStatus == .paused, !seekInFlight, pendingSeekMs == nil else { return }
    player.preroll(atRate: 1)
  }

  private func presentSwapSnapshot() {
    guard player.currentItem != nil, let snap = snapshotView(afterScreenUpdates: false) else { return }
    swapSnapshot?.removeFromSuperview()
    snap.frame = bounds
    snap.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(snap)
    swapSnapshot = snap
    swapSnapshotTimeout?.cancel()
    // Failsafe: a source that never reaches ready must not leave a frozen frame on screen.
    let timeout = DispatchWorkItem { [weak self] in self?.dismissSwapSnapshot() }
    swapSnapshotTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: timeout)
  }

  private func observeReadyForDisplay() {
    guard swapSnapshot != nil else { return }
    readyObservation = playerLayer.observe(\.isReadyForDisplay, options: [.new]) { [weak self] layer, _ in
      guard layer.isReadyForDisplay else { return }
      DispatchQueue.main.async { self?.dismissSwapSnapshotWhenSettled() }
    }
  }

  /// The first ready frame after a swap is the stale pre-seeked one; dismissing on it flashed a
  /// visible jump back before the drift-refine seek landed. Hold until the seek chain drains.
  private func dismissSwapSnapshotWhenSettled() {
    guard swapSnapshot != nil, !seekInFlight, pendingSeekMs == nil else { return }
    guard playerLayer.isReadyForDisplay else { return }
    dismissSwapSnapshot()
  }

  private func dismissSwapSnapshot() {
    swapSnapshotTimeout?.cancel()
    swapSnapshotTimeout = nil
    readyObservation = nil
    swapSnapshot?.removeFromSuperview()
    swapSnapshot = nil
  }

  /// Single emission path. Two invariants JS animates against: positions never move backwards
  /// between explicit discontinuities (seek/rebuild reset the mark), and every tick carries the
  /// transport rate so JS never animates through a stall or resync it cannot see.
  private func emitTick(rate: Double) {
    guard let index else { return }
    var positionMs = player.currentTime().seconds * 1000
    if positionMs < lastEmittedMs { positionMs = lastEmittedMs }
    lastEmittedMs = positionMs
    let clipIndex = index.positionToClip(positionMs).clipIndex
    if clipIndex != lastClipIndex {
      lastClipIndex = clipIndex
      onClipChanged(["clipIndex": clipIndex])
    }
    onTimeUpdate(["positionMs": positionMs, "clipIndex": clipIndex, "rate": rate])
  }

  private func installTimeObserver() {
    if let timeObserver {
      player.removeTimeObserver(timeObserver)
      self.timeObserver = nil
    }
    guard player.currentItem != nil else { return }
    lastEmittedMs = -1
    let interval = CMTime(value: CMTimeValue(max(16, timeUpdateIntervalMs)), timescale: 1000)
    timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) {
      [weak self] _ in
      guard let self else { return }
      // Silent unless actively playing (matches Android): the observer also fires on install and on
      // seeks, and those mid-swap ticks carry the stale pre-seek position — the JS clock would snap
      // the timeline backwards for a beat on every recompile.
      if self.seekInFlight || self.pendingSeekMs != nil || self.swapSettling { return }
      guard self.player.timeControlStatus == .playing else { return }
      self.emitTick(rate: 1)
    }
  }

  private func installEndObserver(for item: AVPlayerItem) {
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      if self.loop {
        // Coalesced seek; playback resumes when the chain drains, never mid-seek.
        self.seekTo(ms: 0)
      } else {
        self.onPlayEnd([:])
      }
    }
  }
}
