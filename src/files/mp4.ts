import {
  BufferTarget,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSample,
  VideoSampleSource,
} from 'mediabunny';

/** Builds an H.264 MP4 frame by frame with the browser's own encoder (WebCodecs). */
export interface Mp4Writer {
  /** An opaque frame and when it shows, in seconds. */
  add(frame: ImageData, timestamp: number, duration: number): Promise<void>;
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}

/** Why MP4 can't be made here (no WebCodecs at all), or null if it might. */
export function mp4Unavailable(): string | null {
  return typeof VideoEncoder === 'undefined' ? 'This browser can’t encode video' : null;
}

/** H.264 needs even dimensions. */
export const evenSize = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function createMp4Writer(
  width: number,
  height: number,
  fps: number,
): Promise<Mp4Writer> {
  const why = mp4Unavailable();
  if (why) throw new Error(why);
  if (width % 2 || height % 2) throw new Error('MP4 needs an even width and height');
  if (!(await canEncodeVideo('avc', { width, height, quality: QUALITY_HIGH }))) {
    throw new Error(`This browser can’t encode H.264 video at ${width} × ${height}`);
  }
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const source = new VideoSampleSource({
    codec: 'avc',
    quality: QUALITY_HIGH,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  return {
    async add(frame, timestamp, duration) {
      const sample = new VideoSample(frame.data, {
        format: 'RGBX',
        codedWidth: frame.width,
        codedHeight: frame.height,
        timestamp,
        duration,
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
    },
    async finish() {
      await output.finalize();
      const buffer = output.target.buffer;
      if (!buffer) throw new Error('The video came out empty');
      return new Blob([buffer], { type: 'video/mp4' });
    },
    async cancel() {
      if (output.state === 'started' || output.state === 'pending') await output.cancel();
    },
  };
}
