const cameraFeed = document.getElementById('cameraFeed');
const overlayCanvas = document.getElementById('overlayCanvas');
const overlayCtx = overlayCanvas.getContext('2d');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const fullscreenButton = document.getElementById('fullscreenButton');
const snapshotButton = document.getElementById('snapshotButton');
const recordButton = document.getElementById('recordButton');
const gestureName = document.getElementById('gestureName');
const confidenceValue = document.getElementById('confidenceValue');
const fpsValue = document.getElementById('fpsValue');
const effectsToggle = document.getElementById('effectsToggle');
const soundToggle = document.getElementById('soundToggle');
const trailToggle = document.getElementById('trailToggle');
const particleToggle = document.getElementById('particleToggle');
const portalToggle = document.getElementById('portalToggle');
const calibrateButton = document.getElementById('calibrateButton');
const sensitivityRange = document.getElementById('sensitivityRange');
const primaryColorInput = document.getElementById('primaryColor');
const accentColorInput = document.getElementById('accentColor');
const modeButtons = document.querySelectorAll('.mode-button');

let camera = null;
let mediaRecorder = null;
let recordedChunks = [];
let recording = false;
let latestResults = null;
let currentGesture = 'Idle';
let currentConfidence = 0;
let lastFrame = performance.now();
let fps = 0;
let motionHistory = [];
let particles = [];
let pinchBall = null;
let shakeOffset = { x: 0, y: 0 };
let calibrating = false;
let gestureBaseline = null;
let effectsEnabled = true;
let soundEnabled = true;
let trailsEnabled = true;
let particlesEnabled = true;
let portalEnabled = true;
let currentMode = 'Fire';
const recordingFileName = 'موقع (يزن)';

const modePalettes = {
  Fire: { base: '#ff6b6b', glow: '#ffb36b', accent: '#ffd46a' },
  Ice: { base: '#6bdfff', glow: '#74aaff', accent: '#c7eeff' },
  Laser: { base: '#57c7ff', glow: '#91f1ff', accent: '#ed63ff' },
  Galaxy: { base: '#d084ff', glow: '#7ae5ff', accent: '#ff72d9' },
};

function resizeCanvas() {
  overlayCanvas.width = window.innerWidth * window.devicePixelRatio;
  overlayCanvas.height = window.innerHeight * window.devicePixelRatio;
  overlayCanvas.style.width = `${window.innerWidth}px`;
  overlayCanvas.style.height = `${window.innerHeight}px`;
  overlayCtx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function playTone(frequency, duration = 0.1) {
  if (!soundEnabled || !window.AudioContext) return;
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.0025, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function updateStatusLabels() {
  gestureName.textContent = currentGesture;
  confidenceValue.textContent = `${Math.min(100, Math.round(currentConfidence * 100))}%`;
  fpsValue.textContent = fps.toFixed(1);
}

function getDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function normalizePoint(point) {
  return {
    x: point.x * window.innerWidth,
    y: point.y * window.innerHeight,
  };
}

function isFingerExtended(landmarks, tipIndex, pipIndex) {
  return landmarks[tipIndex].y < landmarks[pipIndex].y;
}

function detectGesture(landmarks) {
  const sensitivity = parseFloat(sensitivityRange.value) || 1.0;
  const extended = [
    isFingerExtended(landmarks, 8, 6),
    isFingerExtended(landmarks, 12, 10),
    isFingerExtended(landmarks, 16, 14),
    isFingerExtended(landmarks, 20, 18),
  ];
  const extendedCount = extended.filter(Boolean).length;
  const pinchDistance = getDistance(landmarks[4], landmarks[8]);
  const adjustedPinch = 0.05 * (1.25 - sensitivity);

  if (pinchDistance < adjustedPinch) {
    return 'Pinch';
  }
  if (extendedCount >= 4 * sensitivity) {
    return 'Open Hand';
  }
  if (extendedCount === 0) {
    return 'Closed Fist';
  }
  if (extendedCount === 2) {
    return 'Two Fingers';
  }
  if (extendedCount === 3) {
    return 'Three Fingers';
  }
  if (extended[0] && !extended[1] && !extended[2] && !extended[3]) {
    return 'Pointing';
  }
  return 'Idle';
}

function getAverageHandPosition(landmarks) {
  const point = landmarks.reduce((acc, cur) => ({ x: acc.x + cur.x, y: acc.y + cur.y }), { x: 0, y: 0 });
  return { x: point.x / landmarks.length, y: point.y / landmarks.length };
}

function drawHandAuras(landmarks, color) {
  const points = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]].map(normalizePoint);
  overlayCtx.save();
  const gradient = overlayCtx.createRadialGradient(points[0].x, points[0].y, 20, points[0].x, points[0].y, 170);
  gradient.addColorStop(0, `${color}55`);
  gradient.addColorStop(1, `${color}00`);
  overlayCtx.fillStyle = gradient;
  overlayCtx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) overlayCtx.moveTo(point.x, point.y);
    else overlayCtx.lineTo(point.x, point.y);
  });
  overlayCtx.closePath();
  overlayCtx.fill();
  overlayCtx.restore();

  overlayCtx.save();
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = 1.8;
  overlayCtx.setLineDash([14, 14]);
  overlayCtx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) overlayCtx.moveTo(point.x, point.y);
    else overlayCtx.lineTo(point.x, point.y);
  });
  overlayCtx.closePath();
  overlayCtx.stroke();
  overlayCtx.restore();
}

function drawNeonBeam(origin, target, color) {
  overlayCtx.save();
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = 10;
  overlayCtx.shadowBlur = 30;
  overlayCtx.shadowColor = color;
  overlayCtx.beginPath();
  overlayCtx.moveTo(origin.x, origin.y);
  overlayCtx.lineTo(target.x, target.y);
  overlayCtx.stroke();
  overlayCtx.restore();

  overlayCtx.save();
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.28)';
  overlayCtx.lineWidth = 2;
  overlayCtx.beginPath();
  overlayCtx.moveTo(origin.x, origin.y);
  overlayCtx.lineTo(target.x, target.y);
  overlayCtx.stroke();
  overlayCtx.restore();
}

function drawTrail(path, color) {
  overlayCtx.save();
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = 4;
  overlayCtx.globalAlpha = 0.7;
  overlayCtx.beginPath();
  path.forEach((point, index) => {
    if (index === 0) overlayCtx.moveTo(point.x, point.y);
    else overlayCtx.lineTo(point.x, point.y);
  });
  overlayCtx.stroke();
  overlayCtx.restore();
}

function spawnParticles(origin, count, color) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * (1.6 + Math.random() * 2.4),
      vy: Math.sin(angle) * (1.6 + Math.random() * 2.4),
      life: 1.0,
      size: 1.8 + Math.random() * 2.8,
      color,
    });
  }
}

function drawParticles() {
  particles.forEach((p) => {
    overlayCtx.save();
    overlayCtx.globalAlpha = Math.max(p.life, 0) * 0.9;
    overlayCtx.fillStyle = p.color;
    overlayCtx.beginPath();
    overlayCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.restore();
  });
}

function updateParticles(delta) {
  particles = particles.filter((p) => p.life > 0);
  particles.forEach((p) => {
    p.x += p.vx * delta * 60;
    p.y += p.vy * delta * 60;
    p.vy += 0.01 * delta * 60;
    p.life -= 0.018 * delta * 60;
  });
}

function applyScreenShake(force) {
  shakeOffset.x = (Math.random() - 0.5) * force;
  shakeOffset.y = (Math.random() - 0.5) * force;
}

function drawPinchBall(position, color) {
  overlayCtx.save();
  const gradient = overlayCtx.createRadialGradient(position.x, position.y, 4, position.x, position.y, 72);
  gradient.addColorStop(0, `${color}ff`);
  gradient.addColorStop(1, `${color}00`);
  overlayCtx.fillStyle = gradient;
  overlayCtx.beginPath();
  overlayCtx.arc(position.x, position.y, 72, 0, Math.PI * 2);
  overlayCtx.fill();
  overlayCtx.restore();

  overlayCtx.save();
  overlayCtx.strokeStyle = '#ffffff33';
  overlayCtx.lineWidth = 2;
  overlayCtx.beginPath();
  overlayCtx.arc(position.x, position.y, 42, 0, Math.PI * 2);
  overlayCtx.stroke();
  overlayCtx.restore();

  drawAnimeSparkles(position, color, 8);
}

function drawAnimeSparkles(origin, color, count = 10) {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const radius = 52 + Math.random() * 32;
    const x = origin.x + Math.cos(angle) * radius;
    const y = origin.y + Math.sin(angle) * radius;
    const size = 2 + Math.random() * 3;

    overlayCtx.save();
    overlayCtx.globalAlpha = 0.5 + Math.random() * 0.35;
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 1.2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(x - size, y);
    overlayCtx.lineTo(x + size, y);
    overlayCtx.moveTo(x, y - size);
    overlayCtx.lineTo(x, y + size);
    overlayCtx.stroke();
    overlayCtx.restore();
  }
}

function renderHandEffects(handIndex, landmarks, gesture, palette) {
  const center = normalizePoint(getAverageHandPosition(landmarks));

  if (gesture === 'Open Hand') {
    drawHandAuras(landmarks, palette.glow);
    drawAnimeSparkles(center, palette.accent, 12);
    if (particlesEnabled && Math.random() < 0.18) {
      spawnParticles(center, 3, palette.accent);
    }
  }

  if (gesture === 'Closed Fist') {
    if (particlesEnabled) spawnParticles(center, 24, palette.base);
    applyScreenShake(12);
    drawAnimeSparkles(center, palette.glow, 6);
  }

  if (gesture === 'Pointing') {
    const tip = normalizePoint(landmarks[8]);
    const pip = normalizePoint(landmarks[6]);
    const dx = tip.x - pip.x;
    const dy = tip.y - pip.y;
    const target = {
      x: Math.min(window.innerWidth, Math.max(0, tip.x + dx * 20)),
      y: Math.min(window.innerHeight, Math.max(0, tip.y + dy * 20)),
    };
    drawNeonBeam(tip, target, palette.base);
    drawAnimeSparkles(tip, palette.glow, 6);
    if (trailsEnabled) {
      motionHistory.push({ x: tip.x, y: tip.y, alpha: 0.65, color: palette.glow });
    }
  }

  if (gesture === 'Two Fingers') {
    const indexTip = normalizePoint(landmarks[8]);
    const middleTip = normalizePoint(landmarks[12]);
    drawTrail([center, indexTip], palette.glow);
    drawTrail([center, middleTip], palette.accent);
    if (trailsEnabled) {
      motionHistory.push({ x: indexTip.x, y: indexTip.y, alpha: 0.4, color: palette.glow });
      motionHistory.push({ x: middleTip.x, y: middleTip.y, alpha: 0.4, color: palette.accent });
    }
  }

  if (gesture === 'Three Fingers') {
    const fingerPoints = [landmarks[8], landmarks[12], landmarks[16]].map(normalizePoint);
    fingerPoints.forEach((point) => {
      if (particlesEnabled) spawnParticles(point, 2, palette.glow);
    });
  }

  if (gesture === 'Pinch') {
    const pinchCenter = normalizePoint({
      x: (landmarks[4].x + landmarks[8].x) / 2,
      y: (landmarks[4].y + landmarks[8].y) / 2,
    });
    if (!pinchBall) pinchBall = pinchCenter;
    pinchBall = pinchCenter;
    drawPinchBall(pinchBall, palette.accent);
  }

  if (portalEnabled && latestResults && latestResults.multiHandLandmarks && latestResults.multiHandLandmarks.length === 2) {
    const handA = normalizePoint(getAverageHandPosition(latestResults.multiHandLandmarks[0]));
    const handB = normalizePoint(getAverageHandPosition(latestResults.multiHandLandmarks[1]));
    const dist = getDistance({ x: handA.x / window.innerWidth, y: handA.y / window.innerHeight }, { x: handB.x / window.innerWidth, y: handB.y / window.innerHeight });
    if (dist < 0.16) {
      overlayCtx.save();
      const radius = 120 + Math.sin(performance.now() / 180) * 18;
      const gradient = overlayCtx.createRadialGradient((handA.x + handB.x) / 2, (handA.y + handB.y) / 2, 8, (handA.x + handB.x) / 2, (handA.y + handB.y) / 2, radius);
      gradient.addColorStop(0, `${palette.accent}dd`);
      gradient.addColorStop(1, `${palette.base}00`);
      overlayCtx.fillStyle = gradient;
      overlayCtx.beginPath();
      overlayCtx.arc((handA.x + handB.x) / 2, (handA.y + handB.y) / 2, radius, 0, Math.PI * 2);
      overlayCtx.fill();
      overlayCtx.restore();
    }
  }
}

function renderVisuals(delta) {
  overlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  overlayCtx.save();
  overlayCtx.translate(shakeOffset.x, shakeOffset.y);

  if (latestResults && latestResults.multiHandLandmarks && latestResults.multiHandLandmarks.length > 0) {
    latestResults.multiHandLandmarks.forEach((landmarks, index) => {
      const palette = modePalettes[currentMode];
      const gesture = detectGesture(landmarks);
      currentGesture = gesture;
      if (latestResults.multiHandedness && latestResults.multiHandedness[index]) {
        currentConfidence = latestResults.multiHandedness[index].score || currentConfidence;
      }
      renderHandEffects(index, landmarks, gesture, palette);
    });
  } else {
    currentGesture = 'Searching';
  }

  drawParticles();
  overlayCtx.restore();

  motionHistory = motionHistory
    .map((trail) => ({ ...trail, alpha: trail.alpha - 0.015 * delta * 60 }))
    .filter((trail) => trail.alpha > 0);

  motionHistory.forEach((trail) => {
    overlayCtx.save();
    overlayCtx.strokeStyle = trail.color;
    overlayCtx.globalAlpha = trail.alpha;
    overlayCtx.lineWidth = 6;
    overlayCtx.beginPath();
    overlayCtx.moveTo(trail.x, trail.y);
    overlayCtx.lineTo(trail.x + 0.1, trail.y + 0.1);
    overlayCtx.stroke();
    overlayCtx.restore();
  });

  shakeOffset.x *= 0.88;
  shakeOffset.y *= 0.88;
}

function updateSimulation(delta) {
  if (effectsEnabled) {
    updateParticles(delta);
  }
}

function onResults(results) {
  latestResults = results;
  if (results.multiHandedness && results.multiHandedness.length > 0) {
    currentConfidence = results.multiHandedness[0].score || currentConfidence;
  }
  if (calibrating && results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    gestureBaseline = getAverageHandPosition(results.multiHandLandmarks[0]);
    calibrating = false;
    playTone(780, 0.14);
    alert('Calibration complete. Your neutral hand zone has been recorded.');
  }
}

function animate() {
  const now = performance.now();
  const delta = Math.min((now - lastFrame) / 1000, 0.033);
  lastFrame = now;
  fps = 1 / delta;
  updateStatusLabels();
  if (effectsEnabled) {
    renderVisuals(delta);
  } else {
    overlayCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
  updateSimulation(delta);
  requestAnimationFrame(animate);
}

function startExperience() {
  if (camera) return;
  camera = new Camera(cameraFeed, {
    onFrame: async () => {
      await hands.send({ image: cameraFeed });
    },
    width: 1280,
    height: 720,
  });

  camera.start().then(() => {
    startButton.disabled = true;
    stopButton.disabled = false;
    playTone(520, 0.14);
  }).catch((error) => {
    console.error('Camera start failed', error);
    alert('Unable to start camera. Please check permissions.');
  });
}

function stopExperience() {
  if (!camera) return;
  camera.stop();
  camera = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  if (recording) toggleRecording();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function takeSnapshot() {
  const link = document.createElement('a');
  link.download = `${recordingFileName}.png`;
  link.href = overlayCanvas.toDataURL('image/png');
  link.click();
}

function toggleRecording() {
  if (recording) {
    mediaRecorder.stop();
    recordButton.textContent = 'Record';
    recording = false;
    return;
  }
  if (!canvasSupportsRecording()) {
    alert('Recording not supported in this browser.');
    return;
  }

  const stream = overlayCanvas.captureStream(30);
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${recordingFileName}.webm`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  mediaRecorder.start();
  recording = true;
  recordButton.textContent = 'Stop Recording';
}

function canvasSupportsRecording() {
  return typeof MediaRecorder !== 'undefined';
}

function handleModeSelection(event) {
  modeButtons.forEach((button) => button.classList.remove('active'));
  event.currentTarget.classList.add('active');
  currentMode = event.currentTarget.dataset.mode;
  playTone(620, 0.12);
}

function handleToggleChange() {
  effectsEnabled = effectsToggle.checked;
  soundEnabled = soundToggle.checked;
  trailsEnabled = trailToggle.checked;
  particlesEnabled = particleToggle.checked;
  portalEnabled = portalToggle.checked;
}

function calibrateGesture() {
  calibrating = true;
  gestureBaseline = null;
  alert('Hold your hand still in the center of the frame and then press OK to calibrate.');
}

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.75,
  minTrackingConfidence: 0.65,
});

hands.onResults(onResults);

startButton.addEventListener('click', startExperience);
stopButton.addEventListener('click', stopExperience);
fullscreenButton.addEventListener('click', toggleFullscreen);
snapshotButton.addEventListener('click', takeSnapshot);
recordButton.addEventListener('click', toggleRecording);
modeButtons.forEach((button) => button.addEventListener('click', handleModeSelection));
effectsToggle.addEventListener('change', handleToggleChange);
soundToggle.addEventListener('change', handleToggleChange);
trailToggle.addEventListener('change', handleToggleChange);
particleToggle.addEventListener('change', handleToggleChange);
portalToggle.addEventListener('change', handleToggleChange);
calibrateButton.addEventListener('click', calibrateGesture);
sensitivityRange.addEventListener('input', () => {});

window.addEventListener('beforeunload', () => {
  if (camera) camera.stop();
  if (recording && mediaRecorder) mediaRecorder.stop();
});

animate();
