"use strict";

(() => {

// === Options ===

let options = ({ // default
    button: 2, key_shift: false, key_ctrl: false, key_alt: false, key_meta: false,
    scaling: 1, speed: 6000, friction: 10,
    notext: false,
    debug: false
});

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
let isOverText = (() => {
    let bonet = document.createElement("SPAN");
    return (ev) => {
        let mommy = ev.target;
        if (mommy == null) return false;
        for (let i = 0; i < mommy.childNodes.length; i++) {
            let baby = mommy.childNodes[i];
            if (baby.nodeType == Node.TEXT_NODE && baby.textContent.search(/\S/) != -1) {
                // debug("TEXT_NODE: '"+baby.textContent+"'")
                try {
                    bonet.appendChild(mommy.replaceChild(bonet,baby));
                    if (bonet.isSameNode(document.elementFromPoint(ev.clientX,ev.clientY))) return true;
                } finally {
                    if (baby.isSameNode(bonet.firstChild)) bonet.removeChild(baby);
                    if (bonet.isSameNode(mommy.childNodes[i])) mommy.replaceChild(baby,bonet);
                }
            }
        }
        return false;
    }
})();

// Test if a mouse event occurred over a scrollbar by testing if the
// coordinates of the event are on the outside of a scrollable element.
// The body element is treated separately since the visible size is
// fetched differently depending on the doctype.
function isOverScrollbar(ev) {
    let t = ev.target == document.documentElement ? document.body : ev.target;
    if (t == document.body) {
        let d = document.documentElement;
        let clientWidth;
        let clientHeight;
        if (d.scrollHeight == d.clientHeight &&
            d.scrollHeight == d.offsetHeight) {
            // Guessing it's a no doctype document
            clientWidth = t.clientWidth;
            clientHeight = t.clientHeight;
        } else {
            clientWidth = d.clientWidth;
            clientHeight = d.clientHeight;
        }
        return (ev.offsetX - t.scrollLeft >= clientWidth ||
                ev.offsetY - t.scrollTop >= clientHeight);
    }
    else if (!isScrollable(t)) return false;
    else return (ev.offsetX - t.scrollLeft >= t.clientWidth ||
                 ev.offsetY - t.scrollTop >= t.clientHeight);
}

// Can the given element be scrolled on either axis?
// That is, is the scroll size greater than the client size
// and the CSS overflow set to scroll or auto?
function isScrollable(e) {
    let o;
    if (e.scrollWidth > e.clientWidth) {
        o = document.defaultView.getComputedStyle(e)["overflow-x"];
        if (o == "auto" || o == "scroll") return true;
    }
    if (e.scrollHeight > e.clientHeight) {
        o = document.defaultView.getComputedStyle(e)["overflow-y"];
        if (o == "auto" || o == "scroll") return true;
    }
    return false;
}

// Return the first ancestor (or the element itself) that is scrollable
function findInnermostScrollable(e) {
    while (true) {
        if (e == document.documentElement) return document.body;
        if (e == null || e == document.body || isScrollable(e)) return e;
        e = e.parentNode;
    }
}

// Don't drag when left-clicking on these elements
const LBUTTON_OVERRIDE_TAGS = ["A","INPUT","SELECT","TEXTAREA","BUTTON","LABEL","OBJECT","EMBED"];
const MBUTTON_OVERRIDE_TAGS = ["A"];
const RBUTTON_OVERRIDE_TAGS = ["A","INPUT","TEXTAREA","OBJECT","EMBED"];
function hasOverrideAncestor(e) {
    while (e != null) {
        if (options.button == LBUTTON ? (LBUTTON_OVERRIDE_TAGS.indexOf(e.tagName)>=0
                                         || hasRoleButtonAttribute(e))
            : options.button == MBUTTON ? MBUTTON_OVERRIDE_TAGS.indexOf(e.tagName)>=0
            : options.button == RBUTTON ? RBUTTON_OVERRIDE_TAGS.indexOf(e.tagName)>=0
            : false)
            return true;
        e = e.parentNode;
    }
    return false;
}

function hasRoleButtonAttribute(e) {
    return e.attributes && e.attributes.role &&
           e.attributes.role.value === "button";
}

// === Clipboard Stuff ===
let Clipboard = (() => {
    let blockElement = null;

    function isPastable(e) {
        return e && e.tagName == "INPUT" || e.tagName == "TEXTAREA";
    }

    // Block the next paste event if a text element is active. This is a
    // workaround for middle-click paste not being preventable on Linux.
    function blockPaste() {
        let e = document.activeElement;
        if (blockElement != e) {
            if (blockElement) unblockPaste();
            if (isPastable(e)) {
                debug("blocking paste for active text element", e);
                blockElement = e;
                e.addEventListener("paste",onPaste,true);
            }
        }
    }

    function unblockPaste() {
        if (blockElement) {
            debug("unblocking paste", blockElement);
            blockElement.removeEventListener("paste",onPaste,true);
            blockElement = null;
        }
    }

    function onPaste(ev) {
        let e = ev.target;
        if (!e) return;
        if (blockElement == e) {
            blockElement = null;
            ev.preventDefault();
        }
        e.removeEventListener("paste", onPaste, true);
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
        scrollFixElement.style.top=0;
        scrollFixElement.style.right=0;
        scrollFixElement.style.bottom=0;
        scrollFixElement.style.left=0;
        scrollFixElement.style.zIndex=99999999;
        scrollFixElement.style.display="block";
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

                  if (y < 0)            y = 0;
        else if (y >= innerHeight) y = innerHeight-1;
                  if (x < 0)            x = 0;
        else if (x >= innerWidth)  x = innerWidth-1;

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
    let scrolling = false;
    let element;
    let scrollOrigin;
    let viewportSize;
    let scrollSize;
    let scrollListener;
    let scrollMultiplier;

    // Return the size of the element as it appears in parent's layout
    function getViewportSize(el) {
        if (el == document.body) return [window.innerWidth, window.innerHeight];
        else return [el.clientWidth, el.clientHeight];
    }

    function getScrollEventSource(el) {
        return el == document.body ? document : el;
    }

    // Start dragging given element
    function start(el) {
        if (element) stop();
        element = el;
        viewportSize = getViewportSize(el);
        scrollSize = [el.scrollWidth, el.scrollHeight];
        scrollOrigin = [el.scrollLeft, el.scrollTop];
        // grab-to-drag style
        scrollMultiplier = [-options.scaling, -options.scaling];
        // inverted: grab a virtual scrollbar
        // scrollMultiplier = [(scrollSize[0] / viewportSize[0]) * options.scaling,
        //                     (scrollSize[1] / viewportSize[1]) * options.scaling];
    }

    // Move the currently dragged element relative to the starting position
    // and applying the the scaling setting.
    // Return if/not the element actually moved (i.e. if it did not hit a
    // boundary on both axes).
    function move(pos) {
        if (element) {
            let x = element.scrollLeft;
            let y = element.scrollTop;
            try {
                scrolling = true;
                element.scrollLeft = scrollOrigin[0] + pos[0] * scrollMultiplier[0];
                element.scrollTop  = scrollOrigin[1] + pos[1] * scrollMultiplier[1];
            } finally {
                scrolling = false;
            }
            return element.scrollLeft != x || element.scrollTop != y;
        }
    }

    // Stop dragging
    function stop() {
        if (!element) return;
        element = null;
        viewportSize = null;
        scrollSize = null;
        scrollOrigin = null;
    }

    function listen(fn) {
        scrollListener = fn;
    }

    return ({ start, move, stop, listen });
})();

const LBUTTON=0, MBUTTON=1, RBUTTON=2;
const KEYS = ["shift","ctrl","alt","meta"];
const TIME_STEP = 10;

const STOP=0, CLICK=1, DRAG=2, GLIDE=3;
const ACTIVITIES = ["STOP","CLICK","DRAG","GLIDE"];
for (let i = 0; i < ACTIVITIES.length; i++)
    window[ACTIVITIES[i]] = i;

let activity = STOP;
let blockContextMenu = false;
let showScrollFix = false;
let mouseOrigin = null;
let dragElement = null;

function updateGlide() {
    if (activity == GLIDE) {
        debug("glide update");
        let moving = Motion.glide(performance.now());
        moving = Scroll.move(vsub(Motion.getPosition(),mouseOrigin)) && moving;
        if (moving) setTimeout(updateGlide,TIME_STEP);
        else stopGlide();
    }
}

function stopGlide() {
    debug("glide stop");
    activity = STOP;
    Motion.stop();
    Scroll.stop();
}

function updateDrag(ev) {
    debug("drag update");
    let v = [ev.clientX,ev.clientY];
    let moving = false;
    if (v[0] && v[1]) {
        moving = Motion.impulse(v,ev.timeStamp);
        Scroll.move(vsub(v,mouseOrigin));
    }
    return moving;
}

function startDrag(ev) {
    debug("drag start");
    activity = DRAG;
    document.body.style.cursor = "-webkit-grabbing";
    Scroll.start(dragElement);
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
        Scroll.stop();
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
            debug("wrong button, ignoring   ev.button="+ev.button+"   options.button="+options.button);
            break;
        }

        if (!KEYS.every(key => (options["key_"+key]+"" == "true") == ev[key+"Key"])) {
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

        dragElement = findInnermostScrollable(ev.target);
        if (!dragElement) {
            debug("no scrollable ancestor found, ignoring",ev);
            break;
        }

        if (options.notext && isOverText(ev)) {
            debug("detected text node, ignoring");
            break;
        }

        debug("click MouseEvent=",ev," dragElement=",dragElement);
        activity = CLICK;
        mouseOrigin = [ev.clientX,ev.clientY];
        Motion.impulse(mouseOrigin,ev.timeStamp);
        ev.preventDefault();
        if (ev.button == MBUTTON && ev.target != document.activeElement)
            Clipboard.blockPaste()
        if (ev.button == RBUTTON &&
            (navigator.platform.match(/Mac/) || navigator.platform.match(/Linux/)))
            blockContextMenu = true;
        showScrollFix = true
        break

    default:
        debug("WARNING: illegal activity for mousedown: "+ACTIVITIES[activity]);
        document.body.style.cursor = "auto";
        Clipboard.unblockPaste();
        ScrollFix.hide();
        activity = STOP;
        return onMouseDown(ev);
    }
}

function onMouseMove(ev) {
    switch (activity) {

    case STOP: break

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

    case DRAG:
        if (ev.button == options.button) {
            updateDrag(ev);
            ev.preventDefault();
        }
        break;

    case GLIDE: break;

    default:
        debug("WARNING: unknown state: "+activity);
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

    default:
        debug("WARNING: unknown state: "+activity);
        break;
    }
}

function onMouseOut(ev) {
    switch (activity) {

    case STOP: break;

    case CLICK: break;

    case DRAG:
        if (ev.toElement == null) stopDrag(ev);
        break;

    case GLIDE: break;

    default:
        debug("WARNING: unknown state: "+activity);
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

})();
