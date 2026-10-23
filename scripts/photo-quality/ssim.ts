// Luma SSIM for the offline photo-quality measurement (WP-10 step 1, T-265). Pure, no dependency.
// Mean SSIM over 8x8 windows moved in steps of 4 (shrunk to the image when it is smaller), on 8-bit
// grey values; constants C1 = (0.01 * 255)^2 and C2 = (0.03 * 255)^2 (Wang et al. 2004, uniform window).
// 1.0 means identical; lower means more different.

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const WINDOW = 8;
const STEP = 4;

export function lumaSsim(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number): number {
  if (width < 1 || height < 1) throw new RangeError('ssim: empty image');
  if (a.length !== width * height || b.length !== width * height) {
    throw new RangeError(`ssim: buffer length ${a.length}/${b.length} does not match ${width}x${height}`);
  }
  const win = Math.min(WINDOW, width, height);
  const n = win * win;
  let sum = 0;
  let count = 0;
  const lastY = height - win;
  const lastX = width - win;
  for (let y0 = 0; ; y0 += STEP) {
    const y = Math.min(y0, lastY);
    for (let x0 = 0; ; x0 += STEP) {
      const x = Math.min(x0, lastX);
      let sa = 0;
      let sb = 0;
      let saa = 0;
      let sbb = 0;
      let sab = 0;
      for (let j = 0; j < win; j++) {
        const row = (y + j) * width + x;
        for (let i = 0; i < win; i++) {
          const va = a[row + i] as number;
          const vb = b[row + i] as number;
          sa += va;
          sb += vb;
          saa += va * va;
          sbb += vb * vb;
          sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const varA = saa / n - ma * ma;
      const varB = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (varA + varB + C2));
      count++;
      if (x === lastX) break;
    }
    if (y === lastY) break;
  }
  return sum / count;
}
