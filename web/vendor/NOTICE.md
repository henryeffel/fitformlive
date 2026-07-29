# OpenCV.js vendored asset

## File

- Local path: `web/vendor/opencv-4.10.0.js`
- Package: `@techstark/opencv-js`
- Package version: `4.10.0-release.1`
- OpenCV version: 4.10.0
- Download date: 2026-07-28
- Source: `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js`
- SHA-256: `19B46167B59EFBEF9CC3836264B0B657110833E4B1DF84282004B8B3141C048D`

## Reason for vendoring

The previous runtime URL, `https://docs.opencv.org/4.10.0/opencv.js`, returned an HTTP 403 response in a real browser test. This disabled brightness and sharpness analysis even though the MoveNet pose pipeline continued to work.

The pinned OpenCV.js distribution is now served from the same origin as the application to make local and deployed demos reproducible and independent of the OpenCV documentation server's direct-file access policy.

## License

The distribution is provided under the Apache License 2.0. A copy is stored in `web/vendor/OPENCV_JS_LICENSE.txt`.

