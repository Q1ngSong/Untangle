// The hero plays its illustrated scenes one at a time, in turn. The dot row under it shows the
// chosen feature's demos, one dot each: a feature button plays its first demo, a dot plays its
// own, and either stops the turns; the round button pauses everything. With Reduce Motion every
// scene rests on one frame (style.css) and nothing plays in turn.
const stage = document.querySelector(".hero-stage");
const scenes = [...stage.querySelectorAll(".ug-stage")];
const dotRow = document.querySelector(".scene-dots");
const modeButtons = [...document.querySelectorAll(".mode-button")];
const motionButton = document.querySelector(".motion-toggle");
const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
const status = document.querySelector("#demo-status");
let current = -1;
let timer;
let cycling = !preference.matches;
let playing = !preference.matches;

/** The dot row for `mode`: one dot per scene of that feature. */
function showDots(mode) {
  dotRow.replaceChildren(...scenes.flatMap((scene, index) => {
    if (scene.dataset.mode !== mode) return [];
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "scene-dot";
    dot.dataset.index = index;
    dot.title = scene.dataset.title;
    dot.setAttribute("aria-label", scene.dataset.title);
    dot.append(document.createElement("i"));
    dot.addEventListener("click", () => { cycling = false; show(index, true); });
    return [dot];
  }));
}

function show(index, announce = false) {
  const scene = scenes[index];
  if (scenes[current]?.dataset.mode !== scene.dataset.mode) showDots(scene.dataset.mode);
  current = index;
  scenes.forEach((other, i) => other.classList.toggle("current", i === index));
  modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === scene.dataset.mode)));
  for (const dot of dotRow.children) {
    dot.setAttribute("aria-current", String(Number(dot.dataset.index) === index));
    // Restart the progress for this demo.
    dot.firstChild.style.animation = "none";
    void dot.firstChild.offsetWidth;
    dot.firstChild.style.animation = "";
  }
  dotRow.style.setProperty("--seconds", scene.dataset.seconds + "s");
  if (announce) status.textContent = scene.dataset.title + " preview selected.";
  schedule();
}

function schedule() {
  clearTimeout(timer);
  dotRow.classList.toggle("cycling", cycling);
  if (cycling && playing && !document.hidden)
    timer = setTimeout(() => show((current + 1) % scenes.length), Number(scenes[current].dataset.seconds) * 1000);
}

function setPlayback(enabled) {
  playing = enabled;
  scenes.forEach((scene) => scene.classList.toggle("paused", !enabled));
  dotRow.classList.toggle("paused", !enabled);
  motionButton.setAttribute("aria-pressed", String(enabled));
  motionButton.setAttribute("aria-label", enabled ? "Pause automatic preview" : "Play automatic preview");
  document.querySelector(".motion-symbol").textContent = enabled ? "Ⅱ" : "▶";
  schedule();
}

modeButtons.forEach((button) => button.addEventListener("click", () => {
  cycling = false;
  show(scenes.findIndex((scene) => scene.dataset.mode === button.dataset.mode), true);
}));
motionButton.addEventListener("click", () => {
  if (!playing) cycling = !preference.matches;
  setPlayback(!playing);
});
preference.addEventListener("change", () => { cycling = !preference.matches; setPlayback(!preference.matches); });
document.addEventListener("visibilitychange", schedule);
show(0);
setPlayback(playing);

if ("IntersectionObserver" in window) {
  const reveals = document.querySelectorAll(".download-section > div, .guide-heading");
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
  }), { threshold: 0.1 });
  reveals.forEach((element) => { element.classList.add("reveal"); observer.observe(element); });
  const links = [...document.querySelectorAll(".guide-nav a")];
  const sections = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) links.forEach((link) => link.classList.toggle("current", link.hash === "#" + entry.target.id));
  }), { rootMargin: "-5% 0px -70% 0px" });
  document.querySelectorAll(".readme-content h2").forEach((heading) => sections.observe(heading));
}
