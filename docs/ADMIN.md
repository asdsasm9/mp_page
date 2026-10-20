# Admin app

(T-146 completes this file; so far only the section below.)

## Browser encode check

`npm run admin-encode-check` runs the real browser encoder (`apps/admin/src/encode`, with `canvasSurface.ts`) in
headless system Chrome on sharp-made fixtures and checks the output. Needs Chrome (`CHROME_PATH`, else the usual
locations); exit 0 pass, 1 fail, 2 skipped without Chrome. Run it alone, never during `npm test`.

Fixtures (generated into the gitignored `.tmp/admin-encode/`): a 4000x3000 JPEG with Exif orientation 6 and a GPS
position (displays as 3000x4000 portrait), JPEGs of 6000x4000, 3000x2000, 1200x800, 600x400 and 300x200 (all with GPS),
a PNG with alpha and a WebP.

Per photo it asserts: the file set equals `planUploadFiles`; magic bytes and blob type match JPEG/WebP; every size is
within 1 px of `variantPlan`; the master is at most 3000 px and never upscaled; Exif orientation is applied (the
portrait stays portrait); no Exif/GPS/XMP/IPTC in the master, the 1600 JPEG and the OG image (also none in the WebPs);
the dominant colour matches `^#[0-9a-f]{6}$`. It prints one table row per photo with the encode time and ends with
`ADMIN_ENCODE: PASS` or `ADMIN_ENCODE: FAIL`. `--break-exif` injects an Exif+GPS segment into every produced 1600 JPEG
and must make the run fail (exit 1). `--out <dir>` keeps the produced files for a look.

First real run (2026-10-20, headless Chrome on macOS, `ADMIN_ENCODE: PASS`, `--break-exif` exits 1):

```
fixture              source              master     1600       og        webp tiers             files  magic     exif/gps  colour   ms   result
exif-portrait.jpg    3000x4000 (exif 6)  2250x3000  1600x2133  1200x630  480/720/960/1600       7/7    jwwwwjj   none      #848175  317  ok
photo-6000x4000.jpg  6000x4000           3000x2000  1600x1067  1200x630  480/720/960/1600/2400  8/8    jwwwwwjj  none      #827f74  399  ok
photo-3000x2000.jpg  3000x2000           3000x2000  1600x1067  1200x630  480/720/960/1600/2400  8/8    jwwwwwjj  none      #827f74  312  ok
photo-1200x800.jpg   1200x800            1200x800   1200x800   1200x630  480/720/960            6/6    jwwwjj    none      #838075  66   ok
photo-600x400.jpg    600x400             600x400    600x400    600x315   480                    4/4    jwjj      none      #838076  16   ok
photo-300x200.jpg    300x200             300x200    300x200    300x158   480                    4/4    jwjj      none      #838075  10   ok
alpha.png            1500x1000           1500x1000  1500x1000  1200x630  480/720/960            6/6    jwwwjj    none      #a19d92  69   ok
photo.webp           1800x1200           1800x1200  1600x1067  1200x630  480/720/960/1600       7/7    jwwwwjj   none      #827f74  147  ok
peak time per photo: 399 ms (photo-6000x4000.jpg); total 1336 ms
```

The encoder needed no fix: orientation, `convertToBlob` types, OffscreenCanvas drawing and quality all behaved. Only
the `createImageBitmap` decode path is exercised here (the `<img>` fallback is not).
