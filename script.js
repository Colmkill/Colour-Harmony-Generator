/* =========================================================================
   Colour Harmony Generator — script.js
   All colour maths, wheel rendering and UI wiring live here. Functions are
   kept small and single-purpose so the harmony system can grow (new modes,
   new gradient types) without rewriting the rest of the app.
   ========================================================================= */

(() => {
  "use strict";

  /* ----------------------------------------------------------------------
     DOM references
     -------------------------------------------------------------------- */
  const wheelCanvas   = document.getElementById("colourWheel");
  const markerCanvas  = document.getElementById("markerLayer");
  const wheelHint      = document.getElementById("wheelHint");
  const previewTile    = document.getElementById("previewTile");

  const btnTriad       = document.getElementById("btnTriad");
  const btnQuad        = document.getElementById("btnQuad");
  const pointDirectionRange = document.getElementById("pointDirectionRange");
  const pointDirectionValueEl = document.getElementById("pointDirectionValue");
  const spreadRange     = document.getElementById("spreadRange");
  const spreadValueEl   = document.getElementById("spreadValue");

  const gradientTypeSel = document.getElementById("gradientType");
  const directionRow    = document.getElementById("directionRow");
  const dialRow         = document.getElementById("dialRow");
  const directionRange  = document.getElementById("directionRange");
  const directionValueEl = document.getElementById("directionValue");
  const directionDial   = document.getElementById("directionDial");
  const dialNeedle      = document.getElementById("dialNeedle");

  const animToggle      = document.getElementById("animToggle");
  const reducedMotionNote = document.getElementById("reducedMotionNote");
  const forceMotionBtn  = document.getElementById("forceMotionBtn");
  const btnAnimDrift    = document.getElementById("btnAnimDrift");
  const btnAnimPoints   = document.getElementById("btnAnimPoints");
   /////////////////////////
  const btnAnimPointsDrift   = document.getElementById("btnAnimPointsDrift");
   ////////////////////////
  const speedRange      = document.getElementById("speedRange");
  const speedValueEl    = document.getElementById("speedValue");
  const animDirectionRange = document.getElementById("animDirectionRange");
  const animDirectionValueEl = document.getElementById("animDirectionValue");

  // The "Points" animation cycles the tile's background-colour through the
  // current harmony colours. Its @keyframes depend on how many colours
  // there are and what their hex values are right now, so we generate the
  // rule in JS and keep it in one <style> tag that we update on every
  // render, rather than trying to express it as static CSS.
  const pointsKeyframesStyle = document.createElement("style");
  pointsKeyframesStyle.id = "pointsKeyframesStyle";
  document.head.appendChild(pointsKeyframesStyle);
  const POINTS_KEYFRAMES_NAME = "pointsCycle";

  const colourListEl    = document.getElementById("colourList");
  const cssOutputEl     = document.getElementById("cssOutput");
  const copyCssBtn      = document.getElementById("copyCssBtn");
  const cssCopyFeedback = document.getElementById("cssCopyFeedback");

  const wheelCtx  = wheelCanvas.getContext("2d");
  const markerCtx = markerCanvas.getContext("2d");

  /* ----------------------------------------------------------------------
     Application state
     A single object keeps every input the app needs to regenerate its
     output, so any control change can just call render() at the end.
     -------------------------------------------------------------------- */
  const state = {
    mouseX: 210,          // pixel position of the primary point on the wheel canvas
    mouseY: 210,
    lightness: 55,         // fixed per-colour base lightness
    mode: "triad",          // "triad" | "quad"
    pointDirection: 0,       // degrees — rotates the whole harmony layout around the mouse
    pointDistance: 100,       // pixels — how far secondary points sit from the mouse
    gradientType: "linear",    // "linear" | "radial" | "conic"
    direction: 135,              // degrees, linear/conic gradients
    animation: {
      enabled: false,
      style: "drift",  // "drift" (hue-rotate filter) | "points" (cycle through harmony colours)
      speed: 8,     // 1 (slow) - 20 (fast)
      forward: true,
      forceMotion: false  // user's explicit override of the OS reduced-motion setting
    },
    hasInteracted: false
  };

  // Default layout angles for each harmony mode, in degrees, before the
  // user's Point direction offset is applied. These place the secondary
  // points evenly around the primary — they no longer determine hue.
  const HARMONY_LAYOUT_ANGLES = {
    triad: [0, 120, 240],
    quad: [0, 90, 180, 270]
  };

  /* ----------------------------------------------------------------------
     Colour maths
     -------------------------------------------------------------------- */

  // Convert an HSL triple to a "#rrggbb" hex string.
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.min(100, Math.max(0, s)) / 100;
    l = Math.min(100, Math.max(0, l)) / 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120)  { r = x; g = c; b = 0; }
    else if (h < 180)   { r = 0; g = c; b = x; }
    else if (h < 240)    { r = 0; g = x; b = c; }
    else if (h < 300)     { r = x; g = 0; b = c; }
    else                    { r = c; g = 0; b = x; }

    const toHex = (v) => {
      const n = Math.round((v + m) * 255);
      return n.toString(16).padStart(2, "0");
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  // Given a raw pixel position on the wheel canvas, return the hue/saturation
  // it represents. Positions outside the circle are clamped to the edge so
  // interaction never "drops" the pointer.
  function getColourFromWheelPosition(x, y, canvas) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = canvas.width / 2;

    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Angle 0 = right, increasing clockwise to match the wheel's own
    // rendering (see createColourWheel).
    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    const clampedDist = Math.min(dist, radius);
    const sat = (clampedDist / radius) * 100;

    return { hue: angle, sat, lightness: state.lightness };
  }

  // Triad: three layout angles, 120° apart, plus the user's direction
  // offset. These are *positions* around the mouse, not hues — the colour
  // at each position is sampled from the wheel afterwards.
  function calculateTriad(directionOffset) {
    return HARMONY_LAYOUT_ANGLES.triad.map(
      (a) => ((a + directionOffset) % 360 + 360) % 360
    );
  }

  // Quad: four layout angles, 90° apart, plus the direction offset.
  function calculateQuad(directionOffset) {
    return HARMONY_LAYOUT_ANGLES.quad.map(
      (a) => ((a + directionOffset) % 360 + 360) % 360
    );
  }

  // Turns the mouse position plus the current mode/direction/distance into
  // a full list of colour objects. The mouse is a pure pivot — every point,
  // including the first, sits `distance` pixels out from it at its layout
  // angle, so a triad renders as a triangle centred on the mouse and a
  // quad as a square centred on it. Each point's colour is then *sampled*
  // from the wheel at that exact pixel — so the swatch always matches
  // what's drawn under the marker, and dragging the sliders always lands
  // on a real, predictable colour (including green) instead of a
  // formula-derived one that can drift away from the visible wheel.
  function calculateHarmonyPoints(mouseX, mouseY, lightness, mode, directionOffset, distance) {
    const layoutAngles = mode === "quad" ? calculateQuad(directionOffset) : calculateTriad(directionOffset);
    const maxX = wheelCanvas.width;
    const maxY = wheelCanvas.height;

    return layoutAngles.map((angle, i) => {
      const rad = (angle * Math.PI) / 180;
      // Clamp to the canvas bounds so a point near the edge can't sample
      // outside the wheel and produce an undefined colour.
      const x = Math.min(Math.max(mouseX + Math.cos(rad) * distance, 0), maxX);
      const y = Math.min(Math.max(mouseY + Math.sin(rad) * distance, 0), maxY);

      const { hue, sat } = getColourFromWheelPosition(x, y, wheelCanvas);

      return {
        index: i + 1,
        hue,
        sat,
        lightness,
        hex: hslToHex(hue, sat, lightness),
        x,
        y
      };
    });
  }

  /* ----------------------------------------------------------------------
     Wheel rendering
     -------------------------------------------------------------------- */

  // Paints the static hue/saturation wheel once. Hue is the angle,
  // saturation is the distance from the centre; lightness stays fixed so
  // every point on the wheel is a "pure" pickable colour.
  function createColourWheel() {
    const radius = wheelCanvas.width / 2;
    const cx = radius;
    const cy = radius;
    const image = wheelCtx.createImageData(wheelCanvas.width, wheelCanvas.height);

    for (let py = 0; py < wheelCanvas.height; py++) {
      for (let px = 0; px < wheelCanvas.width; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (py * wheelCanvas.width + px) * 4;

        if (dist > radius) {
          image.data[i + 3] = 0; // transparent outside the circle
          continue;
        }

        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        if (angle < 0) angle += 360;
        const sat = (dist / radius) * 100;

        const hex = hslToHex(angle, sat, state.lightness);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }

    wheelCtx.putImageData(image, 0, 0);
  }

  // Draws the primary + harmony markers over the wheel on every update.
  // Kept on a separate canvas layer so we never repaint the (expensive)
  // wheel gradient itself during interaction.
  function drawMarkers(colours, mouseX, mouseY) {
    markerCtx.clearRect(0, 0, markerCanvas.width, markerCanvas.height);

    // Pivot dot: marks the mouse position itself, which is no longer one
    // of the colour points now every harmony point sits on the distance
    // circle around it.
    markerCtx.beginPath();
    markerCtx.arc(mouseX, mouseY, 4, 0, Math.PI * 2);
    markerCtx.fillStyle = "rgba(245, 243, 239, 0.85)";
    markerCtx.fill();

    colours.forEach((c) => {
      markerCtx.beginPath();
      markerCtx.arc(c.x, c.y, 8, 0, Math.PI * 2);
      markerCtx.fillStyle = c.hex;
      markerCtx.fill();
      markerCtx.lineWidth = 2;
      markerCtx.strokeStyle = "#f5f3ef";
      markerCtx.stroke();

      // Label with the hex value near the marker, where there's room.
      const labelX = Math.min(Math.max(c.x, 34), markerCanvas.width - 34);
      const labelY = c.y > markerCanvas.height / 2 ? c.y - 16 : c.y + 22;

      markerCtx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
      markerCtx.textAlign = "center";
      const textWidth = markerCtx.measureText(c.hex).width;

      markerCtx.fillStyle = "rgba(10, 10, 14, 0.72)";
      markerCtx.fillRect(labelX - textWidth / 2 - 5, labelY - 12, textWidth + 10, 16);

      markerCtx.fillStyle = "#f5f3ef";
      markerCtx.fillText(c.hex, labelX, labelY);
    });
  }

  /* ----------------------------------------------------------------------
     Gradient + CSS generation
     -------------------------------------------------------------------- */

  // Even stops across 0-100%, e.g. [0,50,100] for three colours.
  function getColourStops(count) {
    if (count === 1) return [0];
    const stops = [];
    for (let i = 0; i < count; i++) {
      stops.push(Math.round((i / (count - 1)) * 100));
    }
    return stops;
  }

  function buildStopList(colours) {
    const stops = getColourStops(colours.length);
    return colours.map((c, i) => `${c.hex} ${stops[i]}%`).join(", ");
  }

  // Produces the CSS gradient() function string for the current type.
  function generateGradient(colours, type, direction) {
    const stopList = buildStopList(colours);

    if (type === "radial") {
      return `radial-gradient(circle, ${stopList})`;
    }
    if (type === "conic") {
      return `conic-gradient(from ${direction}deg, ${stopList})`;
    }
    return `linear-gradient(${direction}deg, ${stopList})`;
  }

  // Builds a @keyframes rule that cycles background-colour through every
  // harmony colour in turn, looping smoothly back to the first at 100%.
  // Used both to drive the live preview and (in generateCSS) as copy-ready
  // output, so it takes the keyframe name as a parameter.
  function buildPointCycleKeyframes(colours, name) {
    const n = colours.length;
    const lines = colours.map((c, i) => {
      const pct = Math.round((i / n) * 100);
      return `  ${pct}% { background-color: ${c.hex}; }`;
    });
    lines.push(`  100% { background-color: ${colours[0].hex}; }`);
    return `@keyframes ${name} {\n${lines.join("\n")}\n}`;
  }

  // Applies the generated gradient (and animation state) to the preview tile.
  function updatePreview(colours) {
    const placeholder = previewTile.querySelector(".tile-placeholder");
    if (placeholder) placeholder.remove();

    // Speed 1 (slow) -> 14s cycle, speed 20 (fast) -> ~1.5s cycle. Shared by
    // both animation styles.
    const duration = (21 - state.animation.speed) * 0.7;
    previewTile.style.setProperty("--anim-duration", `${duration.toFixed(2)}s`);
    previewTile.style.setProperty(
      "--anim-direction",
      state.animation.forward ? "normal" : "reverse"
    );

    const usingPoints = state.animation.enabled && state.animation.style === "points";

    previewTile.classList.toggle("force-motion", state.animation.forceMotion);

    const systemReducesMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedMotionNote.hidden = !(state.animation.enabled && systemReducesMotion && !state.animation.forceMotion);

    if (usingPoints) {
      // Keep the keyframes fresh with the current harmony colours, then let
      // CSS animate background-colour through them — the gradient/type/
      // direction controls are set aside for this style since it shows one
      // colour at a time rather than a blend of all of them.
      pointsKeyframesStyle.textContent = buildPointCycleKeyframes(colours, POINTS_KEYFRAMES_NAME);
      previewTile.style.backgroundColor = colours[0].hex;
      previewTile.classList.add("is-animating-points");
      previewTile.classList.remove("is-animating-drift");
    } else {
      const gradient = generateGradient(colours, state.gradientType, state.direction);
      previewTile.style.background = gradient;
      previewTile.classList.toggle("is-animating-drift", state.animation.enabled);
      previewTile.classList.remove("is-animating-points");
    }
  }

  // Builds the full, copy-ready CSS block shown in the output panel.
  function generateCSS(colours, type, direction) {
    const gradient = generateGradient(colours, type, direction);
    const stops = getColourStops(colours.length);

    const stopLines = colours
      .map((c, i) => `    ${c.hex} ${stops[i]}%${i < colours.length - 1 ? "," : ""}`)
      .join("\n");

    let cssBody;
    if (type === "radial") {
      cssBody = `background: radial-gradient(\n    circle,\n${stopLines}\n);`;
    } else if (type === "conic") {
      cssBody = `background: conic-gradient(\n    from ${direction}deg,\n${stopLines}\n);`;
    } else {
      cssBody = `background: linear-gradient(\n    ${direction}deg,\n${stopLines}\n);`;
    }

    if (state.animation.enabled) {
      const duration = ((21 - state.animation.speed) * 0.7).toFixed(2);
      const direction = state.animation.forward ? "normal" : "reverse";

      if (state.animation.style === "points") {
        const keyframes = buildPointCycleKeyframes(colours, "points-cycle");
        cssBody = `background-color: ${colours[0].hex};\nanimation: points-cycle ${duration}s ease-in-out infinite ${direction};\n\n${keyframes}`;
      } else {
        cssBody += `\n\n/* animation */\nfilter: hue-rotate(0deg);\nanimation: hue-drift ${duration}s linear infinite ${direction};\n\n@keyframes hue-drift {\n  from { filter: hue-rotate(0deg); }\n  to   { filter: hue-rotate(360deg); }\n}`;
      }
    }

    return cssBody;
  }

  /* ----------------------------------------------------------------------
     Colour info panel
     -------------------------------------------------------------------- */

  function updateColourInformation(colours) {
    colourListEl.innerHTML = "";

    colours.forEach((c) => {
      const li = document.createElement("li");
      li.className = "colour-chip";

      li.innerHTML = `
        <span class="colour-swatch" style="background:${c.hex}"></span>
        <span class="colour-meta">
          <span class="colour-index">Colour ${c.index}</span>
          <span class="colour-hex">${c.hex}</span>
        </span>
        <button type="button" class="colour-copy-btn" data-hex="${c.hex}" aria-label="Copy ${c.hex}">Copy</button>
      `;

      colourListEl.appendChild(li);
    });
  }

  /* ----------------------------------------------------------------------
     Clipboard helpers
     -------------------------------------------------------------------- */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback for older/blocked clipboard permissions.
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      document.body.removeChild(textarea);
      return ok;
    }
  }

  function copyCSS() {
    copyText(cssOutputEl.textContent).then((ok) => {
      cssCopyFeedback.textContent = ok ? "CSS copied to clipboard." : "Copy failed — select and copy manually.";
      setTimeout(() => { cssCopyFeedback.textContent = ""; }, 2200);
    });
  }

  /* ----------------------------------------------------------------------
     Central render — every control change funnels through here
     -------------------------------------------------------------------- */

  let currentColours = [];

  function render() {
    currentColours = calculateHarmonyPoints(
      state.mouseX,
      state.mouseY,
      state.lightness,
      state.mode,
      state.pointDirection,
      state.pointDistance
    );

    drawMarkers(currentColours, state.mouseX, state.mouseY);
    updatePreview(currentColours);
    updateColourInformation(currentColours);
    cssOutputEl.textContent = generateCSS(currentColours, state.gradientType, state.direction);
  }

  /* ----------------------------------------------------------------------
     Wheel interaction (mouse + touch + basic keyboard)
     -------------------------------------------------------------------- */

  function wheelPointFromEvent(clientX, clientY) {
    const rect = wheelCanvas.getBoundingClientRect();
    const scaleX = wheelCanvas.width / rect.width;
    const scaleY = wheelCanvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  function handleWheelPoint(clientX, clientY) {
    const { x, y } = wheelPointFromEvent(clientX, clientY);
    // Clamp to the wheel's bounding circle so the primary point (and the
    // secondary points built from it) always samples a real colour.
    const cx = wheelCanvas.width / 2;
    const cy = wheelCanvas.height / 2;
    const radius = wheelCanvas.width / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const scale = dist > radius ? radius / dist : 1;

    state.mouseX = cx + dx * scale;
    state.mouseY = cy + dy * scale;

    if (!state.hasInteracted) {
      state.hasInteracted = true;
      wheelHint.textContent = "Move around the wheel to explore the harmony";
    }
    render();
  }

  function onMouseMove(e) {
    handleWheelPoint(e.clientX, e.clientY);
  }

  function onTouchMove(e) {
    if (e.touches.length === 0) return;
    e.preventDefault();
    handleWheelPoint(e.touches[0].clientX, e.touches[0].clientY);
  }

  wheelCanvas.addEventListener("mousemove", onMouseMove);
  wheelCanvas.addEventListener("mousedown", onMouseMove);
  wheelCanvas.addEventListener("touchstart", onTouchMove, { passive: false });
  wheelCanvas.addEventListener("touchmove", onTouchMove, { passive: false });

  // Basic keyboard access: arrow keys nudge hue (left/right) and
  // saturation (up/down) once the wheel has focus.
  wheelCanvas.setAttribute("tabindex", "0");
  wheelCanvas.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 3;
    const { hue, sat } = getColourFromWheelPosition(state.mouseX, state.mouseY, wheelCanvas);
    let newHue = hue;
    let newSat = sat;
    let handled = true;

    switch (e.key) {
      case "ArrowLeft":  newHue = (hue - step + 360) % 360; break;
      case "ArrowRight": newHue = (hue + step) % 360; break;
      case "ArrowUp":    newSat = Math.min(100, sat + step); break;
      case "ArrowDown":  newSat = Math.max(0, sat - step); break;
      default: handled = false;
    }

    if (handled) {
      // Convert the new hue/saturation back into a pixel position, the
      // inverse of getColourFromWheelPosition.
      const radius = wheelCanvas.width / 2;
      const rad = (newHue * Math.PI) / 180;
      const dist = (newSat / 100) * radius;
      state.mouseX = radius + Math.cos(rad) * dist;
      state.mouseY = radius + Math.sin(rad) * dist;
    }

    if (handled) {
      e.preventDefault();
      state.hasInteracted = true;
      wheelHint.textContent = "Move around the wheel to explore the harmony";
      render();
    }
  });

  /* ----------------------------------------------------------------------
     Harmony mode buttons
     -------------------------------------------------------------------- */

  function setMode(mode) {
    state.mode = mode;
    btnTriad.classList.toggle("is-active", mode === "triad");
    btnTriad.setAttribute("aria-pressed", String(mode === "triad"));
    btnQuad.classList.toggle("is-active", mode === "quad");
    btnQuad.setAttribute("aria-pressed", String(mode === "quad"));
    render();
  }

  btnTriad.addEventListener("click", () => setMode("triad"));
  btnQuad.addEventListener("click", () => setMode("quad"));

  /* ----------------------------------------------------------------------
     Point direction + distance — direct control over where the secondary
     harmony markers sit relative to the mouse.
     -------------------------------------------------------------------- */

  pointDirectionRange.addEventListener("input", () => {
    state.pointDirection = Number(pointDirectionRange.value);
    pointDirectionValueEl.textContent = `${state.pointDirection}°`;
    render();
  });

  spreadRange.addEventListener("input", () => {
    state.pointDistance = Number(spreadRange.value);
    spreadValueEl.textContent = `${state.pointDistance}px`;
    render();
  });

  /* ----------------------------------------------------------------------
     Gradient type + direction
     -------------------------------------------------------------------- */

  gradientTypeSel.addEventListener("change", () => {
    state.gradientType = gradientTypeSel.value;
    const showDirection = state.gradientType !== "radial";
    directionRow.style.display = showDirection ? "grid" : "none";
    dialRow.style.display = showDirection ? "grid" : "none";
    render();
  });

  function setDirection(deg) {
    state.direction = deg;
    directionValueEl.textContent = `${deg}°`;
    directionRange.value = String(deg);
    const angleRad = ((deg - 90) * Math.PI) / 180; // 0deg = up, like CSS gradients
    const x2 = 50 + 36 * Math.cos(angleRad);
    const y2 = 50 + 36 * Math.sin(angleRad);
    dialNeedle.setAttribute("x2", x2.toFixed(1));
    dialNeedle.setAttribute("y2", y2.toFixed(1));
    directionDial.setAttribute("aria-valuenow", String(deg));
  }

  directionRange.addEventListener("input", () => {
    setDirection(Number(directionRange.value));
    render();
  });

  function dialAngleFromEvent(clientX, clientY) {
    const rect = directionDial.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let angle = Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI) + 90;
    angle = ((angle % 360) + 360) % 360;
    return Math.round(angle);
  }

  let draggingDial = false;
  directionDial.addEventListener("mousedown", (e) => {
    draggingDial = true;
    setDirection(dialAngleFromEvent(e.clientX, e.clientY));
    render();
  });
  window.addEventListener("mousemove", (e) => {
    if (!draggingDial) return;
    setDirection(dialAngleFromEvent(e.clientX, e.clientY));
    render();
  });
  window.addEventListener("mouseup", () => { draggingDial = false; });

  directionDial.addEventListener("keydown", (e) => {
    let handled = true;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      setDirection((state.direction - 5 + 360) % 360);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      setDirection((state.direction + 5) % 360);
    } else {
      handled = false;
    }
    if (handled) { e.preventDefault(); render(); }
  });

  /* ----------------------------------------------------------------------
     Animation controls
     -------------------------------------------------------------------- */

  animToggle.addEventListener("click", () => {
    state.animation.enabled = !state.animation.enabled;
    animToggle.setAttribute("aria-checked", String(state.animation.enabled));
    animToggle.querySelector(".toggle-text").textContent = state.animation.enabled ? "On" : "Off";
    render();
  });

  forceMotionBtn.addEventListener("click", () => {
    state.animation.forceMotion = true;
    render();
  });

  function setAnimStyle(style) {
    state.animation.style = style;
    btnAnimDrift.classList.toggle("is-active", style === "drift");
    btnAnimDrift.setAttribute("aria-pressed", String(style === "drift"));
    btnAnimPoints.classList.toggle("is-active", style === "points");
    btnAnimPoints.setAttribute("aria-pressed", String(style === "points"));
     //////////////////////////////
   btnAnimPointsDrift.classList.toggle("is-active", style === "pointsDrift");
    btnAnimPointsDrift.setAttribute("aria-pressed", String(style === "pointsDrift"));
     //////////////////////////
    render();
  }

  btnAnimDrift.addEventListener("click", () => setAnimStyle("drift"));
  btnAnimPoints.addEventListener("click", () => setAnimStyle("points"));
   ///////////////////////
  btnAnimPointsDrift.addEventListener("click", () => setAnimStyle("pointsDrift"));
//////////////////////////
  speedRange.addEventListener("input", () => {
    state.animation.speed = Number(speedRange.value);
    speedValueEl.textContent = speedRange.value;
    render();
  });

  animDirectionRange.addEventListener("input", () => {
    state.animation.forward = animDirectionRange.value === "1";
    animDirectionValueEl.textContent = state.animation.forward ? "Forward" : "Reverse";
    render();
  });

  /* ----------------------------------------------------------------------
     Copy buttons (delegated for per-colour copy buttons)
     -------------------------------------------------------------------- */

  colourListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".colour-copy-btn");
    if (!btn) return;
    copyText(btn.dataset.hex).then((ok) => {
      if (!ok) return;
      btn.textContent = "Copied";
      btn.classList.add("is-copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("is-copied");
      }, 1400);
    });
  });

  copyCssBtn.addEventListener("click", copyCSS);

  /* ----------------------------------------------------------------------
     Init
     -------------------------------------------------------------------- */

  createColourWheel();
  setDirection(state.direction);
  render();
})();
