"use client";

import * as React from "react";

const CHARACTERS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MAX_WAVES = 12;
const TRAIL = 12;
const TRAIL_LIFE = 700;
const WAVE_LIFE = 4;
const WAVE_GAP = 0.3;
const WAVE_SPEED = 560;
const WAVE_SLOWDOWN = 0.66;
const WAVE_EDGE = 10;
const WAVE_TAIL = 30;
const DRIFT = [-30, 12] as const;

const VERTEX = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform sampler2D atlas;
uniform vec2 size;
uniform vec2 cell;
uniform float dpr;
uniform float count;
uniform float time;
uniform float rest;
uniform float haze;
uniform float hoverInk;
uniform float activity;
uniform vec2 drift;
uniform vec3 color;
uniform vec3 accent;
uniform vec4 waves[${MAX_WAVES * 2}];
uniform vec4 trail[${TRAIL}];

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float smoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float clouds(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 4; i++) {
    v += a * smoothNoise(p);
    p = p * 2.02 + vec2(17.1, 9.4);
    a *= 0.5;
  }
  return v;
}

float outline(float kind, float angle, float phase) {
  if (kind < 0.5) return 1.0;
  if (kind < 1.5) {
    float s = sin(angle);
    float c = cos(angle);
    return (2.0 - 2.0 * s + s * sqrt(abs(c)) / (s + 1.4)) * 0.42;
  }
  return 1.0 + 0.14 * sin(3.0 * angle + phase) + 0.08 * sin(5.0 * angle - phase * 1.3);
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  vec2 index = floor(pixel / cell);
  vec2 point = (index + 0.5) * cell / dpr;

  float ring = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 a = waves[i * 2];
    vec4 b = waves[i * 2 + 1];
    if (a.w <= 0.0) continue;
    vec2 v = point - a.xy;
    float angle = atan(-v.y, v.x);
    float shape = mix(1.0, outline(b.x, angle, b.z), b.y);
    shape *= 1.0 + 0.07 * sin(3.0 * angle + b.z + b.w) + 0.05 * sin(5.0 * angle - b.z * 1.7 - b.w * 1.3) + 0.03 * sin(9.0 * angle + b.w * 2.1);
    float d = length(v) - a.z * shape;
    float k = d > 0.0 ? d / ${WAVE_EDGE.toFixed(1)} : d / ${WAVE_TAIL.toFixed(1)};
    ring = max(ring, exp(-k * k) * a.w);
  }

  float hover = 0.0;
  for (int i = 0; i < ${TRAIL}; i++) {
    vec4 t = trail[i];
    if (t.w <= 0.0) continue;
    vec2 v = point - t.xy;
    hover += t.w * exp(-dot(v, v) / (2.0 * t.z * t.z));
  }
  hover = min(hover, 1.0);

  mat2 turn = mat2(0.82, 0.57, -0.57, 0.82);
  vec2 q = turn * (point - drift);
  float blob = smoothNoise(vec2(q.x / 140.0, q.y / 80.0) + vec2(time * 0.04, 0.0)) * 0.62
    + smoothNoise(vec2(q.x / 62.0, q.y / 36.0) + vec2(3.7, time * 0.06)) * 0.38;
  float grain = smoothNoise(vec2(q.x / 30.0, q.y / 14.0) + vec2(time * 0.2, 7.3));
  float cloud = blob * (0.82 + 0.24 * grain);
  float mask = pow(smoothstep(0.47 - 0.2 * activity, 0.84, cloud), 2.6);

  float seed = hash(index);
  float epoch = floor(time * 0.08 * (0.4 + seed) + seed * 97.0);
  float character = floor(hash(index + epoch * 0.137) * count);
  vec2 local = fract(pixel / cell);
  float ink = pow(texture2D(atlas, vec2((character + local.x) / count, local.y)).a, 1.7);

  float grey = ink * clamp(rest + haze * mask * (1.0 + 0.3 * activity) + hoverInk * hover * (0.6 + 0.4 * mask), 0.0, 1.0);
  float blue = ink * ring * 0.72;
  float alpha = grey + blue - grey * blue;
  vec3 tint = color * grey * (1.0 - blue) + accent * blue;
  gl_FragColor = vec4(tint, alpha);
}
`;

type Wave = {
  x: number;
  y: number;
  kind: number;
  phase: number;
  strength: number;
  start: number;
};

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function toRgb(color: string): [number, number, number] {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return [0.9, 0.9, 0.9];
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return [r! / 255, g! / 255, b! / 255];
}

function drawAtlas(cellWidth: number, cellHeight: number, font: string) {
  const atlas = document.createElement("canvas");
  atlas.width = Math.ceil(cellWidth * CHARACTERS.length);
  atlas.height = Math.ceil(cellHeight);
  const context = atlas.getContext("2d")!;
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff";
  for (let i = 0; i < CHARACTERS.length; i++)
    context.fillText(CHARACTERS[i]!, (i + 0.5) * cellWidth, cellHeight / 2);
  return atlas;
}

type Frame = {
  width: number;
  height: number;
  dpr: number;
  cell: [number, number];
  time: number;
  activity: number;
  drift: [number, number];
  color: [number, number, number];
  accent: [number, number, number];
  waves: Float32Array;
  trail: Float32Array;
};

function createRenderer(gl: WebGLRenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    atlas: at("atlas"),
    size: at("size"),
    cell: at("cell"),
    dpr: at("dpr"),
    count: at("count"),
    time: at("time"),
    rest: at("rest"),
    haze: at("haze"),
    hoverInk: at("hoverInk"),
    activity: at("activity"),
    drift: at("drift"),
    color: at("color"),
    accent: at("accent"),
    waves: at("waves"),
    trail: at("trail"),
  };
  gl.uniform1i(uniforms.atlas, 0);
  gl.uniform1f(uniforms.count, CHARACTERS.length);
  gl.uniform1f(uniforms.rest, 0);
  gl.uniform1f(uniforms.haze, 0.24);
  gl.uniform1f(uniforms.hoverInk, 0.3);

  return {
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
    atlas(image: HTMLCanvasElement) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
    },
    draw(frame: Frame) {
      gl.viewport(0, 0, frame.width, frame.height);
      gl.uniform2f(uniforms.size, frame.width, frame.height);
      gl.uniform2f(uniforms.cell, ...frame.cell);
      gl.uniform1f(uniforms.dpr, frame.dpr);
      gl.uniform1f(uniforms.time, frame.time);
      gl.uniform1f(uniforms.activity, frame.activity);
      gl.uniform2f(uniforms.drift, ...frame.drift);
      gl.uniform3f(uniforms.color, ...frame.color);
      gl.uniform3f(uniforms.accent, ...frame.accent);
      gl.uniform4fv(uniforms.waves, frame.waves);
      gl.uniform4fv(uniforms.trail, frame.trail);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

export function GlyphBackground({ dark }: { dark: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: true,
      antialias: false,
    });
    const renderer = gl && createRenderer(gl);
    if (!renderer) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const waves: Wave[] = [];
    const trail: { x: number; y: number; t: number }[] = [];
    const waveData = new Float32Array(MAX_WAVES * 8);
    const trailData = new Float32Array(TRAIL * 4);
    const cell: [number, number] = [7, 13];
    const color = toRgb(dark ? "#c1b1ff" : "#48347a");
    const accent = toRgb(dark ? "#aa9cff" : "#5742c4");
    let dpr = 1;
    let clock = 0;
    let last = 0;
    let frame = 0;

    function draw() {
      if (!canvas || !renderer) return;
      while (waves[0] && clock - waves[0].start >= WAVE_LIFE * 1000)
        waves.shift();
      while (trail[0] && clock - trail[0].t >= TRAIL_LIFE) trail.shift();
      waveData.fill(0);
      waves.forEach((wave, i) => {
        const age = (clock - wave.start) / 1000;
        if (age <= 0) return;
        const radius = (WAVE_SPEED * age) / (1 + WAVE_SLOWDOWN * age);
        const fade =
          Math.min(1, age / 0.05) * Math.exp(-Math.max(0, age - 0.4) / 1.3);
        waveData.set(
          [
            wave.x,
            wave.y,
            radius,
            fade * wave.strength,
            wave.kind,
            0.12 + 0.5 * Math.min(1, age / 2.2),
            wave.phase,
            age * 3,
          ],
          i * 8,
        );
      });
      trailData.fill(0);
      trail.forEach((point, i) => {
        const age = (clock - point.t) / TRAIL_LIFE;
        trailData.set(
          [point.x, point.y, 40 + 25 * age, 0.3 * (1 - age) ** 2],
          i * 4,
        );
      });
      const time = clock / 1000;
      renderer.draw({
        width: canvas.width,
        height: canvas.height,
        dpr,
        cell,
        time,
        activity: (trail.length / TRAIL) * 0.55,
        drift: [DRIFT[0] * time, DRIFT[1] * time],
        color,
        accent,
        waves: waveData,
        trail: trailData,
      });
    }

    function resize() {
      if (!canvas || !renderer) return;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      cell[0] = Math.round(7 * dpr);
      cell[1] = Math.round(13 * dpr);
      renderer.atlas(drawAtlas(cell[0], cell[1], `${10 * dpr}px monospace`));
      draw();
    }

    function tick(now: number) {
      if (now - last >= 32) {
        clock += Math.min(64, now - last);
        last = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function updateMotion() {
      cancelAnimationFrame(frame);
      if (!document.hidden && !motion.matches) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      } else {
        waves.length = 0;
        trail.length = 0;
        draw();
      }
    }

    function move(event: PointerEvent) {
      if (motion.matches || event.pointerType === "touch") return;
      const previous = trail.at(-1);
      if (
        previous &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 18
      )
        return;
      if (trail.length === TRAIL) trail.shift();
      trail.push({ x: event.clientX, y: event.clientY, t: clock });
    }

    function ripple(event: PointerEvent) {
      if (
        motion.matches ||
        (event.target instanceof Element &&
          event.target.closest("a, button, input, select, textarea, label"))
      )
        return;
      for (const [delay, strength] of [
        [0, 1],
        [WAVE_GAP, 0.55],
      ] as const) {
        if (waves.length === MAX_WAVES) waves.shift();
        waves.push({
          x: event.clientX,
          y: event.clientY,
          start: clock + delay * 1000,
          kind: 1 + Math.floor(Math.random() * 2),
          phase: Math.random() * Math.PI * 2,
          strength,
        });
      }
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    updateMotion();
    document.addEventListener("visibilitychange", updateMotion);
    motion.addEventListener("change", updateMotion);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", ripple, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", updateMotion);
      motion.removeEventListener("change", updateMotion);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", ripple);
      renderer.dispose();
    };
  }, [dark]);

  return <canvas ref={canvasRef} className="glyph-canvas" aria-hidden="true" />;
}
