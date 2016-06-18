"use strict";

// === Options ===

let options = ({ // default
    button: 2, key_shift: false, key_ctrl: false, key_alt: false, key_meta: false,
    speed: 6000, friction: 10,
    notext: false,
    debug: false
});
const KEYS = ["shift","ctrl","alt","meta"];

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

// === Vector math ===

let vadd  = (a,b) => [a[0]+b[0], a[1]+b[1]];
let vsub  = (a,b) => [a[0]-b[0], a[1]-b[1]];
let vmul  = (s,v) => [s*v[0], s*v[1]];
let vdiv  = (s,v) => [v[0]/s, v[1]/s];
let vmag2 = (v)   => v[0]*v[0] + v[1]*v[1];
let vmag  = (v)   => Math.sqrt(v[0]*v[0] + v[1]*v[1]);
let vunit = (v)   => vdiv(vmag(v),v);

// Test if the given point is directly over text
let testElt = document.createElement("SPAN");
function isOverText(ev) {
    let parent = ev.target;
    if (parent == null) return false;
    for (let i = 0; i < parent.childNodes.length; i++) {
        let child = parent.childNodes[i];
        if (child.nodeType !== Node.TEXT_NODE) continue;
        if (child.textContent.search(/\S/) == -1) continue;
        // debug("TEXT_NODE: '"+child.textContent+"'")
        try {
            testElt.appendChild(parent.replaceChild(testElt,child));
            if (testElt.isSameNode(document.elementFromPoint(ev.clientX,ev.clientY)))
                return true;
        } finally {
            if (child.isSameNode(testElt.firstChild)) testElt.removeChild(child);
            if (testElt.isSameNode(parent.childNodes[i])) parent.replaceChild(child,testElt);
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
        ["auto","scroll"].indexOf(document.defaultView.getComputedStyle(elt)[css]) >= 0;
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
const LBUTTON_OVERRIDE_TAGS = ["A","INPUT","SELECT","TEXTAREA","BUTTON","LABEL","OBJECT","EMBED"];
const MBUTTON_OVERRIDE_TAGS = ["A"];
const RBUTTON_OVERRIDE_TAGS = ["A","INPUT","TEXTAREA","OBJECT","EMBED"];

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
        if (blockElement == elt) {
            blockElement = null;
            ev.preventDefault();
        }
        elt.removeEventListener("paste", onPaste, true);
    }
    return ({ blockPaste, unblockPaste });
})();

// === Scrollfix hack ===
let ScrollFix = (() => {
    let scrollFixElement = null;

    function createScrollFix() {
        scrollFixElement = document.createElement("div");
        scrollFixElement.setAttribute("style", "background: transparent none !important");
        scrollFixElement.style.position = "fixed";
        scrollFixElement.style.top      = 0;
        scrollFixElement.style.right    = 0;
        scrollFixElement.style.bottom   = 0;
        scrollFixElement.style.left     = 0;
        scrollFixElement.style.zIndex   = 99999999;
        scrollFixElement.style.display  = "block";
        // scrollFixElement.style.borderRight="5px solid rgba(0,0,0,0.04)";
    }

    function show() {
        if (scrollFixElement === null) createScrollFix();
        document.body.appendChild(scrollFixElement);
    }

    function hide() {
        if (scrollFixElement !== null && scrollFixElement.parentNode !== null)
            scrollFixElement.parentNode.removeChild(scrollFixElement);
    }

    return ({ show, hide })
})();

// === Fake Selection ===

let Selector = (() => {

    let startRange = null;

    function start(x,y) {
        debug("Selector.start("+x+","+y+")");
        startRange = document.caretRangeFromPoint(x,y);
        let s = getSelection();
        s.removeAllRanges();
        s.addRange(startRange);
    }

    function update(x,y) {
        debug("Selector.update("+x+","+y+")");
        if (y < 0) y = 0; else if (y >= innerHeight) y = innerHeight-1;
        if (x < 0) x = 0; else if (x >= innerWidth)  x = innerWidth-1;
        if (!startRange) start(x,y);
        let a = startRange;
        let b = document.caretRangeFromPoint(x,y);
        if (b != null) {
            if (b.compareBoundaryPoints(Range.START_TO_START,a) > 0)
                b.setStart(a.startContainer,a.startOffset);
            else
                b.setEnd(a.startContainer,a.startOffset);
            let s = getSelection();
            s.removeAllRanges();
            s.addRange(b);
        }
    }

    function cancel() {
        debug("Selector.cancel()");
        startRange = null;
        getSelection().removeAllRanges();
    }

    function scroll(ev) {
        let y = ev.clientY;
        if (y < 0) {
            scrollBy(0,y);
            return true;
        } else if (y >= innerHeight) {
            scrollBy(0,y-innerHeight);
            return true;
        }
        return false;
    }

    return ({ start, update, cancel, scroll });
})();

// === Motion ===

let Motion = (() => {
    const MIN_SPEED_SQUARED = 1;
    const FILTER_INTERVAL = 100;
    let position = null;
    let velocity = [0,0];
    let updateTime = null;
    let impulses = [];

    // ensure velocity is within min and max values
    // return if/not there is motion
    function clamp() {
        let speedSquared = vmag2(velocity);
        if (speedSquared <= MIN_SPEED_SQUARED) {
            velocity = [0,0];
            return false;
        } else if (speedSquared > options.speed*options.speed) {
            velocity = vmul(options.speed,vunit(velocity));
        }
        return true;
    }

    // zero velocity
    function stop() {
        impulses = [];
        velocity = [0,0];
    }

    // impulsively move to given position and time
    // return if/not there is motion
    function impulse(pos,time) {
        position = pos;
        updateTime = time;

        while (impulses.length > 0 && (time - impulses[0].time) > FILTER_INTERVAL)
            impulses.shift();
        impulses.push({pos:pos,time:time});

        if (impulses.length < 2) {
            velocity = [0,0];
            return false;
        } else {
            let a = impulses[0];
            let b = impulses[impulses.length-1];
            velocity = vdiv((b.time - a.time)/1000, vsub(b.pos,a.pos));
            return clamp();
        }
    }

    // update free motion to given time
    // return if/not there is motion
    function glide(time) {
        impulses = [];
        let moving;

        if (updateTime == null) {
            moving = false;
        } else {
            let deltaSeconds = (time-updateTime)/1000;
            let frictionMultiplier = Math.max(1-(options.friction/FILTER_INTERVAL), 0);
            frictionMultiplier = Math.pow(frictionMultiplier, deltaSeconds*FILTER_INTERVAL);
            velocity = vmul(frictionMultiplier, velocity);
            moving = clamp();
            position = vadd(position,vmul(deltaSeconds,velocity));
        }
        updateTime = time;
        return moving;
    }

    function getPosition() { return position }

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
    // Return if/not the element actually moved (i.e. if it did not hit a
    // boundary on both axes).
    function move(pos) {
        if (!elt) return false;
        let x = elt.scrollLeft, y = elt.scrollTop;
        elt.scrollLeft = scrollOrigin[0] - pos[0];
        elt.scrollTop  = scrollOrigin[1] - pos[1];
        return elt.scrollLeft != x || elt.scrollTop != y;
    }

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
    if (moving) setTimeout(updateGlide,TIME_STEP);
    else stopGlide();
}

function stopGlide() {
    debug("glide stop");
    activity = STOP;
    Motion.stop();
}

function updateDrag(ev) {
    debug("drag update");
    let v = [ev.clientX,ev.clientY], moving = false;
    moving = Motion.impulse(v,ev.timeStamp);
    Scroll.move(vsub(v,mouseOrigin));
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
        window.setTimeout(updateGlide,TIME_STEP);
        activity = GLIDE;
    } else {
        activity = STOP;
    }
}

function onMouseDown(ev) {
    blockContextMenu = false;

    switch (activity) {

    case GLIDE:
        stopGlide(ev);
        // fall through

    case STOP:
        if (!ev.target) {
            debug("target is null, ignoring");
            break;
        }

        if (ev.button != options.button) {
            debug("wrong button, ignoring; ev.button="+ev.button+"; options.button="+options.button);
            break;
        }

        if (!KEYS.every(key => options["key_"+key] == ev[key+"Key"])) {
            debug("wrong modkeys, ignoring");
            break;
        }

        if (hasOverrideAncestor(ev.target)) {
            debug("forbidden target element, ignoring",ev);
            break;
        }

        if (isOverScrollbar(ev)) {
            debug("detected scrollbar click, ignoring",ev);
            break;
        }

        if (options.notext && isOverText(ev)) {
            debug("detected text node, ignoring");
            break;
        }

        debug("click MouseEvent=",ev);
        activity = CLICK;
        mouseOrigin = [ev.clientX,ev.clientY];
        Motion.impulse(mouseOrigin,ev.timeStamp);
        ev.preventDefault();
        if (ev.button == MBUTTON && ev.target != document.activeElement)
            Clipboard.blockPaste()
        if (ev.button == RBUTTON &&
            (navigator.platform.match(/Mac/) || navigator.platform.match(/Linux/)))
            blockContextMenu = true;
        showScrollFix = true;
        break;

    default:
        debug("WARNING: illegal activity for mousedown: "+activity);
        document.body.style.cursor = "auto";
        Clipboard.unblockPaste();
        ScrollFix.hide();
        activity = STOP;
        return onMouseDown(ev);
    }
}

function onMouseMove(ev) {
    switch (activity) {
    case STOP: case GLIDE: break;

    case DRAG:
        if (ev.button == options.button) {
            updateDrag(ev);
            ev.preventDefault();
        }
        break;

    case CLICK:
        if (ev.button == options.button) {
            if (options.button == RBUTTON) blockContextMenu = true;
            if (showScrollFix) {
                ScrollFix.show();
                showScrollFix = false;
            }
            startDrag(ev);
            ev.preventDefault();
        }
        break;

    }
}

function onMouseUp(ev) {
    switch (activity) {

    case STOP: break;

    case CLICK:
        debug("unclick, no drag");
        Clipboard.unblockPaste();
        ScrollFix.hide();
        if (ev.button == 0) getSelection().removeAllRanges();
        if (document.activeElement) document.activeElement.blur();
        if (ev.target) ev.target.focus();
        if (ev.button == options.button) activity = STOP;
        break;

    case DRAG:
        if (ev.button == options.button) {
            stopDrag(ev);
            ev.preventDefault();
        }
        break;

    case GLIDE:
        stopGlide(ev);
        break;

    }
}

function onMouseOut(ev) {
    switch (activity) {
    case STOP: case CLICK: case GLIDE: break;
    case DRAG:
        if (ev.toElement == null) stopDrag(ev);
        break;
    }
}

function onContextMenu(ev) {
    if (blockContextMenu) {
        blockContextMenu = false;
        debug("blocking context menu");
        ev.preventDefault();
    }
}

addEventListener("mousedown",     onMouseDown,   true);
addEventListener("mouseup",       onMouseUp,     true);
addEventListener("mousemove",     onMouseMove,   true);
addEventListener("mouseout",      onMouseOut,    true);
addEventListener("contextmenu",   onContextMenu, true);
