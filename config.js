"use strict";

let $ = document.getElementById.bind(document);

function error(msg) {
  $("message").innerHTML += "<div style='color:red;'>"+msg+"</div>";
}

function save() {
  let x;

  $("message").innerHTML = "";

  x = $("button").selectedIndex;
  if (x < 0 || x > 2) error("Somehow, you broke the button field");
  else options.button = x;

  x = $("speed").value - 0;
  if (isNaN(x) || x < 0) error("Top speed must be a non-negative number");
  else options.speed = x;

  x = $("friction").value - 0;
  if (isNaN(x) || x < 0) error("Friction must be a positive number");
  else options.friction = x;

  for (let k of BOOLEAN_OPTS) options[k] = $(k).checked;

  chrome.storage.sync.set({options});
}

function load() {
  for (let k of BOOLEAN_OPTS) $(k).checked = options[k];
  $("button").selectedIndex = options.button;
  $("speed").value    = options.speed;
  $("friction").value = options.friction;
}

let updateTimeoutId;

function onUpdate(ev) {
  if (updateTimeoutId != null) clearTimeout(updateTimeoutId);
  updateTimeoutId = setTimeout(save, 200);
}

function start() {
  $("button").addEventListener("change", onUpdate, false);
  for (let k of BOOLEAN_OPTS) $(k).addEventListener("change", onUpdate, false);

  ["speed","friction"].forEach(id =>
    ["change", "keydown", "mousedown", "blur"].forEach(evname =>
      $(id).addEventListener(evname, onUpdate, true)));
  let footerText = ["<i>Here's a bunch of text to scroll:</i>", ""];
  let beers = 99;
  function bottles(n, text) {
    footerText.push((n==0 ? "no more" : n)+" bottle"+(n==1?"":"s")
                    + " of beer"+text);
  }
  while (beers > 0) {
    bottles(beers, " on the wall,");
    bottles(beers, "!");
    footerText.push("Take one down, pass it around");
    bottles(--beers, " on the wall.");
    footerText.push("");
  }
  $("long_footer").innerHTML = footerText.join("<br>");
}

function loadAndStart(ev) {
  chrome.storage.sync.get("options", val => {
    if (val && val.options) Object.assign(options, val.options);
    load();
    start(); });
}

document.addEventListener("DOMContentLoaded", loadAndStart, true);

document.addEventListener("unload", save, true);
