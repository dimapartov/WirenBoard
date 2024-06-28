var humidityFlag = false;
var humidityThreshold = 70;
var durationThreshold = 30 * 60 * 1000; // milliseconds
var timerStarted = false;
var startTime = null;

defineRule("humidityNotification", {
    whenChanged: ["Humidity sensor-1 (БСУ, щит)/humidity"],
    then: function (newValue, devName, cellName) {
        var humidity = dev["Humidity sensor-1 (БСУ, щит)/humidity"];
        var doorIsOpen = !dev["Shower door switch/contact"];

        if (humidity >= 70 && humidityFlag == false) {
            SendTelegramMsg(0, "Уведомление. Влажность в душе достигла 70%");
            humidityFlag = true;
        } else if (humidity <= 65) {
            humidityFlag = false;
        }

        if (humidity > humidityThreshold && doorIsOpen == true) {
            if (!timerStarted) {
                timerStarted = true;
                startTime = new Date().getTime();
            } else if (new Date().getTime() - startTime >= durationThreshold) {
                dev["VirtSoundAlarm/triggeredByHumidity"] = true;
                dev["VirtSoundAlarm/isActive"] = true;
                timerStarted = false;
            }
        } else {
            timerStarted = false;
        }
    }
});