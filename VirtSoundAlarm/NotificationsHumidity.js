var humidityFlag = false;
var durationThreshold = 30 * 60 * 1000; // milliseconds
var timerStarted = false;
var startTime = null;

defineRule("humidityNotification", {
    whenChanged: ["Humidity sensor-1 (БСУ, щит)/humidity"],
    then: function (newValue, devName, cellName) {
        var humidity = newValue;
        var doorIsOpen = !dev["Shower door switch/contact"];

        if (humidity >= dev["AuxHumidity/humidityThresholdHi"] && humidityFlag == false) {
            SendTelegramMsg(0, "Уведомление. Влажность в душе достигла порога");
            humidityFlag = true;
        } else if (humidity <= dev["AuxHumidity/humidityThresholdLo"]) {
            humidityFlag = false;
        }

        if ((humidity > dev["AuxHumidity/humidityThresholdHi"]) && (doorIsOpen == true)) {
            if (!timerStarted) {
                timerStarted = true;
                startTime = Date.now();
            } else if (Date.now() - startTime >= durationThreshold) {
                dev["VirtSoundAlarm/triggeredByHumidity"] = true;
                dev["VirtSoundAlarm/isActive"] = true;
                timerStarted = false;
            }
        } else {
            timerStarted = false;
        }
    }
});