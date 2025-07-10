var TM_PREFIX = "<tsdk> ";
var LOG_PREFIX = "П8_БСУ: ";
var LIGHT_OFF_DELAY = 2;

var showerLightTimerId = null;

defineRule("showerMotion", {
    whenChanged: "Motion sensor-2 (БСУ)/occupancy",
    then: function (newValue, devName, cellName) {
            var offDelay = LIGHT_OFF_DELAY * 60 * 1000;
            if (newValue == "true") {
              log(TM_PREFIX + LOG_PREFIX + "{} - motion registered", devName);
              dev["wb-mr6c_209/K4"] = true;
              if (showerLightTimerId) {
                  log(TM_PREFIX + LOG_PREFIX + "{} - countdown aborted!", devName);
                  clearTimeout(showerLightTimerId);
              }

            } else if (newValue == "false") {
                log(TM_PREFIX + LOG_PREFIX + "{} - motion is Off. Countdown started..", devName);
                showerLightTimerId = setTimeout(function () {
                    log(TM_PREFIX + LOG_PREFIX + "{} - timer finished. Switching off", devName);
                     dev["wb-mr6c_209/K4"] = false;
                    showerLightTimerId = null;
                }, offDelay);
            } else {
                log.warning(TM_PREFIX + LOG_PREFIX + "{} - UNDEFINED STATE = {}!", devName, newValue);
            }
    }
});