package com.dahabtech.mediaeditor.compile

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import com.dahabtech.mediaeditor.records.ClipRecord
import com.dahabtech.mediaeditor.records.OverlayRecord

/** Compiles one clip into an EditedMediaItem; shared verbatim by preview and export. */
@androidx.annotation.OptIn(UnstableApi::class)
object ClipCompiler {
  fun compile(
    context: Context,
    clip: ClipRecord,
    overlays: List<OverlayRecord>,
    clipStartUs: Long,
    clipEndUs: Long,
    presentation: Presentation?,
    renderWidth: Int,
    renderHeight: Int,
  ): EditedMediaItem {
    val audioProcessors = mutableListOf<AudioProcessor>()
    val videoEffects = mutableListOf<Effect>()

    // CompositionPlayer mandates the experimental speed pair placed first in both chains.
    if (clip.speed != 1.0) {
      val speed = Effects.createExperimentalSpeedChangingEffect(constantSpeed(clip.speed))
      audioProcessors.add(speed.first)
      videoEffects.add(speed.second)
    }
    videoEffects.addAll(EffectsFactory.build(context, clip))
    presentation?.let(videoEffects::add)
    TimedOverlayFactory.build(context, overlays, clipStartUs, clipEndUs, renderWidth, renderHeight)
      ?.let(videoEffects::add)

    return EditedMediaItem.Builder(mediaItem(clip))
      // Preview requires the untrimmed source duration up front (TIME_UNSET crashes CompositionPlayer).
      .setDurationUs(clip.sourceDurationMs * 1000)
      .apply {
        if (audioProcessors.isNotEmpty() || videoEffects.isNotEmpty()) {
          setEffects(Effects(audioProcessors, videoEffects))
        }
      }
      .build()
  }

  private fun mediaItem(clip: ClipRecord): MediaItem =
    MediaItem.Builder()
      .setUri(Uri.parse(clip.source))
      .apply {
        if (clip.sourceStartMs > 0 || clip.sourceEndMs < clip.sourceDurationMs) {
          setClippingConfiguration(
            MediaItem.ClippingConfiguration.Builder()
              .setStartPositionMs(clip.sourceStartMs)
              .setEndPositionMs(clip.sourceEndMs)
              .build()
          )
        }
      }
      .build()

  private fun constantSpeed(speed: Double): SpeedProvider = object : SpeedProvider {
    override fun getSpeed(timeUs: Long): Float = speed.toFloat()

    override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
  }
}
