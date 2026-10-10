"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { Slider } from "./selection-controls";
import { formatTimestamp } from "./transcript-viewer";

export interface AudioPlayerHandle {
  /** Seek to a position in milliseconds (and optionally start playback). */
  seek: (ms: number, play?: boolean) => void;
  play: () => void;
  pause: () => void;
}

export interface AudioPlayerProps {
  src: string;
  /**
   * Controlled seek: whenever this value changes the player seeks to it.
   * (Alternatively use the imperative `ref.seek(ms)`.)
   */
  seekToMs?: number | null;
  onTimeUpdate?: (ms: number) => void;
  className?: string;
}

/** M3-styled audio player with controlled seek via prop or ref. */
export const AudioPlayer = React.forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src, seekToMs, onTimeUpdate, className },
  ref,
) {
  const audio = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [dur, setDur] = React.useState(0);

  const seek = React.useCallback((ms: number, play = false) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, ms / 1000);
    setTime(ms);
    if (play) void a.play().catch(() => {});
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      seek,
      play: () => void audio.current?.play().catch(() => {}),
      pause: () => audio.current?.pause(),
    }),
    [seek],
  );

  React.useEffect(() => {
    if (seekToMs != null) seek(seekToMs, true);
  }, [seekToMs, seek]);

  return (
    <div className={cn("flex items-center gap-2 rounded-full bg-surface-container-high px-2 py-1", className)}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration * 1000)}
        onTimeUpdate={(e) => {
          const ms = e.currentTarget.currentTime * 1000;
          setTime(ms);
          onTimeUpdate?.(ms);
        }}
      />
      <IconButton
        variant="filled"
        icon={playing ? "pause" : "play_arrow"}
        label={playing ? "Pause" : "Play"}
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play().catch(() => {}))}
      />
      <IconButton icon="replay_10" label="Back 10 seconds" onClick={() => seek(time - 10000)} />
      <span className="w-11 text-end label-m tabular-nums text-on-surface-variant">{formatTimestamp(time)}</span>
      <Slider
        aria-label="Seek"
        showValueLabel={false}
        min={0}
        max={Math.max(1, Math.round(dur))}
        step={500}
        value={[Math.min(Math.round(time), Math.max(1, Math.round(dur)))]}
        onValueChange={([v]) => seek(v)}
        className="flex-1"
      />
      <span className="w-11 label-m tabular-nums text-on-surface-variant">{formatTimestamp(dur)}</span>
      <IconButton icon="forward_10" label="Forward 10 seconds" onClick={() => seek(time + 10000)} />
    </div>
  );
});
