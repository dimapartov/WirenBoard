var tmPrefix = "<tsdk> ";
var logPrefix = "LED: ";

// -----------------------------------------------------------------------------
// *** Main Kitchen LED control ***
// -----------------------------------------------------------------------------
defineRule('kitchenLed_OnOff', {
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
//
defineRule("kitchenLed_BrightnessCtrl", {
    when: cron("@every 1m"),
    then: function () {
        var date = new Date();
        var hours  = date.getHours();
        var minutes = date.getMinutes();
        var out = dev["wb-mrgbw-d-fw3_112/Channel 2 (R) Brightness"];
        var delta = Math.round((minutes*100)/60);
        //
        if (hours < 7) {
            out = led4BrightnessMin; // minimum brightness at night (00:00 to 7:00)
        } else if (hours >= 7 && hours < 21) {
            out = led4BrightnessMax;
        } else if (hours == 21) {
            out = led4BrightnessMax - (led4BrightnessMax - led4BrightnessMid)/100*delta;
        } else if (hours == 23) {
            out = led4BrightnessMid - (led4BrightnessMid - led4BrightnessMin)/100*delta;
        }
        // extra condition before actual writing to prevent frequent MQTT publishing
        if (dev["wb-mrgbw-d-fw3_112/Channel 2 (R) Brightness"] !== out) {
            dev["wb-mrgbw-d-fw3_112/Channel 2 (R) Brightness"] = out;
        }
    } // EOF
});
//
// -----------------------------------------------------------------------------
// *** Kitchen LED settings (virtual device cells) ***
// -----------------------------------------------------------------------------
var lightAutoCtrl_cells = {
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
    // Begin
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
    // End
    autoEndHH: {
        title: "Окончание АВТ периода: ЧЧ",
        type: "value",
        value: 23,
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
defineVirtualDevice('kitchenLedAuto', {
    title: 'LED лента. Кухня' ,
    cells: lightAutoCtrl_cells
});
// -----------------------------------------------------------------------------
// *** Kitchen LED Auto logic ***
// -----------------------------------------------------------------------------
var kitchenLed_timerID = null;

defineRule("kitchen_motion", {
    whenChanged: "Motion sensor. Kitchen/occupancy",
    then: function (newValue, devName, cellName) {
        if (dev["kitchenLedAuto/autoEn"] == true) {
            var date = new Date();
            // time point marking the beginning of the interval
            // i.e. "today, at HH:MM"
            var date_start = new Date(date);
            date_start.setHours(dev["kitchenLedAuto/autoBeginHH"]);
            date_start.setMinutes(dev["kitchenLedAuto/autoBeginMM"]);
            // time point marking the end of the interval
            var date_end = new Date(date);
            date_end.setHours(dev["kitchenLedAuto/autoEndHH"]);
            date_end.setMinutes(dev["kitchenLedAuto/autoEndMM"]);
            //
            var offDelay = dev["kitchenLedAuto/offDelay_min"] * 60 * 1000;
            //
            if (newValue == "true") {
                if ( ((date > date_start) && (date < date_end)) || (dev["kitchenLedAuto/roundTheClock"] == true) ) { // time interval validation
                    log(tmPrefix + logPrefix + "{} - motion in Range", devName);
                    dev["wb-mrgbw-d-fw3_112/Channel 2 (R)"] = true;
                    if (kitchenLed_timerID) {
                        log(tmPrefix + logPrefix + "{} - countdown aborted!", devName);
                        clearTimeout(kitchenLed_timerID);
                    }
                } else { // out of range and not 24h mode
                    log(tmPrefix + logPrefix + "{} - motion Out of Range", devName);
                } // end of time interval validation

            } else { // newValue != "true"
                if (newValue == "false") {
                    log(tmPrefix + logPrefix + "{} - motion is Off. Countdown started..", devName);
                    kitchenLed_timerID = setTimeout(function () {
                        log(tmPrefix + logPrefix + "{} - timer finished. Switching off", devName);
                        dev["wb-mrgbw-d-fw3_112/Channel 2 (R)"] = false;
                        kitchenLed_timerID = null;
                    }, offDelay);
                } else {
                    log.warning(tmPrefix + logPrefix + "{} - UNDEFINED STATE = {}!", devName, newValue);
                }
            } // if (newValue == "true")

        } else { // !autoEn
            log (tmPrefix + logPrefix + "{} - switched {} whilst Auto is disabled", devName, newValue);
        } //  if (dev["kitchenLedAuto/autoEn"])

    } // function
});