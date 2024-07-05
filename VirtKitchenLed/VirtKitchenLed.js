var TM_PREFIX = "<tsdk> ";
var LOG_PREFIX = "LED: ";

// -----------------------------------------------------------------------------
// *** Main Kitchen LED control ***
// -----------------------------------------------------------------------------
defineRule("kitchenLed_OnOff", {
    whenChanged: "wb-gpio/EXT4_IN1",
    then: function (newValue, devName, cellName) {
        dev["wb-mrgbw-d-fw3_112/Channel 2 (R)"] = !dev["wb-mrgbw-d-fw3_112/Channel 2 (R)"];
    }
});

// -----------------------------------------------------------------------------
// *** Kitchen LED brightness control ***
// -----------------------------------------------------------------------------
var led4BrightnessMax = 90;
var led4BrightnessMid = 40;
var led4BrightnessMin = 10;

defineRule("kitchenLed_BrightnessCtrl", {
    when: cron("@every 1m"),
    then: function () {
        var date = new Date();
        var hours = date.getHours();
        var minutes = date.getMinutes();
        var out = dev["wb-mrgbw-d-fw3_112/Channel 2 (R) Brightness"];
        var delta = Math.round((minutes * 100) / 60);

        if (hours < 7) {
            out = led4BrightnessMin; // minimum brightness at night (00:00 to 7:00)
        } else if (hours >= 7 && hours < 21) {
            out = led4BrightnessMax;
        } else if (hours == 21) {
            out = led4BrightnessMax - (led4BrightnessMax - led4BrightnessMid) / 100 * delta;
        } else if (hours == 23) {
            out = led4BrightnessMid - (led4BrightnessMid - led4BrightnessMin) / 100 * delta;
        }
        // extra condition before actual writing to prevent frequent MQTT publishing
        if (dev["wb-mrgbw-d-fw3_112/Channel 2 (R) Brightness"] !== out) {
            dev["wb-mrgbw-d-fw3_112/Channel 2 (R) Brightness"] = out;
        }
    }
});

// -----------------------------------------------------------------------------
// *** Kitchen LED settings (virtual device cells) ***
// -----------------------------------------------------------------------------
var KITCHEN_LED_CTRL_CELLS = {
    autoEn: {
        title: "Авто управление",
        type: "switch",
        value: false,
        readonly: false,
        order: 1,
    },
    roundTheClock: {
        title: "Круглосуточно",
        type: "switch",
        value: false,
        readonly: false,
        order: 2,
    },
    autoBeginHH: {
        title: "Начало АВТ периода: ЧЧ",
        type: "value",
        value: 17,
        readonly: false,
        order: 3,
    },
    autoBeginMM: {
        title: "Начало АВТ периода: ММ",
        type: "value",
        value: 0,
        readonly: false,
        order: 4,
    },
    autoEndHH: {
        title: "Окончание АВТ периода: ЧЧ",
        type: "value",
        value: 1,
        readonly: false,
        order: 5,
    },
    autoEndMM: {
        title: "Окончание АВТ периода: ММ",
        type: "value",
        value: 0,
        readonly: false,
        order: 6,
    },
    offDelay_min: {
        title: "Задержка отключения, мин",
        type: "range",
        value: 10,
        min: 5,
        max: 15,
        precision: 1.0,
        readonly: false,
        order: 7,
    },
};

defineVirtualDevice("KitchenLed_virt", {
    title: "LED лента. Кухня",
    cells: KITCHEN_LED_CTRL_CELLS
});

// -----------------------------------------------------------------------------
// *** Kitchen LED Auto logic ***
// -----------------------------------------------------------------------------
var kitchenLedTimerId = null;

defineRule("kitchenMotion", {
    whenChanged: "Motion sensor. Kitchen/occupancy",
    then: function (newValue, devName, cellName) {
        if (dev["KitchenLed_virt/autoEn"] == true) {
            if (newValue == "true") {
                if (IsWithinAllowedInterval(dev["KitchenLed_virt/autoBeginHH"],
                                            dev["KitchenLed_virt/autoBeginMM"],
                                            dev["KitchenLed_virt/autoEndHH"],
                                            dev["KitchenLed_virt/autoEndMM"]) == true || dev["KitchenLed_virt/roundTheClock"] == true) {
                    log(TM_PREFIX + LOG_PREFIX + "{} - motion in Range", devName);
                    dev["wb-mrgbw-d-fw3_112/Channel 2 (R)"] = true;
                    if (kitchenLedTimerId) {
                        log(TM_PREFIX + LOG_PREFIX + "{} - countdown aborted!", devName);
                        clearTimeout(kitchenLedTimerId);
                    }
                } else {
                    log(TM_PREFIX + LOG_PREFIX + "{} - motion Out of Range", devName);
                }
            } else if (newValue == "false") {
                log(TM_PREFIX + LOG_PREFIX + "{} - motion is Off. Countdown started..", devName);
                kitchenLedTimerId = setTimeout(function () {
                    log(TM_PREFIX + LOG_PREFIX + "{} - timer finished. Switching off", devName);
                    dev["wb-mrgbw-d-fw3_112/Channel 2 (R)"] = false;
                    kitchenLedTimerId = null;
                }, offDelay);
            } else {
                log.warning(TM_PREFIX + LOG_PREFIX + "{} - UNDEFINED STATE = {}!", devName, newValue);
            }
        } else {
            log(TM_PREFIX + LOG_PREFIX + "{} - switched {} whilst Auto is disabled", devName, newValue);
        }
    }
});