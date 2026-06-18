import { resolveRtspUrl, sanitizeRtspUrl } from '../services/rtsp-url.js';

const checks = [
  {
    name: 'full custom RTSP preserved',
    actual: resolveRtspUrl({
      customRtspUrl: 'rtsp://viewer:pa:ss@camera.local:554/live/main?profile=1&transport=tcp',
      vendor: 'CUSTOM',
      username: 'ignored-user',
      password: 'ignored-pass',
      qualityPreset: 'STANDARD',
    }).rtspUrl,
    expected: 'rtsp://viewer:pa:ss@camera.local:554/live/main?profile=1&transport=tcp',
  },
  {
    name: 'axis host expands with encoded credentials',
    actual: resolveRtspUrl({
      vendor: 'AXIS',
      host: '192.168.1.190',
      rtspPort: 8551,
      username: 'root@example.com',
      password: 'p@ss word',
      qualityPreset: 'STANDARD',
    }).rtspUrl,
    expected: 'rtsp://root%40example.com:p%40ss%20word@192.168.1.190:8551/axis-media/media.amp?videocodec=h264&resolution=1024x576&fps=10&compression=35',
  },
  {
    name: 'hikvision host expands with default port',
    actual: resolveRtspUrl({
      vendor: 'HIKVISION',
      host: '192.168.1.198',
      rtspPort: 554,
      username: 'operator',
      password: 'secret',
      qualityPreset: 'STANDARD',
    }).rtspUrl,
    expected: 'rtsp://operator:secret@192.168.1.198:554/Streaming/Channels/101',
  },
  {
    name: 'two cameras can share host with different forwarded ports',
    actual: [
      resolveRtspUrl({
        vendor: 'AXIS',
        host: '203.0.113.10',
        rtspPort: 8551,
        username: 'root',
        password: 'secret-one',
        qualityPreset: 'STANDARD',
      }).rtspUrl,
      resolveRtspUrl({
        vendor: 'AXIS',
        host: '203.0.113.10',
        rtspPort: 8552,
        username: 'root',
        password: 'secret-two',
        qualityPreset: 'STANDARD',
      }).rtspUrl,
    ].join(' | '),
    expected:
      'rtsp://root:secret-one@203.0.113.10:8551/axis-media/media.amp?videocodec=h264&resolution=1024x576&fps=10&compression=35 | rtsp://root:secret-two@203.0.113.10:8552/axis-media/media.amp?videocodec=h264&resolution=1024x576&fps=10&compression=35',
  },
  {
    name: 'password is sanitized',
    actual: sanitizeRtspUrl('rtsp://operator:secret@192.168.1.198:554/Streaming/Channels/101'),
    expected: 'rtsp://operator:***@192.168.1.198:554/Streaming/Channels/101',
  },
];

let failed = false;

for (const check of checks) {
  const pass = check.actual === check.expected;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${check.name}`);
  console.log(`  actual:   ${check.actual}`);
  console.log(`  expected: ${check.expected}`);
  if (!pass) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
