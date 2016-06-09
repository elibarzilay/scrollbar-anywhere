var KEYS = ["shift","ctrl","alt","meta"];

var $ = document.getElementById.bind(document);

function error(msg) {
    $("message").innerHTML += "<div style='color:red;'>"+msg+"</div>";
}

function save() {
    var x;
    var o = {};

    $("message").innerHTML = "";

    x = $("button").selectedIndex;
    if (x < 0 || x > 2) error("Somehow, you broke the button field");
    else o.button = x;

    x = $("scaling").value-0;
    if (isNaN(x)) error("Scaling must be a number");
    else o.scaling = x / 100

    x = $("speed").value-0;
    if (isNaN(x) || x < 0) error("Top speed must be a positive number or zero");
    else o.speed = x;

    x = $("friction").value-0;
    if (isNaN(x) || x < 0) error("Friction must be a positive number");
    else o.friction = x;

    for (var i = 0; i < KEYS.length; i++) {
        o["key_"+KEYS[i]] = $("key_"+KEYS[i]).checked;
    }

    o.notext = $("notext").checked;
    o.debug = $("debug").checked;

    chrome.extension.getBackgroundPage().saveOptions(o);
}

function load() {
    var o = chrome.extension.getBackgroundPage().loadOptions();

    $("button").selectedIndex = o.button;

    for (var i = 0; i < KEYS.length; i++) {
        $("key_"+KEYS[i]).checked = (o["key_"+KEYS[i]]+"" == "true");
    }

    $("scaling").value  = o.scaling * 100;
    $("speed").value    = o.speed;
    $("friction").value = o.friction;

    $("notext").checked = (o.notext == "true");
    $("debug").checked = (o.debug == "true");
}

var updateTimeoutId;

function onUpdate(ev) {
    if (updateTimeoutId != null) clearTimeout(updateTimeoutId);
    updateTimeoutId = setTimeout(save,200);
}

document.addEventListener("DOMContentLoaded", ev => {
    load();
    ["button","notext","debug"].forEach(id =>
        $(id).addEventListener("change",onUpdate,false));

    KEYS.forEach(key => $("key_"+key).addEventListener("change",onUpdate,false));

    ["scaling","speed","friction"].forEach(id => {
        $(id).addEventListener("change",    onUpdate, true);
        $(id).addEventListener("keydown",   onUpdate, true);
        $(id).addEventListener("mousedown", onUpdate, true);
        $(id).addEventListener("blur",      onUpdate, true);
    });
    (function() {
        var footerText = ["Here's a bunch of text to scroll:",""], beers = 99;
        function bottles(n, text) {
            footerText.push((n==0 ? "no more" : n)+" bottle"+(n==1?"":"s")
                            + " of beer"+text);
        }
        while (beers > 0) {
            bottles(beers," on the wall,");
            bottles(beers,"!");
            footerText.push("Take one down, pass it around");
            bottles(--beers," on the wall!");
            footerText.push("");
        }
        $("long_footer").innerHTML = footerText.join("<br>");
    })();
}, true);

document.addEventListener("unload", save, true);
