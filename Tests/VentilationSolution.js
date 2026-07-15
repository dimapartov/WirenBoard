var topics = {
    AI_HUMIDITY: "Humidity sensor-1 (БСУ, щит)/humidity",
    DI_WALL_SWITCH: "wb-gpio/EXT2_IN7",
    DI_DOOR_CLOSED: "Shower door switch/contact",
    DI_MOTION: "Motion sensor-2 (БСУ)/occupancy",
    DO_FAN: "wb-mr6c_209/K5"
};
var controls = {
    AUTO_MODE: "bathroom_fan/auto_mode",
    HUMIDITY_MAX: "bathroom_fan/humidity_max",
    HUMIDITY_MIN: "bathroom_fan/humidity_min",
    DOOR_MODE: "bathroom_fan/door_mode",
    ON_DELAY: "bathroom_fan/on_delay",
    OFF_DELAY: "bathroom_fan/off_delay"
};
defineVirtualDevice("bathroom_fan", {
    title: "Управление вытяжкой",
    cells: {
        auto_mode: {
            title: "Автоматический режим",
            type: "switch",
            value: true
        },
        humidity_max: {
            title: "Порог включения по влажности, %",
            type: "range",
            value: 70,
            min: 30,
            max: 100
        },
        humidity_min: {
            title: "Порог выключения по влажности, %",
            type: "range",
            value: 60,
            min: 20,
            max: 95
        },
        door_mode: {
            title: "Управление по двери и движению",
            type: "switch",
            value: true
        },
        on_delay: {
            title: "Задержка включения, с",
            type: "range",
            value: 10,
            min: 0,
            max: 600
        },
        off_delay: {
            title: "Задержка выключения, с",
            type: "range",
            value: 300,
            min: 0,
            max: 3600
        }
    }
});
var ENTRY_CONFIRM_TIME_MS = 30000;
var PRESENCE_EMPTY = 0;
var PRESENCE_OCCUPIED = 1;
var fanOnTimer = null;
var fanOffTimer = null;
var humidityDemand = false;
var presenceState = PRESENCE_EMPTY;
var lastMotionTime = 0;
var previousDoorClosed = false;
var pressTime = 0;
function toBoolean(value) {
    return value === true ||
        value === 1 ||
        value === "1" ||
        value === "true";
}
function nowMs() {
    return Date.now();
}
function getDelay(controlName) {
    var delay = Number(dev[controlName]);
    if (isNaN(delay) || delay < 0) {
        return 0;
    }
    return delay;
}
function clearFanOnTimer() {
    if (fanOnTimer !== null) {
        clearTimeout(fanOnTimer);
        fanOnTimer = null;
    }
}
function clearFanOffTimer() {
    if (fanOffTimer !== null) {
        clearTimeout(fanOffTimer);
        fanOffTimer = null;
    }
}
function clearAllTimers() {
    clearFanOnTimer();
    clearFanOffTimer();
}
function setFanState(state) {
    var currentState = toBoolean(dev[topics.DO_FAN]);
    if (currentState !== state) {
        dev[topics.DO_FAN] = state;
    }
}
function updatePresenceState() {
    var doorModeEnabled = toBoolean(dev[controls.DOOR_MODE]);
    var doorClosed = toBoolean(dev[topics.DI_DOOR_CLOSED]);
    var motionDetected = toBoolean(dev[topics.DI_MOTION]);
    if (!doorModeEnabled) {
        presenceState = PRESENCE_EMPTY;
        previousDoorClosed = doorClosed;
        return;
    }
    if (motionDetected) {
        lastMotionTime = nowMs();
    }
    var doorJustOpened =
        previousDoorClosed && !doorClosed;
    var doorJustClosed =
        !previousDoorClosed && doorClosed;
    if (doorJustOpened) {
        presenceState = PRESENCE_EMPTY;
    }
    if (doorClosed && motionDetected) {
        presenceState = PRESENCE_OCCUPIED;
    }
    if (doorJustClosed) {
        var motionWasRecent =
            lastMotionTime > 0 &&
            nowMs() - lastMotionTime <= ENTRY_CONFIRM_TIME_MS;
        if (motionWasRecent) {
            presenceState = PRESENCE_OCCUPIED;
        }
    }
    if (!doorClosed) {
        presenceState = PRESENCE_EMPTY;
    }
    previousDoorClosed = doorClosed;
}
function updateHumidityDemand() {
    var humidity = Number(dev[topics.AI_HUMIDITY]);
    var humidityMax = Number(dev[controls.HUMIDITY_MAX]);
    var humidityMin = Number(dev[controls.HUMIDITY_MIN]);
    if (isNaN(humidity)) {
        return;
    }
    if (
        isNaN(humidityMax) ||
        isNaN(humidityMin) ||
        humidityMin >= humidityMax
    ) {
        humidityDemand = false;
        return;
    }
    if (humidity >= humidityMax) {
        humidityDemand = true;
    }
    if (humidity <= humidityMin) {
        humidityDemand = false;
    }
}
function getAutomaticDemand() {
    var humidity = Number(dev[topics.AI_HUMIDITY]);
    var humidityMax = Number(dev[controls.HUMIDITY_MAX]);
    var humidityMin = Number(dev[controls.HUMIDITY_MIN]);
    var doorModeEnabled = toBoolean(dev[controls.DOOR_MODE]);
    var doorClosed = toBoolean(dev[topics.DI_DOOR_CLOSED]);
    if (
        isNaN(humidity) ||
        isNaN(humidityMax) ||
        isNaN(humidityMin) ||
        humidityMin >= humidityMax
    ) {
        return false;
    }
    updatePresenceState();
    updateHumidityDemand();
    if (humidity <= humidityMin) {
        return false;
    }
    if (humidity >= humidityMax) {
        return true;
    }
    var presenceDemand =
        doorModeEnabled &&
        doorClosed &&
        presenceState === PRESENCE_OCCUPIED;
    return humidityDemand || presenceDemand;
}
function requestFanOn() {
    clearFanOffTimer();
    if (toBoolean(dev[topics.DO_FAN])) {
        clearFanOnTimer();
        return;
    }
    if (fanOnTimer !== null) {
        return;
    }
    var delaySeconds = getDelay(controls.ON_DELAY);
    if (delaySeconds === 0) {
        if (getAutomaticDemand()) {
            setFanState(true);
        }
        return;
    }
    fanOnTimer = setTimeout(function () {
        fanOnTimer = null;
        if (
            toBoolean(dev[controls.AUTO_MODE]) &&
            getAutomaticDemand()
        ) {
            setFanState(true);
        }
    }, delaySeconds * 1000);
}
function requestFanOff() {
    clearFanOnTimer();
    if (!toBoolean(dev[topics.DO_FAN])) {
        clearFanOffTimer();
        return;
    }
    if (fanOffTimer !== null) {
        return;
    }
    var delaySeconds = getDelay(controls.OFF_DELAY);
    if (delaySeconds === 0) {
        if (!getAutomaticDemand()) {
            setFanState(false);
        }
        return;
    }
    fanOffTimer = setTimeout(function () {
        fanOffTimer = null;
        if (
            toBoolean(dev[controls.AUTO_MODE]) &&
            !getAutomaticDemand()
        ) {
            setFanState(false);
        }
    }, delaySeconds * 1000);
}
function controlFan() {
    var autoModeEnabled =
        toBoolean(dev[controls.AUTO_MODE]);
    if (!autoModeEnabled) {
        clearAllTimers();
        humidityDemand = false;
        presenceState = PRESENCE_EMPTY;
        return;
    }
    var fanDemand = getAutomaticDemand();
    if (fanDemand) {
        requestFanOn();
    } else {
        requestFanOff();
    }
}
defineRule("bathroom_fan_button", {
    whenChanged: topics.DI_WALL_SWITCH,
    then: function (newValue) {
        if (toBoolean(newValue)) {
            pressTime = Date.now();
        } else {
            var releaseTime = Date.now();
            if (
                pressTime > 0 &&
                (releaseTime - pressTime) <= 1000
            ) {
                dev[topics.DO_FAN] =
                    !toBoolean(dev[topics.DO_FAN]);
            }
            pressTime = 0;
        }
    }
});
defineRule("bathroom_fan_control", {
    whenChanged: [
        topics.AI_HUMIDITY,
        topics.DI_DOOR_CLOSED,
        topics.DI_MOTION,
        controls.AUTO_MODE,
        controls.HUMIDITY_MAX,
        controls.HUMIDITY_MIN,
        controls.DOOR_MODE,
        controls.ON_DELAY,
        controls.OFF_DELAY
    ],
    then: function () {
        controlFan();
    }
});
setTimeout(function () {
    previousDoorClosed =
        toBoolean(dev[topics.DI_DOOR_CLOSED]);
    if (toBoolean(dev[topics.DI_MOTION])) {
        lastMotionTime = nowMs();
    }
    controlFan();
}, 1000);