import { createTarget, deleteTarget, type Target } from '../gl/target';
import { imageToDataURL, readImage, readPremultiplied } from './readback';
import { fitWithin, Scaler } from './Scaler';

/** Longest side of a layer thumbnail, px. */
export const THUMB_SIZE = 96;

/**
 * Small previews by repeated 2× linear downsampling (see Scaler). The chain is allocated once per
 * source size.
 */
export class Thumbnailer {
  private scaler: Scaler;
  private out: Target;

  constructor(
    private gl: WebGL2RenderingContext,
    docW: number,
    docH: number,
    size = THUMB_SIZE,
  ) {
    const { w, h } = fitWithin(docW, docH, size);
    this.scaler = new Scaler(gl, docW, docH, w, h);
    this.out = createTarget(gl, w, h);
  }

  /** PNG data URL. */
  render(src: Target): string {
    return imageToDataURL(this.renderImage(src));
  }

  /** Straight alpha. */
  renderImage(src: Target): ImageData {
    this.scaler.run(src, this.out);
    return readImage(this.gl, this.out);
  }

  /** Premultiplied RGBA8 bytes, with the size. */
  renderPremultiplied(src: Target): { data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } {
    this.scaler.run(src, this.out);
    return { data: readPremultiplied(this.gl, this.out), w: this.out.w, h: this.out.h };
  }

  dispose() {
    this.scaler.dispose();
    deleteTarget(this.gl, this.out);
  }
}
