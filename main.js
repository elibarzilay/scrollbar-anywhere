"use strict";

// === Options ===

let options = ({ // default
    button: 2, key_shift: false, key_ctrl: false, key_alt: false, key_meta: false,
    speed: 6000, friction: 10,
    notext: false,
    debug: false
});
const KEYS = ["shift", "ctrl", "alt", "meta"];

function setOptions(o) {
    if (o) { Object.assign(options, o); debug("Options: %o", options); }
}
chrome.storage.onChanged.addListener((changes, _) =>
    setOptions(changes.options && changes.options.newValue));
chrome.storage.sync.get("options", val => setOptions(val && val.options));

// === Debugging ===

function debug(str, ...args) {
    if (!options.debug) return;
    console.debug("SA: "+str, ...args);
}

// === Vector math and other utilities ===

let vadd  = (a,b) => [a[0]+b[0], a[1]+b[1]];
let vsub  = (a,b) => [a[0]-b[0], a[1]-b[1]];
let vmul  = (v,s) => [s*v[0], s*v[1]];
let vdiv  = (v,s) => [v[0]/s, v[1]/s];
let vmag2 = (v)   => v[0]*v[0] + v[1]*v[1];
let vmag  = (v)   => Math.sqrt(v[0]*v[0] + v[1]*v[1]);

let evPos = (ev) => [ev.clientX, ev.clientY];

// Test if the given point is directly over text
let testElt = document.createElement("SPAN");
function isOverText(ev) {
    let parent = ev.target;
    if (parent == null) return false;
    for (let i = 0; i < parent.childNodes.length; i++) {
        let child = parent.childNodes[i];
        if (child.nodeType !== Node.TEXT_NODE) continue;
        if (child.textContent.search(/\S/) == -1) continue;
        // debug("TEXT_NODE: \"%s\"", child.textContent);
        try {
            testElt.appendChild(parent.replaceChild(testElt, child));
            if (testElt.isSameNode(document.elementFromPoint(ev.clientX, ev.clientY)))
                return true;
        } finally {
            if (child.isSameNode(testElt.firstChild)) testElt.removeChild(child);
            if (testElt.isSameNode(parent.childNodes[i])) parent.replaceChild(child, testElt);
        }
    }
    return false;
}

// Test if a mouse event occurred over a scrollbar by testing if the
// coordinates of the event are on the outside of a scrollable element.
// The body element is treated separately since the visible size is
// fetched differently depending on the doctype.
function isOverScrollbar(ev) {
    let t = ev.target == document.documentElement ? document.body : ev.target;
    if (t == document.body) {
        let d = document.documentElement, cW, cH;
        if (d.scrollHeight == d.clientHeight && d.scrollHeight == d.offsetHeight) {
            // Guessing it's a no doctype document
            cW = t.clientWidth; cH = t.clientHeight;
        } else {
            cW = d.clientWidth; cH = d.clientHeight;
        }
        return (ev.offsetX - t.scrollLeft >= cW || ev.offsetY - t.scrollTop >= cH);
    } else if (!isScrollable(t)) return false;
    else return (ev.offsetX - t.scrollLeft >= t.clientWidth ||
                 ev.offsetY - t.scrollTop >= t.clientHeight);
}

// Can the given element be scrolled on either axis?
// That is, is the scroll size greater than the client size
// and the CSS overflow set to scroll or auto?
function isScrollable(elt) {
    let o = css =>
        ["auto", "scroll"].indexOf(document.defaultView.getComputedStyle(elt)[css]) >= 0;
    return (elt.scrollWidth  > elt.clientWidth  && o("overflow-x"))
        || (elt.scrollHeight > elt.clientHeight && o("overflow-y"));
}

// Return the first ancestor (or the element itself) that is scrollable
function findInnermostScrollable(elt) {
    while (true) {
        if (elt == document.documentElement) return document.body;
        if (elt == null || elt == document.body || isScrollable(elt)) return elt;
        elt = elt.parentNode;
    }
}

// Don't drag when left-clicking on these elements
const LBUTTON_OVERRIDE_TAGS = ["A", "INPUT", "SELECT", "TEXTAREA", "BUTTON",
                               "LABEL", "OBJECT", "EMBED"];
const MBUTTON_OVERRIDE_TAGS = ["A"];
const RBUTTON_OVERRIDE_TAGS = ["A", "INPUT", "TEXTAREA", "OBJECT", "EMBED"];

const LBUTTON=0, MBUTTON=1, RBUTTON=2;
const TIME_STEP = 10;

const STOP=0, CLICK=1, DRAG=2, GLIDE=3;

function hasOverrideAncestor(elt) {
    while (elt != null) {
        if (options.button == LBUTTON ? (LBUTTON_OVERRIDE_TAGS.indexOf(elt.tagName)>=0
                                         || hasRoleButtonAttribute(elt))
            : options.button == MBUTTON ? MBUTTON_OVERRIDE_TAGS.indexOf(elt.tagName)>=0
            : options.button == RBUTTON ? RBUTTON_OVERRIDE_TAGS.indexOf(elt.tagName)>=0
            : false)
            return true;
        elt = elt.parentNode;
    }
    return false;
}

function hasRoleButtonAttribute(elt) {
    return elt.attributes && elt.attributes.role &&
           elt.attributes.role.value === "button";
}

// === Clipboard Stuff ===
// Block the next paste event if a text element is active. This is a
// workaround for middle-click paste not being preventable on Linux.
let Clipboard = (() => {
    let blockElement = null;
    function isPastable(elt) {
        return elt && elt.tagName == "INPUT" || elt.tagName == "TEXTAREA";
    }
    function blockPaste() {
        let elt = document.activeElement;
        if (blockElement == elt) return;
        if (blockElement) unblockPaste();
        if (isPastable(elt)) {
            debug("blocking paste for active text element", elt);
            blockElement = elt;
            elt.addEventListener("paste", onPaste, true);
        }
    }
    function unblockPaste() {
        if (!blockElement) return;
        debug("unblocking paste", blockElement);
        blockElement.removeEventListener("paste", onPaste, true);
        blockElement = null;
    }
    function onPaste(ev) {
        let elt = ev.target;
        if (!elt) return;
        if (blockElement == elt) { blockElement = null; ev.preventDefault(); }
        elt.removeEventListener("paste", onPaste, true);
    }
    return ({ blockPaste, unblockPaste });
})();

// === Scrollfix hack ===
let ScrollFix = (() => {
    let elt = null;
    function createScrollFix() {
        elt = document.createElement("div");
        elt.setAttribute("style", "background: transparent none !important");
        elt.style.position = "fixed";
        elt.style.top      = 0;
        elt.style.right    = 0;
        elt.style.bottom   = 0;
        elt.style.left     = 0;
        elt.style.zIndex   = 99999999;
        elt.style.display  = "block";
        // elt.style.borderRight="5px solid rgba(0,0,0,0.04)";
    }
    function show() {
        if (elt === null) createScrollFix();
        document.body.appendChild(elt);
    }
    function hide() {
        if (elt !== null && elt.parentNode !== null) elt.parentNode.removeChild(elt);
    }
    return ({ show, hide })
})();

// === Motion ===

let Motion = (() => {
    const FILTER_INTERVAL = 100;
    let position = null;
    let velocity = [0, 0];
    let updateTime = null;
    let impulses = {new: null, old: null};

    // ensure velocity is within min and max values,
    // return true if there is motion
    function clamp() {
        let speedSquared = vmag2(velocity);
        if (speedSquared <= 1) {
            velocity = [0, 0];
            return false;
        } else if (speedSquared > options.speed*options.speed) {
            velocity = vmul(velocity, options.speed/vmag(velocity));
        }
        return true;
    }

    // zero velocity
    function stop() {
        impulses = {new: null, old: null};
        velocity = [0, 0];
    }

    // impulsively move to given position and time,
    // return true if there is motion
    function impulse(pos, time) {
        position = pos;
        updateTime = time;
        while (impulses.old != null &&
               (time-impulses.old.time) > FILTER_INTERVAL)
            impulses.old = impulses.old.next;
        if (impulses.old == null)
            impulses.old = impulses.new = {pos, time, next: null};
        else
            impulses.new = (impulses.new.next = {pos, time, next: null});
        if (impulses.new == impulses.old) {
            velocity = [0, 0];
            return false;
        } else {
            velocity = vdiv(vsub(impulses.new.pos,impulses.old.pos),
                            (impulses.new.time-impulses.old.time)/1000);
            return clamp();
        }
    }

    // update free motion to given time,
    // return true there is motion
    function glide(time) {
        impulses = {old: null, new: null};
        let moving;
        if (updateTime == null) {
            moving = false;
        } else {
            let deltaSeconds = (time-updateTime)/1000;
            let frictionMultiplier = Math.max(1-(options.friction/FILTER_INTERVAL), 0);
            frictionMultiplier = Math.pow(frictionMultiplier, deltaSeconds*FILTER_INTERVAL);
            velocity = vmul(velocity, frictionMultiplier);
            moving = clamp();
            position = vadd(position, vmul(velocity, deltaSeconds));
        }
        updateTime = time;
        return moving;
    }

    let getPosition = () => position;

    return ({ stop, impulse, glide, getPosition });
})();

let Scroll = (() => {
    let elt, scrollOrigin;
    // Start dragging
    function start(ev) {
        elt = findInnermostScrollable(ev.target);
        scrollOrigin = [elt.scrollLeft, elt.scrollTop];
    }
    // Move the currently dragged element relative to the starting position.
    // Return true the element actually moved (i.e. if it did not hit a
    // boundary on both axes).
    function move(pos) {
        if (!elt) return false;
        let x = elt.scrollLeft, y = elt.scrollTop;
        elt.scrollLeft = scrollOrigin[0] - pos[0];
        elt.scrollTop  = scrollOrigin[1] - pos[1];
        return elt.scrollLeft != x || elt.scrollTop != y;
    }
    //
    return ({ start, move });
})();

let activity = STOP;
let blockContextMenu = false;
let showScrollFix = false;
let mouseOrigin = null;

function updateGlide() {
    if (activity != GLIDE) return;
    debug("glide update");
    let moving = Motion.glide(performance.now());
    moving = Scroll.move(vsub(Motion.getPosition(),mouseOrigin)) && moving;
    if (moving) setTimeout(updateGlide, TIME_STEP);
    else stopGlide();
}

function stopGlide() {
    debug("glide stop");
    activity = STOP;
    Motion.stop();
}

function updateDrag(ev) {
    debug("drag update");
    let pos = evPos(ev), moving = false;
    moving = Motion.impulse(pos, ev.timeStamp);
    Scroll.move(vsub(pos,mouseOrigin));
    return moving;
}

function startDrag(ev) {
    debug("drag start");
    activity = DRAG;
    document.body.style.cursor = "-webkit-grabbing";
    Scroll.start(ev);
    return updateDrag(ev);
}

function stopDrag(ev) {
    debug("drag stop");
    document.body.style.cursor = "auto";
    Clipboard.unblockPaste();
    ScrollFix.hide();
    if (updateDrag(ev)) {
        window.setTimeout(updateGlide, TIME_STEP);
        activity = GLIDE;
    } else {
        activity = STOP;
    }
}

// === Event handlers ===

function onMouseDown(ev) {
    blockContextMenu = false;
    switch (activity) {
    //
    case GLIDE:
        stopGlide(ev);
        // fall through
    //
    case STOP:
        if (!ev.target) {
            debug("target is null, ignoring");
            break; }
        if (ev.button != options.button) {
            debug("wrong button, ignoring; ev.button=%s; options.button=%s",
                  ev.button, options.button);
            break; }
        if (!KEYS.every(key => options["key_"+key] == ev[key+"Key"])) {
            debug("wrong modkeys, ignoring");
            break; }
        if (hasOverrideAncestor(ev.target)) {
            debug("forbidden target element, ignoring", ev);
            break; }
        if (isOverScrollbar(ev)) {
            debug("detected scrollbar click, ignoring", ev);
            break; }
        if (options.notext && isOverText(ev)) {
            debug("detected text node, ignoring");
            break; }
        debug("click MouseEvent=", ev);
        activity = CLICK;
        mouseOrigin = evPos(ev);
        Motion.impulse(mouseOrigin, ev.timeStamp);
        ev.preventDefault();
        if (ev.button == MBUTTON && ev.target != document.activeElement)
            Clipboard.blockPaste()
        if (ev.button == RBUTTON &&
            (navigator.platform.match(/Mac/) || navigator.platform.match(/Linux/)))
            blockContextMenu = true;
        showScrollFix = true;
        break;
    //
    default:
        console.log("WARNING: illegal activity for mousedown:", activity);
        document.body.style.cursor = "auto";
        Clipboard.unblockPaste();
        ScrollFix.hide();
        activity = STOP;
        return onMouseDown(ev);
    }
}
addEventListener("mouseup", onMouseUp, true);

function onMouseMove(ev) {
    switch (activity) {
    //
    case STOP: case GLIDE: break;
    //
    case DRAG:
        if (ev.button != options.button) break;
        updateDrag(ev);
        ev.preventDefault();
        break;
    //
    case CLICK:
        if (ev.button != options.button) break;
        if (vmag2(vsub(mouseOrigin,evPos(ev))) > 9) {
            if (options.button == RBUTTON) blockContextMenu = true;
            if (showScrollFix) { ScrollFix.show(); showScrollFix = false; }
            startDrag(ev);
        }
        ev.preventDefault();
        break;
    //
    }
}
addEventListener("mousemove", onMouseMove, true);

function onMouseUp(ev) {
    switch (activity) {
    //
    case STOP: break;
    //
    case CLICK:
        debug("unclick, no drag");
        Clipboard.unblockPaste();
        ScrollFix.hide();
        if (ev.button == 0) getSelection().removeAllRanges();
        if (document.activeElement) document.activeElement.blur();
        if (ev.target) ev.target.focus();
        if (ev.button == options.button) activity = STOP;
        break;
    //
    case DRAG:
        if (ev.button == options.button) { stopDrag(ev); ev.preventDefault(); }
        break;
    //
    case GLIDE:
        stopGlide(ev);
        break;
    //
    }
}
addEventListener("mousedown", onMouseDown, true);

function onMouseOut(ev) {
    if (activity === DRAG && ev.toElement == null) stopDrag(ev);
}
addEventListener("mouseout", onMouseOut, true);

function onContextMenu(ev) {
    if (!blockContextMenu) return;
    blockContextMenu = false;
    debug("blocking context menu");
    ev.preventDefault();
}
addEventListener("contextmenu", onContextMenu, true);
