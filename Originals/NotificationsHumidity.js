var humidityFlag = false;

defineRule("humidityNotification", {
    whenChanged: ["Humidity sensor-1 (БСУ, щит)/humidity"],
    then: function(newValue, devName, cellName) {
        if (newValue >= 70 && humidityFlag === false) {
            SendTelegramMsg(0, "Уведомление. Влажность в душе достигла 70%");
            humidityFlag = true;
        }
        else if (newValue <= 65) {
            humidityFlag = false;
        }
    }
});