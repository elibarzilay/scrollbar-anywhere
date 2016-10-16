"use strict";

let getElt = document.getElementById.bind(document);

function forallOptions(cb) {
  for (let k in options) {
    let inp = getElt(k); if (!inp) continue; // in case of junk in settings
    cb(k, inp);
  }
}

function save() {
  forallOptions((k, inp) =>
    options[k] = (BOOLEAN_OPTS.indexOf(k) >= 0)    ? inp.checked
               : (inp.selectedIndex !== undefined) ? inp.selectedIndex
               :                                     Number(inp.value));
  chrome.storage.sync.set({options});
}

function load() {
  forallOptions((k, inp) => {
    if (BOOLEAN_OPTS.indexOf(k) >= 0)         inp.checked       = options[k];
    else if (inp.selectedIndex !== undefined) inp.selectedIndex = options[k];
    else                                      inp.value         = options[k];
  });
}

let updateTimeoutId;

function onUpdate(ev) {
  if (updateTimeoutId != null) clearTimeout(updateTimeoutId);
  updateTimeoutId = setTimeout(save, 200);
}

function start() {
  forallOptions((k, inp) => inp.addEventListener("change", onUpdate, false));
  let text = ["<i>Here's a bunch of text to scroll:</i>", ""];
  let beers = 99;
  let bottles = (n, rest) =>
    `${n==0 ? "no more" : n} bottle${n==1?"":"s"} of beer${rest}`;
  while (beers > 0) {
    text.push(bottles(beers, " on the wall,"),
              bottles(beers, "!"),
              "Take one down, pass it around",
              bottles(--beers, " on the wall."),
              "");
  }
  getElt("long_footer").innerHTML = text.join("<br>");
}

function loadAndStart(ev) {
  chrome.storage.sync.get("options", val => {
    if (val && val.options) Object.assign(options, val.options);
    load();
    start(); });
}

document.addEventListener("DOMContentLoaded", loadAndStart, true);

document.addEventListener("unload", save, true);
