package com.dahabtech.mediaeditor.compile

import android.content.Context
import androidx.media3.common.OverlaySettings
import androidx.media3.common.VideoCompositorSettings
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import com.dahabtech.mediaeditor.records.ClipRecord
import com.dahabtech.mediaeditor.records.PipClipRecord
import com.dahabtech.mediaeditor.records.ProjectRecord
import com.dahabtech.mediaeditor.records.TimelineIndex
import kotlin.math.max
import kotlin.math.roundToInt

class CompiledTimeline(
  val composition: Composition,
  val renderWidth: Int,
  val renderHeight: Int,
  val totalDurationMs: Long,
  val index: TimelineIndex,
)

/** Compiles a parsed project into the Composition consumed by both preview and export. */
@androidx.annotation.OptIn(UnstableApi::class)
object TimelineCompiler {
  fun compile(context: Context, project: ProjectRecord): CompiledTimeline {
    val clips = project.clips
    val index = TimelineIndex(clips)
    val (renderWidth, renderHeight) = resolveRenderSize(project)
    val pips = project.pips.mapNotNull { pip ->
      compilePip(context, pip, index.totalDurationUs, renderWidth, renderHeight)
    }
    val hasPips = pips.isNotEmpty()

    // Single pure-trim clip must stay passthrough, so Presentation only appears when required.
    // Pip compositing needs main frames at the exact output size before the compositor runs.
    val normalize =
      clips.size > 1 || project.output?.compression != null || isCapped(project) || hasPips
    val presentation = if (normalize) {
      Presentation.createForWidthAndHeight(renderWidth, renderHeight, Presentation.LAYOUT_SCALE_TO_FIT)
    } else {
      null
    }

    // With pips, timed overlays hoist to composition level so they render above every video layer.
    val itemOverlays = if (hasPips) emptyList() else project.overlays
    val items = clips.mapIndexed { i, clip ->
      ClipCompiler.compile(
        context = context,
        clip = clip,
        overlays = itemOverlays,
        clipStartUs = index.clipStartUs(i),
        clipEndUs = index.clipStartUs(i) + TimelineIndex.clipOutputDurationUs(clip),
        presentation = presentation,
        renderWidth = renderWidth,
        renderHeight = renderHeight,
      )
    }
    val sequence = EditedMediaItemSequence.Builder(*items.toTypedArray())
      .apply { if (needsForcedAudio(context, project, hasPips)) experimentalSetForceAudioTrack(true) }
      .build()
    val builder = Composition.Builder(listOf(sequence) + pips.map { it.sequence })
    if (hasPips) {
      builder.setVideoCompositorSettings(
        PipCompositorSettings(renderWidth, renderHeight, pips.map { it.window })
      )
      TimedOverlayFactory
        .build(context, project.overlays, 0, index.totalDurationUs, renderWidth, renderHeight)
        ?.let { builder.setEffects(Effects(emptyList(), listOf(it))) }
    }
    return CompiledTimeline(
      composition = builder.build(),
      renderWidth = renderWidth,
      renderHeight = renderHeight,
      totalDurationMs = index.totalDurationUs / 1000,
      index = index,
    )
  }

  private class PipWindow(
    val startUs: Long,
    val endUs: Long,
    val scale: Float,
    /** Wire value — clockwise degrees. */
    val rotationDegrees: Float,
    val opacity: Float,
    val anchorX: Float,
    val anchorY: Float,
  )

  private class CompiledPip(val sequence: EditedMediaItemSequence, val window: PipWindow)

  /** inputId 0 = main sequence (identity); inputId n = pips[n − 1], windowed via time-varying alpha. */
  private class PipCompositorSettings(
    outputWidth: Int,
    outputHeight: Int,
    private val windows: List<PipWindow>,
  ) : VideoCompositorSettings {
    private val outputSize = Size(outputWidth, outputHeight)

    override fun getOutputSize(inputSizes: List<Size>): Size = outputSize

    override fun getOverlaySettings(inputId: Int, presentationTimeUs: Long): OverlaySettings {
      val window = windows.getOrNull(inputId - 1) ?: return StaticOverlaySettings.Builder().build()
      val visible = presentationTimeUs >= window.startUs && presentationTimeUs < window.endUs
      return StaticOverlaySettings.Builder()
        .setScale(window.scale, window.scale)
        // Wire rotation is clockwise; media3 overlay rotation is counter-clockwise.
        .setRotationDegrees(-window.rotationDegrees)
        // Gap frames decode opaque — alpha 0 outside the window keeps them off the main video.
        .setAlphaScale(if (visible) window.opacity else 0f)
        .setBackgroundFrameAnchor(window.anchorX, window.anchorY)
        .build()
    }
  }

  private fun compilePip(
    context: Context,
    pip: PipClipRecord,
    totalDurationUs: Long,
    renderWidth: Int,
    renderHeight: Int,
  ): CompiledPip? {
    val startUs = pip.placement.timelineStartMs * 1000L
    if (startUs < 0 || startUs >= totalDurationUs) return null
    val clip = clampToWindow(pip.clip, totalDurationUs - startUs) ?: return null
    val itemDurationUs = TimelineIndex.clipOutputDurationUs(clip)
    if (itemDurationUs <= 0) return null

    // Aspect-fit to the canvas so overlay setScale(s, s) means s × canvas on every source size.
    val item = ClipCompiler.compile(
      context = context,
      clip = clip,
      overlays = emptyList(),
      clipStartUs = 0,
      clipEndUs = 0,
      presentation = Presentation.createForWidthAndHeight(
        renderWidth, renderHeight, Presentation.LAYOUT_SCALE_TO_FIT
      ),
      renderWidth = renderWidth,
      renderHeight = renderHeight,
    )
    val sequence = EditedMediaItemSequence.Builder()
      .apply { if (startUs > 0) addGap(startUs) }
      .addItem(item)
      .apply {
        val tailUs = totalDurationUs - startUs - itemDurationUs
        if (tailUs > 0) addGap(tailUs)
      }
      // Gap segments carry no audio; the forced track supplies the silence mixing needs.
      .experimentalSetForceAudioTrack(true)
      .build()
    return CompiledPip(
      sequence = sequence,
      window = PipWindow(
        startUs = startUs,
        endUs = startUs + itemDurationUs,
        scale = pip.placement.scale.toFloat(),
        rotationDegrees = pip.placement.rotation.toFloat(),
        opacity = pip.placement.opacity.toFloat(),
        anchorX = (2.0 * pip.placement.x - 1.0).toFloat(),
        anchorY = (1.0 - 2.0 * pip.placement.y).toFloat(),
      ),
    )
  }

  /** Shortens the trim so the pip's output never outruns the main timeline. */
  private fun clampToWindow(clip: ClipRecord, availableUs: Long): ClipRecord? {
    if (TimelineIndex.clipOutputDurationUs(clip) <= availableUs) return clip
    val trimmedMs = (availableUs * clip.speed / 1000.0).toLong()
    if (trimmedMs <= 0) return null
    return clip.copy(sourceEndMs = clip.sourceStartMs + trimmedMs)
  }

  /** First clip's post-crop display size, long-edge capped (never upscaled), even-rounded. */
  fun resolveRenderSize(project: ProjectRecord): Pair<Int, Int> {
    val first = project.clips.first()
    val baseW = (first.crop?.width ?: first.width).toDouble()
    val baseH = (first.crop?.height ?: first.height).toDouble()
    val cap = listOfNotNull(project.output?.maxDimension, project.output?.compression?.maxDimension)
      .filter { it > 0 }
      .minOrNull()
    val longEdge = max(baseW, baseH)
    val scale = if (cap != null && longEdge > cap) cap / longEdge else 1.0
    return evenClamp(baseW * scale) to evenClamp(baseH * scale)
  }

  private fun isCapped(project: ProjectRecord): Boolean {
    val first = project.clips.first()
    val (w, h) = resolveRenderSize(project)
    return w != evenClamp((first.crop?.width ?: first.width).toDouble()) ||
      h != evenClamp((first.crop?.height ?: first.height).toDouble())
  }

  // Silent clips need generated silence when mixing with audio clips, and the experimental
  // speed pair clocks video retiming off the audio pipeline — without a track it stalls.
  private fun needsForcedAudio(context: Context, project: ProjectRecord, hasPips: Boolean): Boolean {
    val anySpeed = project.clips.any { it.speed != 1.0 }
    if (project.clips.size == 1 && !hasPips) {
      return anySpeed && !SourceProbe.hasAudioTrack(context, project.clips[0].source)
    }
    // Pip sequences always carry (forced) audio, so the main sequence must offer a track to mix.
    return anySpeed || hasPips || project.clips.any { SourceProbe.hasAudioTrack(context, it.source) }
  }

  /** Round to an even integer (H.264 encoder requirement) with a 2-pixel floor. */
  fun evenClamp(value: Double): Int {
    val rounded = value.roundToInt()
    return max(2, rounded and 1.inv())
  }
}
