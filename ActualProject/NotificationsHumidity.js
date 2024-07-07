var humidityFlag = false;
var DURATION_THRESHOLD = 30 * 60 * 1000; // milliseconds
var timerStarted = false;
var startTime = null;

defineRule("humidityNotification", {
    whenChanged: ["Humidity sensor-1 (БСУ, щит)/humidity"],
    then: function (newValue, devName, cellName) {
        var humidity = newValue;
        var doorIsOpen = !dev["Shower door switch/contact"];

        if (humidity >= dev["AuxHumidity_virt/humidityThresholdHi"] && humidityFlag == false) {
            SendTelegramMsg(0, "Уведомление. Влажность в душе достигла порога");
            humidityFlag = true;
        } else if (humidity <= dev["AuxHumidity_virt/humidityThresholdLo"]) {
            humidityFlag = false;
        }

        if ((humidity > dev["AuxHumidity_virt/humidityThresholdHi"]) && (doorIsOpen == true)) {
            if (!timerStarted) {
                timerStarted = true;
                startTime = Date.now();
            } else if (Date.now() - startTime >= DURATION_THRESHOLD) {
                dev["SoundAlarm_virt/triggeredByHumidity"] = true;
                dev["SoundAlarm_virt/isActive"] = true;
                timerStarted = false;
            }
        } else {
            timerStarted = false;
        }
    }
});